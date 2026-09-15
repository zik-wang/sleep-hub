import { json, OPTIONS, readJson } from "./_http.js";
import { chatTurn, nlAvailable } from "./_nl.js";

export { OPTIONS };
export const maxDuration = 60;

export async function POST(request) {
  if (!nlAvailable()) return json({ ok: false, error: "未配置 DeepSeek" }, 503);
  const data = await readJson(request);
  if (!data) return json({ ok: false, error: "需要 JSON 对象" }, 400);
  try {
    const out = await chatTurn({
      messages: data.messages,
      files: data.files,
      origin: String(data.origin || "").slice(0, 120),
      topic: String(data.topic || ""),
    });
    return json({ ok: true, ...out });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e).slice(0, 240) }, 502);
  }
}
