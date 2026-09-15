/* 总线：用户指定采集 → 三条事实 → 用户指定方案 → 执行。硬件不是前提。 */

const FACT_KEYS = [
  { id: "presence", label: "在床/有人", kind: "bool" },
  { id: "motion", label: "体动", kind: "bool" },
  { id: "stage", label: "睡眠状态", kind: "text" },
];

const STEP_TYPES = [
  { id: "wait_until", label: "等到墙上时钟", hint: "到点才往下走" },
  { id: "wait_near", label: "接近起床时间", hint: "起床前一段时间进入窗口" },
  { id: "wait_minutes", label: "再等几分钟" },
  { id: "wait_seconds", label: "再等几秒" },
  { id: "wait_fact", label: "等到某个事实", hint: "例如等到「有人」" },
  { id: "screen_dawn", label: "屏幕黎明" },
  { id: "pc_beep", label: "电脑响铃" },
  { id: "notify", label: "系统通知" },
  { id: "log", label: "记一条日志" },
  { id: "http_out", label: "HTTP 发出", hint: "自己的灯、窗帘、网关" },
];

const APPLY_GIVEN = [
  { id: "screen_dawn", name: "屏幕黎明" },
  { id: "pc_beep", name: "电脑响铃" },
  { id: "notify", name: "系统通知" },
  { id: "http_out", name: "HTTP 发出" },
];

const PRESETS = {
  blank: {
    name: "我的方案",
    blurb: "空白起点。自己加步骤，决定怎么叫醒。",
    steps: [{ type: "wait_until", time: "07:00" }, { type: "pc_beep", seconds: 8 }],
  },
  dawn_then_beep: {
    name: "先亮后响",
    blurb: "到点先黎明再响铃，不看人在不在。",
    steps: [
      { type: "wait_until", time: "06:40" },
      { type: "screen_dawn", durationMin: 20 },
      { type: "pc_beep", seconds: 10 },
      { type: "notify", title: "该起床了", body: "方案跑完强制步" },
    ],
  },
  gate_then_dawn: {
    name: "有人才亮",
    blurb: "到点后，等你指定的「在床」为真才亮。",
    steps: [
      { type: "wait_until", time: "06:40" },
      { type: "wait_fact", fact: "presence", equals: true },
      { type: "screen_dawn", durationMin: 15 },
      { type: "pc_beep", seconds: 8 },
    ],
  },
  light_window: {
    name: "浅睡窗口才亮",
    blurb: "到点、在床、且状态为浅睡。状态由你接入的源来写。",
    steps: [
      { type: "wait_until", time: "06:40" },
      { type: "wait_fact", fact: "presence", equals: true },
      { type: "wait_fact", fact: "stage", equals: "light" },
      { type: "screen_dawn", durationMin: 15 },
      { type: "pc_beep", seconds: 8 },
    ],
  },
  beep_only: {
    name: "只响铃",
    blurb: "最小叫醒：到点只走声音。",
    steps: [
      { type: "wait_until", time: "07:00" },
      { type: "pc_beep", seconds: 12 },
      { type: "notify", title: "该起床了", body: "只走声音" },
    ],
  },
  swap_demo: {
    name: "换源演示",
    blurb: "不等时钟。谁把状态写成浅睡，方案就亮。货没到也够演。",
    steps: [
      { type: "wait_fact", fact: "stage", equals: "light" },
      { type: "screen_dawn", durationMin: 15 },
      { type: "pc_beep", seconds: 8 },
    ],
  },
  motion_window: {
    name: "翻身才亮",
    blurb: "起床前窗口里，雷达看到持续移动才黎明。坐着不动不亮。灯板没烧好用屏幕。",
    steps: [
      { type: "wait_near", time: "07:00", minutes: 20 },
      { type: "wait_fact", fact: "motion", equals: true },
      { type: "screen_dawn", durationMin: 15 },
      { type: "pc_beep", seconds: 8 },
    ],
  },
  three_radar: {
    name: "三幕·雷达体动",
    blurb: "雷达介入。等持续体动再黎明；坐着不动不亮。",
    steps: [
      { type: "wait_fact", fact: "motion", equals: true },
      { type: "screen_dawn", durationMin: 15 },
      { type: "http_out", url: "{dawn}", body: '{"progress":1}' },
      { type: "pc_beep", seconds: 8 },
      {
        type: "http_out",
        url: "https://ntfy.sh/{topic}",
        body: "该起床了 · 睡眠中控",
      },
    ],
  },
  swap_phone: {
    name: "浅睡推手机",
    blurb: "换源演示再加 ntfy。灯没到也能让手机震一下。",
    steps: [
      { type: "wait_fact", fact: "stage", equals: "light" },
      { type: "screen_dawn", durationMin: 15 },
      { type: "pc_beep", seconds: 8 },
      {
        type: "http_out",
        url: "https://ntfy.sh/{topic}",
        body: "该起床了 · 睡眠中控",
      },
    ],
  },
};

const DEMO_NIGHT = [
  { ms: 0, kind: "presence", value: true },
  { ms: 200, kind: "motion", value: false },
  { ms: 400, kind: "stage", value: "wake" },
  { ms: 2800, kind: "stage", value: "light" },
  { ms: 5200, kind: "motion", value: true },
  { ms: 6400, kind: "motion", value: false },
  { ms: 11000, kind: "motion", value: false },
];

let demoTimers = [];

function stopDemoNight() {
  demoTimers.forEach(clearTimeout);
  demoTimers = [];
}

function playDemoNight() {
  stopDemoNight();
  logLine("示例回放开始：无硬件，假装有脚本在写事实");
  DEMO_NIGHT.forEach((step) => {
    demoTimers.push(
      setTimeout(() => {
        ingest({ source: "demo-night", kind: step.kind, value: step.value }, "demo");
      }, step.ms)
    );
  });
  const last = DEMO_NIGHT[DEMO_NIGHT.length - 1].ms;
  demoTimers.push(
    setTimeout(() => {
      logLine("示例回放结束。DEV102 到了，只换这个源，方案不用改。");
    }, last + 250)
  );
}

function newId(prefix) {
  return prefix + "-" + Math.random().toString(36).slice(2, 8);
}

function defaultRecipe() {
  return structuredClone(PRESETS.blank);
}

function defaultDawnUrl() {
  try {
    const saved = localStorage.getItem("sleep-hub-lamp") || "";
    if (/^https?:\/\//i.test(saved)) return saved;
  } catch {
    /* private mode */
  }
  if (typeof location !== "undefined" && location.origin) return location.origin + "/dawn";
  return "http://127.0.0.1:8792/dawn";
}

function isStandinDawn(url) {
  const u = String(url || "");
  if (typeof location !== "undefined" && location.origin && u === location.origin + "/dawn") return true;
  return /:\/\/(?:127\.0\.0\.1|localhost):8792\/dawn$/i.test(u);
}

function rememberLampUrl(url) {
  try {
    if (url && /\/dawn/i.test(url)) localStorage.setItem("sleep-hub-lamp", url);
  } catch {
    /* private mode */
  }
}

function defaultStep(type) {
  const t = type || "wait_until";
  if (t === "led_dawn") {
    const url = defaultDawnUrl();
    rememberLampUrl(url);
    return { type: "http_out", url, body: '{"progress":1}' };
  }
  const base = { type: t };
  if (t === "wait_until") base.time = "07:00";
  if (t === "wait_near") {
    base.time = "07:00";
    base.minutes = 20;
  }
  if (t === "wait_minutes") base.minutes = 5;
  if (t === "wait_seconds") base.seconds = 8;
  if (t === "wait_fact") {
    base.fact = "presence";
    base.equals = true;
  }
  if (t === "screen_dawn") base.durationMin = 20;
  if (t === "pc_beep") base.seconds = 8;
  if (t === "notify") {
    base.title = "该起床了";
    base.body = "";
  }
  if (t === "log") base.text = "方案走到这里";
  if (t === "http_out") {
    base.url = "https://ntfy.sh/{topic}";
    base.body = "该起床了 · 睡眠中控";
  }
  return base;
}

function ntfyTopic() {
  try {
    let t = localStorage.getItem("sleep-hub-ntfy") || "";
    t = t.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!t) {
      t = "sleep-hub-" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem("sleep-hub-ntfy", t);
    }
    return t;
  } catch {
    return "sleep-hub-demo";
  }
}

function expandApplyUrl(url) {
  return String(url || "")
    .split("{topic}")
    .join(ntfyTopic())
    .split("{dawn}")
    .join(defaultDawnUrl());
}

function builtinSources() {
  return [
    {
      id: "clock",
      name: "墙上时钟",
      type: "builtin",
      builtin: "clock",
      enabled: true,
      locked: true,
      infra: true,
      note: "中控自带。方案里「等到某时刻」用它，不需要硬件。",
    },
    {
      id: "http",
      name: "HTTP 总入口",
      type: "builtin",
      builtin: "http",
      enabled: true,
      locked: true,
      infra: true,
      note: "任何你自己的脚本或设备 POST /ingest 都能进来。",
    },
    {
      id: "pad",
      name: "由我指定",
      type: "builtin",
      builtin: "pad",
      sourceKey: "pad",
      enabled: true,
      locked: true,
      note: "没有硬件时，你在本页点选三条事实。这就是一种采集方式。",
    },
    {
      id: "demo-night",
      name: "示例回放",
      type: "builtin",
      builtin: "demo",
      sourceKey: "demo-night",
      enabled: true,
      locked: true,
      note: "无硬件。点一下模拟别人的脚本在写事实。货到了把同一契约换成 DEV102。",
    },
  ];
}

const CN_DIGIT = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function stepsSignature(steps) {
  return JSON.stringify(steps || []);
}

function cnToInt(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "十") return 10;
  if (s.startsWith("十")) return 10 + (CN_DIGIT[s.slice(1)] || 0);
  const ten = s.indexOf("十");
  if (ten >= 0) {
    const left = ten === 0 ? 1 : CN_DIGIT[s.slice(0, ten)];
    const right = s.slice(ten + 1);
    return (left || 0) * 10 + (right ? CN_DIGIT[right] || 0 : 0);
  }
  if (s.length === 1 && CN_DIGIT[s] != null) return CN_DIGIT[s];
  return null;
}

function padClock(h, m) {
  const hh = Math.max(0, Math.min(23, h));
  const mm = Math.max(0, Math.min(59, m));
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function parseClock(text) {
  const s = String(text || "");
  const colon = s.match(/(\d{1,2})[:：](\d{2})/);
  if (colon) return padClock(Number(colon[1]), Number(colon[2]));
  const half = s.match(/(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*点半/);
  if (half) {
    const h = cnToInt(half[1]);
    if (h != null) return padClock(h, 30);
  }
  const arab = s.match(/(\d{1,2})\s*点(?:钟)?(?:(\d{1,2})\s*分?)?/);
  if (arab) return padClock(Number(arab[1]), arab[2] ? Number(arab[2]) : 0);
  const cn = s.match(
    /([零一二两三四五六七八九十两]{1,3})\s*点(?:钟)?(?:([零一二三四五六七八九十]{1,3})\s*分?)?/
  );
  if (cn) {
    const h = cnToInt(cn[1]);
    const m = cn[2] ? cnToInt(cn[2]) : 0;
    if (h != null) return padClock(h, m || 0);
  }
  return "";
}

function parseMinutes(text) {
  const s = String(text || "");
  if (/慢慢|缓缓|逐渐/.test(s)) return 20;
  const arab = s.match(/(\d+(?:\.\d+)?)\s*分钟/);
  if (arab) return Number(arab[1]);
  const cn = s.match(/([零一二两三四五六七八九十两]{1,3})\s*分钟/);
  if (cn) {
    const n = cnToInt(cn[1]);
    if (n != null && n > 0) return n;
  }
  return 15;
}

function extractUrls(text) {
  return (String(text || "").match(/https?:\/\/[^\s"'<>]+/gi) || []).map((u) =>
    u.replace(/[),.，。]+$/, "")
  );
}

function extractLampUrl(text) {
  const s = String(text || "");
  const fromHttp = extractUrls(s).find((u) => /\/dawn/i.test(u) && !/\/ingest\b/i.test(u));
  if (fromHttp) return fromHttp;
  const ip = s.match(/\b(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{2,5}))?(\/dawn[^\s"'<>]*)?/i);
  if (!ip) return "";
  return "http://" + ip[1] + (ip[2] ? ":" + ip[2] : "") + (ip[3] || "/dawn");
}

function sourceKeyFromText(text) {
  const s = String(text || "");
  if (/手环|手表|band/i.test(s)) return /室友/.test(s) ? "roommate-band" : "band";
  if (/雷达|LD2410|海凌|HiLink|hilink/i.test(s)) return "ld2410c";
  if (/脚本/.test(s)) return "my-script";
  return "my-device";
}

function sourceNameFromText(text) {
  const s = String(text || "");
  if (/室友/.test(s) && /手环|手表/.test(s)) return "室友手环";
  if (/手环|手表/.test(s)) return "手环";
  if (/雷达|LD2410|海凌|HiLink/i.test(s)) return "HiLink 雷达";
  if (/脚本/.test(s)) return "我的脚本";
  return "我的 HTTP 源";
}

function compileNl(senseText, applyText) {
  const sense = String(senseText || "").trim();
  const apply = String(applyText || "").trim();
  const all = (sense + "\n" + apply).trim();
  const gaps = [];
  const sources = [];
  const steps = [];

  if (!all) {
    return {
      ok: false,
      gaps: ["先写怎么采集或怎么叫醒。"],
      sources: [],
      steps: [],
      name: "",
      note: "",
      report: "没有原文",
    };
  }

  const skipPresence = /不看人|不管人|不等人/.test(all);
  const wantLight = /浅睡/.test(all);
  const wantDeep = /等到深睡|等深睡/.test(all);
  const wantTurnover = /翻身|距离突然|距离.*0|报0|LD2410/.test(all);
  const wantMotion = wantTurnover || /等到体动|有体动时|体动再/.test(all);
  const wantPresence = !skipPresence && /在床|有人/.test(all) && !/没有人会/.test(all);
  const wantPad = /点选|自己点|由我指定|没有硬件|没设备|无硬件/.test(sense || all);
  const wantHttp =
    /http|POST|curl|ingest|脚本|网关/i.test(sense) ||
    ((/手环|雷达|手表|传感器/.test(sense) || /手环|雷达|手表/.test(all)) && !wantPad);

  if (wantHttp) {
    const fact = wantLight || wantDeep ? "stage" : wantMotion || wantTurnover ? "motion" : "presence";
    sources.push({
      name: sourceNameFromText(sense || all),
      type: "http",
      sourceKey: sourceKeyFromText(sense || all),
      fact,
      enabled: true,
      note: "口述编译。HTTP 里 source=" + sourceKeyFromText(sense || all) + " 写入 " + fact,
    });
    gaps.push("采集通道：把 curl 发给脚本或设备。中控不猜手环/雷达的地址。");
  } else if (wantTurnover) {
    sources.push({
      name: "HiLink 雷达",
      type: "http",
      sourceKey: "ld2410c",
      fact: "motion",
      enabled: true,
      note: "翻身/挥手：移动能量连续超阈值才写 motion，坐着不动不写",
    });
  }

  const clock = parseClock(all);
  if (clock && wantTurnover) steps.push({ type: "wait_near", time: clock, minutes: 20 });
  else if (clock) steps.push({ type: "wait_until", time: clock });
  if (wantPresence) steps.push({ type: "wait_fact", fact: "presence", equals: true });
  if (wantLight) steps.push({ type: "wait_fact", fact: "stage", equals: "light" });
  else if (wantDeep) steps.push({ type: "wait_fact", fact: "stage", equals: "deep" });
  if (wantMotion) steps.push({ type: "wait_fact", fact: "motion", equals: true });

  const dawn = /亮|黎明|日出|屏幕/.test(all);
  const lamp = /灯带|台灯|灯|板子|ESP|窗帘|LED|SK6812/i.test(all);
  const ledStrip = /灯带|LED\s*灯|led灯|SK6812|ESP32|SuperMini/i.test(all);
  const beep = /响|铃|蜂鸣/.test(all);
  const phone = /推手机|ntfy|震一下|手机震/.test(all);
  const sysNotify = /系统通知/.test(all);
  const applyOrder = apply || all;
  const dawnIdx = applyOrder.search(/亮|黎明|日出|屏幕|灯/);
  const beepIdx = applyOrder.search(/响|铃|蜂鸣/);
  const beepFirst = beep && dawnIdx >= 0 && beepIdx >= 0 && beepIdx < dawnIdx;

  const durationMin = parseMinutes(all);
  const applySteps = [];
  if (dawn || lamp || (!beep && !phone && !sysNotify)) {
    applySteps.push({ type: "screen_dawn", durationMin });
  }
  if (beep) applySteps.push({ type: "pc_beep", seconds: 8 });
  if (beepFirst) applySteps.sort((a, b) => (a.type === "pc_beep" ? -1 : b.type === "pc_beep" ? 1 : 0));
  if (sysNotify) {
    applySteps.push({ type: "notify", title: "该起床了", body: "" });
  }

  const urls = extractUrls(apply || all).filter((u) => !/\/ingest\b/i.test(u));
  const lampUrl = extractLampUrl(apply || all);
  if (urls.length) {
    const url = lampUrl || urls[0];
    const jsonish = /dawn/i.test(url) || ledStrip;
    applySteps.push({
      type: "http_out",
      url,
      body: jsonish ? '{"progress":1}' : "该起床了 · 睡眠中控",
    });
    rememberLampUrl(url);
  }
  if (phone && !applySteps.some((st) => st.type === "http_out" && /ntfy\.sh/i.test(st.url || ""))) {
    applySteps.push({
      type: "http_out",
      url: "https://ntfy.sh/{topic}",
      body: "该起床了 · 睡眠中控",
    });
  }
  const hasDawnOut = applySteps.some((st) => st.type === "http_out" && /\/dawn/i.test(st.url || ""));
  if (ledStrip && !hasDawnOut) {
    const url = lampUrl || defaultDawnUrl();
    applySteps.push({
      type: "http_out",
      url,
      body: '{"progress":1}',
    });
    rememberLampUrl(url);
    if (!lampUrl && isStandinDawn(url)) {
      gaps.push("灯带地址暂用本中控 /dawn。板子烧好后改成 http://板子IP/dawn");
    }
  } else if (lamp && !ledStrip && !urls.length && !phone) {
    gaps.push("灯/窗帘的 POST 地址还没有。先屏幕黎明；有地址再加 HTTP 发出。");
  }

  applySteps.forEach((st) => steps.push(st));
  if (!steps.length) {
    steps.push({ type: "screen_dawn", durationMin: 15 });
    steps.push({ type: "pc_beep", seconds: 8 });
  }

  const name = clock ? "口述今夜 " + clock : wantLight ? "口述浅睡窗口" : "口述今夜";
  const note = [sense && "采集：" + sense, apply && "叫醒：" + apply].filter(Boolean).join("\n");
  const report =
    "编译 " +
    steps.map(compileStepBrief).join(" → ") +
    (sources.length ? "；源 " + sources.map((s) => s.name + "/" + s.sourceKey).join("、") : "；源用已有点选/回放") +
    (gaps.length ? "；缺项 " + gaps.length : "");

  return { ok: true, sources, steps, name, note, gaps, report };
}

function compileStepBrief(st) {
  if (st.type === "wait_until") return "等到 " + st.time;
  if (st.type === "wait_near") return "接近 " + st.time;
  if (st.type === "wait_fact") {
    if (st.fact === "stage") return "等 " + st.equals;
    return "等 " + st.fact;
  }
  if (st.type === "screen_dawn") return "屏幕黎明";
  if (st.type === "pc_beep") return "响铃";
  if (st.type === "notify") return "通知";
  if (st.type === "http_out") return /\/dawn/i.test(st.url || "") ? "灯带" : "HTTP 发出";
  return st.type;
}
