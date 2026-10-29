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

describe("shipping zones and discounts through the client", () => {
  async function owner() {
    const b = await browser();
    await b.api.admin(PORTAL).enrol({ reference: "ref", email: "owner@shop.test", password: PW });
    await b.api.verifyEmail(b.tokens[b.tokens.length - 1]!); await b.api.login("owner@shop.test", PW);
    return { ...b, admin: b.api.admin(PORTAL) };
  }
  test("zones: validated, saved, public, editable, deletable", async () => {
    const { api, admin } = await owner();
    const bad = await admin.saveZone({ name: "", regions: ["Atlantis"], currency: "GHS", baseFee: -5, estimate: "" });
    expect(bad.status).toBe(422); expect(bad.errors.join(" ")).toMatch(/Unknown region: Atlantis/);
    const ok = await admin.saveZone({ name: "Accra", regions: ["Greater Accra"], currency: "GHS", baseFee: 2500, estimate: "1–2 days", freeOver: 50000 });
    expect(ok.status).toBe(201);
    const id = ok.data!.id;
    expect((await api.zones()).data!.map((z) => z.name)).toContain("Accra");
    expect((await admin.saveZone({ id, name: "Accra metro", regions: ["Greater Accra"], currency: "GHS", baseFee: 3000, estimate: "1–2 days" })).data!.baseFee).toBe(3000);
    expect((await admin.zones()).data!.find((z) => z.id === id)!.freeOver).toBeUndefined();
    expect((await admin.saveZone({ id: "nope", name: "x", regions: ["Volta"], currency: "GHS", baseFee: 1, estimate: "e" })).ok).toBe(false);
    expect((await admin.deleteZone(id)).ok).toBe(true); expect((await admin.deleteZone(id)).status).toBe(422);
  });
  test("discounts: validated, never trust client redemption counts, toggle, and apply at checkout", async () => {
    const { api, admin } = await owner();
    expect((await admin.saveDiscount({ code: "x", kind: "percent", value: 500 })).status).toBe(422);
    expect((await admin.saveDiscount({ code: "BAD", kind: "percent", value: 20000 })).status).toBe(422);
    const d = await admin.saveDiscount({ code: "welcome10", kind: "percent", value: 1000, redeemed: 99 } as never);
    expect(d.data).toMatchObject({ code: "WELCOME10", redeemed: 0, active: true });
    const prod = await admin.createProduct({ name: "Cap", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "CAP", priceGhs: 10000, onHand: 5, published: true });
    const variantId = `${prod.data!.id}::CAP`;
    const order = (code: string) => api.checkout({ lines: [{ variantId, qty: 1 }], currency: "GHS", region: "Greater Accra", zoneId: "z", guestEmail: "g@x.com", address: { recipient: "R", region: "Greater Accra", city: "A", street: "1" }, discountCode: code, idempotencyKey: `k-${code}-${Math.random()}`, acceptedTerms: true });
    const withCode = await order("WELCOME10"); expect(withCode.data!.order.discount).toBe(1000);
    await admin.setDiscountActive("WELCOME10", false);
    expect((await order("WELCOME10")).ok).toBe(false);
    expect((await admin.discounts()).data![0]).toMatchObject({ active: false, redeemed: 0 }); // redemptions count on verified payment, not on unpaid orders
  });
  test("a fulfilment user cannot read or change zones or discounts", async () => {
    const { p, admin, api } = await owner();
    await transact(p, (db) => { const u = [...db.users.values()].find((x) => x.email === "owner@shop.test")!; u.roles = ["fulfilment"]; });
    await api.logout(); await api.login("owner@shop.test", PW);
    for (const r of [await admin.zones(), await admin.discounts(), await admin.saveZone({ name: "a", regions: ["Volta"], currency: "GHS", baseFee: 1, estimate: "e" }), await admin.saveDiscount({ code: "ABC", kind: "free_shipping", value: 0 })]) expect(r.status).toBe(403);
  });
});

describe("category administration through the client", () => {
  async function owner() {
    const p = new MemoryPersistence();
    const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN, PBKDF2_ITERATIONS: "1000", ADMIN_PORTAL_PATH: PORTAL, ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex("ref") };
    const tokens: string[] = []; let jar = "";
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers); headers.set("cf-connecting-ip", `10.2.0.${++n}`); if (jar) headers.set("cookie", jar);
      const res = await handle(new Request(ORIGIN + url, { ...init, headers }), env, p, { mail: async (_t, _tpl, d) => { tokens.push(d.token); } });
      const sc = res.headers.get("set-cookie"); if (sc) jar = sc.split(";")[0]!.endsWith("=") ? "" : sc.split(";")[0]!;
      return res;
    };
    const api = createClient({ fetchImpl, origin: ORIGIN }); const admin = api.admin(PORTAL);
    await admin.enrol({ reference: "ref", email: "owner@shop.test", password: PW }); await api.verifyEmail(tokens.at(-1)!); await api.login("owner@shop.test", PW);
    return { api, admin, p };
  }
  test("a brand-new shop already has the standard categories, so the first product can be added", async () => {
    const { api, admin } = await owner();
    expect((await api.categories()).data!.length).toBeGreaterThan(14);
    const r = await admin.createProduct({ name: "First", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "F1", priceGhs: 100, onHand: 1, published: true });
    expect(r.ok).toBe(true);
  });
  test("add, rename, hide (children hidden too), move; bad input is 422 not 500", async () => {
    const { api, admin } = await owner();
    const top = (await admin.categories()).data!.find((c) => c.parentId === null)!;
    expect((await admin.addCategory("Gadgets Plus", top.id)).ok).toBe(true);
    const added = (await admin.categories()).data!.find((c) => c.name === "Gadgets Plus")!;
    expect(added.parentId).toBe(top.id);
    expect((await admin.renameCategory(added.id, "Gadgets Pro")).ok).toBe(true);
    expect((await api.categories()).data!.some((c) => c.name === "Gadgets Pro")).toBe(true);
    expect((await admin.addCategory("Too deep", added.id)).errors[0]).toMatch(/two levels/);
    expect((await admin.renameCategory("cat-nope", "x")).status).toBe(422);
    expect((await admin.renameCategory(added.id, "  ")).status).toBe(422);
    expect((await admin.addCategory("x", "cat-nope")).status).toBe(422);
    await admin.setCategoryHidden(top.id, true);
    const pub = (await api.categories()).data!;
    expect(pub.some((c) => c.id === top.id)).toBe(false); expect(pub.some((c) => c.id === added.id)).toBe(false); // children of a hidden parent are hidden too
    expect((await admin.categories()).data!.some((c) => c.id === top.id)).toBe(true); // staff still see it
    expect((await admin.moveCategory(added.id, 0)).ok).toBe(true); expect((await admin.moveCategory("cat-nope", 0)).status).toBe(422);
  });
});
