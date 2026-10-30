import { describe, expect, test } from "vitest";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { sha256Hex } from "../lib/security/crypto";
import type { Env } from "../server/api";
import { route } from "../server/edge";
import { createProduct } from "../server/services/catalog-admin";
import { injectProductSeo, safeJson } from "../server/seo-inject";
import { MemoryPersistence, transact } from "../server/persistence/transact";

const ORIGIN = "https://shop.test", PORTAL = "/ops-k7q2m9x4p1z8";
async function setup() {
  const p = new MemoryPersistence();
  const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN, PBKDF2_ITERATIONS: "1000", ADMIN_PORTAL_PATH: PORTAL, ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex("ref") };
  await transact(p, (db) => {
    db.categories = [...SEED_CATEGORIES];
    db.products.set("p1", { id: "p1", slug: "pub-item", name: "Pub", categoryId: "x", shortDescription: "s", image: "i", imageAlt: "a", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-03T00:00:00Z", archived: false } as never);
    db.products.set("p2", { id: "p2", slug: "draft-item", name: "Draft", categoryId: "x", shortDescription: "s", image: "i", imageAlt: "a", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-03T00:00:00Z", archived: false } as never);
    db.variants.set("p1::A", { id: "p1::A", productId: "p1", published: true } as never);
    db.variants.set("p2::B", { id: "p2::B", productId: "p2", published: false } as never);
  });
  let ssrCalls = 0;
  const ssr = async () => { ssrCalls++; return new Response("<html>app</html>", { headers: { "content-type": "text/html" } }); };
  return { p, env, ssr, calls: () => ssrCalls };
}
const get = (path: string) => new Request(ORIGIN + path);

describe("edge router", () => {
  test("pages go to SSR with hardening headers; public pages stay cacheable", async () => {
    const { p, env, ssr, calls } = await setup();
    const r = await route(get("/shop"), env, p, ssr);
    expect(calls()).toBe(1); expect(await r.text()).toContain("app");
    expect(r.headers.get("x-frame-options")).toBe("DENY"); expect(r.headers.get("x-content-type-options")).toBe("nosniff"); expect(r.headers.get("cache-control")).toBeNull();
  });
  test("API and secret-portal API never reach SSR; wrong portal does not exist", async () => {
    const { p, env, ssr, calls } = await setup();
    const empty = new MemoryPersistence();
    expect(await (await route(get("/api/products"), env, empty, ssr)).json()).toEqual([]);
    expect((await route(get(`${PORTAL}/api/me`), env, p, ssr)).status).toBe(404);
    expect(calls()).toBe(0);
  });
  test("private pages are no-store + noindex; portal page likewise", async () => {
    const { p, env, ssr } = await setup();
    for (const path of ["/checkout", "/account", "/login", "/reset-password", "/track", PORTAL]) {
      const r = await route(get(path), env, p, ssr);
      expect(r.headers.get("cache-control"), path).toBe("private, no-store");
      expect(r.headers.get("x-robots-tag"), path).toMatch(/noindex/);
    }
  });
  test("sitemap lists only published products and never private paths or the portal", async () => {
    const { p, env, ssr } = await setup();
    const xml = await (await route(get("/sitemap.xml"), env, p, ssr)).text();
    expect(xml).toContain("https://shop.test/product/pub-item"); expect(xml).not.toContain("draft-item");
    for (const bad of ["/checkout", "/account", "/cart", PORTAL, "admin"]) expect(xml).not.toContain(bad);
    const robots = await (await route(get("/robots.txt"), env, p, ssr)).text();
    expect(robots).toContain("Sitemap: https://shop.test/sitemap.xml"); expect(robots).not.toContain(PORTAL); expect(robots).toContain("Disallow: /track");
  });
});

describe("product page SEO injection", () => {
  const owner = { id: "o", kind: "staff" as const, roles: ["owner" as const], recentAuthAt: Date.now() };
  const shell = '<html><head><title>Dera Darko Trade</title><meta name="description" content="Quality imported products in Ghana."><meta property="og:type" content="website"><link rel="canonical" href="https://shop.test/"></head><body>app</body></html>';
  async function withProduct(extra: Record<string, unknown> = {}) {
    const p = new MemoryPersistence();
    const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN, PBKDF2_ITERATIONS: "1000", ADMIN_PORTAL_PATH: PORTAL, ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex("ref") };
    await transact(p, (db) => { createProduct(db, owner, { name: 'Cap <b>"x"</b> & Co', categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "Soft cotton </script><script>alert(1)</script>", image: "/img/cap.jpg", imageAlt: "cap", sku: "CAP", priceGhs: 12550, onHand: 5, published: true, ...extra } as never); });
    const ssr = async () => new Response(shell, { headers: { "content-type": "text/html; charset=utf-8" } });
    return { p, env, ssr };
  }
  test("a published product gets its own title, description, canonical, Open Graph and Product JSON-LD, safely escaped", async () => {
    const { p, env, ssr } = await withProduct(); const slug = await transact(p, (db) => [...db.products.values()].find((x) => x.name.startsWith("Cap"))!.slug);
    const r = await route(get(`/product/${slug}`), env, p, ssr); const html = await r.text();
    expect(r.status).toBe(200);
    expect(html.match(/<title>/g)!.length).toBe(1); expect(html).toContain("<title>Cap &lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; Co — Dera Darko Trade</title>");
    expect(html).toContain(`<link rel="canonical" href="https://shop.test/product/${slug}">`); expect(html).not.toContain('href="https://shop.test/"');
    expect(html.match(/name="description"/g)!.length).toBe(1); expect(html).toContain('property="og:type" content="product"'); expect(html.match(/og:type/g)!.length).toBe(1);
    expect(html).toContain('og:image" content="https://shop.test/img/cap.jpg"');
    const ld = JSON.parse(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html)![1]!);
    expect(ld).toMatchObject({ "@type": "Product", image: "https://shop.test/img/cap.jpg", offers: { priceCurrency: "GHS", price: "125.50", availability: "https://schema.org/InStock" } });
    expect(ld.aggregateRating).toBeUndefined(); // no published reviews → no rating claimed
    expect(html).not.toContain("</script><script>alert(1)"); // script-breakout attempt is neutralised in JSON-LD
    expect(html.match(/<script[^>]*type="application\/ld\+json"/g)!.length).toBe(1);
  });
  test("unknown, unpublished or malformed product URLs are real 404s for crawlers; other pages are untouched", async () => {
    const { p, env, ssr } = await withProduct();
    for (const path of ["/product/nope", "/product/%E0%A4%A", "/product/pub-item/"]) { const r = await route(get(path), env, p, ssr); expect(r.status).toBe(404); expect(r.headers.get("x-robots-tag")).toBe("noindex"); }
    expect(await (await route(get("/shop"), env, p, ssr)).text()).toBe(shell);
    const post = await route(new Request(`${ORIGIN}/product/nope`, { method: "POST" }), env, p, ssr); expect(post.status).toBe(200);
  });
  test("pure helper: pre-order availability, sale price wins, missing GHS price omits offers, rating only when counted", () => {
    const base = { slug: "a b", name: "N", shortDescription: "d", image: "https://cdn.test/i.jpg", availability: "pre_order", price: { GHS: 1000 }, salePrice: { GHS: 800 } };
    const ld = (h: string) => JSON.parse(/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(h)![1]!);
    expect(ld(injectProductSeo(shell, base, "https://shop.test/"))).toMatchObject({ offers: { price: "8.00", availability: "https://schema.org/PreOrder", url: "https://shop.test/product/a%20b" }, image: "https://cdn.test/i.jpg" });
    expect(ld(injectProductSeo(shell, { ...base, price: { USD: 5 }, salePrice: null }, "https://shop.test")).offers).toBeUndefined();
    expect(ld(injectProductSeo(shell, { ...base, rating: { average: 4.5, count: 3 } }, "https://shop.test")).aggregateRating).toEqual({ "@type": "AggregateRating", ratingValue: 4.5, reviewCount: 3 });
    expect(ld(injectProductSeo(shell, { ...base, rating: { average: 0, count: 0 } }, "https://shop.test")).aggregateRating).toBeUndefined();
    expect(safeJson({ a: "</script>\u2028&" })).not.toMatch(/<|>|&|\u2028/);
    expect(injectProductSeo("<p>no head</p>", base, "https://shop.test")).toBe("<p>no head</p>");
  });
});

describe("content security policy at the edge", () => {
  const page = '<html><head><script>window.__boot=1</script><script src="/a.js" type="module"></script><script nonce="keep" >x</script></head><body></body></html>';
  const ssr = async () => new Response(page, { headers: { "content-type": "text/html" } });
  test("default is report-only with a fresh nonce on every script; CSP_MODE=enforce enforces; nonce differs per response", async () => {
    const { p, env } = await setup();
    const a = await route(get("/shop"), env, p, ssr), b = await route(get("/shop"), env, p, ssr);
    const csp = a.headers.get("content-security-policy-report-only")!; expect(a.headers.get("content-security-policy")).toBeNull();
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]!; const html = await a.text();
    expect(html).toContain(`<script nonce="${nonce}">window.__boot=1`); expect(html).toContain(`<script nonce="${nonce}" src="/a.js" type="module">`); expect(html).toContain('<script nonce="keep" >x'); // existing nonce untouched
    expect(csp).toContain("report-uri /api/csp-report"); expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(/'nonce-([^']+)'/.exec(b.headers.get("content-security-policy-report-only")!)![1]).not.toBe(nonce);
    const enforced = await route(get("/shop"), { ...env, CSP_MODE: "enforce" }, p, ssr);
    expect(enforced.headers.get("content-security-policy")).toContain("frame-ancestors 'none'"); expect(enforced.headers.get("content-security-policy-report-only")).toBeNull();
  });
  test("portal and private pages get it too; API and non-HTML responses don't; the report endpoint is quiet and capped", async () => {
    const { p, env } = await setup();
    expect((await route(get("/checkout"), env, p, ssr)).headers.get("content-security-policy-report-only")).toBeTruthy();
    expect((await route(get(`${PORTAL}`), env, p, ssr)).headers.get("content-security-policy-report-only")).toBeTruthy();
    expect((await route(get("/api/products"), env, p, ssr)).headers.get("content-security-policy-report-only")).toBeNull();
    const css = await route(get("/x.css"), env, p, async () => new Response("a{}", { headers: { "content-type": "text/css" } })); expect(css.headers.get("content-security-policy-report-only")).toBeNull(); expect(await css.text()).toBe("a{}");
    const spy: unknown[][] = []; const orig = console.warn; console.warn = (...a: unknown[]) => { spy.push(a); };
    const r = await route(new Request(`${ORIGIN}/api/csp-report`, { method: "POST", body: "x".repeat(10_000) + "\nforged line" }), env, p, ssr); console.warn = orig;
    expect(r.status).toBe(204); expect(await r.text()).toBe(""); expect(String(spy[0]?.[1]).length).toBeLessThanOrEqual(600); expect(String(spy[0]?.[1])).not.toContain("\n");
    expect((await route(get("/api/csp-report"), env, p, ssr)).status).not.toBe(204); // GET isn't a report
  });
  test("product pages with injected SEO carry the nonce on the JSON-LD block", async () => {
    const p = new MemoryPersistence();
    const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN, PBKDF2_ITERATIONS: "1000", ADMIN_PORTAL_PATH: PORTAL, ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex("ref") };
    await transact(p, (db) => { createProduct(db, { id: "o", kind: "staff", roles: ["owner"], recentAuthAt: Date.now() }, { name: "Cap", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "d", image: "/i.jpg", imageAlt: "a", sku: "CAP", priceGhs: 1000, onHand: 1, published: true } as never); });
    const slug = await transact(p, (db) => [...db.products.values()][0]!.slug);
    const r = await route(get(`/product/${slug}`), env, p, async () => new Response("<html><head><title>x</title></head><body></body></html>", { headers: { "content-type": "text/html" } }));
    const nonce = /'nonce-([^']+)'/.exec(r.headers.get("content-security-policy-report-only")!)![1]!;
    expect(await r.text()).toContain(`<script nonce="${nonce}" type="application/ld+json"`);
  });
});
