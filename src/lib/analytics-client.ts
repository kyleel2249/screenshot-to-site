/**
 * Browser-side analytics helpers. Nothing is sent unless the visitor has actively granted consent; the server
 * independently refuses events without `consent: true`, strips query strings and rejects anything that looks like PII.
 */
export type Consent = "granted" | "denied" | null;
const KEY = "ddt-consent-v1";
export const CONSENT_EVENT = "ddt:consent-changed";
export const OPEN_CONSENT_EVENT = "ddt:open-consent";

export function readConsent(): Consent {
  try { const v = localStorage.getItem(KEY); return v === "granted" || v === "denied" ? v : null; } catch { return null; }
}
export function writeConsent(v: "granted" | "denied") {
  try { localStorage.setItem(KEY, v); } catch { /* storage unavailable: choice applies for this page only */ }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: v }));
}

const MEASURED = new Set(["/", "/shop", "/new-arrivals", "/preorders", "/deals", "/best-sellers", "/featured", "/about", "/faq", "/contact", "/wholesale", "/checkout"]);
/** Allow-list: only public shop pages are measured. Staff dashboard, account, auth and tracking pages never are — by construction, not by pattern. */
export const isMeasurable = (pathname: string) => MEASURED.has(pathname) || /^\/(product|policies)\/[^/]+$/.test(pathname);

/** Maps a pathname to the single event kind it represents. */
export function eventKindFor(pathname: string): "product_view" | "category_view" | "checkout_start" | "page_view" {
  if (pathname.startsWith("/product/")) return "product_view";
  if (pathname === "/shop") return "category_view";
  if (pathname === "/checkout") return "checkout_start";
  return "page_view";
}
/** Marketing attribution from standard UTM parameters, trimmed; absent values are omitted. */
export function campaignFrom(search: string): { source?: string; campaign?: string } {
  const q = new URLSearchParams(search);
  const source = q.get("utm_source")?.slice(0, 60), campaign = q.get("utm_campaign")?.slice(0, 60);
  return { ...(source ? { source } : {}), ...(campaign ? { campaign } : {}) };
}
