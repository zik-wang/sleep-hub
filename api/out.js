import { json, OPTIONS, readJson } from "./_http.js";

export { OPTIONS };
export const maxDuration = 15;

export async function POST(request) {
  const data = await readJson(request);
  if (!data) return json({ ok: false, error: "需要 JSON 对象" }, 400);
  const url = String(data.url || "").trim();
  if (!(url.startsWith("http://") || url.startsWith("https://"))) {
    return json({ ok: false, error: "只转发 http(s)" }, 400);
  }
  const body = String(data.body || "");
  const headers = {
    "Content-Type": body.trim().startsWith("{") ? "application/json" : "text/plain;charset=utf-8",
  };
  if (url.includes("ntfy.sh")) headers.Title = "sleep-hub";
  try {
    const res = await fetch(url, { method: "POST", headers, body });
    await res.arrayBuffer();
    return json({ ok: true, status: res.status });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 502);
  }
}
