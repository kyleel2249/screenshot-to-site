import { beforeEach, describe, expect, test } from "vitest";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { sha256Hex } from "../lib/security/crypto";
import { MemoryDb } from "../server/db";
import { Forbidden, type Actor } from "../server/rbac";
import { adjustStock, archiveProduct, categoryAdmin, createProduct, setAvailability, setPrices, setPublishedState, ValidationError } from "../server/services/catalog-admin";
import { adminStoreFor, authenticate, enrolOwner, login, registerCustomer, requestPasswordReset, resetPassword, verifyEmail } from "../server/services/auth";
import { completeRefund, getOrderForCustomer, handleVerifiedPayment, placeOrder, releaseExpired, requestCancellation, requestRefund, staffUpdateStatus, trackOrder } from "../server/services/orders";

const IT = 1000; // fast PBKDF2 for tests
const owner: Actor = { id: "staff1", kind: "staff", roles: ["owner"], recentAuthAt: Date.now() };
const fulfil: Actor = { id: "staff2", kind: "staff", roles: ["fulfilment"], recentAuthAt: Date.now() };
const cust = (id: string): Actor => ({ id, kind: "customer", roles: [] });
const CAT = "cat-shoes-and-footwear--sneakers";

let db: MemoryDb;
const newProduct = (o: Partial<Parameters<typeof createProduct>[2]> = {}) =>
  createProduct(db, owner, { name: "Test Sneaker", categoryId: CAT, shortDescription: "s", image: "i", imageAlt: "a", sku: "SNK1", priceGhs: 10000, priceUsd: 700, onHand: 5, published: true, ...o });
const vid = (p: { id: string }, sku = "SNK1") => `${p.id}::${sku}`;
const addr = { recipient: "Ama", region: "Greater Accra", city: "Accra", street: "1 Main St" };

beforeEach(() => {
  db = new MemoryDb(); db.categories = [...SEED_CATEGORIES];
  db.zones.set("z1", { id: "z1", name: "Accra", regions: ["Greater Accra"], currency: "GHS", baseFee: 2000, perKgFee: 0, estimate: "1–3 days (estimate)" });
  db.zones.set("z2", { id: "z2", name: "Accra USD", regions: ["Greater Accra"], currency: "USD", baseFee: 300, perKgFee: 0, estimate: "est." });
});
const order = (p: { id: string }, qty = 1, extra: Record<string, unknown> = {}) =>
  placeOrder(db, { guestEmail: "g@x.com", lines: [{ variantId: vid(p), qty }], currency: "GHS", region: "Greater Accra", address: addr, idempotencyKey: `k${Math.random()}`, acceptedTerms: true, zoneId: "z1", ...extra } as never);

describe("RBAC on admin actions", () => {
  test("customers and unauthenticated callers cannot manage products", () => {
    expect(() => createProduct(db, null, {} as never)).toThrow(Forbidden);
    expect(() => createProduct(db, cust("c1"), {} as never)).toThrow(Forbidden);
    expect(() => newProduct()).not.toThrow();
  });
  test("fulfilment staff cannot change prices or refund; owner needs recent re-auth for refunds", () => {
    const p = newProduct();
    expect(() => setPrices(db, fulfil, vid(p), { ghs: 1 })).toThrow(Forbidden);
    const stale: Actor = { ...owner, recentAuthAt: Date.now() - 3600_000 };
    expect(() => requestRefund(db, stale, "x", 1)).toThrow(/Re-authentication/);
  });
});

describe("product status & inventory (admin is source of truth)", () => {
  test("validation, audit trail, bulk status is all-or-nothing", () => {
    expect(() => newProduct({ name: " " })).toThrow(ValidationError);
    const a = newProduct(), b = newProduct({ sku: "SNK2", name: "Other" });
    expect(() => setAvailability(db, owner, [a.id, b.id], "pre_order")).toThrow(ValidationError);
    expect(db.variants.get(vid(a))!.availability).toBe("available"); // untouched
    setAvailability(db, owner, [a.id, b.id], "out_of_stock");
    expect(db.variants.get(vid(b, "SNK2"))!.availability).toBe("out_of_stock");
    expect(db.audit.some((x) => x.event === "product.availability_changed" && x.actor === owner.id)).toBe(true);
  });
  test("pre-order needs explicit enablement", () => {
    expect(() => newProduct({ availability: "pre_order" })).toThrow(ValidationError);
    expect(() => newProduct({ availability: "pre_order", preOrderEnabled: true })).not.toThrow();
  });
  test("sale price must be lower; stock cannot drop below reserved or reason-less", async () => {
    const p = newProduct();
    expect(() => setPrices(db, owner, vid(p), { saleGhs: 10000 })).toThrow(ValidationError);
    setPrices(db, owner, vid(p), { saleGhs: 8000 });
    await order(p, 3);
    expect(() => adjustStock(db, owner, vid(p), -4, "shrinkage")).toThrow(/reserved/);
    expect(() => adjustStock(db, owner, vid(p), 1, " ")).toThrow(ValidationError);
    adjustStock(db, owner, vid(p), 5, "restock");
    expect(db.variants.get(vid(p))!.onHand).toBe(10);
  });
  test("unpublished and archived products cannot be ordered", async () => {
    const p = newProduct(); setPublishedState(db, owner, p.id, false);
    expect((await order(p)).ok).toBe(false);
    setPublishedState(db, owner, p.id, true); archiveProduct(db, owner, p.id);
    expect((await order(p)).ok).toBe(false);
  });
  test("category admin: add/hide/rename without code changes", () => {
    const c = categoryAdmin(db, owner); c.add("Pets", null); c.hide("cat-pets", true); c.rename("cat-pets", "Pet Care");
    expect(db.categories.find((x) => x.id === "cat-pets")).toMatchObject({ name: "Pet Care", published: false });
    expect(() => categoryAdmin(db, fulfil)).toThrow(Forbidden);
  });
});

describe("checkout, reservation and payments", () => {
  test("no overselling: second buyer is refused once stock is reserved", async () => {
    const p = newProduct({ onHand: 2 });
    expect((await order(p, 2)).ok).toBe(true);
    const r = await order(p, 1); expect(r.ok).toBe(false);
  });
  test("idempotency: double submit returns the same order and reserves once", async () => {
    const p = newProduct();
    const a = await order(p, 1, { idempotencyKey: "same" }), b = await order(p, 1, { idempotencyKey: "same" });
    expect(a.ok && b.ok && b.duplicate && a.order.id === b.order.id).toBe(true);
    expect(db.variants.get(vid(p))!.reserved).toBe(1);
  });
  test("client cannot influence price; totals are server-computed; terms required", async () => {
    const p = newProduct();
    const r = await order(p, 2); expect(r.ok && r.order.total).toBe(22000);
    expect((await order(p, 1, { acceptedTerms: false })).ok).toBe(false);
    expect((await order(p, 1, { region: "Nowhere" })).ok).toBe(false);
  });
  test("unpaid order expires and releases stock; paid order commits stock", async () => {
    const p = newProduct({ onHand: 2 });
    const a = await order(p, 2, { now: 0 }); if (!a.ok) throw 0;
    expect(releaseExpired(db, 31 * 60_000)).toBe(1);
    expect(db.variants.get(vid(p))!.reserved).toBe(0);
    const b = await order(p, 2); if (!b.ok) throw 0;
    expect(handleVerifiedPayment(db, { eventId: "e1", orderRef: b.order.ref, amount: b.order.total, currency: "GHS", status: "success" }).kind).toBe("applied");
    expect(db.variants.get(vid(p))).toMatchObject({ onHand: 0, reserved: 0 });
    expect(handleVerifiedPayment(db, { eventId: "e1", orderRef: b.order.ref, amount: b.order.total, currency: "GHS", status: "success" }).kind).toBe("duplicate");
    expect(db.variants.get(vid(p))!.onHand).toBe(0); // not deducted twice
  });
  test("failed/mismatched payments never mark paid; staff cannot confirm payment manually", async () => {
    const p = newProduct(); const o = await order(p); if (!o.ok) throw 0;
    handleVerifiedPayment(db, { eventId: "f", orderRef: o.order.ref, amount: o.order.total, currency: "GHS", status: "failed" });
    expect(o.order.status).toBe("pending_payment");
    expect(handleVerifiedPayment(db, { eventId: "m", orderRef: o.order.ref, amount: 1, currency: "GHS", status: "success" }).kind).toBe("review");
    expect(o.order.status).toBe("payment_under_review");
    expect(() => staffUpdateStatus(db, owner, o.order.id, "payment_confirmed")).toThrow();
  });
  test("pre-orders: acknowledgement required, allocation enforced, mixed carts flagged", async () => {
    const pre = newProduct({ sku: "PRE", name: "Pre", availability: "pre_order", preOrderEnabled: true });
    db.variants.get(vid(pre, "PRE"))!.preOrder!.limit = 1;
    const line = { variantId: vid(pre, "PRE"), qty: 1 };
    const base = { guestEmail: "g@x.com", lines: [line], currency: "GHS" as const, region: "Greater Accra", address: addr, acceptedTerms: true, zoneId: "z1" };
    expect((await placeOrder(db, { ...base, idempotencyKey: "a" })).ok).toBe(false);
    const ok = await placeOrder(db, { ...base, idempotencyKey: "b", preorderAcknowledged: true });
    expect(ok.ok && ok.order.hasPreorder).toBe(true);
    expect((await placeOrder(db, { ...base, idempotencyKey: "c", preorderAcknowledged: true })).ok).toBe(false);
  });
  test("currency integrity: order, refund and shipping keep the order currency", async () => {
    const p = newProduct(); const o = await order(p, 1, { currency: "USD", zoneId: "z2" }); if (!o.ok) throw 0;
    expect(o.order).toMatchObject({ currency: "USD", subtotal: 700, shipping: 300, total: 1000 });
    handleVerifiedPayment(db, { eventId: "u", orderRef: o.order.ref, amount: 1000, currency: "USD", status: "success" });
    expect(requestRefund(db, owner, o.order.id, 400).currency).toBe("USD");
    completeRefund(db, o.order.id, 400); expect(o.order.status).toBe("partially_refunded");
    expect(() => requestRefund(db, owner, o.order.id, 700)).toThrow(/exceeds/);
  });
});

describe("customer data isolation", () => {
  test("customers only see their own orders; tracking needs the secret and leaks no PII", async () => {
    const p = newProduct({ onHand: 9 });
    const mine = await order(p, 1, { userId: "u1", guestEmail: undefined }); if (!mine.ok) throw 0;
    expect(getOrderForCustomer(db, cust("u1"), mine.order.id)).not.toBeNull();
    expect(getOrderForCustomer(db, cust("u2"), mine.order.id)).toBeNull();
    expect(getOrderForCustomer(db, null, mine.order.id)).toBeNull();
    expect(await trackOrder(db, mine.order.ref, "wrong")).toBeNull();
    const t = await trackOrder(db, mine.order.ref, mine.trackingSecret!);
    expect(t?.status).toBe("pending_payment"); expect(JSON.stringify(t)).not.toContain("Main St");
    expect(requestCancellation(db, cust("u2"), mine.order.id).ok).toBe(false);
    expect(requestCancellation(db, cust("u1"), mine.order.id).ok).toBe(true);
    expect(db.variants.get(vid(p))!.reserved).toBe(0);
  });
});

describe("auth", () => {
  const SECRET = "s".repeat(32), PW = "Str0ng!Passw0rd#";
  test("register → verify; duplicate email gives the same response (no enumeration); marketing never pre-ticked", async () => {
    const r = await registerCustomer(db, { email: "A@x.com", password: PW, firstName: "A", lastName: "B", acceptTerms: true }, IT);
    const dup = await registerCustomer(db, { email: "a@x.com", password: PW, firstName: "A", lastName: "B", acceptTerms: true }, IT);
    expect(r.ok && dup.ok).toBe(true); expect(db.users.size).toBe(1);
    expect([...db.profiles.values()][0]!.marketingConsent).toBe(false);
    expect(await verifyEmail(db, (r as { verifyToken: string }).verifyToken)).toBe(true);
    expect(await verifyEmail(db, (r as { verifyToken: string }).verifyToken)).toBe(false);
    expect((await registerCustomer(db, { email: "b@x.com", password: PW, firstName: "A", lastName: "B", acceptTerms: false }, IT)).ok).toBe(false);
  });
  test("login: generic errors, lockout, session auth, revocation by reset", async () => {
    await registerCustomer(db, { email: "a@x.com", password: PW, firstName: "A", lastName: "B", acceptTerms: true }, IT);
    // the stored hash used the test iteration count, so verification works with it
    const bad = await login(db, { email: "nobody@x.com", password: "x", secret: SECRET });
    const bad2 = await login(db, { email: "a@x.com", password: "wrong", secret: SECRET });
    expect(bad).toEqual(bad2);
    const ok = await login(db, { email: "a@x.com", password: PW, secret: SECRET });
    expect(ok.ok).toBe(true);
    const actor = await authenticate(db, ok.ok ? ok.token : undefined, SECRET);
    expect(actor?.kind).toBe("customer");
    expect(await authenticate(db, "garbage", SECRET)).toBeNull();
    const reset = await requestPasswordReset(db, "a@x.com");
    expect((await requestPasswordReset(db, "none@x.com")).ok).toBe(true);
    expect((await resetPassword(db, (reset as { token: string }).token, PW + "9", Date.now(), IT)).ok).toBe(true);
    expect(await authenticate(db, ok.ok ? ok.token : undefined, SECRET)).toBeNull(); // sessions revoked
    expect((await resetPassword(db, (reset as { token: string }).token, PW + "8", Date.now(), IT)).ok).toBe(false); // single use
    for (let i = 0; i < 5; i++) await login(db, { email: "a@x.com", password: "bad", secret: SECRET });
    const locked = await login(db, { email: "a@x.com", password: PW + "9", secret: SECRET });
    expect(locked.ok).toBe(false);
  });
  test("owner enrolment works once, produces an owner with MFA required, then is closed", async () => {
    const env = { ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex("test-ref") };
    const store = adminStoreFor(db);
    const r1 = await enrolOwner(store, env, { reference: "test-ref", email: "o@x.com", password: PW, clientKey: "k1" });
    expect(r1.ok).toBe(true);
    const owner1 = [...db.users.values()][0]!;
    expect(owner1).toMatchObject({ kind: "staff", roles: ["owner"], mfaRequired: true, emailVerified: false });
    expect(await enrolOwner(store, env, { reference: "test-ref", email: "z@x.com", password: PW, clientKey: "k2" })).toEqual({ ok: false, code: "setup_closed" });
    expect(db.users.size).toBe(1);
    // unverified staff cannot log in
    expect((await login(db, { email: "o@x.com", password: PW, secret: SECRET })).ok).toBe(false);
    expect(JSON.stringify(db.audit)).not.toContain("test-ref");
  });
});
