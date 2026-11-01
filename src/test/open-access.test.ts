import { describe, expect, test } from "vitest";
import { createClient } from "../lib/api-client";
import { OPEN_ACCESS_EMAIL } from "../lib/security/open-access";
import { handle, normaliseNewProduct, type Env } from "../server/api";
import { route } from "../server/edge";
import { MemoryPersistence, transact } from "../server/persistence/transact";

const ORIGIN = "https://shop.test", CONSOLE = "/dera-owner-console", PW = "Str0ng!Passw0rd#";
let n = 0;

async function shop(p = new MemoryPersistence()) {
  const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN, PBKDF2_ITERATIONS: "1000" };
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); headers.set("cf-connecting-ip", `10.9.0.${++n}`);
    return handle(new Request(ORIGIN + url, { ...init, headers }), env, p);
  };
  return { api: createClient({ fetchImpl, origin: ORIGIN }), p, env, call: fetchImpl };
}

describe("open dashboard (no login)", () => {
  test("opens with no sign-in, as the owner, and says whether data is being kept", async () => {
    const { api } = await shop();
    const me = await api.admin(CONSOLE).me();
    expect(me.ok).toBe(true); expect(me.data).toMatchObject({ roles: ["owner"], storage: "memory" });
  });

  test("a product can be created, priced, published and seen publicly; counts update", async () => {
    const { api } = await shop();
    const admin = api.admin(CONSOLE);
    const cats = (await admin.categories()).data!; expect(cats.length).toBeGreaterThan(15);
    const made = await admin.createProduct({ name: "Test Basket", sku: "T-1", categoryId: cats.find((c) => c.parentId)!.id, shortDescription: "A basket", image: "/products/DDT-003.png", imageAlt: "Basket", priceGhs: 8500, priceUsd: 740, onHand: 5, published: true, availability: "available" });
    expect(made.ok).toBe(true); expect(made.data).toMatchObject({ published: true });
    expect((await api.products()).data!.map((x) => x.name)).toContain("Test Basket");
    const ov = (await admin.overview()).data as unknown as { catalogue: { products: number; published: number; missingPrice: number } };
    expect(ov.catalogue).toMatchObject({ products: 1, published: 1, missingPrice: 0 });
  });

  test("bad input is refused with a reason instead of being silently changed", async () => {
    const { api } = await shop();
    const admin = api.admin(CONSOLE);
    const cat = (await admin.categories()).data!.find((c) => c.parentId)!;
    const base = { name: "X", sku: "X-1", categoryId: cat.id, shortDescription: "x", image: "/products/DDT-003.png", imageAlt: "x" };
    for (const [bad, re] of [
      [{ ...base, image: "blob:https://shop.test/abc" }, /local preview/],
      [{ ...base, priceGhs: -5 }, /GHS price/],
      [{ ...base, priceGhs: 12.5 }, /GHS price/],
      [{ ...base, onHand: "lots" }, /Stock/],
      [{ ...base, availability: "sold_out_forever" }, /availability/],
      [{ ...base, name: "  " }, /Name is required/],
      [{ ...base, image: "data:text/html;base64,PHNjcmlwdD4=" }, /PNG, JPEG/],
      [{ ...base, published: true }, /price/i],
    ] as const) {
      const r = await admin.createProduct(bad as Record<string, unknown>);
      expect(r.ok).toBe(false); expect(r.status).toBe(422); expect(r.errors.join(" ")).toMatch(re);
    }
    expect((await admin.products()).data).toEqual([]);
    expect((await admin.createProduct({ ...base, categoryId: "cat-does-not-exist" })).errors.join(" ")).toMatch(/category/i);
  });

  test("a store whose saved state lost its categories gets the standard tree back", async () => {
    const { api, p } = await shop();
    await transact(p, (db) => { db.categories = []; });
    expect((await api.admin(CONSOLE).categories()).data!.length).toBeGreaterThan(15);
  });

  test("normaliseNewProduct keeps legacy 'enquiry' availability working and defaults text from the name", () => {
    const r = normaliseNewProduct({ name: "Chair", sku: "C-1", categoryId: "c", availability: "enquiry", image: "/products/DDT-001.png" });
    expect(r.availability).toBe("temporarily_unavailable"); expect(r.shortDescription).toBe("Chair"); expect(r.imageAlt).toBe("Chair"); expect(r.published).toBe(false);
  });

  test("the built-in owner exists once, leaves no sessions, and nobody can sign in as it", async () => {
    const { api, p } = await shop();
    for (let i = 0; i < 4; i++) await api.admin(CONSOLE).me();
    const { users, sessions } = await transact(p, (db) => ({ users: [...db.users.values()].filter((u) => u.email === OPEN_ACCESS_EMAIL).length, sessions: db.sessions.size }));
    expect(users).toBe(1); expect(sessions).toBe(0);
    for (const pw of ["", "disabled", "open", PW]) expect((await api.login(OPEN_ACCESS_EMAIL, pw)).ok).toBe(false);
  });

  test("the login, two-step, enrolment, password-change and staff-invite routes are gone", async () => {
    const { call } = await shop();
    const post = (path: string) => call(path, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });
    for (const gone of ["/enrol", "/mfa/setup", "/mfa/confirm", "/mfa/verify", "/password/change", "/staff/invite", "/staff/mfa-reset"]) expect((await post(`${CONSOLE}/api${gone}`)).status).toBe(404);
    expect((await call(`${CONSOLE}/api/staff`)).status).toBe(404);
    expect((await post("/api/staff/accept-invite")).status).toBe(404);
  });

  test("only the dashboard path is an admin path", async () => {
    const { api } = await shop();
    for (const other of ["/some-other-path-1234", "/admin", "/ops-k7q2m9x4p1z8"]) {
      expect((await api.admin(other).me()).status).toBe(404);
      expect((await api.admin(other).createProduct({ name: "x" })).status).toBe(404);
    }
  });

  test("customer registration and sign-in still work", async () => {
    const { api } = await shop();
    expect((await api.register({ email: "a@x.com", password: PW, firstName: "A", lastName: "B", acceptTerms: true })).ok).toBe(true);
    expect((await api.login("a@x.com", PW)).ok).toBe(true);
  });

  test("the edge router serves the dashboard API uncached and never advertises the path in robots.txt", async () => {
    const p = new MemoryPersistence();
    const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN };
    const res = await route(new Request(`${ORIGIN}${CONSOLE}/api/me`), env, p, () => new Response("ssr"));
    expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const robots = await (await route(new Request(`${ORIGIN}/robots.txt`), env, p, () => new Response("ssr"))).text();
    expect(robots).not.toMatch(/dera-owner-console/);
    const page = await route(new Request(`${ORIGIN}${CONSOLE}`), env, p, () => new Response("<html></html>", { headers: { "content-type": "text/html" } }));
    expect(page.headers.get("x-robots-tag")).toMatch(/noindex/);
  });
});
