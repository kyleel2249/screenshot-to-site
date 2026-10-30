/**
 * Edge router: decides, per request, whether the API, a generated SEO file, or the SSR app answers, then applies
 * response headers. Pure of framework imports so it is unit-tested; src/server.ts wires it to TanStack Start.
 *
 * CSP is intentionally NOT applied here: a nonce-based policy must be injected with the framework's script tags and can only
 * be validated in a real build (see docs/DEPLOYMENT.md). Every other hardening header is applied.
 */
import { resolvePortalPath } from "../lib/security/enrolment";
import { NO_STORE } from "../lib/security/headers";
import { buildRobots, buildSitemap } from "../lib/seo/sitemap";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { handle, publicProducts, type Deps, type Env } from "./api";
import { injectProductSeo } from "./seo-inject";
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

export async function route(req: Request, env: Env, persistence: Persistence, ssr: (r: Request) => Promise<Response> | Response, deps: Deps = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const portal = resolvePortalPath(env);
  const isPortal = !!portal && (path === portal || path.startsWith(`${portal}/`));

  if (path === "/api" || path.startsWith("/api/") || (isPortal && path.startsWith(`${portal}/api`))) return withHeaders(await handle(req, env, persistence, deps));

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
    if (!product) return withHeaders(new Response(res.body, { status: 404, headers: res.headers }), { "X-Robots-Tag": "noindex" });
    const html = injectProductSeo(await res.text(), product, env.SITE_ORIGIN);
    const h = new Headers(res.headers); h.delete("content-length"); h.delete("content-encoding");
    return withHeaders(new Response(html, { status: 200, headers: h }), { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" });
  }
  // Portal pages and personal/transactional pages must never be cached or indexed.
  if (isPortal) return withHeaders(res, { ...NO_STORE, "X-Robots-Tag": "noindex, nofollow, noarchive" });
  if (PRIVATE_PAGES.test(path)) return withHeaders(res, { ...NO_STORE, "X-Robots-Tag": "noindex" });
  return withHeaders(res);
}
