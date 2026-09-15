function logLine(msg) {
  const line =
    new Date().toLocaleTimeString("zh-CN", { hour12: false }) + "  " + msg;
  const el = document.getElementById("log");
  if (el) el.textContent = line + "\n" + el.textContent;
  try {
    const hist = JSON.parse(localStorage.getItem("sleep-hub-log") || "[]");
    hist.unshift(line);
    localStorage.setItem("sleep-hub-log", JSON.stringify(hist.slice(0, 200)));
  } catch {
    /* ignore quota */
  }
}

const bus = {
  facts: {
    presence: true,
    motion: false,
    stage: "",
  },
  lastBySource: {},
  inbox: [],
  listeners: [],
  seenRemote: 0,
};

function onBus(fn) {
  bus.listeners.push(fn);
}

function emitBus(evt) {
  bus.listeners.forEach((fn) => fn(evt));
}

function ingest(raw, via) {
  const evt = {
    t: Date.now(),
    via: via || "local",
    source: String(raw.source || "unknown").slice(0, 64),
    kind: String(raw.kind || "note").slice(0, 32),
    value: raw.value,
    confidence: Number(raw.confidence),
  };
  if (!Number.isFinite(evt.confidence)) evt.confidence = 1;
  bus.lastBySource[evt.source] = evt;
  bus.inbox.unshift(evt);
  bus.inbox = bus.inbox.slice(0, 80);

  if (evt.kind === "presence") bus.facts.presence = truthy(evt.value);
  if (evt.kind === "motion") bus.facts.motion = truthy(evt.value);
  if (evt.kind === "stage") bus.facts.stage = String(evt.value ?? "");

  const extras = loadCustomSources().filter(
    (s) => s.enabled && s.sourceKey && s.sourceKey === evt.source && s.fact
  );
  extras.forEach((s) => {
    if (s.fact === "presence" || s.fact === "motion") {
      bus.facts[s.fact] = truthy(evt.value);
    } else if (s.fact === "stage") {
      bus.facts.stage = String(evt.value ?? "");
    }
  });

  emitBus({ type: "event", evt });
  return evt;
}

function truthy(v) {
  if (v === true || v === 1 || v === "1" || v === "true" || v === "on" || v === "有人") return true;
  if (v === false || v === 0 || v === "0" || v === "false" || v === "off" || v === "无人") return false;
  return Boolean(v);
}

function factEquals(key, want) {
  const got = bus.facts[key];
  if (key === "stage") return String(got || "") === String(want ?? "");
  return Boolean(got) === Boolean(want);
}

function loadCustomSources() {
  try {
    return JSON.parse(localStorage.getItem("sleep-hub-sources") || "[]");
  } catch {
    return [];
  }
}

function saveCustomSources(list) {
  localStorage.setItem("sleep-hub-sources", JSON.stringify(list));
}

let pollBusy = false;

async function pollRemote() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const res = await fetch("/api/inbox?after=" + bus.seenRemote);
    if (!res.ok) return;
    const data = await res.json();
    (data.events || []).forEach((e) => {
      bus.seenRemote = Math.max(bus.seenRemote, e.id || 0);
      ingest(e, "http");
    });
  } catch {
    /* 没开 server 也能单页跑 */
  } finally {
    pollBusy = false;
  }
}
