const SYSTEM = `你是睡眠中控的编译器。用户会随口说怎么采集、怎么叫醒。你只输出一个 JSON 对象，不要 markdown。

中控只认三条事实：presence（在床/有人，布尔）、motion（体动，布尔）、stage（wake/light/deep/rem）。
采集和叫醒都是契约。不要发明雷达型号、不要写 PSG、不要写大模型夜里推理。没有硬件时用 pad 点选或 HTTP POST /ingest。

允许的步骤 type 只能是：
- wait_until: {type, time}  time 为 HH:MM 24小时
- wait_near: {type, time, minutes} 起床时刻，提前多少分钟进入窗口
- wait_minutes: {type, minutes} 数字
- wait_seconds: {type, seconds} 数字
- wait_fact: {type, fact, equals}  fact 为 presence|motion|stage。presence/motion 的 equals 为 true/false；stage 的 equals 为 wake|light|deep|rem
- screen_dawn: {type, durationMin} 数字分钟
- pc_beep: {type, seconds}
- notify: {type, title, body}
- log: {type, text}
- http_out: {type, url, body}

规则：
1. 用户没提时钟，就不要 wait_until / wait_near。
2. 提到浅睡：先 wait_fact stage=light。深睡同理 deep。有人/在床：presence true。体动或翻身：motion true。接近起床+翻身：wait_near 再 wait_fact motion。
3. 提到慢慢亮/黎明/屏幕：screen_dawn。慢慢亮默认 20 分钟，否则 15。
4. 提到响铃/电脑响：pc_beep 8 秒。
5. 提到灯带/LED/ESP/板子：加 http_out。用户给了 http(s) 地址就用；只给 IPv4 就补 http://IP/dawn；都没有则 url 用 ORIGIN/dawn，body 为 {"progress":1}。
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
`;

function num(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : n;
}

function clock(v) {
  const m = String(v || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const h = Math.max(0, Math.min(23, Number(m[1])));
  const mi = Math.max(0, Math.min(59, Number(m[2])));
  return String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
}

function parseJsonText(text) {
  let s = String(text || "").trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  return JSON.parse(s);
}

export function nlAvailable() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export function sanitize(raw, origin, topic = "") {
  if (!raw || typeof raw !== "object") throw new Error("模型没有返回对象");
  origin = String(origin || "http://127.0.0.1:8792").replace(/\/$/, "");
  topic = String(topic || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "sleep-hub";
  const steps = [];
  for (const st of raw.steps || []) {
    if (!st || typeof st !== "object") continue;
    const t = String(st.type || "");
        if (t === "wait_until") {
      const time = clock(st.time);
      if (time) steps.push({ type: t, time });
    } else if (t === "wait_near") {
      const time = clock(st.time);
      if (time) steps.push({ type: t, time, minutes: num(st.minutes, 1, 180, 20) });
    } else if (t === "wait_minutes") {
      steps.push({ type: t, minutes: num(st.minutes, 1, 180, 5) });
    } else if (t === "wait_seconds") {
      steps.push({ type: t, seconds: num(st.seconds, 1, 600, 8) });
    } else if (t === "wait_fact") {
      let fact = String(st.fact || "presence");
      if (!["presence", "motion", "stage"].includes(fact)) continue;
      let eq = st.equals;
      if (fact === "stage") {
        eq = String(eq || "light");
        if (!["wake", "light", "deep", "rem"].includes(eq)) eq = "light";
      } else {
        eq = !["false", "0", "no", "否"].includes(String(eq).toLowerCase());
      }
      steps.push({ type: t, fact, equals: eq });
    } else if (t === "screen_dawn") {
      steps.push({ type: t, durationMin: num(st.durationMin, 0.1, 90, 15) });
    } else if (t === "pc_beep") {
      steps.push({ type: t, seconds: num(st.seconds, 1, 60, 8) });
    } else if (t === "notify") {
      steps.push({
        type: t,
        title: String(st.title || "该起床了").slice(0, 40),
        body: String(st.body || "").slice(0, 80),
      });
    } else if (t === "log") {
      steps.push({ type: t, text: String(st.text || "方案走到这里").slice(0, 80) });
    } else if (t === "http_out") {
      let url = String(st.url || "").trim();
      url = url.replaceAll("{topic}", topic).replaceAll("NTFY_TOPIC", topic);
      if (/^\d{1,3}(?:\.\d{1,3}){3}/.test(url)) {
        if (!url.startsWith("http")) url = "http://" + url;
        if (!url.includes("/dawn")) url = url.replace(/\/$/, "") + "/dawn";
      }
      if (!(url.startsWith("http://") || url.startsWith("https://"))) url = origin + "/dawn";
      let body = String(st.body || "");
      if (url.includes("/dawn")) body = '{"progress":1}';
      if (url.includes("ntfy.sh") && !body) body = "该起床了 · 睡眠中控";
      steps.push({ type: t, url: url.slice(0, 240), body: body.slice(0, 500) });
    }
  }
  if (!steps.length) {
    steps.push({ type: "screen_dawn", durationMin: 15 }, { type: "pc_beep", seconds: 8 });
  }
  const sources = [];
  for (const s of raw.sources || []) {
    if (!s || typeof s !== "object") continue;
    if (String(s.type || "") !== "http") continue;
    const key = String(s.sourceKey || "my-device")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32);
    let fact = String(s.fact || "presence");
    if (!["presence", "motion", "stage"].includes(fact)) fact = "presence";
    sources.push({
      name: String(s.name || "我的 HTTP 源").slice(0, 24),
      type: "http",
      sourceKey: key || "my-device",
      fact,
      enabled: true,
      note: String(s.note || "HTTP source=" + key + " 写入 " + fact).slice(0, 80),
    });
  }
  const gaps = (raw.gaps || []).map((g) => String(g).slice(0, 120)).filter((g) => g.trim()).slice(0, 6);
  const name = String(raw.name || "口述今夜").slice(0, 24);
  const briefs = steps.map((st) => {
    if (st.type === "wait_until") return "等到 " + st.time;
    if (st.type === "wait_near") return "接近 " + st.time;
    if (st.type === "wait_fact") {
      if (st.fact === "stage") {
        const labels = { wake: "醒", light: "浅睡", deep: "深睡", rem: "REM" };
        return "等 " + (labels[st.equals] || String(st.equals));
      }
      return "等 " + st.fact;
    }
    if (st.type === "screen_dawn") return "屏幕黎明";
    if (st.type === "pc_beep") return "响铃";
    if (st.type === "http_out") return String(st.url || "").includes("/dawn") ? "灯带" : "HTTP 发出";
    return st.type;
  });
  let report = "DeepSeek 编译 " + briefs.join(" → ");
  if (sources.length) report += "；源 " + sources.map((s) => s.name + "/" + s.sourceKey).join("、");
  if (gaps.length) report += "；缺项 " + gaps.length;
  return { ok: true, name, gaps, sources, steps, report };
}

async function postDs(key, base, body) {
  const res = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error("DeepSeek HTTP " + res.status + ": " + text.slice(0, 200));
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return JSON.parse(text);
}

async function completeJson(messages, { maxTokens = 1200, temperature = 0.2 } = {}) {
  const key = process.env.DEEPSEEK_API_KEY || "";
  if (!key) throw new Error("没有 DeepSeek 密钥");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
  };
  let raw;
  try {
    raw = await postDs(key, base, body);
  } catch (e) {
    if (e.status === 400 && body.thinking) {
      delete body.thinking;
      raw = await postDs(key, base, body);
    } else {
      throw e;
    }
  }
  const message = (((raw || {}).choices || [])[0] || {}).message || {};
  const msg = message.content || message.reasoning_content || "";
  if (!String(msg).trim()) throw new Error("DeepSeek 返回空");
  return parseJsonText(msg);
}

const CHAT_SYSTEM = `你是睡眠中控第三版的对话编译器。用户会多轮聊天，也可能附上文件（日志、jsonl、说明、代码、截图）。你先读附件再回答。

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
- 附件里已经写清采集/叫醒，且用户让你根据文件做方案：填写 recipe。

读文件：
- 引用时用文件名。
- 看不懂或像乱码，在 reply 里说缺什么，不要瞎编。
- 不要把附件全文复述进 reply。
`;

function clipFiles(files) {
  const list = Array.isArray(files) ? files : [];
  const texts = [];
  const images = [];
  let used = 0;
  for (const f of list.slice(0, 6)) {
    if (!f || typeof f !== "object") continue;
    const name = String(f.name || "file").slice(0, 80);
    const image = String(f.image || "");
    if (image.startsWith("data:image") && image.length <= 400000) {
      images.push({ name, url: image });
      continue;
    }
    let text = String(f.text || "");
    if (!text.trim()) continue;
    if (text.length > 80000) text = text.slice(0, 80000) + "\n…(截断)";
    if (used + text.length > 240000) continue;
    used += text.length;
    texts.push({ name, text });
  }
  return { texts, images };
}

function historyMessages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const m of list.slice(-16)) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = String(m.content || "").trim().slice(0, 4000);
    if (!content) continue;
    out.push({ role, content });
  }
  return out;
}

export async function chatTurn({ messages, files, origin, topic } = {}) {
  origin = String(origin || "http://127.0.0.1:8792").replace(/\/$/, "");
  topic = String(topic || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "sleep-hub";
  const packed = clipFiles(files);
  const sys =
    CHAT_SYSTEM.replaceAll("ORIGIN/dawn", origin + "/dawn") +
    "\n\nORIGIN=" +
    origin +
    "\nNTFY_TOPIC=" +
    topic;
  const fileNote = packed.texts.length
    ? packed.texts.map((f) => "### " + f.name + "\n" + f.text).join("\n\n")
    : "";
  const imgNote = packed.images.length
    ? "用户还附了图片：" + packed.images.map((i) => i.name).join("、")
    : "";
  const hist = historyMessages(messages);
  if (!hist.length && !fileNote && !packed.images.length) {
    return { reply: "先说怎么采集、怎么叫醒，或把文件丢进来。", recipe: null };
  }
  const last = hist.length ? hist[hist.length - 1] : { role: "user", content: "请阅读附件。" };
  const prefix = [fileNote && "附件如下：\n" + fileNote, imgNote].filter(Boolean).join("\n");
  const lastText = prefix ? prefix + "\n\n用户：\n" + last.content : last.content;
  const dsMessages = [{ role: "system", content: sys }];
  hist.slice(0, -1).forEach((m) => dsMessages.push(m));
  if (packed.images.length) {
    dsMessages.push({
      role: "user",
      content: [{ type: "text", text: lastText || "请阅读这些图片。" }].concat(
        packed.images.map((img) => ({ type: "image_url", image_url: { url: img.url } }))
      ),
    });
  } else {
    dsMessages.push({ role: "user", content: lastText });
  }
  let parsed;
  try {
    parsed = await completeJson(dsMessages, { maxTokens: 1400, temperature: 0.3 });
  } catch (e) {
    if (packed.images.length && /image|vision|content/i.test(String(e.message || e))) {
      dsMessages[dsMessages.length - 1] = {
        role: "user",
        content: lastText + "\n（图片未能识别，请只根据文字回答）",
      };
      parsed = await completeJson(dsMessages, { maxTokens: 1400, temperature: 0.3 });
    } else {
      throw e;
    }
  }
  const reply = String((parsed && parsed.reply) || "").trim() || "我看过了。";
  let recipe = null;
  if (parsed && parsed.recipe && typeof parsed.recipe === "object") {
    try {
      recipe = sanitize(parsed.recipe, origin, topic);
    } catch {
      recipe = null;
    }
  }
  return { reply: reply.slice(0, 4000), recipe };
}

export async function compileNl(sense, apply, origin, topic = "") {
  const key = process.env.DEEPSEEK_API_KEY || "";
  if (!key) throw new Error("没有 DeepSeek 密钥");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  origin = String(origin || "http://127.0.0.1:8792").replace(/\/$/, "");
  topic = String(topic || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "sleep-hub";
  const user =
    "ORIGIN=" +
    origin +
    "\nNTFY_TOPIC=" +
    topic +
    "\n采集：\n" +
    (sense || "（空）") +
    "\n叫醒：\n" +
    (apply || "（空）");
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM.replace("ORIGIN/dawn", origin + "/dawn") },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
  };
  let raw;
  try {
    raw = await postDs(key, base, body);
  } catch (e) {
    if (e.status === 400 && body.thinking) {
      delete body.thinking;
      raw = await postDs(key, base, body);
    } else {
      throw e;
    }
  }
  const message = (((raw || {}).choices || [])[0] || {}).message || {};
  const msg = message.content || message.reasoning_content || "";
  if (!String(msg).trim()) throw new Error("DeepSeek 返回空");
  return sanitize(parseJsonText(msg), origin, topic);
}
