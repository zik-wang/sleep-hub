const $ = (id) => document.getElementById(id);

let recipe = loadRecipe();

function loadRecipe() {
  try {
    const raw = JSON.parse(localStorage.getItem("sleep-hub-recipe") || "null");
    if (raw && Array.isArray(raw.steps)) return raw;
  } catch {
    /* fall through */
  }
  return defaultRecipe();
}

function persistRecipe() {
  if (recipe.compiledSteps) {
    if (stepsSignature(recipe.steps) !== recipe.compiledSteps) recipe.handEdited = true;
  }
  localStorage.setItem("sleep-hub-recipe", JSON.stringify(recipe));
}

function allSources() {
  return builtinSources().concat(loadCustomSources());
}

function enabledSourceCount() {
  return allSources().filter((s) => s.enabled !== false).length;
}

function matchingPresetKey() {
  return Object.keys(PRESETS).find((k) => PRESETS[k].name === recipe.name) || "";
}

function stageLabel(v) {
  return (
    { wake: "醒", light: "浅睡", deep: "深睡", rem: "REM" }[v] || v || "未报"
  );
}

function renderFacts() {
  $("factPresence").textContent = bus.facts.presence ? "有人" : "无人";
  $("factMotion").textContent = bus.facts.motion ? "有体动" : "静止";
  $("factStage").textContent = stageLabel(bus.facts.stage);
  $("pillPresence").classList.toggle("on", Boolean(bus.facts.presence));
  $("pillMotion").classList.toggle("on", Boolean(bus.facts.motion));
  $("pillStage").classList.toggle("warn", Boolean(bus.facts.stage));
  $("pipeSrcN").textContent = enabledSourceCount() + " 路";
  $("pipeRecipe").textContent = recipe.name || "未命名";
  if ($("nowPresence")) {
    $("nowPresence").textContent = bus.facts.presence ? "有人" : "无人";
    $("nowMotion").textContent = bus.facts.motion ? "有体动" : "静止";
    $("nowStage").textContent = stageLabel(bus.facts.stage);
    $("nowPresenceCell").classList.toggle("on", Boolean(bus.facts.presence));
    $("nowMotionCell").classList.toggle("on", Boolean(bus.facts.motion));
    $("nowStageCell").classList.toggle("warn", Boolean(bus.facts.stage));
  }
}

function renderApplyPills() {
  const box = $("applyPills");
  box.innerHTML = "";
  APPLY_GIVEN.forEach((a) => {
    const s = document.createElement("span");
    s.className = "pill";
    s.textContent = a.name;
    box.append(s);
  });
}

function lastForSource(s) {
  if (s.builtin === "http") return bus.inbox[0];
  return bus.lastBySource[s.sourceKey || s.builtin || s.id];
}

function appendPad(card, sourceKey) {
  const row1 = document.createElement("div");
  row1.className = "btns tight pad-btns";
  row1.append(
    btn("有人", () => ingest({ source: sourceKey, kind: "presence", value: true })),
    btn("无人", () => ingest({ source: sourceKey, kind: "presence", value: false })),
    btn("有体动", () => ingest({ source: sourceKey, kind: "motion", value: true })),
    btn("静止", () => ingest({ source: sourceKey, kind: "motion", value: false }))
  );
  const row2 = document.createElement("div");
  row2.className = "btns tight pad-btns";
  [
    ["醒", "wake"],
    ["浅睡", "light"],
    ["深睡", "deep"],
    ["REM", "rem"],
  ].forEach(([lab, val]) => {
    row2.append(btn(lab, () => ingest({ source: sourceKey, kind: "stage", value: val })));
  });
  card.append(row1, row2);
}

function sourceCard(s) {
  const last = lastForSource(s);
  const card = document.createElement("div");
  const isPad = s.builtin === "pad" || s.type === "pad";
  const isDemo = s.builtin === "demo";
  card.className = "src" + (s.enabled === false ? " off" : "") + (isPad || isDemo ? " wide" : "");
  const head = document.createElement("div");
  head.className = "src-h";
  const title = document.createElement("b");
  title.textContent = s.name;
  head.append(title);
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = s.infra
    ? "自带"
    : s.type === "http"
      ? "HTTP"
      : isPad
        ? "本地点选"
        : isDemo
          ? "示例插件"
          : "接入";
  head.append(tag);
  const note = document.createElement("p");
  note.textContent = s.note || (s.sourceKey ? "source=" + s.sourceKey : "");
  const lastEl = document.createElement("div");
  lastEl.className = "muted";
  lastEl.textContent = last ? "最近：" + last.kind + "=" + JSON.stringify(last.value) : "还没进过数";
  card.append(head, note, lastEl);
  if (isPad) appendPad(card, s.sourceKey || "pad");
  if (isDemo) {
    const play = btn("播一段（约 11 秒）", () => playDemoNight());
    card.append(play);
  }
  if (!s.locked) {
    const tog = document.createElement("button");
    tog.type = "button";
    tog.className = "tiny";
    tog.textContent = s.enabled === false ? "关" : "开";
    tog.onclick = () => toggleSource(s);
    head.append(tog);
    const del = btn("移除这个源", () => {
      saveCustomSources(loadCustomSources().filter((x) => x.id !== s.id));
      renderSources();
      renderFacts();
    });
    del.className = "tiny ghost";
    card.append(del);
  }
  return card;
}

function renderSources() {
  const infra = $("sourcesInfra");
  const mine = $("sourcesMine");
  infra.innerHTML = "";
  mine.innerHTML = "";
  builtinSources().forEach((s) => {
    if (s.infra) infra.append(sourceCard(s));
  });
  builtinSources()
    .filter((s) => !s.infra)
    .forEach((s) => mine.append(sourceCard(s)));
  const extras = loadCustomSources();
  extras.forEach((s) => mine.append(sourceCard(s)));
  $("customEmpty").hidden = extras.length > 0;
}

function renderInbox() {
  const box = $("inbox");
  box.innerHTML = "";
  const rows = bus.inbox.slice(0, 8);
  if (!rows.length) {
    box.textContent = "还没有事件。用「由我指定」，或接入后试发 JSON。";
    return;
  }
  rows.forEach((e) => {
    const d = document.createElement("div");
    const t = new Date(e.t).toLocaleTimeString("zh-CN", { hour12: false });
    d.textContent = t + "  " + e.source + "  " + e.kind + "=" + JSON.stringify(e.value);
    box.append(d);
  });
}

function ingestUrl() {
  return (location.origin || "http://127.0.0.1:8792") + "/ingest";
}

function samplePayload() {
  const key = $("srcKey").value.trim() || "my-device";
  const fact = $("srcFact").value;
  const value = fact === "stage" ? "light" : true;
  return { source: key, kind: fact, value };
}

function refreshCurl() {
  const mode = $("srcMode").value;
  $("httpFields").hidden = mode !== "http";
  $("curlHint").textContent =
    mode === "http"
      ? "把下面发给你的脚本或设备。没有硬件时，用试发即可。同一 WiFi 可用局域网地址。"
      : "本地点选不需要 JSON。接入后会多一组按钮。";
  const payload = samplePayload();
  $("curl").textContent =
    mode === "http"
      ? "curl -s " +
        ingestUrl() +
        " -H \"Content-Type: application/json\" -d '" +
        JSON.stringify(payload) +
        "'"
      : "本地点选：接入后在卡片上点选事实。";
  if (!$("testBody").dataset.dirty) {
    $("testBody").value = JSON.stringify(payload, null, 2);
  }
}

function refreshNtfy() {
  const topic = ntfyTopic();
  if ($("ntfyTopic") && !$("ntfyTopic").matches(":focus")) {
    $("ntfyTopic").value = topic;
  }
  if ($("ntfyHint")) {
    $("ntfyHint").textContent =
      "手机装 ntfy，订阅 " +
      topic +
      "。方案里 URL 写成 https://ntfy.sh/{topic} 会自动换成这个主题。";
  }
}

const PUBLIC_ORIGIN = "https://sleep-hub.vercel.app";

function publicPageUrl() {
  const path = (location.pathname || "").replace(/index\.html$/, "");
  if (path === "/v3" || path === "/v3/" || path === "/v3.html") return PUBLIC_ORIGIN + "/v3";
  return PUBLIC_ORIGIN + "/";
}

function setPublicQr() {
  const wrap = $("lanQrWrap");
  if (!wrap) return;
  wrap.hidden = false;
  const url = publicPageUrl();
  const cap = $("lanQrUrl");
  if (cap) cap.textContent = url;
  const note = $("lanQrNote");
  if (note) note.textContent = "扫码打开公网页，不必同一 Wi‑Fi。";
  const img = $("lanQr");
  if (img) img.alt = "扫码打开 " + url;
}

async function refreshLan() {
  setPublicQr();
  const el = $("lanHint");
  const origin = location.origin;
  const remote = !/^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|$)/i.test(origin);
  let nl = "";
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (data && data.nl) nl = " · 口述走 DeepSeek";
    else if (data) nl = " · 口述走关键词（未配 DeepSeek）";
    if (remote) {
      if (el) el.textContent = "公网 " + origin + "/ · 接入 POST " + origin + "/ingest" + nl;
      return;
    }
    if (data && data.lan) {
      if (el) {
        el.textContent =
          "本机 " + origin + "/ · 局域网 " + data.lan + " · 接入 POST " + data.ingest + nl;
      }
      return;
    }
  } catch {
    /* fall through */
  }
  if (el) {
    el.textContent = remote
      ? "公网 " + origin + "/ingest"
      : "本机 " + ingestUrl() + "（局域网地址需用启动脚本开 server.py）";
  }
}

async function refreshRadar() {
  const box = $("radarBox");
  if (!box) return;
  try {
    const res = await fetch("/api/radar");
    if (!res.ok) {
      box.hidden = true;
      return;
    }
    const data = await res.json();
    box.hidden = false;
    const sel = $("radarPort");
    const prev = sel.value;
    sel.innerHTML = "";
    (data.ports || []).forEach((p) => {
      const o = document.createElement("option");
      o.value = p.device;
      o.textContent = p.device + " · " + (p.name || "");
      sel.append(o);
    });
    if (!sel.options.length) {
      const o = document.createElement("option");
      o.value = "COM4";
      o.textContent = "COM4";
      sel.append(o);
    }
    if (data.port && [...sel.options].some((o) => o.value === data.port)) sel.value = data.port;
    else if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    $("radarStart").disabled = Boolean(data.running);
    $("radarStop").disabled = !data.running;
    $("radarHint").textContent = data.running
      ? "雷达脚本在跑 · " + data.port + "。海凌科 Tool 必须关掉。"
      : "点启动后中控自己跑脚本。先关掉海凌科 Tool，COM 口只能占一次。";
    $("radarLog").textContent = (data.log || []).slice(-4).join("  ·  ");
  } catch {
    box.hidden = true;
  }
}

async function radarAction(action) {
  const btn = action === "start" ? $("radarStart") : $("radarStop");
  if (btn) btn.disabled = true;
  try {
    const res = await fetch("/api/radar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, port: $("radarPort") ? $("radarPort").value : "" }),
    });
    const data = await res.json();
    if (!data.ok && data.error) logLine("雷达：" + data.error);
    else logLine(action === "start" ? "雷达脚本已启动" : "雷达脚本已停止");
  } catch (e) {
    logLine("雷达请求失败：" + (e.message || e));
  }
  await refreshRadar();
}

function renderPresets() {
  const box = $("presetLib");
  box.innerHTML = "";
  const active = matchingPresetKey();
  Object.keys(PRESETS).forEach((key) => {
    const p = PRESETS[key];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "preset" + (key === active ? " active" : "");
    const title = document.createElement("b");
    title.textContent = p.name;
    const blurb = document.createElement("span");
    blurb.textContent = p.blurb || "";
    b.append(title, blurb);
    b.onclick = () => loadPreset(key);
    box.append(b);
  });
}

function btn(label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ghost";
  b.textContent = label;
  b.onclick = fn;
  return b;
}

function toggleSource(s) {
  const list = loadCustomSources().map((x) =>
    x.id === s.id ? { ...x, enabled: x.enabled === false } : x
  );
  saveCustomSources(list);
  renderSources();
  renderFacts();
}

function addSource() {
  const mode = $("srcMode").value;
  const name = $("srcName").value.trim() || (mode === "pad" ? "本地点选" : "我的 HTTP 源");
  const list = loadCustomSources();
  if (mode === "pad") {
    list.push({
      id: newId("src"),
      name,
      type: "pad",
      sourceKey: newId("pad"),
      enabled: true,
      note: "无硬件。你在这张卡片上指定事实。",
    });
    logLine("接入了本地点选：" + name);
  } else {
    const sourceKey = $("srcKey").value.trim() || newId("src");
    const fact = $("srcFact").value;
    list.push({
      id: newId("src"),
      name,
      type: "http",
      sourceKey,
      fact,
      enabled: true,
      note: "HTTP 里 source=" + sourceKey + " 写入 " + fact,
    });
    logLine("接入了 HTTP 源 " + name + "（" + sourceKey + "）");
  }
  saveCustomSources(list);
  $("srcName").value = "";
  $("srcKey").value = "";
  renderSources();
  renderFacts();
  refreshCurl();
}

async function testSend() {
  let payload;
  try {
    payload = JSON.parse($("testBody").value);
  } catch {
    logLine("试发失败：JSON 无效");
    return;
  }
  if (!payload || typeof payload !== "object") {
    logLine("试发失败：需要一个 JSON 对象");
    return;
  }
  ingest(payload, "try");
  try {
    const res = await fetch("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data && data.id) bus.seenRemote = Math.max(bus.seenRemote, data.id);
  } catch {
    /* 本地 ingest 已写入 */
  }
  logLine("已试发 " + (payload.source || "unknown") + " " + (payload.kind || ""));
}

function renderSteps() {
  const box = $("steps");
  box.innerHTML = "";
  $("recipeName").value = recipe.name || "";
  const noteEl = $("recipeNote");
  if (noteEl) {
    noteEl.hidden = !recipe.note;
    noteEl.textContent = recipe.note || "";
  }
  recipe.steps.forEach((step, i) => {
    const row = document.createElement("div");
    row.className = "step" + (run.armed && run.index === i ? " current" : "");
    const n = document.createElement("span");
    n.className = "idx";
    n.textContent = String(i + 1);
    const type = document.createElement("select");
    STEP_TYPES.forEach((t) => {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.label;
      if (t.id === step.type) o.selected = true;
      type.append(o);
    });
    type.onchange = () => {
      recipe.steps[i] = defaultStep(type.value);
      persistRecipe();
      renderSteps();
    };
    const fields = document.createElement("div");
    fields.className = "fields";
    fillFields(fields, step, i);
    const ops = document.createElement("div");
    ops.className = "ops";
    const up = btn("上", () => moveStep(i, -1));
    const down = btn("下", () => moveStep(i, 1));
    const del = btn("删", () => {
      recipe.steps.splice(i, 1);
      persistRecipe();
      renderSteps();
    });
    ops.append(up, down, del);
    row.append(n, type, fields, ops);
    box.append(row);
  });
  renderPresets();
  renderFacts();
}

function fillFields(el, step, i) {
  const add = (key, input) => {
    input.oninput = input.onchange = () => {
      let v = input.value;
      if (input.type === "number") v = Number(v);
      if (input.dataset.bool === "1") v = input.value === "true";
      recipe.steps[i][key] = v;
      persistRecipe();
    };
    el.append(input);
  };
  if (step.type === "wait_until") {
    const t = document.createElement("input");
    t.type = "time";
    t.value = step.time || "07:00";
    add("time", t);
  }
  if (step.type === "wait_near") {
    const t = document.createElement("input");
    t.type = "time";
    t.value = step.time || "07:00";
    add("time", t);
    add("minutes", num(step.minutes, 1, 180));
  }
  if (step.type === "wait_minutes") add("minutes", num(step.minutes, 1, 180));
  if (step.type === "wait_seconds") add("seconds", num(step.seconds, 1, 600));
  if (step.type === "wait_fact") {
    const f = document.createElement("select");
    FACT_KEYS.forEach((k) => {
      const o = document.createElement("option");
      o.value = k.id;
      o.textContent = k.label;
      if (k.id === step.fact) o.selected = true;
      f.append(o);
    });
    add("fact", f);
    f.onchange = f.oninput = () => {
      recipe.steps[i].fact = f.value;
      recipe.steps[i].equals = f.value === "stage" ? "light" : true;
      persistRecipe();
      renderSteps();
    };
    if (step.fact === "stage") {
      const eq = document.createElement("select");
      [
        ["wake", "醒"],
        ["light", "浅睡"],
        ["deep", "深睡"],
        ["rem", "REM"],
      ].forEach(([v, lab]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = lab;
        if (String(step.equals) === v) o.selected = true;
        eq.append(o);
      });
      add("equals", eq);
    } else {
      const eq = document.createElement("select");
      [
        ["true", "要成立"],
        ["false", "要不成"],
      ].forEach(([v, lab]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = lab;
        if (Boolean(step.equals) === (v === "true")) o.selected = true;
        eq.append(o);
      });
      eq.dataset.bool = "1";
      add("equals", eq);
    }
  }
  if (step.type === "screen_dawn") add("durationMin", num(step.durationMin, 0.1, 90));
  if (step.type === "pc_beep") add("seconds", num(step.seconds, 1, 60));
  if (step.type === "notify") {
    add("title", text(step.title, "标题"));
    add("body", text(step.body, "正文"));
  }
  if (step.type === "log") add("text", text(step.text, "写什么"));
  if (step.type === "http_out") {
    add("url", text(step.url, "https://ntfy.sh/{topic} 或灯的地址"));
    add("body", text(step.body, "正文或 JSON"));
  }
}

function num(v, min, max) {
  const i = document.createElement("input");
  i.type = "number";
  i.min = String(min);
  i.max = String(max);
  i.step = "any";
  i.value = v ?? min;
  return i;
}

function text(v, ph) {
  const i = document.createElement("input");
  i.type = "text";
  i.placeholder = ph;
  i.value = v || "";
  return i;
}

function moveStep(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= recipe.steps.length) return;
  const tmp = recipe.steps[i];
  recipe.steps[i] = recipe.steps[j];
  recipe.steps[j] = tmp;
  persistRecipe();
  renderSteps();
}

function loadPreset(key) {
  if (!PRESETS[key]) return;
  recipe = structuredClone(PRESETS[key]);
  recipe.handEdited = false;
  recipe.compiledSteps = "";
  recipe.note = "";
  recipe.steps.forEach((s) => {
    if (s.type === "http_out" && String(s.url || "").includes("{dawn}")) {
      s.url = expandApplyUrl(s.url);
    }
  });
  persistRecipe();
  renderSteps();
  logLine("载入方案模板：" + recipe.name + "（可改）");
}

function addStep() {
  recipe.steps.push(defaultStep($("newStep").value));
  persistRecipe();
  renderSteps();
}

function refreshRunButtons() {
  $("arm").disabled = run.armed;
  $("cancel").disabled = !run.armed;
  $("test").disabled = run.armed;
  if ($("threeActs")) $("threeActs").disabled = run.armed;
  renderSteps();
}

function isPhoneUi() {
  return window.matchMedia("(max-width: 820px)").matches;
}

function syncFolds() {
  const phone = isPhoneUi();
  document.querySelectorAll("details.m-fold").forEach((d) => {
    d.open = !phone;
  });
}

function setCol(name) {
  if (!name) return;
  document.body.dataset.col = name;
  try {
    sessionStorage.setItem("sleep-hub-col", name);
  } catch {
    /* private mode */
  }
  document.querySelectorAll(".m-nav [data-col]").forEach((b) => {
    b.classList.toggle("on", b.dataset.col === name);
  });
  if (isPhoneUi()) window.scrollTo(0, 0);
}

function initColNav() {
  const nav = document.querySelector(".m-nav");
  if (!nav) return;
  nav.querySelectorAll("[data-col]").forEach((b) => {
    b.onclick = () => setCol(b.dataset.col);
  });
  let start = "tonight";
  try {
    start = sessionStorage.getItem("sleep-hub-col") || "tonight";
  } catch {
    start = "tonight";
  }
  const allowed = [...nav.querySelectorAll("[data-col]")].map((b) => b.dataset.col);
  if (!allowed.includes(start)) start = "tonight";
  setCol(start);
  syncFolds();
  const mq = window.matchMedia("(max-width: 820px)");
  if (mq.addEventListener) mq.addEventListener("change", syncFolds);
  else mq.addListener(syncFolds);
}

async function runThreeActs() {
  setCol("tonight");
  stopDemoNight();
  setDawn(0);
  logLine("一键三幕开始");
  let localHub = false;
  let radarOn = false;
  try {
    const res = await fetch("/api/radar");
    if (res.ok) {
      let st = await res.json();
      localHub = Boolean(st && st.local);
      if (localHub && !st.running) {
        logLine("第三幕：正在接本机雷达");
        const started = await fetch("/api/radar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start",
            port: $("radarPort") ? $("radarPort").value : "",
          }),
        }).then((r) => r.json());
        st = started;
        if (typeof refreshRadar === "function") refreshRadar();
        if (!started.running && started.error) {
          logLine("雷达没接上：" + started.error);
        }
      }
      radarOn = Boolean(st && st.running);
    }
  } catch {
    radarOn = false;
  }
  ingest({ source: "hub", kind: "presence", value: true }, "local");
  ingest({ source: "hub", kind: "motion", value: false }, "local");
  if (localHub || radarOn) {
    loadPreset("three_radar");
    persistRecipe();
    armRecipe(recipe, true);
    refreshRunButtons();
    if (radarOn) {
      logLine("第三幕：保持静止不会亮。挥手或翻身才亮灯。");
    } else {
      logLine("第三幕：雷达没跑，静止不会亮。关掉海凌科 Tool，采集栏再启动雷达。或点「有体动」。");
    }
    return;
  }
  loadPreset("swap_phone");
  ingest({ source: "hub", kind: "stage", value: "wake" }, "local");
  persistRecipe();
  armRecipe(recipe, true);
  refreshRunButtons();
  playDemoNight();
  logLine("不在本机中控，改示例回放：浅睡推手机。");
}

function tick() {
  $("clock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  renderFacts();
  if (!run.armed) {
    $("status").textContent = "未守夜";
    return;
  }
  $("status").textContent = tickRun() || "运行中";
  if (!run.armed) refreshRunButtons();
}

onBus(() => {
  renderFacts();
  renderSources();
  renderInbox();
});

function saveNlDraft() {
  try {
    localStorage.setItem(
      "sleep-hub-nl",
      JSON.stringify({
        sense: $("nlSense") ? $("nlSense").value : "",
        apply: $("nlApply") ? $("nlApply").value : "",
      })
    );
  } catch {
    /* ignore */
  }
}

function loadNlDraft() {
  if (!$("nlSense") || !$("nlApply")) return;
  try {
    const d = JSON.parse(localStorage.getItem("sleep-hub-nl") || "null");
    if (d) {
      $("nlSense").value = d.sense || "";
      $("nlApply").value = d.apply || "";
    }
  } catch {
    /* ignore */
  }
  if (recipe.compiledFrom) {
    if (!$("nlSense").value) $("nlSense").value = recipe.compiledFrom.sense || "";
    if (!$("nlApply").value) $("nlApply").value = recipe.compiledFrom.apply || "";
  }
}

function renderNlResult(gaps, report) {
  if ($("nlReport")) $("nlReport").textContent = report || "";
  const box = $("nlGaps");
  if (!box) return;
  box.innerHTML = "";
  if (!gaps || !gaps.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  gaps.forEach((g) => {
    const li = document.createElement("li");
    li.textContent = g;
    box.append(li);
  });
}

function addCompiledSource(s) {
  const list = loadCustomSources();
  if (list.some((x) => x.sourceKey === s.sourceKey)) return;
  list.push({ id: newId("src"), ...s });
  saveCustomSources(list);
}

function applyCompiled(out, sense, apply) {
  renderNlResult(out.gaps, out.report);
  if (!out.ok) {
    logLine(out.report || "编译失败");
    return;
  }
  (out.steps || []).forEach((st) => {
    if (st.type === "http_out" && /\/dawn/i.test(st.url || "")) rememberLampUrl(st.url);
  });
  recipe = {
    name: out.name,
    blurb: "由口述编译，可改",
    steps: out.steps,
    note: out.note || [sense && "采集：" + sense, apply && "叫醒：" + apply].filter(Boolean).join("\n"),
    compiledFrom: { sense, apply },
    compiledSteps: stepsSignature(out.steps),
    handEdited: false,
  };
  persistRecipe();
  (out.sources || []).forEach(addCompiledSource);
  if (out.sources && out.sources[0] && out.sources[0].type === "http") {
    $("srcMode").value = "http";
    $("srcName").value = out.sources[0].name;
    $("srcKey").value = out.sources[0].sourceKey;
    $("srcFact").value = out.sources[0].fact;
    refreshCurl();
  }
  renderSources();
  renderSteps();
  logLine(out.report);
  (out.gaps || []).forEach((g) => logLine("缺项：" + g));
}

function applyKeywordCompile() {
  const sense = $("nlSense").value;
  const apply = $("nlApply").value;
  applyCompiled(compileNl(sense, apply), sense, apply);
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function applyNlCompile() {
  saveNlDraft();
  if (recipe.handEdited && recipe.compiledSteps) {
    if (!window.confirm("方案已手改。用这段文字覆盖当前步骤？")) return;
  }
  const sense = $("nlSense").value;
  const apply = $("nlApply").value;
  const btn = $("nlCompile");
  if (btn) btn.disabled = true;
  renderNlResult([], "DeepSeek 编译中…");
  try {
    const startRes = await fetch("/api/nl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sense,
        apply,
        origin: location.origin,
        topic: ntfyTopic(),
      }),
    });
    const start = await startRes.json();
    if (!start.ok || !start.id) {
      logLine("DeepSeek 不可用，改用关键词编译");
      applyKeywordCompile();
      return;
    }
    if (start.status === "done" && start.result) {
      applyCompiled(start.result, sense, apply);
      return;
    }
    if (start.status === "error") {
      logLine("DeepSeek 失败：" + (start.error || "") + "，改用关键词");
      applyKeywordCompile();
      return;
    }
    for (let i = 0; i < 90; i++) {
      const st = await fetch("/api/nl?job=" + encodeURIComponent(start.id)).then((r) => r.json());
      if (st.status === "done" && st.result) {
        applyCompiled(st.result, sense, apply);
        return;
      }
      if (st.status === "error") {
        logLine("DeepSeek 失败：" + (st.error || "") + "，改用关键词");
        applyKeywordCompile();
        return;
      }
      renderNlResult([], "DeepSeek 编译中… " + (i + 1));
      await sleepMs(400);
    }
    logLine("DeepSeek 超时，改用关键词编译");
    applyKeywordCompile();
  } catch (e) {
    logLine("编译请求失败，改用关键词：" + (e.message || e));
    applyKeywordCompile();
  } finally {
    if (btn) btn.disabled = false;
  }
}

const NL_EXAMPLE = {
  sense: "室友手环判断浅睡，他的脚本会 POST 进来。",
  apply: "浅睡之后 LED 灯带慢慢亮，电脑也响一声。",
};

$("recipeName").oninput = () => {
  recipe.name = $("recipeName").value;
  persistRecipe();
  renderPresets();
  renderFacts();
};
$("addStep").onclick = addStep;
$("addSource").onclick = addSource;
$("testSend").onclick = testSend;
$("srcMode").onchange = refreshCurl;
$("srcKey").oninput = refreshCurl;
$("srcFact").onchange = refreshCurl;
$("testBody").oninput = () => {
  $("testBody").dataset.dirty = "1";
};
$("resetGiven").onclick = () => loadPreset("blank");
if ($("threeActs")) $("threeActs").onclick = runThreeActs;
$("arm").onclick = () => {
  setCol("tonight");
  persistRecipe();
  armRecipe(recipe, false);
  refreshRunButtons();
};
$("test").onclick = () => {
  setCol("tonight");
  persistRecipe();
  armRecipe(recipe, true);
  refreshRunButtons();
};
$("cancel").onclick = () => {
  cancelRun();
  refreshRunButtons();
};
$("beepNow").onclick = () => {
  ensureAudio();
  beep(2);
  logLine("试响");
};
if ($("nlCompile")) $("nlCompile").onclick = applyNlCompile;
if ($("nlExample")) {
  $("nlExample").onclick = () => {
    $("nlSense").value = NL_EXAMPLE.sense;
    $("nlApply").value = NL_EXAMPLE.apply;
    saveNlDraft();
  };
}
if ($("nlSense")) $("nlSense").oninput = saveNlDraft;
if ($("nlApply")) $("nlApply").oninput = saveNlDraft;
if ($("radarStart")) $("radarStart").onclick = () => radarAction("start");
if ($("radarStop")) $("radarStop").onclick = () => radarAction("stop");
if ($("ntfyTopic")) {
  $("ntfyTopic").oninput = () => {
    const t = $("ntfyTopic").value.trim() || ntfyTopic();
    localStorage.setItem("sleep-hub-ntfy", t.replace(/[^a-zA-Z0-9_-]/g, ""));
    refreshNtfy();
  };
}

try {
  $("log").textContent = JSON.parse(localStorage.getItem("sleep-hub-log") || "[]").join("\n");
} catch {
  $("log").textContent = "";
}

initColNav();
renderApplyPills();
loadNlDraft();
renderSources();
renderInbox();
renderSteps();
refreshCurl();
refreshNtfy();
refreshLan();
refreshRadar();
setInterval(tick, 250);
setInterval(pollRemote, 1000);
setInterval(refreshRadar, 2000);
tick();
logLine("中控就绪：无硬件也能指定采集和叫醒；有设备时用 HTTP 自己接入。");
