# DeepSeek 把随心口述收成中控契约。密钥只在本机 .env。
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SYSTEM = """你是睡眠中控的编译器。用户会随口说怎么采集、怎么叫醒。你只输出一个 JSON 对象，不要 markdown。

中控只认三条事实：presence（在床/有人，布尔）、motion（体动，布尔）、stage（wake/light/deep/rem）。
采集和叫醒都是契约。不要发明雷达型号、不要写 PSG、不要写大模型夜里推理。没有硬件时用 pad 点选或 HTTP POST /ingest。

允许的步骤 type 只能是：
- wait_until: {type, time}  time 为 HH:MM 24小时
- wait_minutes: {type, minutes} 数字
- wait_seconds: {type, seconds} 数字
- wait_fact: {type, fact, equals}  fact 为 presence|motion|stage。presence/motion 的 equals 为 true/false；stage 的 equals 为 wake|light|deep|rem
- screen_dawn: {type, durationMin} 数字分钟
- pc_beep: {type, seconds}
- notify: {type, title, body}
- log: {type, text}
- http_out: {type, url, body}

规则：
1. 用户没提时钟，就不要 wait_until。
2. 提到浅睡：先 wait_fact stage=light。深睡同理 deep。有人/在床：presence true。体动：motion true。
3. 提到慢慢亮/黎明/屏幕：screen_dawn。慢慢亮默认 20 分钟，否则 15。
4. 提到响铃/电脑响：pc_beep 8 秒。
5. 提到灯带/LED/ESP/板子：加 http_out。用户给了 http(s) 地址就用；只给 IPv4 就补 http://IP/dawn；都没有则 url 用 ORIGIN/dawn，body 为 {\"progress\":1}。
6. 提到推手机/ntfy/震动：http_out url=https://ntfy.sh/NTFY_TOPIC，body 短中文。没有主题就用用户消息里的 NTFY_TOPIC。
7. 灯带和 ntfy 可以同时有，不要互相覆盖。
8. 采集若说手环/脚本/POST：sources 里加一个 type=http 的源，fact 与等待的事实一致。若说自己点/没硬件：不要编源，用已有 pad。
9. 不要输出未知字段。steps 按执行顺序。至少一步叫醒。
10. name 短中文。gaps 写还缺什么（没有就空数组）。

输出形状：
{
  "name": "口述浅睡窗口",
  "gaps": [],
  "sources": [{"name":"室友手环","type":"http","sourceKey":"roommate-band","fact":"stage","note":"HTTP source=roommate-band 写 stage"}],
  "steps": []
}
"""


def load_env():
    env = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    key = os.environ.get("DEEPSEEK_API_KEY") or env.get("DEEPSEEK_API_KEY") or ""
    model = os.environ.get("DEEPSEEK_MODEL") or env.get("DEEPSEEK_MODEL") or "deepseek-v4-flash"
    base = os.environ.get("DEEPSEEK_BASE_URL") or env.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
    return key, model, base.rstrip("/")


def available():
    key, _, _ = load_env()
    return bool(key)


def _parse_json_text(text):
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _num(v, lo, hi, default):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return default
    if n < lo:
        return lo
    if n > hi:
        return hi
    if abs(n - int(n)) < 1e-9:
        return int(n)
    return n


def _clock(v):
    s = str(v or "").strip()
    m = re.match(r"^(\d{1,2}):(\d{2})$", s)
    if not m:
        return ""
    h = max(0, min(23, int(m.group(1))))
    mi = max(0, min(59, int(m.group(2))))
    return "%02d:%02d" % (h, mi)


def sanitize(raw, origin, topic=""):
    if not isinstance(raw, dict):
        raise ValueError("模型没有返回对象")
    origin = str(origin or "http://127.0.0.1:8792").rstrip("/")
    topic = re.sub(r"[^a-zA-Z0-9_-]", "", str(topic or ""))[:64] or "sleep-hub"
    steps = []
    for st in raw.get("steps") or []:
        if not isinstance(st, dict):
            continue
        t = str(st.get("type") or "")
        if t == "wait_until":
            time = _clock(st.get("time"))
            if time:
                steps.append({"type": t, "time": time})
        elif t == "wait_minutes":
            steps.append({"type": t, "minutes": _num(st.get("minutes"), 1, 180, 5)})
        elif t == "wait_seconds":
            steps.append({"type": t, "seconds": _num(st.get("seconds"), 1, 600, 8)})
        elif t == "wait_fact":
            fact = str(st.get("fact") or "presence")
            if fact not in ("presence", "motion", "stage"):
                continue
            eq = st.get("equals")
            if fact == "stage":
                eq = str(eq or "light")
                if eq not in ("wake", "light", "deep", "rem"):
                    eq = "light"
            else:
                eq = str(eq).lower() not in ("false", "0", "no", "否")
            steps.append({"type": t, "fact": fact, "equals": eq})
        elif t == "screen_dawn":
            steps.append({"type": t, "durationMin": _num(st.get("durationMin"), 0.1, 90, 15)})
        elif t == "pc_beep":
            steps.append({"type": t, "seconds": _num(st.get("seconds"), 1, 60, 8)})
        elif t == "notify":
            steps.append(
                {
                    "type": t,
                    "title": str(st.get("title") or "该起床了")[:40],
                    "body": str(st.get("body") or "")[:80],
                }
            )
        elif t == "log":
            steps.append({"type": t, "text": str(st.get("text") or "方案走到这里")[:80]})
        elif t == "http_out":
            url = str(st.get("url") or "").strip()
            url = url.replace("{topic}", topic).replace("NTFY_TOPIC", topic)
            if re.match(r"^\d{1,3}(?:\.\d{1,3}){3}", url):
                if not url.startswith("http"):
                    url = "http://" + url
                if "/dawn" not in url:
                    url = url.rstrip("/") + "/dawn"
            if not (url.startswith("http://") or url.startswith("https://")):
                url = origin + "/dawn"
            body = str(st.get("body") or "")
            if "/dawn" in url:
                body = '{"progress":1}'
            if "ntfy.sh" in url and not body:
                body = "该起床了 · 睡眠中控"
            steps.append({"type": t, "url": url[:240], "body": body[:500]})
    if not steps:
        steps = [
            {"type": "screen_dawn", "durationMin": 15},
            {"type": "pc_beep", "seconds": 8},
        ]
    sources = []
    for s in raw.get("sources") or []:
        if not isinstance(s, dict):
            continue
        if str(s.get("type") or "") != "http":
            continue
        key = re.sub(r"[^a-z0-9_-]+", "-", str(s.get("sourceKey") or "my-device").lower()).strip("-")[:32]
        fact = str(s.get("fact") or "presence")
        if fact not in ("presence", "motion", "stage"):
            fact = "presence"
        sources.append(
            {
                "name": str(s.get("name") or "我的 HTTP 源")[:24],
                "type": "http",
                "sourceKey": key or "my-device",
                "fact": fact,
                "enabled": True,
                "note": str(s.get("note") or ("HTTP source=" + key + " 写入 " + fact))[:80],
            }
        )
    gaps = [str(g)[:120] for g in (raw.get("gaps") or []) if str(g).strip()][:6]
    name = str(raw.get("name") or "口述今夜")[:24]
    briefs = []
    for st in steps:
        t = st["type"]
        if t == "wait_until":
            briefs.append("等到 " + st["time"])
        elif t == "wait_fact":
            if st["fact"] == "stage":
                labels = {"wake": "醒", "light": "浅睡", "deep": "深睡", "rem": "REM"}
                briefs.append("等 " + labels.get(st["equals"], str(st["equals"])))
            else:
                briefs.append("等 " + st["fact"])
        elif t == "screen_dawn":
            briefs.append("屏幕黎明")
        elif t == "pc_beep":
            briefs.append("响铃")
        elif t == "http_out":
            briefs.append("灯带" if "/dawn" in st.get("url", "") else "HTTP 发出")
        else:
            briefs.append(t)
    report = "DeepSeek 编译 " + " → ".join(briefs)
    if sources:
        report += "；源 " + "、".join(s["name"] + "/" + s["sourceKey"] for s in sources)
    if gaps:
        report += "；缺项 " + str(len(gaps))
    return {
        "ok": True,
        "name": name,
        "gaps": gaps,
        "sources": sources,
        "steps": steps,
        "report": report,
    }


def _post_ds(key, base, body):
    req = urllib.request.Request(
        base + "/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=55) as resp:
        return json.loads(resp.read().decode("utf-8"))


def compile_nl(sense, apply, origin, topic=""):
    key, model, base = load_env()
    if not key:
        raise RuntimeError("没有 DeepSeek 密钥")
    origin = str(origin or "http://127.0.0.1:8792").rstrip("/")
    topic = re.sub(r"[^a-zA-Z0-9_-]", "", str(topic or ""))[:64] or "sleep-hub"
    user = (
        "ORIGIN="
        + origin
        + "\nNTFY_TOPIC="
        + topic
        + "\n采集：\n"
        + (sense or "（空）")
        + "\n叫醒：\n"
        + (apply or "（空）")
    )
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM.replace("ORIGIN/dawn", origin + "/dawn")},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "max_tokens": 900,
        "response_format": {"type": "json_object"},
        "thinking": {"type": "disabled"},
    }
    try:
        raw = _post_ds(key, base, body)
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", "ignore")[:200]
        if e.code == 400 and "thinking" in body:
            body.pop("thinking", None)
            try:
                raw = _post_ds(key, base, body)
            except urllib.error.HTTPError as e2:
                raise RuntimeError(
                    "DeepSeek HTTP %s: %s" % (e2.code, e2.read().decode("utf-8", "ignore")[:200])
                )
        else:
            raise RuntimeError("DeepSeek HTTP %s: %s" % (e.code, err))
    message = ((raw.get("choices") or [{}])[0].get("message") or {})
    msg = message.get("content") or message.get("reasoning_content") or ""
    if not msg.strip():
        raise RuntimeError("DeepSeek 返回空")
    parsed = _parse_json_text(msg)
    return sanitize(parsed, origin, topic)


CHAT_SYSTEM = """你是睡眠中控第三版的对话编译器。用户会多轮聊天，也可能附上文件（日志、jsonl、说明、代码、截图）。你先读附件再回答。

始终只输出一个 JSON 对象，不要 markdown 围栏：
{
  "reply": "给用户看的中文。用短句。不要把完整方案 JSON 贴进 reply。",
  "recipe": null
}

中控只认三条事实：presence（在床/有人，布尔）、motion（体动，布尔）、stage（wake/light/deep/rem）。
采集和叫醒都是契约。不要发明雷达型号、不要写 PSG、不要写大模型夜里推理。没有硬件时用 pad 点选或 HTTP POST /ingest。

recipe 若不是 null，必须是：
{
  "name": "短中文",
  "gaps": [],
  "sources": [{"name":"室友手环","type":"http","sourceKey":"roommate-band","fact":"stage","note":"..."}],
  "steps": []
}

允许的步骤 type 只能是：
- wait_until: {type, time}  time 为 HH:MM
- wait_minutes: {type, minutes}
- wait_seconds: {type, seconds}
- wait_fact: {type, fact, equals}  fact 为 presence|motion|stage
- screen_dawn: {type, durationMin}
- pc_beep: {type, seconds}
- notify: {type, title, body}
- log: {type, text}
- http_out: {type, url, body}

编译规则与第二版相同：没提时钟就不要 wait_until；浅睡则 wait_fact stage=light；慢慢亮用 screen_dawn；响铃 pc_beep 8 秒；灯带/ESP 用 http_out，没地址则 url=ORIGIN/dawn；推手机用 https://ntfy.sh/NTFY_TOPIC。sources 仅在用户要用 HTTP 脚本/手环接入时添加。

recipe 何时填写：
- 用户在问、还没说定：recipe 必须为 null，reply 里可以先讲你会怎么编。
- 用户说编译、写入中控、就按这个、可以了，或口述已经完整可执行：填写 recipe。
- 附件里已经写清采集、叫醒，且用户让你根据文件做方案：填写 recipe。

读文件：
- 引用时用文件名。
- 看不懂或像乱码，在 reply 里说缺什么，不要瞎编。
- 不要把附件全文复述进 reply。
"""


def _clip_files(files):
    texts = []
    images = []
    used = 0
    if not isinstance(files, list):
        return texts, images
    for f in files[:6]:
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or "file")[:80]
        image = str(f.get("image") or "")
        if image.startswith("data:image") and len(image) <= 400000:
            images.append({"name": name, "url": image})
            continue
        text = str(f.get("text") or "")
        if not text.strip():
            continue
        if len(text) > 80000:
            text = text[:80000] + "\n…(截断)"
        if used + len(text) > 240000:
            continue
        used += len(text)
        texts.append({"name": name, "text": text})
    return texts, images


def _history(raw):
    out = []
    if not isinstance(raw, list):
        return out
    for m in raw[-16:]:
        if not isinstance(m, dict):
            continue
        role = "assistant" if m.get("role") == "assistant" else "user"
        content = str(m.get("content") or "").strip()[:4000]
        if not content:
            continue
        out.append({"role": role, "content": content})
    return out


def _complete_json(key, model, base, messages, max_tokens=1400, temperature=0.3):
    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "thinking": {"type": "disabled"},
    }
    try:
        raw = _post_ds(key, base, body)
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", "ignore")[:200]
        if e.code == 400 and "thinking" in body:
            body.pop("thinking", None)
            try:
                raw = _post_ds(key, base, body)
            except urllib.error.HTTPError as e2:
                raise RuntimeError(
                    "DeepSeek HTTP %s: %s" % (e2.code, e2.read().decode("utf-8", "ignore")[:200])
                )
        else:
            raise RuntimeError("DeepSeek HTTP %s: %s" % (e.code, err))
    message = ((raw.get("choices") or [{}])[0].get("message") or {})
    msg = message.get("content") or message.get("reasoning_content") or ""
    if not str(msg).strip():
        raise RuntimeError("DeepSeek 返回空")
    return _parse_json_text(msg)


def chat_turn(messages, files, origin, topic=""):
    key, model, base = load_env()
    if not key:
        raise RuntimeError("没有 DeepSeek 密钥")
    origin = str(origin or "http://127.0.0.1:8792").rstrip("/")
    topic = re.sub(r"[^a-zA-Z0-9_-]", "", str(topic or ""))[:64] or "sleep-hub"
    texts, images = _clip_files(files)
    sys = (
        CHAT_SYSTEM.replace("ORIGIN/dawn", origin + "/dawn")
        + "\n\nORIGIN="
        + origin
        + "\nNTFY_TOPIC="
        + topic
    )
    file_note = "\n\n".join("### %s\n%s" % (f["name"], f["text"]) for f in texts)
    img_note = "用户还附了图片：" + "、".join(i["name"] for i in images) if images else ""
    hist = _history(messages)
    if not hist and not file_note and not images:
        return {"reply": "先说怎么采集、怎么叫醒，或把文件丢进来。", "recipe": None}
    last = hist[-1] if hist else {"role": "user", "content": "请阅读附件。"}
    prefix_parts = []
    if file_note:
        prefix_parts.append("附件如下：\n" + file_note)
    if img_note:
        prefix_parts.append(img_note)
    prefix = "\n".join(prefix_parts)
    last_text = (prefix + "\n\n用户：\n" + last["content"]) if prefix else last["content"]
    ds = [{"role": "system", "content": sys}]
    ds.extend(hist[:-1])
    if images:
        content = [{"type": "text", "text": last_text or "请阅读这些图片。"}]
        for img in images:
            content.append({"type": "image_url", "image_url": {"url": img["url"]}})
        ds.append({"role": "user", "content": content})
    else:
        ds.append({"role": "user", "content": last_text})
    try:
        parsed = _complete_json(key, model, base, ds)
    except RuntimeError as e:
        if images and re.search(r"image|vision|content", str(e), re.I):
            ds[-1] = {
                "role": "user",
                "content": last_text + "\n（图片未能识别，请只根据文字回答）",
            }
            parsed = _complete_json(key, model, base, ds)
        else:
            raise
    reply = str((parsed or {}).get("reply") or "").strip() or "我看过了。"
    recipe = None
    raw_recipe = (parsed or {}).get("recipe")
    if isinstance(raw_recipe, dict):
        try:
            recipe = sanitize(raw_recipe, origin, topic)
        except Exception:
            recipe = None
    return {"reply": reply[:4000], "recipe": recipe}
