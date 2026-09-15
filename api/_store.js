const g = globalThis;
if (!g.__sleepHub) {
  g.__sleepHub = {
    inbox: [],
    nextId: 1,
    dawn: { progress: 0, t: 0 },
    jobs: new Map(),
  };
}

export const store = g.__sleepHub;
const MAX_KEEP = 200;

export function pushEvent(data) {
  const evt = {
    id: store.nextId++,
    t: Date.now(),
    source: String(data.source || "unknown").slice(0, 64),
    kind: String(data.kind || "note").slice(0, 32),
    value: data.value,
    confidence: data.confidence ?? 1,
  };
  store.inbox.push(evt);
  if (store.inbox.length > MAX_KEEP) store.inbox.splice(0, store.inbox.length - MAX_KEEP);
  return evt;
}
