import { json, OPTIONS, readJson } from "./_http.js";
import { compileNl, nlAvailable } from "./_nl.js";
import { store } from "./_store.js";

export { OPTIONS };
export const maxDuration = 60;

function jobId() {
  return Math.random().toString(16).slice(2, 14);
}

export function GET(request) {
  const id = new URL(request.url).searchParams.get("job") || "";
  const data = store.jobs.get(id);
  if (!data) return json({ ok: false, error: "没有这个任务" }, 404);
  return json({ ok: true, ...data });
}

export async function POST(request) {
  if (!nlAvailable()) return json({ ok: false, error: "未配置 DeepSeek" }, 503);
  const data = await readJson(request);
  if (!data) return json({ ok: false, error: "需要 JSON 对象" }, 400);
  const id = jobId();
  store.jobs.set(id, { status: "running" });
  try {
    const result = await compileNl(
      String(data.sense || "").slice(0, 1500),
      String(data.apply || "").slice(0, 1500),
      String(data.origin || "").slice(0, 120),
      String(data.topic || "")
    );
    const done = { status: "done", result };
    store.jobs.set(id, done);
    return json({ ok: true, id, ...done });
  } catch (e) {
    const fail = { status: "error", error: String(e.message || e).slice(0, 240) };
    store.jobs.set(id, fail);
    return json({ ok: true, id, ...fail });
  }
}
