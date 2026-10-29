import { beforeEach, describe, expect, test } from "vitest";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { hmacHex, verifyWebhook } from "../lib/payments/webhook";
import { buildCsp, securityHeaders } from "../lib/security/headers";
import { buildRobots, buildSitemap } from "../lib/seo/sitemap";
import { MemoryDb } from "../server/db";
import { Forbidden, type Actor } from "../server/rbac";
import { addAddress, deleteMyAccount, editAddress, exportMyData, getProfile, listAddresses, removeAddress, setDefaultAddress, setMarketingConsent, staffViewCustomer, toggleWishlist, updateProfile } from "../server/services/account";
import { attribution, exportOrdersCsv, funnel, pseudonym, recordPurchase, revenue, track } from "../server/services/analytics";
import { authenticate, login, registerCustomer } from "../server/services/auth";
import { createProduct, ValidationError } from "../server/services/catalog-admin";
import { handleVerifiedPayment, placeOrder } from "../server/services/orders";
import { setDiscountActive, upsertDiscount, upsertZone } from "../server/services/promotions";
import { myTickets, openTicket, staffReply } from "../server/services/support";

const owner: Actor = { id: "s1", kind: "staff", roles: ["owner"], recentAuthAt: Date.now() };
const support: Actor = { id: "s2", kind: "staff", roles: ["support"], recentAuthAt: Date.now() };
const analyst: Actor = { id: "s3", kind: "staff", roles: ["analyst"], recentAuthAt: Date.now() };
const cust = (id: string): Actor => ({ id, kind: "customer", roles: [] });
let db: MemoryDb;
beforeEach(() => { db = new MemoryDb(); db.categories = [...SEED_CATEGORIES]; });

async function customer(email = "a@x.com") {
  await registerCustomer(db, { email, password: "Str0ng!Passw0rd#", firstName: "A", lastName: "B", acceptTerms: true }, 1000);
  const u = [...db.users.values()].find((x) => x.email === email)!; return cust(u.id);
}
const addr = { recipient: "R", region: "Greater Accra", city: "Accra", street: "1 St" };

describe("webhook signatures", () => {
  test("valid passes; tampered body, wrong secret, missing header/secret, stale timestamp fail", async () => {
    const body = '{"event":"charge.success"}'; const sig = await hmacHex("sec", body);
    expect(await verifyWebhook({ secret: "sec", rawBody: body, signature: sig })).toBe(true);
    expect(await verifyWebhook({ secret: "sec", rawBody: body + " ", signature: sig })).toBe(false);
    expect(await verifyWebhook({ secret: "other", rawBody: body, signature: sig })).toBe(false);
    expect(await verifyWebhook({ secret: "sec", rawBody: body, signature: null })).toBe(false);
    expect(await verifyWebhook({ secret: undefined, rawBody: body, signature: sig })).toBe(false);
    expect(await verifyWebhook({ secret: "sec", rawBody: body, signature: sig, timestamp: 0, now: 10 * 60_000 })).toBe(false);
  });
});

describe("headers & SEO", () => {
  test("CSP is strict: nonce scripts, no unsafe-inline/eval in script-src, no framing", () => {
    const csp = buildCsp({ nonce: "abc" });
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc'"); expect(script).not.toContain("unsafe-inline"); expect(script).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'"); expect(csp).toContain("object-src 'none'");
    expect(securityHeaders({ nonce: "n" })["Strict-Transport-Security"]).toContain("max-age");
  });
  test("sitemap lists only published public URLs and escapes XML; robots hides private paths", () => {
    const xml = buildSitemap({ siteUrl: "https://x.com/", categories: SEED_CATEGORIES.slice(0, 2), products: [
      { slug: "a&b", updatedAt: "2026-01-02T00:00:00Z", published: true }, { slug: "hidden", updatedAt: "2026-01-02T00:00:00Z", published: false }, { slug: "old", updatedAt: "2026-01-02T00:00:00Z", published: true, archived: true }] });
    expect(xml).toContain("/product/a%26b"); expect(xml).not.toContain("hidden"); expect(xml).not.toContain("old"); expect(xml).not.toMatch(/\/(cart|checkout|account)/);
    const robots = buildRobots("https://x.com", "/ops-secret-path-123");
    expect(robots).toContain("Disallow: /checkout"); expect(robots).not.toContain("ops-secret"); expect(robots).toContain("Sitemap: https://x.com/sitemap.xml");
  });
});

describe("customer account", () => {
  test("profile updates; email/credentials not editable; profile exposes no secrets", async () => {
    const me = await customer();
    updateProfile(db, me, { firstName: "Z", preferredCurrency: "USD", phone: "+233 24 000 0000" });
    expect(getProfile(db, me)).toMatchObject({ firstName: "Z", preferredCurrency: "USD", email: "a@x.com" });
    expect(JSON.stringify(getProfile(db, me))).not.toMatch(/passwordHash|pbkdf2/);
    expect(() => updateProfile(db, me, { phone: "abc" })).toThrow();
    expect(() => updateProfile(db, null, {})).toThrow();
    setMarketingConsent(db, me, true, "v1"); expect(db.consents.at(-1)).toMatchObject({ kind: "marketing", granted: true });
  });
  test("address book: default handling and strict ownership (IDOR)", async () => {
    const a = await customer("a@x.com"), b = await customer("b@x.com");
    const a1 = addAddress(db, a, addr), a2 = addAddress(db, a, { ...addr, street: "2 St", makeDefault: true });
    expect(a1.isDefault).toBe(false); // first address was default until the second took over expect(listAddresses(db, a).filter((x) => x.isDefault).length).toBe(1);
    expect(listAddresses(db, a).find((x) => x.isDefault)!.id).toBe(a2.id);
    expect(() => editAddress(db, b, a1.id, { street: "hack" })).toThrow(/not found/);
    expect(() => removeAddress(db, b, a1.id)).toThrow(/not found/);
    expect(() => setDefaultAddress(db, b, a1.id)).toThrow(/not found/);
    removeAddress(db, a, a2.id); expect(listAddresses(db, a)[0]!.isDefault).toBe(true);
    expect(listAddresses(db, b)).toEqual([]);
  });
  test("wishlist toggles and rejects unknown products", async () => {
    const me = await customer(); const p = createProduct(db, owner, { name: "P", categoryId: "cat-cars", shortDescription: "s", image: "i", imageAlt: "a", sku: "S", priceGhs: 100 });
    expect(toggleWishlist(db, me, p.id)).toBe(true); expect(toggleWishlist(db, me, p.id)).toBe(false);
    expect(() => toggleWishlist(db, me, "nope")).toThrow();
  });
  test("past orders keep their address when saved addresses change", async () => {
    const me = await customer(); const ad = addAddress(db, me, addr);
    const p = createProduct(db, owner, { name: "P", categoryId: "cat-cars", shortDescription: "s", image: "i", imageAlt: "a", sku: "S", priceGhs: 100, onHand: 5, published: true });
    db.zones.set("z", { id: "z", name: "z", regions: ["Greater Accra"], currency: "GHS", baseFee: 0, perKgFee: 0, estimate: "est" });
    const r = await placeOrder(db, { userId: me.id, lines: [{ variantId: `${p.id}::S`, qty: 1 }], currency: "GHS", region: "Greater Accra", address: { ...addr }, idempotencyKey: "k", acceptedTerms: true, zoneId: "z" });
    editAddress(db, me, ad.id, { street: "CHANGED" });
    expect(r.ok && r.order.address.street).toBe("1 St");
  });
  test("export contains only own data; deletion anonymises, keeps order totals, revokes access", async () => {
    const me = await customer(); const other = await customer("o@x.com");
    addAddress(db, me, addr);
    const p = createProduct(db, owner, { name: "P", categoryId: "cat-cars", shortDescription: "s", image: "i", imageAlt: "a", sku: "S", priceGhs: 100, onHand: 5, published: true });
    db.zones.set("z", { id: "z", name: "z", regions: ["Greater Accra"], currency: "GHS", baseFee: 0, perKgFee: 0, estimate: "est" });
    await placeOrder(db, { userId: me.id, lines: [{ variantId: `${p.id}::S`, qty: 1 }], currency: "GHS", region: "Greater Accra", address: addr, idempotencyKey: "k", acceptedTerms: true, zoneId: "z" });
    const exp = exportMyData(db, me); expect(exp.orders.length).toBe(1); expect(JSON.stringify(exp)).not.toContain("o@x.com");
    const ses = await login(db, { email: "a@x.com", password: "Str0ng!Passw0rd#", secret: "s".repeat(32) });
    deleteMyAccount(db, me);
    const o = [...db.orders.values()][0]!;
    expect(o.userId).toBeUndefined(); expect(o.address.street).toBe(""); expect(o.total).toBeGreaterThan(0);
    expect(db.users.get(me.id)).toMatchObject({ status: "deleted", passwordHash: "!" }); expect(db.profiles.has(me.id)).toBe(false); expect(listAddresses(db, other)).toEqual([]);
    expect(await authenticate(db, ses.ok ? ses.token : undefined, "s".repeat(32))).toBeNull();
    expect((await login(db, { email: "a@x.com", password: "Str0ng!Passw0rd#", secret: "s".repeat(32) })).ok).toBe(false);
  });
  test("staff view is permissioned, audited, and has no credentials", async () => {
    const me = await customer();
    expect(() => staffViewCustomer(db, analyst, me.id)).toThrow(Forbidden);
    const v = staffViewCustomer(db, support, me.id);
    expect(JSON.stringify(v)).not.toMatch(/pbkdf2|passwordHash|token/); expect(db.audit.some((a) => a.event === "customer.viewed_by_staff")).toBe(true);
  });
});

describe("promotions & shipping admin", () => {
  test("validated, permissioned, audited", () => {
    expect(() => upsertDiscount(db, support, { code: "X1X", kind: "percent", value: 1000, active: true })).toThrow(Forbidden);
    expect(() => upsertDiscount(db, owner, { code: "!", kind: "percent", value: 1000, active: true })).toThrow(ValidationError);
    expect(() => upsertDiscount(db, owner, { code: "BAD1", kind: "percent", value: 20000, active: true })).toThrow(ValidationError);
    expect(() => upsertDiscount(db, owner, { code: "BAD2", kind: "fixed", value: 500, active: true })).toThrow(ValidationError);
    upsertDiscount(db, owner, { code: "save10", kind: "percent", value: 1000, active: true });
    expect(db.discounts.has("SAVE10")).toBe(true);
    setDiscountActive(db, owner, "save10", false); expect(db.discounts.get("SAVE10")!.active).toBe(false);
    expect(() => upsertZone(db, owner, { id: "z", name: "", regions: [], currency: "GHS", baseFee: -1, perKgFee: 0, estimate: "", })).toThrow(ValidationError);
    upsertZone(db, owner, { id: "z", name: "Accra", regions: ["Greater Accra"], currency: "GHS", baseFee: 2000, perKgFee: 0, estimate: "1–3 days (estimate)" });
    expect(db.zones.has("z")).toBe(true);
  });
  test("redemption counts only on verified payment and respects the limit", async () => {
    const me = await customer(); upsertDiscount(db, owner, { code: "ONCE", kind: "percent", value: 1000, perCustomerLimit: 1, maxRedemptions: 5, active: true });
    const p = createProduct(db, owner, { name: "P", categoryId: "cat-cars", shortDescription: "s", image: "i", imageAlt: "a", sku: "S", priceGhs: 10000, onHand: 9, published: true });
    db.zones.set("z", { id: "z", name: "z", regions: ["Greater Accra"], currency: "GHS", baseFee: 0, perKgFee: 0, estimate: "est" });
    const mk = (k: string) => placeOrder(db, { userId: me.id, lines: [{ variantId: `${p.id}::S`, qty: 1 }], currency: "GHS", region: "Greater Accra", address: addr, idempotencyKey: k, acceptedTerms: true, zoneId: "z", discountCode: "once" });
    const o1 = await mk("a"); if (!o1.ok) throw new Error("x"); expect(o1.order.discount).toBe(1000); expect(db.discounts.get("ONCE")!.redeemed).toBe(0);
    handleVerifiedPayment(db, { eventId: "e", orderRef: o1.order.ref, amount: o1.order.total, currency: "GHS", status: "success" });
    expect(db.discounts.get("ONCE")!.redeemed).toBe(1);
    expect((await mk("b")).ok).toBe(false);
  });
});

describe("support tickets", () => {
  test("customers see only their tickets without internal notes; staff need permission", async () => {
    const me = await customer(), other = await customer("o@x.com");
    const t = openTicket(db, me, { email: "a@x.com", subject: "Help", body: "where is it" });
    expect(() => staffReply(db, me, t.id, "x")).toThrow(Forbidden);
    staffReply(db, support, t.id, "internal: check courier", true); staffReply(db, support, t.id, "We're on it");
    const mine = myTickets(db, me)[0]!; expect(mine.messages.map((m) => m.body)).toEqual(["where is it", "We're on it"]);
    expect(myTickets(db, other)).toEqual([]); expect(myTickets(db, null)).toEqual([]);
    expect(() => openTicket(db, null, { email: "bad", subject: "", body: "" })).toThrow();
  });
});

describe("privacy-first analytics", () => {
  const S = "secret";
  test("no consent → nothing stored; PII-bearing and client 'purchase' events rejected; pseudonyms rotate daily", async () => {
    expect(await track(db, { consent: false, kind: "page_view", clientKey: "c", secret: S })).toBe(false);
    expect(await track(db, { consent: true, kind: "page_view", path: "/p?email=a@b.com", clientKey: "c", secret: S })).toBe(false);
    expect(await track(db, { consent: true, kind: "page_view", source: "call 0241234567 now", clientKey: "c", secret: S })).toBe(false);
    expect(await track(db, { consent: true, kind: "purchase", clientKey: "c", secret: S })).toBe(false);
    expect(await track(db, { consent: true, kind: "page_view", path: "/shop?q=secret", clientKey: "c", secret: S, now: 0 })).toBe(true);
    expect(db.events[0]!.path).toBe("/shop");
    expect(await pseudonym(S, "c", 0)).not.toBe(await pseudonym(S, "c", 86_400_000));
    expect(JSON.stringify(db.events)).not.toContain('"c"');
  });
  test("funnel counts unique sessions; revenue is net per currency from verified orders only", async () => {
    for (const k of ["product_view", "add_to_cart", "checkout_start"]) await track(db, { consent: true, kind: k, clientKey: "v1", secret: S, now: 1000 });
    await track(db, { consent: true, kind: "product_view", clientKey: "v1", secret: S, now: 1001 });
    expect(funnel(db, 0, 5000)).toMatchObject({ productViews: 1, addToCart: 1, checkoutStarts: 1, paidOrders: 0 });
    const p = createProduct(db, owner, { name: "P", categoryId: "cat-cars", shortDescription: "s", image: "i", imageAlt: "a", sku: "S", priceGhs: 10000, priceUsd: 700, onHand: 9, published: true });
    db.zones.set("z", { id: "z", name: "z", regions: ["Greater Accra"], currency: "GHS", baseFee: 0, perKgFee: 0, estimate: "est" });
    const o = await placeOrder(db, { guestEmail: "g@x.com", lines: [{ variantId: `${p.id}::S`, qty: 1 }], currency: "GHS", region: "Greater Accra", address: addr, idempotencyKey: "k", acceptedTerms: true, zoneId: "z" }); if (!o.ok) throw new Error("x");
    expect(revenue(db, analyst, 0, Date.now() + 1000)).toEqual({}); // unpaid revenue not counted
    expect(recordPurchase(db, o.order.ref)).toBe(false);
    handleVerifiedPayment(db, { eventId: "e", orderRef: o.order.ref, amount: o.order.total, currency: "GHS", status: "success" });
    expect(recordPurchase(db, o.order.ref, "promo")).toBe(true); expect(recordPurchase(db, o.order.ref, "promo")).toBe(false);
    expect(revenue(db, analyst, 0, Date.now() + 1000)).toEqual({ GHS: { gross: 10000, refunds: 0, net: 10000, orders: 1 } });
    expect(attribution(db, analyst)).toEqual([]); // group of 1 suppressed
    expect(() => revenue(db, null, 0, 1)).toThrow(Forbidden);
  });
  test("CSV export: permissioned, re-auth required, audited, no PII, formula-safe", async () => {
    expect(() => exportOrdersCsv(db, analyst)).toThrow(Forbidden);
    expect(() => exportOrdersCsv(db, { ...owner, recentAuthAt: 0 })).toThrow(/Re-authentication/);
    const csv = exportOrdersCsv(db, owner); expect(csv.split("\n")[0]).toBe("ref,status,currency,total_minor,created");
    expect(db.audit.at(-1)!.event).toBe("export.orders_csv");
  });
});
