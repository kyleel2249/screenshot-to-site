import { beforeEach, describe, expect, test } from "vitest";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { recommend, type RecProduct } from "../lib/recommend";
import { MemoryDb } from "../server/db";
import { handle, type Env } from "../server/api";
import { MemoryPersistence, transact } from "../server/persistence/transact";
import { runMaintenance } from "../server/maintenance";
import { createProduct } from "../server/services/catalog-admin";
import { GUEST_SESSION_TTL_MS } from "../server/services/guest";
import type { Actor } from "../server/rbac";
import { STAFF_OPEN_ACCESS } from "../lib/security/open-access";

const ORIGIN = "https://shop.test";
const CAT = "cat-shoes-and-footwear--sneakers";
const owner: Actor = { id: "staff1", kind: "staff", roles: ["owner"], recentAuthAt: Date.now() };
let ipN = 0;

async function world() {
  const p = new MemoryPersistence();
  const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN };
  const ids: Record<string, string> = {};
  await transact(p, (db: MemoryDb) => {
    db.categories = [...SEED_CATEGORIES];
    db.zones.set("z1", { id: "z1", name: "Accra", regions: ["Greater Accra"], currency: "GHS", baseFee: 2000, perKgFee: 0, estimate: "1–3 days (estimate)" });
    for (const [sku, price, stock] of [["CAP", 10000, 5], ["SHOE", 25000, 1], ["BELT", 5000, 0]] as const) {
      const pr = createProduct(db, owner, { name: `Item ${sku}`, categoryId: CAT, shortDescription: `desc ${sku}`, image: "/i.jpg", imageAlt: "a", sku, priceGhs: price, priceUsd: price / 10, onHand: stock, published: true });
      ids[sku] = `${pr.id}::${sku}`; ids[`${sku}:slug`] = pr.slug;
    }
    createProduct(db, owner, { name: "Hidden Draft", categoryId: CAT, shortDescription: "x", image: "/i.jpg", imageAlt: "a", sku: "DRAFT", onHand: 3, published: false });
  });
  /** One simulated browser: keeps its own cookie. */
  const browser = () => {
    let cookie = "";
    const call = async (path: string, init: { method?: string; body?: unknown; origin?: string | null; withCookie?: boolean } = {}) => {
      const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
      const headers: Record<string, string> = { "cf-connecting-ip": `10.9.0.${++ipN}` };
      if (cookie && init.withCookie !== false) headers["cookie"] = cookie;
      if (method !== "GET" && init.origin !== null) headers["origin"] = init.origin ?? ORIGIN;
      const res = await handle(new Request(ORIGIN + path, { method, headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) }), env, p, {});
      const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]!;
      const text = await res.text(); let data: any = null; try { data = JSON.parse(text); } catch { data = text; }
      return { res, status: res.status, data, setCookie: sc };
    };
    return { call, get cookie() { return cookie; }, set cookie(v: string) { cookie = v; } };
  };
  return { p, env, ids, browser };
}
const addr = { recipient: "Ama", region: "Greater Accra", city: "Accra", street: "1 Main St", phone: "0240000000" };
const checkoutBody = (currency = "GHS", key = `key-${Math.random()}-${Date.now()}`) => ({ currency, region: "Greater Accra", zoneId: "z1", email: "ama@x.com", address: addr, idempotencyKey: key, acceptedTerms: true });

describe("anonymous session", () => {
  test("opens with no login: issues a signed HttpOnly SameSite=Strict cookie and an empty state; writes nothing until the visitor acts", async () => {
    const w = await world(); const b = w.browser();
    const r = await b.call("/api/guest/session");
    expect(r.status).toBe(200);
    expect(r.setCookie).toMatch(/ddt_guest=.+; HttpOnly; Secure; SameSite=Strict/);
    expect(r.data.state.cart).toEqual([]);
    expect(r.data.state.prefs.notifyMarketing).toBe(false); // marketing is never pre-ticked
    await transact(w.p, (db) => expect(db.guestSessions.size).toBe(0)); // no row for a mere visit
  });
  test("a tampered or foreign cookie is not a session", async () => {
    const w = await world(); const b = w.browser();
    await b.call("/api/guest/session");
    b.cookie = b.cookie.slice(0, -3) + "AAA";
    expect((await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } })).status).toBe(401);
    b.cookie = "ddt_guest=not-a-token";
    expect((await b.call("/api/guest/wishlist", { body: { slug: w.ids["CAP:slug"], on: true } })).status).toBe(401);
    expect((await b.call("/api/guest/orders")).status).toBe(401);
  });
  test("a staff/customer session token cannot be used as a guest session", async () => {
    const w = await world(); const b = w.browser();
    const { signSession } = await import("../lib/security/crypto");
    b.cookie = `ddt_guest=${await signSession({ sid: "gs_aaaaaaaaaaaaaaaaaaaa", sub: "someone-else", exp: Date.now() + 100000 }, w.env.SESSION_SECRET)}`;
    expect((await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } })).status).toBe(401);
  });
  test("an expired cookie is rejected", async () => {
    const w = await world(); const b = w.browser();
    const { signSession } = await import("../lib/security/crypto");
    b.cookie = `ddt_guest=${await signSession({ sid: "gs_aaaaaaaaaaaaaaaaaaaa", sub: "guest", exp: Date.now() - 1 }, w.env.SESSION_SECRET)}`;
    expect((await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } })).status).toBe(401);
  });
  test("state-changing calls need a same-origin Origin header (CSRF)", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    expect((await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 }, origin: "https://evil.test" })).status).toBe(403);
    expect((await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 }, origin: null })).status).toBe(403);
  });
});

describe("cart: server is the authority", () => {
  test("add, change, remove; cart persists across requests; only variant ids and quantities are stored", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    let r = await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 2 } });
    expect(r.status).toBe(200); expect(r.data.state.cart).toEqual([{ variantId: w.ids["CAP"], qty: 2 }]);
    r = await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 3, price: 1 } }); // a client-supplied price is ignored
    expect(r.data.state.cart[0].qty).toBe(3);
    expect((await b.call("/api/guest/session")).data.state.cart[0].qty).toBe(3);
    r = await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 0 } });
    expect(r.data.state.cart).toEqual([]);
    await transact(w.p, (db) => { for (const s of db.guestSessions.values()) for (const l of s.cart) expect(Object.keys(l).sort()).toEqual(["qty", "variantId"]); });
  });
  test("refuses unpublished, out-of-stock, unknown variants and bad quantities; nothing is saved on refusal", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    const draft = await transact(w.p, (db) => [...db.variants.keys()].find((k) => k.endsWith("::DRAFT"))!);
    for (const [variantId, qty] of [[draft, 1], [w.ids["BELT"], 1], ["nope::x", 1], [w.ids["CAP"], -1], [w.ids["CAP"], 1.5], [w.ids["CAP"], 100], [w.ids["SHOE"], 2]] as const) {
      const r = await b.call("/api/guest/cart", { body: { variantId, qty } });
      expect(r.status, `${variantId} x ${qty}`).toBe(422);
    }
    await transact(w.p, (db) => expect(db.guestSessions.size).toBe(0)); // failed first write left no row behind
  });
  test("quote prices from authoritative records, adds no invented tax, rejects client prices and unknown currency", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 2 } });
    const r = await b.call("/api/guest/cart/quote", { body: { currency: "GHS", region: "Greater Accra", zoneId: "z1" } });
    expect(r.status).toBe(200);
    expect(r.data.quote).toMatchObject({ currency: "GHS", subtotal: 20000, shipping: 2000, total: 22000, taxesAndCharges: "none_configured" });
    const usd = await b.call("/api/guest/cart/quote", { body: { currency: "USD" } });
    expect(usd.data.quote.subtotal).toBe(2000); // 2 × the owner-set USD price, never converted
    expect((await b.call("/api/guest/cart/quote", { body: { currency: "EUR" } })).status).toBe(422);
    // the owner raises the price: the very next quote reflects it
    await transact(w.p, (db) => { db.variants.get(w.ids["CAP"]!)!.price.GHS = 12000; });
    expect((await b.call("/api/guest/cart/quote", { body: { currency: "GHS" } })).data.quote.subtotal).toBe(24000);
  });
  test("a product unpublished after being added disappears from the cart state and cannot be bought", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    await transact(w.p, (db) => { db.variants.get(w.ids["CAP"]!)!.published = false; });
    expect((await b.call("/api/guest/session")).data.state.cart).toEqual([]);
    expect((await b.call("/api/guest/checkout", { body: checkoutBody() })).status).toBe(422);
  });
});

describe("isolation between visitors", () => {
  test("carts, wishlists, compare lists, preferences and addresses are private to each session", async () => {
    const w = await world(); const a = w.browser(), c = w.browser();
    await a.call("/api/guest/session"); await c.call("/api/guest/session");
    await a.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 2 } });
    await a.call("/api/guest/wishlist", { body: { slug: w.ids["CAP:slug"], on: true } });
    await a.call("/api/guest/compare", { body: { slug: w.ids["CAP:slug"], on: true } });
    await a.call("/api/guest/preferences", { method: "PUT", body: { preferredName: "Ama", email: "ama@x.com" } });
    await a.call("/api/guest/addresses", { body: { label: "Home", ...addr } });
    const other = (await c.call("/api/guest/session")).data.state;
    expect(other).toMatchObject({ cart: [], wishlist: [], compare: [], addresses: [], orders: [], prefs: { preferredName: "", email: "" } });
  });
  test("a session cannot read, claim or cancel another session's order without the tracking code", async () => {
    const w = await world(); const a = w.browser(), c = w.browser();
    await a.call("/api/guest/session"); await c.call("/api/guest/session");
    await a.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    const placed = await a.call("/api/guest/checkout", { body: checkoutBody() });
    expect(placed.status).toBe(201);
    const ref = placed.data.order.ref as string;
    expect((await c.call("/api/guest/orders")).data).toEqual([]);
    expect((await c.call("/api/guest/orders/claim", { body: { ref, secret: "wrong" } })).status).toBe(404);
    expect((await c.call("/api/guest/orders/claim", { body: { ref: "DDT-NOPE00", secret: placed.data.trackingSecret } })).status).toBe(404);
    expect((await c.call("/api/guest/orders/reissue", { body: { ref } })).status).toBe(404);
    const cancel = await c.call("/api/guest/returns", { body: { kind: "cancellation", orderRef: ref, reason: "x" } });
    expect(cancel.status).toBe(422);
    await transact(w.p, (db) => expect([...db.orders.values()][0]!.status).toBe("pending_payment"));
    // with the code, ownership transfers by explicit proof
    const claimed = await c.call("/api/guest/orders/claim", { body: { ref: ref.toLowerCase(), secret: placed.data.trackingSecret } });
    expect(claimed.status).toBe(200); expect(claimed.data.state.orders).toHaveLength(1);
  });
  test("idempotency keys cannot be used to read another visitor's order", async () => {
    const w = await world(); const a = w.browser(), c = w.browser();
    await a.call("/api/guest/session"); await c.call("/api/guest/session");
    await a.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    const body = checkoutBody("GHS", "shared-key-12345");
    expect((await a.call("/api/guest/checkout", { body })).status).toBe(201);
    await c.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    const r = await c.call("/api/guest/checkout", { body });
    expect(r.status).toBe(422); expect(JSON.stringify(r.data)).not.toMatch(/DDT-/);
  });
});

describe("guest checkout and tracking", () => {
  test("places an order from the session cart: server prices, reserves stock, clears the cart, shows no street/email/phone", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 2 } });
    const r = await b.call("/api/guest/checkout", { body: { ...checkoutBody(), total: 1, items: [{ price: 1 }] } }); // client totals are ignored
    expect(r.status).toBe(201);
    expect(r.data.order).toMatchObject({ currency: "GHS", subtotal: 20000, shipping: 2000, total: 22000, status: "pending_payment", destination: { region: "Greater Accra", city: "Accra" } });
    expect(r.data.trackingSecret).toBeTruthy();
    expect(r.data.state.cart).toEqual([]); expect(r.data.state.orders).toHaveLength(1);
    const wire = JSON.stringify(r.data);
    for (const secret of ["1 Main St", "ama@x.com", "0240000000"]) expect(wire).not.toContain(secret);
    await transact(w.p, (db) => expect(db.variants.get(w.ids["CAP"]!)!.reserved).toBe(2));
  });
  test("same idempotency key from the same session creates one order", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    const body = checkoutBody("GHS", "idem-key-0001");
    const first = await b.call("/api/guest/checkout", { body }), second = await b.call("/api/guest/checkout", { body });
    expect(first.status).toBe(201); expect(second.status).toBe(200);
    expect(second.data.order.ref).toBe(first.data.order.ref);
    await transact(w.p, (db) => expect(db.orders.size).toBe(1));
  });
  test("last unit: two visitors, exactly one order", async () => {
    const w = await world(); const a = w.browser(), c = w.browser();
    await a.call("/api/guest/session"); await c.call("/api/guest/session");
    await a.call("/api/guest/cart", { body: { variantId: w.ids["SHOE"], qty: 1 } });
    await c.call("/api/guest/cart", { body: { variantId: w.ids["SHOE"], qty: 1 } });
    const results = await Promise.all([a.call("/api/guest/checkout", { body: checkoutBody() }), c.call("/api/guest/checkout", { body: checkoutBody() })]);
    expect(results.map((x) => x.status).sort()).toEqual([201, 422]);
  });
  test("fails closed without a delivery zone for the region; needs email, terms and a cart", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    expect((await b.call("/api/guest/checkout", { body: checkoutBody() })).status).toBe(422); // empty cart
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    expect((await b.call("/api/guest/checkout", { body: { ...checkoutBody(), region: "Ashanti" } })).status).toBe(422);
    expect((await b.call("/api/guest/checkout", { body: { ...checkoutBody(), email: "nope" } })).status).toBe(422);
    expect((await b.call("/api/guest/checkout", { body: { ...checkoutBody(), acceptedTerms: false } })).status).toBe(422);
    expect((await b.call("/api/guest/checkout", { body: { ...checkoutBody(), zoneId: "missing" } })).status).toBe(422);
    await transact(w.p, (db) => expect(db.orders.size).toBe(0));
  });
  test("tracking works without a session using reference + code; wrong code and unknown reference are indistinguishable; no private data", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    const placed = await b.call("/api/guest/checkout", { body: checkoutBody() });
    const ref = placed.data.order.ref, secret = placed.data.trackingSecret;
    const anon = w.browser();
    const ok = await anon.call(`/api/guest/track?ref=${ref}&secret=${secret}`);
    expect(ok.status).toBe(200); expect(ok.data).toMatchObject({ ref, status: "pending_payment", destination: { region: "Greater Accra" }, shipment: null });
    for (const s of ["1 Main St", "ama@x.com", "0240000000"]) expect(JSON.stringify(ok.data)).not.toContain(s);
    const wrong = await anon.call(`/api/guest/track?ref=${ref}&secret=nope`), missing = await anon.call(`/api/guest/track?ref=DDT-ZZZZZZ&secret=${secret}`);
    expect(wrong.status).toBe(404); expect(missing.status).toBe(404); expect(wrong.data).toEqual(missing.data);
    expect((await anon.call(`/api/guest/track?ref=${ref}&secret=`)).status).toBe(404);
  });
  test("tracking shows carrier details only once staff recorded them, never invented", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    const placed = await b.call("/api/guest/checkout", { body: checkoutBody() });
    const { setShipment } = await import("../server/services/orders");
    await transact(w.p, (db) => setShipment(db, owner, [...db.orders.values()][0]!.id, { carrier: "DHL", trackingRef: "TRK123", estimatedDelivery: "2026-12-01" }));
    const t = await w.browser().call(`/api/guest/track?ref=${placed.data.order.ref}&secret=${placed.data.trackingSecret}`);
    expect(t.data.shipment).toEqual({ carrier: "DHL", trackingRef: "TRK123", estimatedDelivery: "2026-12-01" });
  });
  test("reissuing a tracking code invalidates the old one", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    const placed = await b.call("/api/guest/checkout", { body: checkoutBody() });
    const re = await b.call("/api/guest/orders/reissue", { body: { ref: placed.data.order.ref } });
    expect(re.status).toBe(200);
    const anon = w.browser();
    expect((await anon.call(`/api/guest/track?ref=${placed.data.order.ref}&secret=${placed.data.trackingSecret}`)).status).toBe(404);
    expect((await anon.call(`/api/guest/track?ref=${placed.data.order.ref}&secret=${re.data.trackingCode}`)).status).toBe(200);
  });
});

describe("returns, cancellations and enquiries", () => {
  async function placed() {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    const o = await b.call("/api/guest/checkout", { body: checkoutBody() });
    return { w, b, ref: o.data.order.ref as string, secret: o.data.trackingSecret as string };
  }
  test("cancelling an unpaid order cancels it and releases the stock", async () => {
    const { w, b, ref } = await placed();
    const r = await b.call("/api/guest/returns", { body: { kind: "cancellation", orderRef: ref, reason: "Changed my mind" } });
    expect(r.status).toBe(201); expect(r.data.outcome).toBe("cancelled");
    await transact(w.p, (db) => { expect([...db.orders.values()][0]!.status).toBe("cancelled"); expect(db.variants.get(w.ids["CAP"]!)!.reserved).toBe(0); });
  });
  test("a paid order only gets a cancellation REQUEST for staff — no automatic cancellation or refund", async () => {
    const { w, b, ref } = await placed();
    await transact(w.p, (db) => { const o = [...db.orders.values()][0]!; o.status = "payment_confirmed"; });
    const r = await b.call("/api/guest/returns", { body: { kind: "cancellation", orderRef: ref, reason: "x" } });
    expect(r.data.outcome).toBe("requested");
    await transact(w.p, (db) => { const o = [...db.orders.values()][0]!; expect(o.status).toBe("cancellation_requested"); expect(o.refunded).toBe(0); });
  });
  test("returns/refunds need a delivered order, a real product on that order and a description; duplicates are refused", async () => {
    const { w, b, ref } = await placed();
    const body = { kind: "return", orderRef: ref, reason: "Wrong size", description: "It does not fit at all." };
    expect((await b.call("/api/guest/returns", { body })).status).toBe(422); // not delivered yet
    await transact(w.p, (db) => { [...db.orders.values()][0]!.status = "delivered"; });
    expect((await b.call("/api/guest/returns", { body: { ...body, variantId: "not-on-order" } })).status).toBe(422);
    expect((await b.call("/api/guest/returns", { body: { ...body, description: "short" } })).status).toBe(422);
    const ok = await b.call("/api/guest/returns", { body: { ...body, variantId: w.ids["CAP"] } });
    expect(ok.status).toBe(201); expect(ok.data.ref).toMatch(/^RET-/);
    expect((await b.call("/api/guest/returns", { body: { ...body, variantId: w.ids["CAP"] } })).status).toBe(422);
    const list = await b.call("/api/guest/returns");
    expect(list.data[0]).toMatchObject({ orderRef: ref, kind: "return", status: "Received" });
    await transact(w.p, (db) => expect([...db.tickets.values()].some((t) => t.subject.startsWith("[return]"))).toBe(true)); // reaches the staff inbox
  });
  test("enquiries open a staff ticket, return a reference, and show only non-internal replies", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    expect((await b.call("/api/guest/enquiries", { body: { category: "product", email: "bad", subject: "Hi", message: "short" } })).status).toBe(422);
    const r = await b.call("/api/guest/enquiries", { body: { category: "product", email: "ama@x.com", subject: "Sizing question", message: "Do you have this in size 44?" } });
    expect(r.status).toBe(201); expect(r.data.ref).toMatch(/^ENQ-/);
    await transact(w.p, (db) => { const t = [...db.tickets.values()][0]!; t.messages.push({ author: "staff1", internal: true, body: "SECRET NOTE", at: Date.now() }, { author: "staff1", internal: false, body: "Yes, we do.", at: Date.now() }); });
    const list = await b.call("/api/guest/enquiries");
    expect(JSON.stringify(list.data)).not.toContain("SECRET NOTE");
    expect(list.data[0].messages.map((m: any) => m.body)).toContain("Yes, we do.");
    const other = w.browser(); await other.call("/api/guest/session");
    expect((await other.call("/api/guest/enquiries")).data).toEqual([]);
  });
});

describe("wishlist, compare, activity, preferences", () => {
  test("wishlist and compare work by public slug only; compare is capped at four", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    expect((await b.call("/api/guest/wishlist", { body: { slug: w.ids["CAP:slug"], on: true } })).data.state.wishlist).toEqual([w.ids["CAP:slug"]]);
    expect((await b.call("/api/guest/wishlist", { body: { slug: "hidden-draft", on: true } })).status).toBe(422);
    expect((await b.call("/api/guest/wishlist", { body: { slug: w.ids["CAP:slug"], on: false } })).data.state.wishlist).toEqual([]);
    await transact(w.p, (db) => { for (let i = 0; i < 4; i++) createProduct(db, owner, { name: `Extra ${i}`, categoryId: CAT, shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: `X${i}`, priceGhs: 100, onHand: 1, published: true }); });
    const slugs = ["extra-0", "extra-1", "extra-2", "extra-3"];
    for (const s of slugs.slice(0, 4)) expect((await b.call("/api/guest/compare", { body: { slug: s, on: true } })).status).toBe(200);
    expect((await b.call("/api/guest/compare", { body: { slug: w.ids["CAP:slug"], on: true } })).status).toBe(422);
  });
  test("recently viewed and searches are capped, de-duplicated and clearable; clearing keeps cart and saved items", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    await b.call("/api/guest/wishlist", { body: { slug: w.ids["CAP:slug"], on: true } });
    await b.call("/api/guest/viewed", { body: { slug: w.ids["CAP:slug"] } }); await b.call("/api/guest/viewed", { body: { slug: w.ids["SHOE:slug"] } }); await b.call("/api/guest/viewed", { body: { slug: w.ids["CAP:slug"] } });
    for (let i = 0; i < 15; i++) await b.call("/api/guest/searches", { body: { q: `query ${i}` } });
    await b.call("/api/guest/searches", { body: { q: "QUERY 14" } });
    let s = (await b.call("/api/guest/session")).data.state;
    expect(s.viewed).toEqual([w.ids["CAP:slug"], w.ids["SHOE:slug"]]); expect(s.searches).toHaveLength(10); expect(s.searches[0]).toBe("QUERY 14");
    expect((await b.call("/api/guest/viewed", { body: { slug: "hidden-draft" } })).status).toBe(422);
    s = (await b.call("/api/guest/activity/clear", { body: {} })).data.state;
    expect(s).toMatchObject({ viewed: [], searches: [], compare: [] }); expect(s.cart).toHaveLength(1); expect(s.wishlist).toHaveLength(1);
  });
  test("preferences validate input, keep marketing opt-in, and never accept unknown fields", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    expect((await b.call("/api/guest/preferences", { method: "PUT", body: { email: "bad" } })).status).toBe(422);
    expect((await b.call("/api/guest/preferences", { method: "PUT", body: { region: "Atlantis" } })).status).toBe(422);
    expect((await b.call("/api/guest/preferences", { method: "PUT", body: { currency: "EUR" } })).status).toBe(422);
    expect((await b.call("/api/guest/preferences", { method: "PUT", body: { notifyMarketing: "yes" } })).status).toBe(422);
    const ok = await b.call("/api/guest/preferences", { method: "PUT", body: { preferredName: "<b>Ama</b>", currency: "GHS", region: "Ashanti", interests: ["shoes", "shoes", "bags"], isAdmin: true } });
    expect(ok.status).toBe(200); expect(ok.data.state.prefs).toMatchObject({ currency: "GHS", region: "Ashanti", interests: ["shoes", "bags"], notifyMarketing: false });
    expect(ok.data.state.prefs).not.toHaveProperty("isAdmin");
  });
  test("addresses are validated, capped and removable", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    expect((await b.call("/api/guest/addresses", { body: { ...addr, region: "Narnia" } })).status).toBe(422);
    for (let i = 0; i < 5; i++) expect((await b.call("/api/guest/addresses", { body: { label: `A${i}`, ...addr } })).status).toBe(201);
    expect((await b.call("/api/guest/addresses", { body: { label: "extra", ...addr } })).status).toBe(422);
    const id = (await b.call("/api/guest/session")).data.state.addresses[0].id;
    expect((await b.call("/api/guest/addresses", { method: "DELETE", body: { id } })).data.state.addresses).toHaveLength(4);
  });
  test("'forget me' deletes the server-side record and rotates the cookie; placed orders stay with the business", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    await b.call("/api/guest/checkout", { body: checkoutBody() });
    const before = b.cookie;
    const r = await b.call("/api/guest/data", { method: "DELETE", body: {} });
    expect(r.status).toBe(200); expect(b.cookie).not.toBe(before); expect(r.data.state.orders).toEqual([]);
    await transact(w.p, (db) => { expect(db.guestSessions.size).toBe(0); expect(db.orders.size).toBe(1); });
  });
});

describe("notifications and promotions come from real records", () => {
  test("order events become notifications; price/availability alerts only when the visitor opted in", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/wishlist", { body: { slug: w.ids["CAP:slug"], on: true } });
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    const placed = await b.call("/api/guest/checkout", { body: checkoutBody() });
    await transact(w.p, (db) => { db.variants.get(w.ids["CAP"]!)!.price.GHS = 9000; });
    let n = (await b.call("/api/guest/notifications")).data as any[];
    expect(n.some((x) => x.kind === "order_placed" && x.orderRef === placed.data.order.ref)).toBe(true);
    expect(n.some((x) => x.kind === "price_change")).toBe(false); // price alerts are opt-in
    await b.call("/api/guest/preferences", { method: "PUT", body: { notifyPriceAlerts: true } });
    n = (await b.call("/api/guest/notifications")).data;
    expect(n.find((x: any) => x.kind === "price_change")?.body).toMatch(/dropped/);
    expect((await b.call("/api/guest/session")).data.state.unreadNotifications).toBeGreaterThan(0);
    await b.call("/api/guest/notifications/read", { body: {} });
    expect((await b.call("/api/guest/session")).data.state.unreadNotifications).toBe(0);
  });
  test("a sale is reported only while it is real: original > sale, inside its window", async () => {
    const w = await world(); const b = w.browser();
    expect((await b.call("/api/guest/promotions")).data).toEqual([]);
    await transact(w.p, (db) => { const v = db.variants.get(w.ids["CAP"]!)!; v.salePrice = { GHS: 7500 }; });
    const p = (await b.call("/api/guest/promotions")).data;
    expect(p).toEqual([expect.objectContaining({ slug: w.ids["CAP:slug"], currency: "GHS", original: 10000, sale: 7500, percentOff: 25 })]);
    await transact(w.p, (db) => { db.variants.get(w.ids["CAP"]!)!.saleEndsAt = "2000-01-01T00:00:00Z"; });
    expect((await b.call("/api/guest/promotions")).data).toEqual([]);
  });
});

describe("rate limits, pruning, and the other APIs still work", () => {
  test("tracking attempts are rate limited per IP", async () => {
    const w = await world(); const b = w.browser(); let blocked = 0;
    const sameIp = async () => handle(new Request(`${ORIGIN}/api/guest/track?ref=DDT-AAAAAA&secret=x`, { headers: { "cf-connecting-ip": "203.0.113.77" } }), w.env, w.p, {});
    for (let i = 0; i < 20; i++) if ((await sameIp()).status === 429) blocked++;
    expect(blocked).toBeGreaterThan(0); void b;
  });
  test("maintenance prunes sessions idle past their lifetime but keeps orders", async () => {
    const w = await world(); const b = w.browser(); await b.call("/api/guest/session");
    await b.call("/api/guest/cart", { body: { variantId: w.ids["CAP"], qty: 1 } });
    await b.call("/api/guest/checkout", { body: checkoutBody() });
    const r = await runMaintenance(w.p, Date.now() + GUEST_SESSION_TTL_MS + 1000);
    expect(r.guests).toBe(1);
    await transact(w.p, (db) => { expect(db.guestSessions.size).toBe(0); expect(db.orders.size).toBe(1); });
  });
  test("the public catalogue and the admin portal are unaffected by the guest layer", async () => {
    const w = await world(); const b = w.browser();
    const cat = await b.call("/api/products");
    expect(cat.status).toBe(200); expect(cat.data.map((x: any) => x.name).sort()).toEqual(["Item BELT", "Item CAP", "Item SHOE"]);
    // While the temporary open-access switch is on the admin API answers without a login; with it off the portal path is a plain 404 to anonymous visitors.
    expect((await b.call("/dera-owner-console/api/products")).status).toBe(STAFF_OPEN_ACCESS ? 200 : 404);
    expect((await b.call("/api/nope")).status).toBe(404);
  });
});

describe("recommendations", () => {
  const cats = SEED_CATEGORIES;
  const mk = (slug: string, categoryId: string, extra: Partial<RecProduct> = {}): RecProduct => ({ slug, name: slug, categoryId, createdAt: "2026-01-01", availability: "available", attributes: {}, ...extra });
  const products = [mk("a", CAT), mk("b", CAT), mk("c", "cat-bags-and-luggage--school-bags"), mk("d", CAT, { availability: "out_of_stock" })];
  test("guests with no signals and no sales get nothing invented", () => {
    expect(recommend(products, cats, { viewed: [], wishlist: [], cart: [], compare: [], searches: [], interests: [] }, { bySlug: {}, recentBySlug: {}, pairs: {} })).toEqual([]);
  });
  test("personal picks come from the visitor's own signals, exclude what they already saw, and never include unpurchasable items", () => {
    const s = recommend(products, cats, { viewed: ["a"], wishlist: [], cart: [], compare: [], searches: [], interests: [] }, { bySlug: {}, recentBySlug: {}, pairs: {} });
    expect(s).toEqual([{ id: "for_you", title: "You may also like", slugs: ["b"] }]);
  });
  test("'bought together' needs repeated real purchases", () => {
    const sales = (n: number) => ({ bySlug: {}, recentBySlug: {}, pairs: { a: { c: n } } });
    const sig = { viewed: [], wishlist: [], cart: [], compare: [], searches: [], interests: [] };
    expect(recommend(products, cats, sig, sales(1), { focus: "a" }).some((x) => x.id === "bought_together")).toBe(false);
    expect(recommend(products, cats, sig, sales(2), { focus: "a" }).find((x) => x.id === "bought_together")?.slugs).toEqual(["c"]);
  });
  test("popular and trending are derived only from paid-order data", () => {
    const sig = { viewed: [], wishlist: [], cart: [], compare: [], searches: [], interests: [] };
    const out = recommend(products, cats, sig, { bySlug: { b: 5, a: 2 }, recentBySlug: { b: 1 }, pairs: {} });
    expect(out.find((x) => x.id === "popular")?.slugs).toEqual(["b", "a"]);
    expect(out.find((x) => x.id === "trending")?.slugs).toEqual(["b"]);
  });
});
