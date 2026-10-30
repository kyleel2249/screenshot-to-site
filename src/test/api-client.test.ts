import { signInStaff } from "./staff-signin";
import { totp } from "../lib/security/totp";
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
    expect((await signInStaff(api, PORTAL, "owner@shop.test", PW)).ok).toBe(true);
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
    await b.api.verifyEmail(b.tokens[b.tokens.length - 1]!); await signInStaff(b.api, PORTAL, "owner@shop.test", PW);
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
    await api.logout(); await signInStaff(api, PORTAL, "owner@shop.test", PW);
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
    await admin.enrol({ reference: "ref", email: "owner@shop.test", password: PW }); await api.verifyEmail(tokens.at(-1)!); await signInStaff(api, PORTAL, "owner@shop.test", PW);
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
  await admin.enrol({ reference: "ref", email: "owner@shop.test", password: PW }); await staff.verifyEmail(tokens.at(-1)!); await signInStaff(staff, PORTAL, "owner@shop.test", PW);
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
    await staff.logout(); await signInStaff(staff, PORTAL, "owner@shop.test", PW);
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
    expect((await signInStaff(sam, PORTAL, "a@shop.test", PW)).ok).toBe(false); // can't sign in before accepting
    expect((await admin.inviteStaff("a@shop.test", ["support", "analyst"])).ok).toBe(true); // re-invite kills old link
    expect((await sam.acceptInvite(first, PW)).ok).toBe(false);
    expect((await sam.acceptInvite(tokens.at(-1)!, "weak")).ok).toBe(false);
    // a weak password is rejected before the link is consumed, so a typo doesn't burn the invitation
    expect((await admin.inviteStaff("a@shop.test", ["support"])).ok).toBe(true);
    expect((await sam.acceptInvite(tokens.at(-1)!, PW)).ok).toBe(true);
    expect((await signInStaff(sam, PORTAL, "a@shop.test", PW)).ok).toBe(true);
    const samAdmin = sam.admin(PORTAL);
    expect((await samAdmin.tickets()).ok).toBe(true); expect((await samAdmin.zones()).status).toBe(403); expect((await samAdmin.staff()).status).toBe(403);
    const id = (await admin.staff()).data!.find((s) => s.email === "a@shop.test")!.id;
    await admin.setStaffRoles(id, ["fulfilment"]);
    expect((await samAdmin.orders()).status).toBe(404); // sessions revoked on role change (portal answers 404 to anyone not signed in)
    await signInStaff(sam, PORTAL, "a@shop.test", PW); expect((await samAdmin.orders()).ok).toBe(true);
    await admin.setStaffActive(id, false); expect((await samAdmin.orders()).status).toBe(404);
    expect((await signInStaff(sam, PORTAL, "a@shop.test", PW)).ok).toBe(false);
    await admin.setStaffActive(id, true); expect((await signInStaff(sam, PORTAL, "a@shop.test", PW)).ok).toBe(true);
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
    await staff.logout(); await signInStaff(staff, PORTAL, "owner@shop.test", PW);
    expect((await admin.quotes()).ok).toBe(true); expect((await admin.sendQuote(id2, { currency: "GHS", total: 5, validDays: 1 })).status).toBe(403);
  });
});

describe("notification emails", () => {
  test("order, quote and support-reply notices go to the right person; internal notes and duplicates send nothing", async () => {
    const sent: { to: string; t: string; ref: string }[] = [];
    const p = new MemoryPersistence();
    const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN, PBKDF2_ITERATIONS: "1000", ADMIN_PORTAL_PATH: PORTAL, ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex("ref") };
    await transact(p, (db) => { db.zones.set("z", { id: "z", name: "z", regions: ["Greater Accra"], currency: "GHS", baseFee: 2000, perKgFee: 0, estimate: "e" }); });
    const toks: string[] = [];
    const mk = () => { let jar = ""; return createClient({ origin: ORIGIN, fetchImpl: async (url, init = {}) => {
      const h = new Headers(init.headers); h.set("cf-connecting-ip", `10.4.0.${++n}`); if (jar) h.set("cookie", jar);
      const res = await handle(new Request(ORIGIN + url, { ...init, headers: h }), env, p, { mail: async (_t, _x, d) => { toks.push(d.token); }, notify: async (to, t, d) => { sent.push({ to, t, ref: d.ref }); } });
      const sc = res.headers.get("set-cookie"); if (sc) jar = sc.split(";")[0]!.endsWith("=") ? "" : sc.split(";")[0]!; return res; } }); };
    const staff = mk(); const admin = staff.admin(PORTAL);
    await admin.enrol({ reference: "ref", email: "owner@shop.test", password: PW }); await staff.verifyEmail(toks.at(-1)!); await signInStaff(staff, PORTAL, "owner@shop.test", PW);
    const prod = await admin.createProduct({ name: "Cap", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "CAP", priceGhs: 10000, onHand: 5, published: true });
    const buyer = mk();
    const body = { lines: [{ variantId: `${prod.data!.id}::CAP`, qty: 1 }], currency: "GHS" as const, region: "Greater Accra", zoneId: "z", guestEmail: "g@x.com", address: { recipient: "R", region: "Greater Accra", city: "A", street: "1" }, idempotencyKey: "same", acceptedTerms: true };
    const o = await buyer.checkout(body); await buyer.checkout(body);
    expect(sent).toEqual([{ to: "g@x.com", t: "order_received", ref: o.data!.order.ref }]);
    const q = await buyer.requestQuote({ contactName: "K", email: "k@x.com", region: "Volta", items: [{ description: "Bags", qty: 5 }] });
    await admin.sendQuote((await admin.quotes()).data![0]!.id, { currency: "GHS", total: 1000, validDays: 3 });
    expect(sent.at(-1)).toEqual({ to: "k@x.com", t: "quote_ready", ref: q.data!.ref });
    await buyer.support({ email: "h@x.com", subject: "Help", body: "hi" });
    const tid = (await admin.tickets()).data![0]!.id;
    await admin.replyTicket(tid, "private note", true); expect(sent.filter((s) => s.t === "ticket_reply")).toHaveLength(0);
    await admin.replyTicket(tid, "Hello!"); expect(sent.at(-1)).toEqual({ to: "h@x.com", t: "ticket_reply", ref: tid });
    expect(JSON.stringify(sent)).not.toContain("Hello!"); // bodies never go in notices
  });
});

describe("staff two-step verification", () => {
  test("password alone opens nothing; wrong codes fail; setup, replay, recovery codes and reset behave", async () => {
    const { admin, staff, shopper, tokens, p } = await ownerSession(); // owner is already enrolled by the helper
    // a brand-new invited colleague signs in with password only
    await admin.inviteStaff("m@shop.test", ["manager"]); const sam = shopper(); await sam.acceptInvite(tokens.at(-1)!, PW);
    expect((await sam.login("m@shop.test", PW)).ok).toBe(true);
    const sa = sam.admin(PORTAL);
    expect((await sa.me()).data).toMatchObject({ mfa: "setup_required", roles: [] }); // roles are not even revealed
    for (const r of [await sa.products(), await sa.orders(), await sa.zones(), await sa.analytics(), await sa.staff()]) expect(r.status).toBe(403);
    expect((await sa.mfaConfirm("123456")).status).toBe(422); // confirm before setup
    const setup = await sa.mfaSetup(); expect(setup.data!.otpauth).toContain("otpauth://totp/");
    expect((await sa.mfaConfirm("000000")).status).toBe(422);
    expect((await sa.products()).status).toBe(403); // still locked
    const good = await totp(setup.data!.secret);
    const conf = await sa.mfaConfirm(good); expect(conf.data!.recoveryCodes).toHaveLength(8);
    expect((await sa.products()).ok).toBe(true); expect((await sa.me()).data).toMatchObject({ mfa: "verified", roles: ["manager"] });
    expect((await sa.mfaSetup()).status).toBe(422); // can't silently replace a confirmed secret
    const stored = await transact(p, (db) => JSON.stringify([...db.users.values()].find((u) => u.email === "m@shop.test")!.mfa));
    for (const c of conf.data!.recoveryCodes) expect(stored).not.toContain(c); // only hashes at rest
    // new sign-in: code required, same TOTP step is a replay, recovery code works once
    await sam.logout(); await sam.login("m@shop.test", PW);
    expect((await sa.me()).data).toMatchObject({ mfa: "code_required", roles: [] });
    expect((await sa.products()).status).toBe(403);
    expect((await sa.mfaVerify(good)).status).toBe(401); // replay of the code used at setup
    expect((await sa.mfaVerify("nope")).status).toBe(401);
    const rc = conf.data!.recoveryCodes;
    expect((await sa.mfaVerify(rc[0]!)).ok).toBe(true); expect((await sa.products()).ok).toBe(true);
    await sam.logout(); await sam.login("m@shop.test", PW);
    expect((await sa.mfaVerify(rc[0]!)).status).toBe(401); // used codes are gone
    expect((await sa.mfaVerify(rc[1]!.toUpperCase())).ok).toBe(true);
    // owner resets: sessions die, setup required again; owner and self can't be reset
    const id = (await admin.staff()).data!.find((s) => s.email === "m@shop.test")!.id;
    expect((await admin.resetStaffMfa(id)).ok).toBe(true); expect((await sa.products()).status).toBe(404);
    await sam.login("m@shop.test", PW); expect((await sa.me()).data!.mfa).toBe("setup_required");
    const me = (await admin.me()).data!.id; expect((await admin.resetStaffMfa(me)).status).toBe(422);
    expect((await staff.logout()).ok).toBe(true);
  });
});

describe("two-step lockout", () => {
  test("five wrong codes end the session, even though each attempt is under the request rate limit", async () => {
    const { admin, staff, p } = await ownerSession(); await staff.logout(); await signInStaff(staff, PORTAL, "owner@shop.test", PW).catch(() => 0);
    await staff.logout(); await staff.login("owner@shop.test", PW);
    for (let i = 0; i < 4; i++) expect((await admin.mfaVerify(`10000${i}`)).status).toBe(401);
    expect((await admin.mfaVerify("100009")).status).toBe(401); // 5th miss
    expect((await admin.me()).status).toBe(404); // session revoked: portal looks like it doesn't exist
    expect(await transact(p, (db) => db.audit.some((a) => a.event === "mfa.lockout"))).toBe(true);
  });
});

describe("editable content pages", () => {
  test("defaults are served; edits go live; validation; legal review rules; reset", async () => {
    const { admin, shopper, staff, p, tokens } = await ownerSession();
    const pub = shopper();
    expect((await pub.page("privacy")).data).toMatchObject({ title: "Privacy policy", reviewed: false });
    expect((await pub.page("../etc")).status).toBe(404); expect((await pub.page("nope")).status).toBe(404);
    expect((await admin.savePage("about", { title: "", sections: [] })).status).toBe(422);
    expect((await admin.savePage("faq", { title: "FAQ", sections: [{ heading: "", body: "answer only" }] })).errors.join()).toMatch(/question/);
    expect((await admin.savePage("nope", { title: "x", sections: [{ heading: "", body: "y" }] })).status).toBe(422);
    const html = "<script>alert(1)</script> Hello";
    expect((await admin.savePage("about", { title: "About us", sections: [{ heading: "Who we are", body: html }] })).ok).toBe(true);
    expect((await pub.page("about")).data).toMatchObject({ title: "About us", sections: [{ heading: "Who we are", body: html }] }); // stored as text; the UI renders text only
    // legal review: owner (fresh sign-in) may mark reviewed; editing afterwards drops it
    expect((await admin.savePage("terms", { title: "Terms", sections: [{ heading: "", body: "v1" }], reviewed: true })).ok).toBe(true);
    expect((await pub.page("terms")).data!.reviewed).toBe(true);
    expect((await admin.savePage("terms", { title: "Terms", sections: [{ heading: "", body: "v1" }] })).ok).toBe(true);
    expect((await pub.page("terms")).data!.reviewed).toBe(true); // unchanged text keeps the badge for a reviewer
    expect((await admin.savePage("terms", { title: "Terms", sections: [{ heading: "", body: "v2" }] })).ok).toBe(true);
    expect((await pub.page("terms")).data!.reviewed).toBe(false); // changed text needs fresh review
    // a marketing user can edit marketing copy but cannot claim legal review
    await admin.inviteStaff("mk@shop.test", ["marketing"]); const mk = shopper(); await mk.acceptInvite(tokens.at(-1)!, PW);
    await signInStaff(mk, PORTAL, "mk@shop.test", PW); const ma = mk.admin(PORTAL);
    expect((await ma.pages()).ok).toBe(true);
    expect((await ma.savePage("privacy", { title: "Privacy policy", sections: [{ heading: "", body: "x" }], reviewed: true })).status).toBe(403);
    expect((await ma.savePage("faq", { title: "FAQ", sections: [{ heading: "Q?", body: "A." }] })).ok).toBe(true);
    // old sign-in → re-auth needed to mark reviewed
    await transact(p, (db) => { for (const s of db.sessions.values()) s.authAt = 0; });
    expect((await admin.savePage("terms", { title: "Terms", sections: [{ heading: "", body: "v2" }], reviewed: true })).status).toBe(403);
    expect((await admin.reauth(PW)).ok).toBe(true); expect((await admin.savePage("terms", { title: "Terms", sections: [{ heading: "", body: "v2" }], reviewed: true })).ok).toBe(true);
    expect((await admin.resetPage("about")).ok).toBe(true); expect((await pub.page("about")).data!.title).toBe("About Dera Darko Trade");
    expect((await admin.pages()).data!.find((x) => x.slug === "faq")).toMatchObject({ customised: true, legal: false });
    void staff;
  });
});

import { methodFromChannel, paystack, type PaymentProvider } from "../lib/payments/provider";
import { hmacHex } from "../lib/payments/webhook";

  async function shop(payments?: PaymentProvider, extraEnv: Partial<Env> = {}) {
    const p = new MemoryPersistence();
    const env: Env = { SESSION_SECRET: "s".repeat(32), SITE_ORIGIN: ORIGIN, PBKDF2_ITERATIONS: "1000", ADMIN_PORTAL_PATH: PORTAL, ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex("ref"), ...extraEnv };
    await transact(p, (db) => { db.zones.set("z", { id: "z", name: "z", regions: ["Greater Accra"], currency: "GHS", baseFee: 2000, perKgFee: 0, estimate: "e" }); });
    const toks: string[] = [];
    const call = (path: string, init: RequestInit = {}, h: Record<string, string> = {}) => handle(new Request(ORIGIN + path, { ...init, headers: { "cf-connecting-ip": `10.9.0.${++n}`, ...h } }), env, p, { mail: async (_t, _x, d) => { toks.push(d.token); }, ...(payments ? { payments } : {}) });
    const mk = () => { let jar = ""; return createClient({ origin: ORIGIN, fetchImpl: async (url, init = {}) => { const h = new Headers(init.headers); h.set("cf-connecting-ip", `10.9.1.${++n}`); if (jar) h.set("cookie", jar); const res = await handle(new Request(ORIGIN + url, { ...init, headers: h }), env, p, { mail: async (_t, _x, d) => { toks.push(d.token); }, ...(payments ? { payments } : {}) }); const sc = res.headers.get("set-cookie"); if (sc) jar = sc.split(";")[0]!.endsWith("=") ? "" : sc.split(";")[0]!; return res; } }); };
    const staff = mk(); const admin = staff.admin(PORTAL);
    await admin.enrol({ reference: "ref", email: "owner@shop.test", password: PW }); await staff.verifyEmail(toks.at(-1)!); await signInStaff(staff, PORTAL, "owner@shop.test", PW);
    const prod = await admin.createProduct({ name: "Cap", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "CAP", priceGhs: 10000, onHand: 5, published: true });
    const order = async (c = mk(), key = `k${Math.random()}`) => (await c.checkout({ lines: [{ variantId: `${prod.data!.id}::CAP`, qty: 1 }], currency: "GHS", region: "Greater Accra", zoneId: "z", guestEmail: "g@x.com", address: { recipient: "R", region: "Greater Accra", city: "A", street: "1" }, idempotencyKey: key, acceptedTerms: true })).data!;
    return { p, mk, order, call, admin };
  }
describe("online payment flow", () => {
  const fake = (log: { init?: unknown }): PaymentProvider => ({ name: "fakepay", methods: (c) => (c === "GHS" ? ["card", "mobile_money"] : ["card"]), initialize: async (i) => { log.init = i; return { ok: true, redirectUrl: "https://pay.example/session" }; }, parseWebhook: async (raw, h) => (h.get("x-sig") === "good" ? JSON.parse(raw) : null) });

  test("without a provider checkout says so honestly and payment can't start", async () => {
    const { mk, order } = await shop(); const c = mk(); const o = await order(c);
    expect(o.paymentAvailable).toBe(false); expect((await c.paymentConfig()).data).toEqual({ enabled: false, methods: { GHS: [], USD: [] } });
    const r = await c.startPayment(o.order.ref, o.trackingSecret); expect(r.status).toBe(503); expect(r.errors[0]).toMatch(/contact you/);
  });
  test("payment starts with the amount from OUR order, only for its owner, once; webhook pays it exactly once", async () => {
    const log: { init?: any } = {}; const { mk, order, call, admin, p } = await shop(fake(log));
    const c = mk(); const o = await order(c); expect(o.paymentAvailable).toBe(true);
    expect((await mk().startPayment(o.order.ref, "wrong")).status).toBe(404); expect((await mk().startPayment("DDT-NOPE", "x")).status).toBe(404);
    const started = await c.startPayment(o.order.ref, o.trackingSecret); expect(started.data).toEqual({ redirectUrl: "https://pay.example/session" });
    expect(log.init).toMatchObject({ orderRef: o.order.ref, amount: o.order.total, currency: "GHS", email: "g@x.com", callbackUrl: `${ORIGIN}/track?ref=${o.order.ref}` });
    const ev = JSON.stringify({ eventId: "e1", orderRef: o.order.ref, amount: o.order.total, currency: "GHS", status: "success" });
    expect((await call("/api/webhooks/fakepay", { method: "POST", body: ev }, { "x-sig": "bad" })).status).toBe(401);
    expect(await (await call("/api/webhooks/fakepay", { method: "POST", body: ev }, { "x-sig": "good" })).json()).toEqual({ received: true, result: "applied" });
    expect(await (await call("/api/webhooks/fakepay", { method: "POST", body: ev }, { "x-sig": "good" })).json()).toMatchObject({ result: "duplicate" });
    expect((await admin.orders()).data![0]!.status).toBe("payment_confirmed");
    expect((await c.startPayment(o.order.ref, o.trackingSecret)).status).toBe(409); // already paid
    // a wrong amount is sent to review, never marked paid
    const o2 = await order(mk()); const bad = JSON.stringify({ eventId: "e2", orderRef: o2.order.ref, amount: 1, currency: "GHS", status: "success" });
    expect(await (await call("/api/webhooks/fakepay", { method: "POST", body: bad }, { "x-sig": "good" })).json()).toMatchObject({ result: "review" });
    // expired reservation can't start
    const o3 = await order(mk()); await transact(p, (db) => { for (const x of db.orders.values()) if (x.ref === o3.order.ref) x.reservedUntil = 1; });
    expect((await mk().startPayment(o3.order.ref, o3.trackingSecret)).errors[0]).toMatch(/expired/);
  });
  test("a signed-in customer can pay their own order without a code, but not someone else's", async () => {
    const { mk } = await shop(fake({}));
    const signUp = async (email: string) => { const c = mk(); await c.register({ email, password: PW, firstName: "A", lastName: "B", acceptTerms: true }); await c.login(email, PW); return c; };
    const alice = await signUp("alice@x.com"), bob = await signUp("bob@x.com");
    const mine = (await alice.checkout({ lines: [{ variantId: (await alice.products()).data![0]!.variantId, qty: 1 }], currency: "GHS", region: "Greater Accra", zoneId: "z", address: { recipient: "A", region: "Greater Accra", city: "A", street: "1" }, idempotencyKey: "alice-1", acceptedTerms: true })).data!;
    expect((await alice.startPayment(mine.order.ref)).ok).toBe(true); // owner, no tracking code needed
    expect((await bob.startPayment(mine.order.ref)).status).toBe(404); // someone else's order looks like it doesn't exist
    expect((await mk().startPayment(mine.order.ref)).status).toBe(404); // anonymous
  });
  test("Paystack adapter: request shape, https-only redirect, signature check, event mapping", async () => {
    let sent: { url: string; body: any; auth: string } | undefined;
    const ok = paystack("sk_test_x", async (url, init) => { sent = { url, body: JSON.parse(init.body as string), auth: (init.headers as Record<string, string>)["Authorization"]! }; return new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc" } }), { status: 200 }); });
    const r = await ok.initialize({ orderRef: "DDT-1", amount: 52000, currency: "GHS", email: "a@b.co", callbackUrl: "https://shop.test/track?ref=DDT-1" });
    expect(r).toEqual({ ok: true, redirectUrl: "https://checkout.paystack.com/abc" });
    expect(sent!.url).toBe("https://api.paystack.co/transaction/initialize"); expect(sent!.auth).toBe("Bearer sk_test_x");
    expect(sent!.body).toMatchObject({ amount: 52000, currency: "GHS", email: "a@b.co" }); expect(sent!.body.reference).toMatch(/^DDT-1\.[a-f0-9]{8}$/);
    expect((await paystack("k", async () => new Response(JSON.stringify({ status: true, data: { authorization_url: "http://evil.test" } }))).initialize({ orderRef: "D", amount: 1, currency: "GHS", email: "a@b.co", callbackUrl: "x" })).ok).toBe(false);
    expect((await paystack("k", async () => { throw new Error("x"); }).initialize({ orderRef: "D", amount: 1, currency: "GHS", email: "a@b.co", callbackUrl: "x" })).ok).toBe(false);
    const raw = JSON.stringify({ event: "charge.success", data: { id: 99, reference: "DDT-1.abcd1234", amount: 52000, currency: "GHS", status: "success" } });
    const sig = await hmacHex("sk_test_x", raw, "SHA-512");
    expect(await ok.parseWebhook(raw, new Headers({ "x-paystack-signature": sig }))).toEqual({ eventId: "paystack:99", orderRef: "DDT-1", amount: 52000, currency: "GHS", status: "success" });
    expect(await ok.parseWebhook(raw, new Headers({ "x-paystack-signature": "00" }))).toBeNull(); expect(await ok.parseWebhook(raw, new Headers())).toBeNull();
    const other = JSON.stringify({ event: "transfer.success", data: {} });
    expect(await ok.parseWebhook(other, new Headers({ "x-paystack-signature": await hmacHex("sk_test_x", other, "SHA-512") }))).toBe("ignored");
  });
});

describe("verified-buyer reviews", () => {
  test("only delivered buyers review, once; moderated before public; summary honest; erased with the account", async () => {
    const { admin, shopper, p } = await ownerSession();
    const prod = await admin.createProduct({ name: "Cap", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "CAP", priceGhs: 10000, onHand: 9, published: true });
    const slug = prod.data!.slug, variantId = `${prod.data!.id}::CAP`;
    const mkCustomer = async (email: string) => { const c = shopper(); await c.register({ email, password: PW, firstName: "Ama", lastName: "Mensah", acceptTerms: true }); await c.login(email, PW); return c; };
    const ama = await mkCustomer("ama@x.com"), kofi = await mkCustomer("kofi@x.com"), guest = shopper();
    const buy = (c: typeof ama) => c.checkout({ lines: [{ variantId, qty: 1 }], currency: "GHS", region: "Greater Accra", zoneId: "z", address: { recipient: "A", region: "Greater Accra", city: "A", street: "1" }, idempotencyKey: `k${Math.random()}`, acceptedTerms: true });
    const amaOrder = (await buy(ama)).data!.order; await buy(kofi);
    const good = { rating: 5, title: "Great", body: "Fits perfectly and arrived on time." };
    expect((await guest.submitReview(slug, good)).status).toBe(422); // not signed in
    expect((await ama.submitReview(slug, good)).errors[0]).toMatch(/delivered/); // ordered but not delivered
    expect((await ama.reviews(slug)).data!.canReview).toBe(false);
    await transact(p, (db) => { for (const o of db.orders.values()) if (o.id === amaOrder.id) o.status = "delivered"; });
    expect((await ama.reviews(slug)).data!.canReview).toBe(true); expect((await kofi.reviews(slug)).data!.canReview).toBe(false);
    for (const bad of [{ ...good, rating: 6 }, { ...good, rating: 4.5 }, { ...good, body: "short" }, { ...good, title: "x".repeat(101) }]) expect((await ama.submitReview(slug, bad)).status).toBe(422);
    expect((await ama.submitReview("nope", good)).status).toBe(422);
    expect((await ama.submitReview(slug, { ...good, body: "<b>bold</b> works fine really" })).ok).toBe(true);
    expect((await ama.submitReview(slug, good)).errors[0]).toMatch(/already/);
    expect((await guest.reviews(slug)).data).toMatchObject({ summary: { count: 0 }, reviews: [] }); // pending is invisible
    expect((await ama.reviews(slug)).data).toMatchObject({ canReview: false, myReview: { status: "pending" } });
    const queue = (await admin.reviews()).data!; expect(queue[0]).toMatchObject({ status: "pending", author: "Ama M.", product: "Cap" });
    expect((await admin.moderateReview(queue[0]!.id, "edit" as never)).status).toBe(422);
    expect((await admin.moderateReview(queue[0]!.id, "publish")).ok).toBe(true);
    expect((await guest.reviews(slug)).data).toMatchObject({ summary: { count: 1, average: 5 }, reviews: [{ author: "Ama M.", rating: 5 }] });
    expect((await guest.products()).data![0]!.rating).toEqual({ count: 1, average: 5 });
    expect(JSON.stringify((await guest.reviews(slug)).data)).not.toContain("ama@x.com"); // no PII
    // rejected reviews never show; customers can't moderate; deletion erases the review
    await admin.moderateReview(queue[0]!.id, "reject"); expect((await guest.reviews(slug)).data!.summary.count).toBe(0);
    expect((await shopper().admin(PORTAL).reviews()).status).toBe(404);
    await admin.moderateReview(queue[0]!.id, "publish"); await ama.deleteAccount();
    expect((await guest.reviews(slug)).data!.summary.count).toBe(0);
    expect(await transact(p, (db) => db.reviews.size)).toBe(0);
  });
});

describe("suppliers and purchase orders", () => {
  test("create → order → receive in parts adds audited stock, never over-receives, all-or-nothing, role-gated, costs never public", async () => {
    const { admin, shopper, staff, p } = await ownerSession();
    const prod = await admin.createProduct({ name: "Cap", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "CAP", priceGhs: 10000, onHand: 2, published: true });
    const prod2 = await admin.createProduct({ name: "Belt", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "BELT", priceGhs: 5000, onHand: 0, published: true });
    const v1 = `${prod.data!.id}::CAP`, v2 = `${prod2.data!.id}::BELT`;
    expect((await admin.saveSupplier({ name: "", email: "bad" })).status).toBe(422);
    const sup = (await admin.saveSupplier({ name: "Guangzhou Gear", country: "China", email: "sales@gz.example" })).data!;
    expect((await admin.saveSupplier({ id: sup.id, name: "Guangzhou Gear Ltd", active: true })).data!.name).toBe("Guangzhou Gear Ltd");
    expect((await admin.saveSupplier({ id: "nope", name: "x" })).status).toBe(422);
    const bad = await admin.createPurchaseOrder({ supplierId: "nope", currency: "dollars", lines: [{ variantId: "x", qty: 0, unitCost: -1 }] }); expect(bad.status).toBe(422); expect(bad.errors.length).toBeGreaterThan(2);
    expect((await admin.createPurchaseOrder({ supplierId: sup.id, currency: "USD", lines: [{ variantId: v1, qty: 5, unitCost: 300 }, { variantId: v1, qty: 1, unitCost: 300 }] })).errors.join()).toMatch(/twice/);
    const po = (await admin.createPurchaseOrder({ supplierId: sup.id, currency: "usd", lines: [{ variantId: v1, qty: 10, unitCost: 300 }, { variantId: v2, qty: 4, unitCost: 150 }], notes: "Sea freight" })).data!;
    expect((await admin.receivePurchaseOrder(po.id, [{ variantId: v1, qty: 1 }])).status).toBe(422); // still a draft
    expect((await admin.setPurchaseOrderStatus(po.id, "ordered")).ok).toBe(true);
    expect((await admin.setPurchaseOrderStatus(po.id, "ordered")).status).toBe(422);
    // all-or-nothing: second line over-receives → nothing is added
    expect((await admin.receivePurchaseOrder(po.id, [{ variantId: v1, qty: 6 }, { variantId: v2, qty: 9 }])).errors[0]).toMatch(/only 4 still expected/);
    expect((await admin.products()).data!.find((x) => x.sku === "CAP")!.onHand).toBe(2);
    expect((await admin.receivePurchaseOrder(po.id, [{ variantId: v1, qty: 6 }])).ok).toBe(true);
    expect((await admin.products()).data!.find((x) => x.sku === "CAP")!.onHand).toBe(8);
    expect((await admin.purchaseOrders()).data![0]).toMatchObject({ status: "partially_received", supplier: "Guangzhou Gear Ltd", currency: "USD" });
    expect((await admin.setPurchaseOrderStatus(po.id, "cancelled")).status).toBe(422); // can't cancel after receiving
    expect((await admin.receivePurchaseOrder(po.id, [{ variantId: v1, qty: 5 }])).status).toBe(422); // only 4 left
    await admin.receivePurchaseOrder(po.id, [{ variantId: v1, qty: 4 }, { variantId: v2, qty: 4 }]);
    expect((await admin.purchaseOrders()).data![0]!.status).toBe("received");
    expect((await admin.products()).data!.find((x) => x.sku === "BELT")!.onHand).toBe(4);
    expect(await transact(p, (db) => db.audit.filter((a) => a.event === "inventory.adjusted").length)).toBeGreaterThanOrEqual(3);
    expect((await admin.receivePurchaseOrder(po.id, [{ variantId: v1, qty: 1 }])).status).toBe(422); // finished
    // cancel a fresh unreceived order
    const po2 = (await admin.createPurchaseOrder({ supplierId: sup.id, currency: "USD", lines: [{ variantId: v1, qty: 1, unitCost: 1 }] })).data!;
    expect((await admin.setPurchaseOrderStatus(po2.id, "cancelled")).ok).toBe(true);
    // costs never leak publicly; anonymous and fulfilment staff are refused
    expect(JSON.stringify((await shopper().products()).data)).not.toMatch(/unitCost|Guangzhou/);
    expect((await shopper().admin(PORTAL).suppliers()).status).toBe(404);
    await transact(p, (db) => { [...db.users.values()].find((u) => u.email === "owner@shop.test")!.roles = ["fulfilment"]; });
    await staff.logout(); await signInStaff(staff, PORTAL, "owner@shop.test", PW);
    expect((await admin.suppliers()).status).toBe(403); expect((await admin.purchaseOrders()).status).toBe(403);
  });
});

describe("payment methods: card, Mobile Money, bank transfer", () => {
  const BANK = "Bank: Example Bank\nAccount name: Dera Darko Trade\nAccount number: 0000000000";
  test("config lists methods per currency; bank transfer stays hidden until the owner configures real details", async () => {
    const log: { init?: any } = {};
    const none = await shop(fake2(log)); const c0 = none.mk();
    expect((await c0.paymentConfig()).data).toMatchObject({ enabled: true, methods: { GHS: ["card", "mobile_money"], USD: ["card"] } });
    const withBank = await shop(fake2(log), { BANK_TRANSFER_DETAILS: BANK }); const c1 = withBank.mk();
    expect((await c1.paymentConfig()).data!.methods).toEqual({ GHS: ["card", "mobile_money", "bank_transfer"], USD: ["card", "bank_transfer"] });
    const narrowed = await shop(fake2(log), { BANK_TRANSFER_DETAILS: BANK, PAYMENT_METHODS: "card, bogus" });
    expect((await narrowed.mk().paymentConfig()).data!.methods.GHS).toEqual(["card"]);
    const bankOnly = await shop(undefined, { BANK_TRANSFER_DETAILS: BANK });
    expect((await bankOnly.mk().paymentConfig()).data).toMatchObject({ enabled: true, methods: { GHS: ["bank_transfer"] } });
  });
  test("the chosen online method is passed to the provider and validated; Mobile Money is refused for USD orders", async () => {
    const log: { init?: any } = {}; const { mk, order, admin } = await shop(fake2(log)); const c = mk(); const o = await order(c);
    expect(o.paymentMethods).toEqual(["card", "mobile_money"]);
    expect((await c.startPayment(o.order.ref, o.trackingSecret, "mobile_money")).ok).toBe(true);
    expect(log.init).toMatchObject({ method: "mobile_money", amount: o.order.total });
    expect((await admin.orders()).data![0]!.paymentMethod).toBe("mobile_money");
    expect((await c.startPayment(o.order.ref, o.trackingSecret, "bitcoin" as never)).status).toBe(422);
    expect((await c.startPayment(o.order.ref, o.trackingSecret, "bank_transfer")).status).toBe(422); // bank transfer isn't an online redirect
    expect((await c.startBankTransfer(o.order.ref, o.trackingSecret)).status).toBe(409 /* not configured → unavailable */);
  });
  test("bank transfer: instructions, extended hold, staff confirmation (exact amount, unique reference, wrong amount → review), role-gated", async () => {
    const { mk, order, admin, p, call } = await shop(undefined, { BANK_TRANSFER_DETAILS: BANK, BANK_TRANSFER_HOLD_HOURS: "48" });
    const c = mk(); const o = await order(c); expect(o.paymentMethods).toEqual(["bank_transfer"]);
    expect((await mk().startBankTransfer(o.order.ref, "wrong")).status).toBe(404);
    const t0 = Date.now();
    const b = (await c.startBankTransfer(o.order.ref, o.trackingSecret)).data!;
    expect(b).toMatchObject({ instructions: BANK, reference: o.order.ref, amount: o.order.total, currency: "GHS" });
    expect(b.holdUntil).toBeGreaterThanOrEqual(t0 + 47 * 3_600_000); expect(b.holdUntil).toBeLessThanOrEqual(Date.now() + 49 * 3_600_000);
    expect((await admin.orders()).data![0]).toMatchObject({ paymentMethod: "bank_transfer", status: "pending_payment" });
    // confirmation validation
    expect((await admin.confirmBankTransfer(o.order.id, o.order.total, "  ")).status).toBe(422);
    expect((await admin.confirmBankTransfer(o.order.id, -5, "TX1")).status).toBe(422);
    // wrong amount → manual review, not paid
    expect((await admin.confirmBankTransfer(o.order.id, 1, "TX-SHORT")).data).toMatchObject({ result: "review" });
    expect((await admin.orders()).data![0]!.status).toBe("payment_under_review");
    // correct amount with a fresh reference → paid; the same reference can't be applied twice
    expect((await admin.confirmBankTransfer(o.order.id, o.order.total, "TX-OK")).data).toMatchObject({ result: "applied" });
    expect((await admin.orders()).data![0]!.status).toBe("payment_confirmed");
    expect((await admin.confirmBankTransfer(o.order.id, o.order.total, "TX-OK")).status).toBe(422);
    // an order that never chose bank transfer can't be confirmed this way
    const o2 = await order(mk());
    expect((await admin.confirmBankTransfer(o2.order.id, o2.order.total, "TX-9")).errors[0]).toMatch(/isn't waiting on a bank transfer/);
    // customers have no access; fulfilment staff can't confirm money
    expect((await mk().admin(PORTAL).confirmBankTransfer(o.order.id, 1, "x")).status).toBe(404);
    await transact(p, (db) => { [...db.users.values()].find((u) => u.email === "owner@shop.test")!.roles = ["fulfilment"]; });
    const staff = mk(); await signInStaff(staff, PORTAL, "owner@shop.test", PW);
    expect((await staff.admin(PORTAL).confirmBankTransfer(o2.order.id, o2.order.total, "TX-10")).status).toBe(403);
    void call;
  });
  test("Paystack adapter restricts channels to the chosen method and reports the channel used", async () => {
    let body: any; const ps = paystack("sk", async (_u, init) => { body = JSON.parse(init.body as string); return new Response(JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/x" } })); });
    expect(ps.methods("GHS")).toEqual(["card", "mobile_money"]); expect(ps.methods("USD")).toEqual(["card"]);
    const base = { orderRef: "DDT-1", amount: 100, currency: "GHS" as const, email: "a@b.co", callbackUrl: "https://x" };
    await ps.initialize({ ...base, method: "mobile_money" }); expect(body.channels).toEqual(["mobile_money"]);
    await ps.initialize({ ...base, method: "card" }); expect(body.channels).toEqual(["card"]);
    await ps.initialize(base); expect(body.channels).toBeUndefined();
    expect((await ps.initialize({ ...base, currency: "USD", method: "mobile_money" })).ok).toBe(false);
    const raw = JSON.stringify({ event: "charge.success", data: { id: 7, reference: "DDT-1.ab", amount: 100, currency: "GHS", status: "success", channel: "mobile_money" } });
    expect(await ps.parseWebhook(raw, new Headers({ "x-paystack-signature": await hmacHex("sk", raw, "SHA-512") }))).toMatchObject({ channel: "mobile_money" });
    expect(methodFromChannel("mobile_money")).toBe("mobile_money"); expect(methodFromChannel("ussd")).toBeUndefined();
  });
  test("a verified webhook records the channel the customer actually used", async () => {
    const { mk, order, admin, call } = await shop(fake2({}));
    const c = mk(); const o = await order(c);
    const ev = JSON.stringify({ eventId: "ch1", orderRef: o.order.ref, amount: o.order.total, currency: "GHS", status: "success", channel: "card" });
    await call("/api/webhooks/fakepay", { method: "POST", body: ev }, { "x-sig": "good" });
    expect((await admin.orders()).data![0]).toMatchObject({ status: "payment_confirmed", paymentMethod: "card" });
  });
});
const fake2 = (log: { init?: unknown }): PaymentProvider => ({ name: "fakepay", methods: (c) => (c === "GHS" ? ["card", "mobile_money"] : ["card"]), initialize: async (i) => { log.init = i; return { ok: true, redirectUrl: "https://pay.example/session" }; }, parseWebhook: async (raw, h) => (h.get("x-sig") === "good" ? JSON.parse(raw) : null) });

describe("pre-order allocation from received stock", () => {
  test("paid pre-orders queue oldest-first; received stock allocates all-or-nothing and deducts inventory", async () => {
    const { mk, admin, call, p } = await shop(fake2({}));
    const pre = (await admin.createProduct({ name: "Drop", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "DROP", priceGhs: 20000, onHand: 0, published: true, availability: "pre_order", preOrderEnabled: true, expectedWindow: "Nov" })).data!;
    const vid = `${pre.id}::DROP`;
    const buy = async (qty: number, key: string) => { const c = mk(); const o = (await c.checkout({ lines: [{ variantId: vid, qty }], currency: "GHS", region: "Greater Accra", zoneId: "z", guestEmail: "g@x.com", address: { recipient: "R", region: "Greater Accra", city: "A", street: "1" }, idempotencyKey: key, acceptedTerms: true, preorderAcknowledged: true })).data!; return o; };
    const pay = async (o: { order: { ref: string; total: number } }, id: string) => call("/api/webhooks/fakepay", { method: "POST", body: JSON.stringify({ eventId: id, orderRef: o.order.ref, amount: o.order.total, currency: "GHS", status: "success" }) }, { "x-sig": "good" });
    const a = await buy(2, "pa"), b = await buy(2, "pb"), unpaid = await buy(1, "pc");
    await pay(a, "ea"); await pay(b, "eb");
    const q0 = (await admin.preorderQueue()).data!;
    expect(q0.map((x) => x.ref)).toEqual([a.order.ref, b.order.ref]); // unpaid order isn't queued
    expect(q0.every((x) => !x.canAllocate)).toBe(true);
    expect((await admin.allocatePreorder((await admin.orders()).data!.find((x) => x.ref === a.order.ref)!.id)).errors[0]).toMatch(/0 free in stock, 2 needed/);
    // stock arrives for only 3 units: the older order can be covered, the newer one can't
    const sup = (await admin.saveSupplier({ name: "S" })).data!;
    const po = (await admin.createPurchaseOrder({ supplierId: sup.id, currency: "USD", lines: [{ variantId: vid, qty: 3, unitCost: 100 }] })).data!;
    await admin.setPurchaseOrderStatus(po.id, "ordered"); await admin.receivePurchaseOrder(po.id, [{ variantId: vid, qty: 3 }]);
    const q1 = (await admin.preorderQueue()).data!;
    expect(q1.map((x) => x.canAllocate)).toEqual([true, false]);
    const ids = (await admin.orders()).data!; const idA = ids.find((x) => x.ref === a.order.ref)!.id, idB = ids.find((x) => x.ref === b.order.ref)!.id;
    expect((await admin.allocatePreorder(idB)).errors[0]).toMatch(/Earlier pre-orders/); // 3 free but the older order has first claim
    expect((await admin.allocatePreorder(idA)).ok).toBe(true);
    expect((await admin.products()).data!.find((x) => x.sku === "DROP")!.onHand).toBe(1);
    expect((await admin.allocatePreorder(idA)).errors[0]).toMatch(/no pre-order items/); // can't allocate twice
    expect((await admin.allocatePreorder(idB)).errors[0]).toMatch(/only 1 free in stock, 2 needed/); // now genuinely short
    expect((await admin.preorderQueue()).data!.map((x) => x.ref)).toEqual([b.order.ref]);
    expect(await transact(p, (db) => db.audit.some((e) => e.event === "order.preorder_allocated"))).toBe(true);
    expect((await mk().admin(PORTAL).preorderQueue()).status).toBe(404);
    void unpaid;
  });
});

import { runMaintenance } from "../server/maintenance";
describe("staff 2FA seed encryption and maintenance", () => {
  test("the authenticator seed is never stored in plaintext; a legacy plaintext seed still works and is upgraded", async () => {
    const { p, admin } = await shop();
    // owner has completed 2FA setup via signInStaff; the stored seed must be sealed
    const stored = await transact(p, (db) => [...db.users.values()].find((u) => u.email === "owner@shop.test")!.mfa!.secret);
    expect(stored.startsWith("v1.")).toBe(true);
    expect((await admin.me()).ok).toBe(true);
    // simulate a database from before encryption: plaintext seed in the row
    const seed = "JBSWY3DPEHPK3PXP";
    const { verifyMfa } = await import("../server/services/mfa");
    const { totp } = await import("../lib/security/totp");
    await transact(p, async (db) => {
      const u = [...db.users.values()].find((x) => x.email === "owner@shop.test")!; u.mfa!.secret = seed; u.mfa!.lastStep = -1; u.mfa!.failures = 0;
      const sid = "legacy-sid"; db.sessions.set(sid, { id: sid, userId: u.id, expiresAt: Date.now() + 1e6, revoked: false, authAt: Date.now() });
      const code = await totp(seed, Date.now());
      expect(await verifyMfa(db, { id: u.id, kind: "staff", roles: u.roles }, sid, code, "s".repeat(32))).toBe(true);
      expect(u.mfa!.secret.startsWith("v1.")).toBe(true);
    });
  });
  test("maintenance releases expired holds and clears expired sessions/tokens, leaving live ones alone", async () => {
    const { p, mk, order } = await shop(fake2({}));
    const o = await order(mk());
    const now = Date.now();
    await transact(p, (db) => {
      db.tokens.set("old", { userId: "u", kind: "reset", expiresAt: now - 1 }); db.tokens.set("live", { userId: "u", kind: "reset", expiresAt: now + 1e6 });
      db.sessions.set("dead", { id: "dead", userId: "u", expiresAt: now - 1, revoked: false, authAt: 0 });
    });
    expect(await runMaintenance(p, now)).toMatchObject({ released: 0, tokens: 1 });
    const r = await runMaintenance(p, now + 24 * 3_600_000);
    expect(r.released).toBe(1);
    const st = await transact(p, (db) => ({ status: [...db.orders.values()].find((x) => x.ref === o.order.ref)!.status, live: db.tokens.has("live"), dead: db.sessions.has("dead") }));
    expect(st).toMatchObject({ status: "cancelled", live: false /* expired by then */, dead: false });
    expect((await runMaintenance(p, now + 24 * 3_600_000)).released).toBe(0); // idempotent
  });
});

describe("wishlist", () => {
  test("customers save and remove by slug, idempotently; hidden/unknown products and guests are refused; lists are private and erased with the account", async () => {
    const { mk, admin } = await shop();
    const live = (await admin.createProduct({ name: "Live", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "LIVE", priceGhs: 1000, onHand: 3, published: true })).data!;
    const hidden = (await admin.createProduct({ name: "Hidden", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "HID", priceGhs: 1000, onHand: 3, published: false })).data!;
    const slugOf = async (name: string) => (await mk().products()).data!.find((x) => x.name === name)?.slug;
    const liveSlug = (await slugOf("Live"))!; expect(liveSlug).toBeTruthy(); expect(await slugOf("Hidden")).toBeUndefined(); void live; void hidden;
    const signUp = async (email: string) => { const c = mk(); await c.register({ email, password: PW, firstName: "A", lastName: "B", acceptTerms: true }); await c.login(email, PW); return c; };
    const alice = await signUp("alice@w.com"), bob = await signUp("bob@w.com");
    expect((await mk().wishlist()).status).toBe(401); expect((await mk().setWishlist(liveSlug, true)).status).toBe(401);
    expect((await alice.setWishlist(liveSlug, true)).data).toEqual({ ok: true, count: 1 });
    expect((await alice.setWishlist(liveSlug, true)).data).toMatchObject({ count: 1 }); // repeating doesn't flip it
    expect((await alice.wishlist()).data).toEqual([liveSlug]); expect((await bob.wishlist()).data).toEqual([]);
    expect((await alice.setWishlist("no-such-item", true)).status).toBe(404);
    expect((await alice.setWishlist(liveSlug, false)).data).toMatchObject({ count: 0 }); expect((await alice.wishlist()).data).toEqual([]);
    await alice.setWishlist(liveSlug, true);
    expect(JSON.stringify((await alice.exportData()).data)).toContain("wishlist");
    expect((await alice.deleteAccount()).ok).toBe(true);
  });
  test("a product that is later hidden disappears from the saved list, and the list is capped", async () => {
    const { mk, admin, p } = await shop();
    const made = (await admin.createProduct({ name: "Gone", categoryId: "cat-shoes-and-footwear--sneakers", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "GONE", priceGhs: 1000, onHand: 3, published: true })).data!;
    const c = mk(); await c.register({ email: "c@w.com", password: PW, firstName: "A", lastName: "B", acceptTerms: true }); await c.login("c@w.com", PW);
    const slug = (await c.products()).data!.find((x) => x.name === "Gone")!.slug;
    await c.setWishlist(slug, true); expect((await c.wishlist()).data).toEqual([slug]);
    await admin.publish(made.id, false); expect((await c.wishlist()).data).toEqual([]); expect((await c.setWishlist(slug, true)).status).toBe(404);
    await admin.publish(made.id, true);
    await transact(p, (db) => { const u = [...db.users.values()].find((x) => x.email === "c@w.com")!; db.wishlist.set(u.id, new Set(Array.from({ length: 200 }, (_, i) => `fake${i}`))); });
    expect((await c.setWishlist(slug, true)).errors[0]).toMatch(/full/);
  });
});

import { cleanAttributes, facets, filterByAttributes, parseFilterParams, toFilterParams, attributesFor } from "../lib/domain/attributes";
describe("category filter attributes", () => {
  test("pure helpers: only defined keys, fixed options, numeric years, facets with counts, safe URL params", () => {
    expect(cleanAttributes("vehicle", { make: " Toyota ", year: 2019, fuel: "Diesel", bogus: "x", transmission: "Cvt" })).toEqual({ attributes: { make: "Toyota", year: "2019", fuel: "Diesel" }, rejected: ["Transmission must be one of: Automatic, Manual."] });
    expect(cleanAttributes("vehicle", { year: "20x9" }).rejected).toEqual(["Year must be a number."]);
    expect(cleanAttributes("footwear", { make: "Toyota", size: "42" }).attributes).toEqual({ size: "42" }); // key not defined for footwear
    expect(cleanAttributes("general", null)).toEqual({ attributes: {}, rejected: [] }); expect(cleanAttributes(undefined, "x").attributes).toEqual({});
    const list = [{ attributes: { make: "Toyota", year: "2019" } }, { attributes: { make: "Toyota", year: "2021" } }, { attributes: { make: "Honda" } }, {}];
    const f = facets(list, "vehicle"); expect(f.map((x) => x.key)).toEqual(["make", "year"]);
    expect(f[0]!.values).toEqual([{ value: "Honda", count: 1 }, { value: "Toyota", count: 2 }]); expect(f[1]!.values.map((v) => v.value)).toEqual(["2021", "2019"]);
    expect(filterByAttributes(list, { make: "toyota", year: "2021" })).toHaveLength(1); expect(filterByAttributes(list, {})).toHaveLength(4); expect(filterByAttributes(list, { make: "Kia" })).toHaveLength(0);
    expect(parseFilterParams(["make:Toyota", "evil:1", "nocolon", "year:2019", 5], "vehicle")).toEqual({ make: "Toyota", year: "2019" }); expect(parseFilterParams("make:Honda", "vehicle")).toEqual({ make: "Honda" }); expect(parseFilterParams(undefined, "vehicle")).toEqual({});
    expect(toFilterParams({ make: "Toyota", model: "" })).toEqual(["make:Toyota"]); expect(attributesFor(undefined).length).toBeGreaterThan(0);
  });
  test("owners set attributes at creation and later; invalid ones are refused; the public catalogue exposes them", async () => {
    const { mk, admin } = await shop();
    const bad = await admin.createProduct({ name: "Corolla", categoryId: "cat-cars--suvs", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "COR", priceGhs: 9000000, onHand: 1, published: true, attributes: { fuel: "Steam" } }); expect(bad.status).toBe(422); expect(bad.errors[0]).toMatch(/Fuel must be one of/);
    const car = (await admin.createProduct({ name: "Corolla", categoryId: "cat-cars--suvs", shortDescription: "s", image: "/i.jpg", imageAlt: "a", sku: "COR", priceGhs: 9000000, onHand: 1, published: true, attributes: { make: "Toyota", year: "2019", fuel: "Petrol", junk: "x" } })).data!;
    const pub = async () => (await mk().products()).data!.find((x) => x.name === "Corolla")!;
    expect((await pub()).attributes).toEqual({ make: "Toyota", year: "2019", fuel: "Petrol" });
    expect((await admin.setAttributes(car.id, { make: "Honda", transmission: "Automatic" })).data!.attributes).toEqual({ make: "Honda", transmission: "Automatic" });
    expect((await pub()).attributes).toEqual({ make: "Honda", transmission: "Automatic" });
    expect((await admin.setAttributes(car.id, { year: "last year" })).status).toBe(422); expect((await admin.setAttributes("nope", {})).status).toBe(422);
    expect((await admin.products()).data!.find((x) => x.id === car.id)).toMatchObject({ categoryId: "cat-cars--suvs", attributes: { make: "Honda" } });
    expect((await mk().admin(PORTAL).setAttributes(car.id, {})).status).toBe(404);
  });
});
