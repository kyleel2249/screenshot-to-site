/**
 * Edge router: decides, per request, whether the API, a generated SEO file, or the SSR app answers, then applies
 * response headers. Pure of framework imports so it is unit-tested; src/server.ts wires it to TanStack Start.
 *
 * CSP is intentionally NOT applied here: a nonce-based policy must be injected with the framework's script tags and can only
 * be validated in a real build (see docs/DEPLOYMENT.md). Every other hardening header is applied.
 */
import { resolvePortalPath } from "../lib/security/enrolment";
import { addNonceToScripts, buildCsp, newNonce, NO_STORE } from "../lib/security/headers";
import { buildRobots, buildSitemap } from "../lib/seo/sitemap";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { handle, publicProducts, type Deps, type Env } from "./api";
import { injectProductSeo } from "./seo-inject";
import { timingSafeEqual } from "../lib/security/crypto";
import { runMaintenance } from "./maintenance";
import { serveImage } from "./media";
import { transact, type Persistence } from "./persistence/transact";

const BASE_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};
const PRIVATE_PAGES = /^\/(cart|checkout|account|login|register|forgot-password|reset-password|verify-email|accept-invite|quote-status|track)(\/|$)/;

export function withHeaders(res: Response, extra: Record<string, string> = {}): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...BASE_HEADERS, ...extra })) out.headers.set(k, v);
  return out;
}

/**
 * Applies the nonce-based CSP to HTML responses. CSP_MODE=enforce enforces it; anything else (the default) only REPORTS
 * violations, so a first deploy can't white-screen the shop — switch to enforce once /api/csp-report shows no violations.
 */
async function withCsp(res: Response, env: Env): Promise<Response> {
  if (!(res.headers.get("content-type") ?? "").includes("text/html") || !res.body) return res;
  const nonce = newNonce();
  const html = addNonceToScripts(await res.text(), nonce);
  const h = new Headers(res.headers); h.delete("content-length"); h.delete("content-encoding");
  h.set(env.CSP_MODE === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", buildCsp({ nonce, reportUri: "/api/csp-report" }));
  return new Response(html, { status: res.status, statusText: res.statusText, headers: h });
}

export async function route(req: Request, env: Env, persistence: Persistence, ssr: (r: Request) => Promise<Response> | Response, deps: Deps = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const portal = resolvePortalPath(env);
  const isPortal = !!portal && (path === portal || path.startsWith(`${portal}/`));

  if (path === "/api/csp-report" && req.method === "POST") {
    // Browsers post violation reports here. Accept quietly, cap size, never echo; only a short sanitised line reaches the logs.
    const raw = (await req.text().catch(() => "")).slice(0, 4000);
    if (raw) console.warn("csp-violation", raw.replace(/[\r\n\t]+/g, " ").slice(0, 600));
    return withHeaders(new Response(null, { status: 204 }), NO_STORE);
  }
  if (path === "/api/maintenance" && req.method === "POST") {
    // Fallback for platforms where the Worker's `scheduled` hook isn't wired: any scheduler (Cron Worker, GitHub Actions, cron-job.org) can POST here
    // with the secret MAINTENANCE_KEY. Disabled (404) until that secret is set, constant-time comparison, no body, no output beyond counts.
    const key = env.MAINTENANCE_KEY ?? "", given = req.headers.get("x-maintenance-key") ?? "";
    if (key.length < 24 || !timingSafeEqual(given, key)) return withHeaders(new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } }), NO_STORE);
    return withHeaders(new Response(JSON.stringify(await runMaintenance(persistence)), { headers: { "content-type": "application/json" } }), NO_STORE);
  }
  if (path === "/api" || path.startsWith("/api/") || (isPortal && path.startsWith(`${portal}/api`))) return withHeaders(await handle(req, env, persistence, deps));

  if (req.method === "GET" && path.startsWith("/media/")) return withHeaders(await serveImage(env.MEDIA, path.slice(7)));
  if (req.method === "GET" && path === "/robots.txt") return withHeaders(new Response(buildRobots(env.SITE_ORIGIN, portal), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } }));
  if (req.method === "GET" && path === "/sitemap.xml") {
    const products = await transact(persistence, (db) => [...db.products.values()].map((p) => ({ slug: p.slug, updatedAt: p.updatedAt, archived: p.archived, published: [...db.variants.values()].some((v) => v.productId === p.id && v.published) })));
    return withHeaders(new Response(buildSitemap({ siteUrl: env.SITE_ORIGIN, categories: SEED_CATEGORIES, products }), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } }));
  }

  const res = await ssr(req);
  const pm = req.method === "GET" ? /^\/product\/([^/]+)\/?$/.exec(path) : null;
  if (pm && res.status === 200 && (res.headers.get("content-type") ?? "").includes("text/html")) {
    let slug = ""; try { slug = decodeURIComponent(pm[1]!); } catch { /* malformed → not found */ }
    const product = slug ? await transact(persistence, (db) => publicProducts(db).find((x) => x.slug === slug)) : undefined;
    // An unknown, unpublished or hidden product is a real 404 for crawlers (the page itself shows the friendly not-found message).
    if (!product) return withHeaders(await withCsp(new Response(res.body, { status: 404, headers: res.headers }), env), { "X-Robots-Tag": "noindex" });
    const html = injectProductSeo(await res.text(), product, env.SITE_ORIGIN);
    const h = new Headers(res.headers); h.delete("content-length"); h.delete("content-encoding");
    return withHeaders(await withCsp(new Response(html, { status: 200, headers: h }), env), { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" });
  }
  // Portal pages and personal/transactional pages must never be cached or indexed.
  if (isPortal) return withHeaders(await withCsp(res, env), { ...NO_STORE, "X-Robots-Tag": "noindex, nofollow, noarchive" });
  if (PRIVATE_PAGES.test(path)) return withHeaders(await withCsp(res, env), { ...NO_STORE, "X-Robots-Tag": "noindex" });
  return withHeaders(await withCsp(res, env));
}
