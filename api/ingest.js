import { json, OPTIONS, readJson } from "./_http.js";
import { pushEvent } from "./_store.js";

export { OPTIONS };
export const maxDuration = 10;

export async function POST(request) {
  const data = await readJson(request);
  if (!data) return json({ ok: false, error: "需要 JSON 对象" }, 400);
  const evt = pushEvent(data);
  return json({ ok: true, id: evt.id });
}
