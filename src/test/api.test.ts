import { describe, expect, test } from "vitest";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { hmacHex } from "../lib/payments/webhook";
import { sha256Hex } from "../lib/security/crypto";
import { handle, type Env } from "../server/api";
import { MemoryPersistence, transact } from "../server/persistence/transact";

const ORIGIN = "https://shop.test";
const PW = "Str0ng!Passw0rd#";
const PORTAL = "/ops-k7q2m9x4p1z8";
let ipN = 0;

async function world() {
  const p = new MemoryPersistence();
  const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN, PAYMENT_WEBHOOK_SECRET: "whsec", PBKDF2_ITERATIONS: "1000", ADMIN_PORTAL_PATH: PORTAL, ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex("test-ref") };
  await transact(p, (db) => { db.categories = [...SEED_CATEGORIES]; db.zones.set("z", { id: "z", name: "Accra", regions: ["Greater Accra"], currency: "GHS", baseFee: 2000, perKgFee: 0, estimate: "1–3 days (estimate)" }); });
  const mails: { to: string; template: string; token: string }[] = [];
  const deps = { mail: async (to: string, template: string, d: { token: string }) => { mails.push({ to, template, token: d.token }); } };
  const call = async (path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; headers?: Record<string, string> } = {}) => {
    const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
    const headers: Record<string, string> = { "cf-connecting-ip": `10.0.0.${++ipN}`, ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers };
    if (method !== "GET" && init.origin !== null) headers["origin"] = init.origin ?? ORIGIN;
    const res = await handle(new Request(ORIGIN + path, { method, headers, ...(init.body !== undefined ? { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) } : {}) }), env, p, deps as never);
    const text = await res.text(); let data: any = null; try { data = JSON.parse(text); } catch { data = text; }
    return { res, status: res.status, data };
  };
  const cookieFrom = (r: { res: Response }) => (r.res.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { p, env, call, mails, cookieFrom };
}
type W = Awaited<ReturnType<typeof world>>;

async function ownerSession(w: W) {
  const e = await w.call(`${PORTAL}/api/enrol`, { body: { reference: "test-ref", email: "owner@shop.test", password: PW } });
  expect(e.status).toBe(200);
  const verify = w.mails.find((m) => m.template === "owner_verify")!;
  // staff email verification uses the same token store
  expect((await w.call("/api/verify-email", { body: { token: verify.token } })).status).toBe(200);
  const l = await w.call("/api/login", { body: { email: "owner@shop.test", password: PW } });
  expect(l.status).toBe(200);
  return w.cookieFrom(l);
}
const newProd = (o: Record<string, unknown> = {}) => ({ name: "Test Phone", categoryId: "cat-phones-and-accessories--mobile-phones", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "PH1", priceGhs: 100000, priceUsd: 6500, onHand: 3, published: true, ...o });

describe("transport security", () => {
  test("state-changing requests need a same-origin Origin header; malformed JSON is rejected; unknown routes 404", async () => {
    const w = await world();
    expect((await w.call("/api/login", { body: {}, origin: "https://evil.test" })).status).toBe(403);
    expect((await w.call("/api/login", { body: {}, origin: null })).status).toBe(403);
    expect((await w.call("/api/login", { body: "{not json" })).status).toBe(400);
    expect((await w.call("/api/nope")).status).toBe(404);
    expect((await w.call("/api/products")).res.headers.get("cache-control")).toBe("private, no-store");
  });
  test("session cookie is HttpOnly, Secure, SameSite=Strict", async () => {
    const w = await world();
    await w.call("/api/register", { body: { email: "a@x.com", password: PW, firstName: "A", lastName: "B", acceptTerms: true } });
    await w.call("/api/verify-email", { body: { token: w.mails[0]!.token } });
    const l = await w.call("/api/login", { body: { email: "a@x.com", password: PW } });
    const c = l.res.headers.get("set-cookie")!;
    expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/Secure/); expect(c).toMatch(/SameSite=Strict/);
  });
});

describe("customer flow over HTTP", () => {
  test("register → generic duplicate → login → /api/me; tokens never appear in responses", async () => {
    const w = await world();
    const r1 = await w.call("/api/register", { body: { email: "a@x.com", password: PW, firstName: "A", lastName: "B", acceptTerms: true } });
    const r2 = await w.call("/api/register", { body: { email: "a@x.com", password: PW, firstName: "A", lastName: "B", acceptTerms: true } });
    expect(r1.status).toBe(201); expect(r2.status).toBe(201); expect(JSON.stringify([r1.data, r2.data])).not.toContain(w.mails[0]!.token);
    expect(w.mails.length).toBe(1);
    expect((await w.call("/api/register", { body: { email: "b@x.com", password: "weak", firstName: "A", lastName: "B", acceptTerms: false } })).status).toBe(422);
    expect((await w.call("/api/me")).status).toBe(401);
    const bad = await w.call("/api/login", { body: { email: "a@x.com", password: "nope" } });
    expect(bad.status).toBe(401);
    const ok = await w.call("/api/login", { body: { email: "a@x.com", password: PW } });
    const me = await w.call("/api/me", { cookie: w.cookieFrom(ok) });
    expect(me.data).toMatchObject({ email: "a@x.com", firstName: "A" }); expect(JSON.stringify(me.data)).not.toMatch(/pbkdf2|passwordHash/);
  });
  test("password reset: generic forgot, single-use link, old session dies", async () => {
    const w = await world();
    await w.call("/api/register", { body: { email: "a@x.com", password: PW, firstName: "A", lastName: "B", acceptTerms: true } });
    const ck = w.cookieFrom(await w.call("/api/login", { body: { email: "a@x.com", password: PW } }));
    const f1 = await w.call("/api/password/forgot", { body: { email: "a@x.com" } }), f2 = await w.call("/api/password/forgot", { body: { email: "ghost@x.com" } });
    expect(f1.data).toEqual(f2.data);
    const tok = w.mails.find((m) => m.template === "password_reset")!.token;
    expect((await w.call("/api/password/reset", { body: { token: tok, password: PW + "9" } })).status).toBe(200);
    expect((await w.call("/api/password/reset", { body: { token: tok, password: PW + "8" } })).status).toBe(400);
    expect((await w.call("/api/me", { cookie: ck })).status).toBe(401);
  });
  test("logout invalidates the session server-side", async () => {
    const w = await world();
    await w.call("/api/register", { body: { email: "a@x.com", password: PW, firstName: "A", lastName: "B", acceptTerms: true } });
    const ck = w.cookieFrom(await w.call("/api/login", { body: { email: "a@x.com", password: PW } }));
    expect((await w.call("/api/logout", { body: {}, cookie: ck })).status).toBe(200);
    expect((await w.call("/api/me", { cookie: ck })).status).toBe(401);
  });
});

describe("admin portal", () => {
  test("enrolment works once; wrong reference fails; probes get 404; customers cannot use admin API", async () => {
    const w = await world();
    expect((await w.call(`${PORTAL}/api/enrol`, { body: { reference: "wrong", email: "o@x.com", password: PW } })).status).toBe(404);
    const ck = await ownerSession(w);
    expect((await w.call(`${PORTAL}/api/enrol`, { body: { reference: "test-ref", email: "z@x.com", password: PW } })).status).toBe(404); // closed
    expect((await w.call(`${PORTAL}/api/products`, { body: newProd() })).status).toBe(404); // no session
    expect((await w.call(`/admin/api/products`, { body: newProd(), cookie: ck })).status).toBe(404); // wrong path
    expect((await w.call(`${PORTAL}/api/products`, { body: newProd(), cookie: ck })).status).toBe(201);
    await w.call("/api/register", { body: { email: "c@x.com", password: PW, firstName: "C", lastName: "D", acceptTerms: true } });
    const cc = w.cookieFrom(await w.call("/api/login", { body: { email: "c@x.com", password: PW } }));
    expect((await w.call(`${PORTAL}/api/products`, { body: newProd({ sku: "X" }), cookie: cc })).status).toBe(404);
  });
  test("portal is disabled entirely when ADMIN_PORTAL_PATH is missing or contains 'admin'", async () => {
    const w = await world();
    w.env.ADMIN_PORTAL_PATH = "/admin-portal-abcdef";
    expect((await w.call("/admin-portal-abcdef/api/enrol", { body: { reference: "test-ref", email: "o@x.com", password: PW } })).status).toBe(404);
    delete w.env.ADMIN_PORTAL_PATH;
    expect((await w.call(`${PORTAL}/api/enrol`, { body: { reference: "test-ref", email: "o@x.com", password: PW } })).status).toBe(404);
  });
  test("dashboard changes propagate to the public storefront immediately", async () => {
    const w = await world(); const ck = await ownerSession(w);
    expect((await w.call("/api/products")).data).toEqual([]);
    const created = await w.call(`${PORTAL}/api/products`, { body: newProd({ published: false }), cookie: ck });
    expect((await w.call("/api/products")).data).toEqual([]); // unpublished stays hidden
    await w.call(`${PORTAL}/api/products/publish`, { body: { productId: created.data.id, published: true }, cookie: ck });
    let list = (await w.call("/api/products")).data;
    expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ availability: "available", price: { GHS: 100000, USD: 6500 } });
    expect(JSON.stringify(list)).not.toMatch(/onHand|reserved|cost/);
    await w.call(`${PORTAL}/api/products/status`, { body: { ids: [created.data.id], availability: "out_of_stock" }, cookie: ck });
    expect((await w.call("/api/products")).data[0].availability).toBe("out_of_stock");
    await w.call(`${PORTAL}/api/prices`, { body: { variantId: list[0].variantId, ghs: 90000 }, cookie: ck });
    expect((await w.call("/api/products")).data[0].price.GHS).toBe(90000);
    const bad = await w.call(`${PORTAL}/api/products/status`, { body: { ids: [created.data.id], availability: "pre_order" }, cookie: ck });
    expect(bad.status).toBe(422);
  });
});

describe("checkout, webhook and refunds end to end", () => {
  const checkout = (w: W, variantId: string, extra: Record<string, unknown> = {}, cookie?: string) => w.call("/api/checkout", { cookie, body: { lines: [{ variantId, qty: 1 }], currency: "GHS", region: "Greater Accra", zoneId: "z", guestEmail: "g@x.com", address: { recipient: "R", region: "Greater Accra", city: "Accra", street: "1 St" }, idempotencyKey: `k${Math.random()}`, acceptedTerms: true, ...extra } });
  const pay = async (w: W, ref: string, amount: number, eventId: string, sig?: string) => {
    const raw = JSON.stringify({ eventId, orderRef: ref, amount, currency: "GHS", status: "success" });
    return w.call("/api/webhooks/payments", { method: "POST", body: raw, origin: null, headers: { "x-signature": sig ?? (await hmacHex("whsec", raw)) } });
  };

  test("guest checkout → unsigned webhook rejected → signed webhook marks paid once → stock committed", async () => {
    const w = await world(); const ck = await ownerSession(w);
    const prod = await w.call(`${PORTAL}/api/products`, { body: newProd(), cookie: ck });
    const variantId = `${prod.data.id}::PH1`;
    const c = await checkout(w, variantId);
    expect(c.status).toBe(201); expect(c.data.order).toMatchObject({ total: 102000, status: "pending_payment", currency: "GHS" }); expect(c.data.trackingSecret).toBeTruthy();
    expect((await pay(w, c.data.order.ref, 102000, "e1", "deadbeef")).status).toBe(401);
    expect((await w.call("/api/webhooks/payments", { method: "POST", body: "{}", origin: null })).status).toBe(401);
    const ok = await pay(w, c.data.order.ref, 102000, "e1"); expect(ok.data.result).toBe("applied");
    expect((await pay(w, c.data.order.ref, 102000, "e1")).data.result).toBe("duplicate");
    const t = await w.call(`/api/track?ref=${c.data.order.ref}&secret=${c.data.trackingSecret}`);
    expect(t.data.status).toBe("payment_confirmed"); expect(JSON.stringify(t.data)).not.toContain("1 St");
    expect((await w.call(`/api/track?ref=${c.data.order.ref}&secret=wrong`)).status).toBe(404);
    expect(await transact(w.p, (db) => db.variants.get(variantId)!.onHand)).toBe(2);
  });
  test("tampered amount cannot be marked paid; client-sent prices are ignored; oversell blocked over HTTP", async () => {
    const w = await world(); const ck = await ownerSession(w);
    const prod = await w.call(`${PORTAL}/api/products`, { body: newProd({ onHand: 1 }), cookie: ck }); const v = `${prod.data.id}::PH1`;
    const c = await checkout(w, v, { total: 1, price: 1, lines: [{ variantId: v, qty: 1, price: 1 }] });
    expect(c.data.order.total).toBe(102000);
    expect((await pay(w, c.data.order.ref, 1, "e2")).data.result).toBe("review");
    expect((await checkout(w, v)).status).toBe(422);
    expect((await checkout(w, v, { acceptedTerms: false })).status).toBe(422);
  });
  test("customers can't read each other's orders over HTTP", async () => {
    const w = await world(); const ck = await ownerSession(w);
    const prod = await w.call(`${PORTAL}/api/products`, { body: newProd({ onHand: 5 }), cookie: ck }); const v = `${prod.data.id}::PH1`;
    const reg = async (e: string) => { await w.call("/api/register", { body: { email: e, password: PW, firstName: "A", lastName: "B", acceptTerms: true } }); return w.cookieFrom(await w.call("/api/login", { body: { email: e, password: PW } })); };
    const a = await reg("a@x.com"), b = await reg("b@x.com");
    const c = await checkout(w, v, { guestEmail: undefined }, a);
    expect((await w.call(`/api/orders/${c.data.order.id}`, { cookie: a })).status).toBe(200);
    expect((await w.call(`/api/orders/${c.data.order.id}`, { cookie: b })).status).toBe(404);
    expect((await w.call(`/api/orders/${c.data.order.id}/cancel`, { body: {}, cookie: b })).status).toBe(404);
    expect((await w.call("/api/orders", { cookie: b })).data).toEqual([]);
    expect((await w.call("/api/orders")).status).toBe(401);
  });
  test("refund needs permission, recent re-auth, and respects order currency", async () => {
    const w = await world(); const ck = await ownerSession(w);
    const prod = await w.call(`${PORTAL}/api/products`, { body: newProd(), cookie: ck }); const v = `${prod.data.id}::PH1`;
    const c = await checkout(w, v); await pay(w, c.data.order.ref, 102000, "e3");
    // age the session's authentication beyond the 10-minute window
    await transact(w.p, (db) => { for (const s of db.sessions.values()) s.authAt -= 3600_000; });
    expect((await w.call(`${PORTAL}/api/refunds`, { body: { orderId: c.data.order.id, amount: 1000 }, cookie: ck })).status).toBe(403);
    expect((await w.call(`${PORTAL}/api/reauth`, { body: { password: "wrong" }, cookie: ck })).status).toBe(401);
    expect((await w.call(`${PORTAL}/api/reauth`, { body: { password: PW }, cookie: ck })).status).toBe(200);
    const r = await w.call(`${PORTAL}/api/refunds`, { body: { orderId: c.data.order.id, amount: 1000 }, cookie: ck });
    expect(r.data).toMatchObject({ amount: 1000, currency: "GHS" });
    const over = await w.call(`${PORTAL}/api/refunds`, { body: { orderId: c.data.order.id, amount: 999999 }, cookie: ck });
    expect(over.status).toBe(422); expect(JSON.stringify(over.data)).toContain("exceeds");
    expect((await w.call(`${PORTAL}/api/orders/status`, { body: { orderId: c.data.order.id, to: "delivered" }, cookie: ck })).status).toBe(422); // invalid transition from refund_pending
    const audit = await w.call(`${PORTAL}/api/audit`, { cookie: ck });
    expect(JSON.stringify(audit.data)).not.toMatch(/test-ref|Str0ng|pbkdf2/); expect(audit.data.some((a: any) => a.event === "refund.requested")).toBe(true);
  });
});
