import { json, OPTIONS, publicOrigin } from "./_http.js";
import { nlAvailable } from "./_nl.js";
import { store } from "./_store.js";

export { OPTIONS };
export const maxDuration = 10;

export function GET(request) {
  const origin = publicOrigin(request);
  return json({
    ok: true,
    inbox: store.inbox.length,
    port: 443,
    lan: origin + "/",
    ingest: origin + "/ingest",
    nl: nlAvailable(),
  });
}
