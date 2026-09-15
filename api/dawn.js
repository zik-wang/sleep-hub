import { json, OPTIONS, readJson } from "./_http.js";
import { store } from "./_store.js";

export { OPTIONS };
export const maxDuration = 10;

export function GET() {
  return json({ ok: true, progress: store.dawn.progress, standin: true });
}

export async function POST(request) {
  let progress = store.dawn.progress;
  const data = await readJson(request);
  if (data && data.progress != null) {
    const n = Number(data.progress);
    if (Number.isFinite(n)) progress = n;
  }
  progress = Math.max(0, Math.min(1, progress));
  store.dawn.progress = progress;
  store.dawn.t = Date.now();
  return json({ ok: true, progress, standin: true });
}
