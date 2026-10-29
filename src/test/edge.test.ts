import { describe, expect, test } from "vitest";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { sha256Hex } from "../lib/security/crypto";
import type { Env } from "../server/api";
import { route } from "../server/edge";
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
