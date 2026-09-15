import { json, OPTIONS } from "./_http.js";
import { store } from "./_store.js";

export { OPTIONS };
export const maxDuration = 10;

export function GET(request) {
  const after = Number(new URL(request.url).searchParams.get("after") || 0) || 0;
  const events = store.inbox.filter((e) => e.id > after);
  return json({ events });
}
