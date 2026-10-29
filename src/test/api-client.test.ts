import { describe, expect, test } from "vitest";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { createClient } from "../lib/api-client";
import { sha256Hex } from "../lib/security/crypto";
import { handle, type Env } from "../server/api";
import { MemoryPersistence, transact } from "../server/persistence/transact";

const ORIGIN = "https://shop.test", PORTAL = "/ops-k7q2m9x4p1z8", PW = "Str0ng!Passw0rd#";
let n = 0;

/** A fetch that talks to the REAL handler and keeps a cookie jar like a browser. */
async function browser() {
  const p = new MemoryPersistence();
  const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN, PBKDF2_ITERATIONS: "1000", ADMIN_PORTAL_PATH: PORTAL, ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex("ref") };
  await transact(p, (db) => { db.categories = [...SEED_CATEGORIES]; db.zones.set("z", { id: "z", name: "z", regions: ["Greater Accra"], currency: "GHS", baseFee: 2000, perKgFee: 0, estimate: "est" }); });
  const tokens: string[] = [];
  let jar = "";
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); headers.set("cf-connecting-ip", `10.1.0.${++n}`); if (jar) headers.set("cookie", jar);
    const res = await handle(new Request(ORIGIN + url, { ...init, headers }), env, p, { mail: async (_t, _tpl, d) => { tokens.push(d.token); } });
    const sc = res.headers.get("set-cookie"); if (sc) jar = sc.split(";")[0]!.endsWith("=") ? "" : sc.split(";")[0]!;
    return res;
  };
  return { api: createClient({ fetchImpl, origin: ORIGIN }), tokens, p };
}

describe("api client against the real handler", () => {
  test("register → verify → login → me → logout, with friendly errors", async () => {
    const { api, tokens } = await browser();
    const bad = await api.register({ email: "x", password: "weak", firstName: "", lastName: "", acceptTerms: false });
    expect(bad.ok).toBe(false); expect(bad.errors.length).toBeGreaterThan(2);
    expect((await api.register({ email: "a@x.com", password: PW, firstName: "A", lastName: "B", acceptTerms: true })).ok).toBe(true);
    expect((await api.verifyEmail(tokens[0]!)).ok).toBe(true);
    const wrong = await api.login("a@x.com", "nope"); expect(wrong).toMatchObject({ ok: false, status: 401, errors: ["Incorrect email or password."] });
    expect((await api.me()).status).toBe(401);
    expect((await api.login("a@x.com", PW)).ok).toBe(true);
    expect((await api.me()).data).toMatchObject({ email: "a@x.com", firstName: "A" });
    await api.logout(); expect((await api.me()).status).toBe(401);
  });
  test("network failure yields a friendly error, never a throw", async () => {
    const api = createClient({ fetchImpl: async () => { throw new Error("offline"); } });
    expect(await api.products()).toMatchObject({ ok: false, status: 0 });
  });
  test("full admin → storefront → checkout round trip through the client", async () => {
    const { api, tokens } = await browser();
    // owner enrolment + login (portal path is typed by the owner; it is not in any bundle)
    expect((await api.admin(PORTAL).enrol({ reference: "ref", email: "owner@shop.test", password: PW })).ok).toBe(true);
    await api.verifyEmail(tokens[tokens.length - 1]!);
    expect((await api.login("owner@shop.test", PW)).ok).toBe(true);
    const admin = api.admin(PORTAL);
    // a staff session must not break the storefront's 'am I a customer?' probe, and zones are public
    expect((await api.me()).status).toBeLessThan(500); expect((await api.me()).ok).toBe(false);
    expect((await api.zones()).data).toEqual([expect.objectContaining({ id: "z", name: "z" })]);
    expect((await api.support({ email: "a@b.co", subject: "Hi", body: "Hello" })).ok).toBe(true);
    expect((await admin.me()).data?.roles).toEqual(["owner"]);
    const created = await admin.createProduct({ name: "Sneaker", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "SN1", priceGhs: 50000, onHand: 2, published: true });
    expect(created.ok).toBe(true);
    const list = await admin.products(); expect(list.data![0]).toMatchObject({ sku: "SN1", onHand: 2, published: true });
    expect((await api.products()).data![0]).toMatchObject({ name: "Sneaker", availability: "available" });
    await admin.adjustStock(created.data!.id + "::SN1", 3, "restock"); expect((await admin.products()).data![0]!.onHand).toBe(5);
    const co = await api.checkout({ lines: [{ variantId: `${created.data!.id}::SN1`, qty: 1 }], currency: "GHS", region: "Greater Accra", zoneId: "z", guestEmail: "g@x.com", address: { recipient: "R", region: "Greater Accra", city: "Accra", street: "1" }, idempotencyKey: "abc", acceptedTerms: true });
    expect(co.data!.order.total).toBe(52000);
    const orders = await admin.orders(); expect(orders.data![0]!.address.recipient).toBe("R");
    expect((await api.admin("/wrong-path-123456").products()).status).toBe(404);
    expect((await admin.setStatus([created.data!.id], "pre_order")).errors[0]).toMatch(/pre-orders/i);
  });
});
