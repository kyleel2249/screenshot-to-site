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

async function ownerSession() {
  const p = new MemoryPersistence();
  const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN, PBKDF2_ITERATIONS: "1000", ADMIN_PORTAL_PATH: PORTAL, ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex("ref") };
  await transact(p, (db) => { db.zones.set("z", { id: "z", name: "z", regions: ["Greater Accra"], currency: "GHS", baseFee: 2000, perKgFee: 0, estimate: "est" }); });
  const tokens: string[] = [];
  const mk = () => {
    let jar = "";
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers); headers.set("cf-connecting-ip", `10.3.0.${++n}`); if (jar) headers.set("cookie", jar);
      const res = await handle(new Request(ORIGIN + url, { ...init, headers }), env, p, { mail: async (_t, _tpl, d) => { tokens.push(d.token); } });
      const sc = res.headers.get("set-cookie"); if (sc) jar = sc.split(";")[0]!.endsWith("=") ? "" : sc.split(";")[0]!;
      return res;
    };
    return createClient({ fetchImpl, origin: ORIGIN });
  };
  const staff = mk(); const admin = staff.admin(PORTAL);
  await admin.enrol({ reference: "ref", email: "owner@shop.test", password: PW }); await staff.verifyEmail(tokens.at(-1)!); await staff.login("owner@shop.test", PW);
  return { p, staff, admin, shopper: mk, tokens };
}

describe("support inbox, analytics and hidden categories", () => {
  test("a customer message reaches staff, the reply is visible to that customer only, internal notes never are", async () => {
    const { admin, shopper, tokens } = await ownerSession();
    const alice = shopper(); const bob = shopper();
    await alice.register({ email: "alice@x.com", password: PW, firstName: "A", lastName: "A", acceptTerms: true }); await alice.verifyEmail(tokens.at(-1)!); await alice.login("alice@x.com", PW);
    expect((await alice.support({ email: "alice@x.com", subject: "Where is my order?", body: "Hello" })).ok).toBe(true);
    expect((await alice.support({ email: "bad", subject: "", body: "" })).status).toBe(422);
    const [t] = (await admin.tickets()).data!; expect(t).toMatchObject({ subject: "Where is my order?", status: "open" });
    await admin.replyTicket(t!.id, "Checking now."); await admin.replyTicket(t!.id, "Customer seems upset — escalate", true);
    expect((await admin.replyTicket(t!.id, "   ")).status).toBe(422); expect((await admin.replyTicket("nope", "x")).status).toBe(422);
    const mine = (await alice.myTickets()).data!; expect(mine).toHaveLength(1);
    expect(mine[0]!.messages.map((m) => m.body)).toEqual(["Hello", "Checking now."]); // internal note stripped
    expect((await bob.myTickets()).status).toBe(401);
    await admin.setTicketStatus(t!.id, "resolved"); expect((await admin.tickets()).data![0]!.status).toBe("resolved");
    expect((await admin.setTicketStatus(t!.id, "weird" as never)).status).toBe(422);
  });
  test("analytics: nothing recorded without consent, PII and purchase events refused, revenue only from verified paid orders", async () => {
    const { admin, shopper, p } = await ownerSession();
    const v = shopper();
    expect((await v.event({ consent: false, kind: "page_view", path: "/shop" })).data).toEqual({ recorded: false });
    expect((await v.event({ consent: true, kind: "page_view", path: "/shop" })).data).toEqual({ recorded: true });
    expect((await v.event({ consent: true, kind: "product_view", path: "/product/cap" })).data).toEqual({ recorded: true });
    expect((await v.event({ consent: true, kind: "page_view", path: "/shop?e=a@b.co" })).data).toEqual({ recorded: false });
    expect((await v.event({ consent: true, kind: "purchase" })).data).toEqual({ recorded: false });
    expect((await v.event({ consent: true, kind: "who_knows" })).data).toEqual({ recorded: false });
    const prod = await admin.createProduct({ name: "Cap", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "CAP", priceGhs: 10000, onHand: 5, published: true });
    const co = await v.checkout({ lines: [{ variantId: `${prod.data!.id}::CAP`, qty: 1 }], currency: "GHS", region: "Greater Accra", zoneId: "z", guestEmail: "g@x.com", address: { recipient: "R", region: "Greater Accra", city: "A", street: "1" }, idempotencyKey: "k1", acceptedTerms: true });
    let a = (await admin.analytics(30)).data!; expect(a.funnel).toMatchObject({ productViews: 1, paidOrders: 0 }); expect(a.revenue).toEqual({}); // unpaid ≠ revenue
    await transact(p, (db) => { const o = [...db.orders.values()][0]!; o.status = "payment_confirmed"; });
    a = (await admin.analytics(30)).data!; expect(a.revenue["GHS"]).toMatchObject({ gross: co.data!.order.total, net: co.data!.order.total, orders: 1 }); expect(a.funnel.paidOrders).toBe(1);
  });
  test("hiding a category removes its products from the public list; staff analytics need permission", async () => {
    const { admin, staff, p, shopper } = await ownerSession();
    const prod = await admin.createProduct({ name: "Cap", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "CAP", priceGhs: 10000, onHand: 5, published: true });
    expect((await shopper().products()).data!.map((x) => x.slug)).toContain(prod.data!.slug);
    await admin.setCategoryHidden("cat-shoes-and-footwear", true);
    expect((await shopper().products()).data).toEqual([]);
    await admin.setCategoryHidden("cat-shoes-and-footwear", false);
    expect((await shopper().products()).data).toHaveLength(1);
    await transact(p, (db) => { [...db.users.values()].find((u) => u.email === "owner@shop.test")!.roles = ["fulfilment"]; });
    await staff.logout(); await staff.login("owner@shop.test", PW);
    expect((await admin.analytics()).status).toBe(403); expect((await admin.tickets()).status).toBe(403);
  });
});

describe("orders CSV export", () => {
  test("needs recent re-authentication, then returns a formula-safe CSV", async () => {
    const { admin, shopper, p } = await ownerSession();
    const prod = await admin.createProduct({ name: "Cap", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "CAP", priceGhs: 10000, onHand: 5, published: true });
    await shopper().checkout({ lines: [{ variantId: `${prod.data!.id}::CAP`, qty: 1 }], currency: "GHS", region: "Greater Accra", zoneId: "z", guestEmail: "g@x.com", address: { recipient: "=cmd()", region: "Greater Accra", city: "A", street: "1" }, idempotencyKey: "k9", acceptedTerms: true });
    await transact(p, (db) => { for (const s of db.sessions.values()) s.authAt = 0; }); // simulate an old sign-in
    const denied = await admin.exportOrdersCsv(); expect(denied).toMatchObject({ ok: false, status: 403 }); expect(denied.errors[0]).toMatch(/re-?auth/i);
    expect((await admin.reauth("wrong-password")).ok).toBe(false);
    expect((await admin.reauth(PW)).ok).toBe(true);
    const ok = await admin.exportOrdersCsv(); expect(ok.ok).toBe(true);
    expect(ok.data!.split("\n")[0]).toBe("ref,status,currency,total_minor,created"); expect(ok.data!.split("\n")).toHaveLength(2);
    expect(ok.data).not.toContain("g@x.com"); expect(ok.data).not.toContain("cmd"); // no customer PII in the export
  });
});

describe("staff invitations", () => {
  test("invite → accept → sign in with limited role; owner is protected; suspension and role change cut access", async () => {
    const { admin, shopper, tokens, p } = await ownerSession();
    expect((await admin.inviteStaff("bad", ["support"])).status).toBe(422);
    expect((await admin.inviteStaff("a@shop.test", ["owner"])).status).toBe(422); // owner can't be granted
    expect((await admin.inviteStaff("a@shop.test", ["support"])).ok).toBe(true);
    const first = tokens.at(-1)!;
    expect((await admin.staff()).data!.find((s) => s.email === "a@shop.test")!.state).toBe("invited");
    const sam = shopper();
    expect((await sam.login("a@shop.test", PW)).ok).toBe(false); // can't sign in before accepting
    expect((await admin.inviteStaff("a@shop.test", ["support", "analyst"])).ok).toBe(true); // re-invite kills old link
    expect((await sam.acceptInvite(first, PW)).ok).toBe(false);
    expect((await sam.acceptInvite(tokens.at(-1)!, "weak")).ok).toBe(false);
    // a weak password is rejected before the link is consumed, so a typo doesn't burn the invitation
    expect((await admin.inviteStaff("a@shop.test", ["support"])).ok).toBe(true);
    expect((await sam.acceptInvite(tokens.at(-1)!, PW)).ok).toBe(true);
    expect((await sam.login("a@shop.test", PW)).ok).toBe(true);
    const samAdmin = sam.admin(PORTAL);
    expect((await samAdmin.tickets()).ok).toBe(true); expect((await samAdmin.zones()).status).toBe(403); expect((await samAdmin.staff()).status).toBe(403);
    const id = (await admin.staff()).data!.find((s) => s.email === "a@shop.test")!.id;
    await admin.setStaffRoles(id, ["fulfilment"]);
    expect((await samAdmin.orders()).status).toBe(404); // sessions revoked on role change (portal answers 404 to anyone not signed in)
    await sam.login("a@shop.test", PW); expect((await samAdmin.orders()).ok).toBe(true);
    await admin.setStaffActive(id, false); expect((await samAdmin.orders()).status).toBe(404);
    expect((await sam.login("a@shop.test", PW)).ok).toBe(false);
    await admin.setStaffActive(id, true); expect((await sam.login("a@shop.test", PW)).ok).toBe(true);
    const owner = (await admin.staff()).data!.find((s) => s.roles.includes("owner"))!;
    expect((await admin.setStaffActive(owner.id, false)).status).toBe(422); expect((await admin.setStaffRoles(owner.id, ["support"])).status).toBe(422);
    expect(await transact(p, (db) => [...db.audit].map((a) => a.event).filter((e) => e.startsWith("staff.")))).toContain("staff.invite_accepted");
  });
  test("invitations expire and customers can't use staff management", async () => {
    const { admin, shopper, tokens, p } = await ownerSession();
    await admin.inviteStaff("b@shop.test", ["analyst"]);
    await transact(p, (db) => { for (const t of db.tokens.values()) if (t.kind === "invite") t.expiresAt = 1; });
    expect((await shopper().acceptInvite(tokens.at(-1)!, PW)).ok).toBe(false);
    expect((await shopper().admin(PORTAL).staff()).status).toBe(404);
  });
});

describe("wholesale quotes", () => {
  test("request → staff quote → requester accepts; secrets protect it; no automatic pricing; expiry; permissions", async () => {
    const { admin, shopper, p, staff } = await ownerSession();
    const buyer = shopper();
    const bad = await buyer.requestQuote({ contactName: "", email: "x", region: "", items: [{ description: "", qty: 0 }] }); expect(bad.status).toBe(422); expect(bad.errors.length).toBeGreaterThan(3);
    const r = await buyer.requestQuote({ business: "Kofi Traders", contactName: "Kofi", email: "k@x.com", region: "Ashanti", items: [{ description: "Cookware set", qty: 50 }] });
    expect(r.status).toBe(201); const { ref, secret } = r.data!;
    expect((await buyer.quoteStatus(ref, secret)).data).toMatchObject({ status: "new" });
    expect((await buyer.quoteStatus(ref, secret)).data!.quote).toBeUndefined();
    expect((await buyer.quoteStatus(ref, "wrong")).status).toBe(404); expect((await buyer.quoteStatus("Q-NOPE", secret)).status).toBe(404);
    expect((await buyer.respondToQuote(ref, secret, true)).status).toBe(422); // nothing to accept yet
    const id = (await admin.quotes()).data![0]!.id;
    expect((await admin.sendQuote(id, { currency: "GHS", total: 0, validDays: 7 })).status).toBe(422);
    expect((await admin.sendQuote(id, { currency: "GHS", total: 4500000, validDays: 7, message: "Delivery included" })).ok).toBe(true);
    expect((await buyer.quoteStatus(ref, secret)).data).toMatchObject({ status: "quoted", quote: { total: 4500000, currency: "GHS" } });
    expect((await buyer.respondToQuote(ref, secret, true)).data!.status).toBe("accepted");
    expect((await admin.sendQuote(id, { currency: "GHS", total: 1, validDays: 1 })).status).toBe(422); // accepted quotes are frozen
    // expiry
    const r2 = await buyer.requestQuote({ contactName: "B", email: "b@x.com", region: "Volta", items: [{ description: "Bags", qty: 10 }] });
    const id2 = (await admin.quotes()).data!.find((q) => q.ref === r2.data!.ref)!.id;
    await admin.sendQuote(id2, { currency: "USD", total: 90000, validDays: 1 });
    await transact(p, (db) => { db.quotes.get(id2)!.quote!.validUntil = 1; });
    expect((await buyer.quoteStatus(r2.data!.ref, r2.data!.secret)).data!.status).toBe("expired");
    expect((await buyer.respondToQuote(r2.data!.ref, r2.data!.secret, true)).status).toBe(422);
    // support role can't price quotes; anonymous can't list
    expect((await shopper().admin(PORTAL).quotes()).status).toBe(404);
    await transact(p, (db) => { [...db.users.values()].find((u) => u.email === "owner@shop.test")!.roles = ["analyst"]; });
    await staff.logout(); await staff.login("owner@shop.test", PW);
    expect((await admin.quotes()).ok).toBe(true); expect((await admin.sendQuote(id2, { currency: "GHS", total: 5, validDays: 1 })).status).toBe(403);
  });
});
