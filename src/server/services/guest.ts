/**
 * Anonymous-session ("guest") customer services. Pure functions over MemoryDb: no HTTP, no cookies, no network.
 *
 * Trust model:
 *  - The caller (src/server/guest.ts) has ALREADY verified the signed session cookie and passes the session id.
 *  - Everything the client sends is untrusted: variant ids and slugs are checked against the PUBLIC catalogue, quantities against
 *    the single purchasing rule (`canPurchase`), prices are never accepted — they are re-derived here from stored records.
 *  - A session can only ever reach records linked to it (`orderIds`, `enquiryIds`, `returnIds`). Unknown and "not yours" look identical.
 *  - Order contents are returned WITHOUT the street address, phone or email.
 */
import { GHANA_REGIONS } from "../../lib/domain/regions";
import { activeUnitPrice, priceCart } from "../../lib/domain/commerce";
import type { Currency } from "../../lib/domain/money";
import { canPurchase } from "../../lib/domain/status";
import { labelOf } from "../../lib/order-labels";
import { recommend, type RecProduct, type SalesData } from "../../lib/recommend";
import { randomToken, sha256Hex, timingSafeEqual } from "../../lib/security/crypto";
import {
  DEFAULT_GUEST_PREFS, ENQUIRY_CATEGORIES, GUEST_LIMITS, REQUEST_KINDS,
  type CartQuote, type EnquiryCategory, type EnquiryView, type GuestNotification, type GuestOrderSummary, type GuestPrefs, type GuestState,
  type OrderDetail, type QuoteResult, type RecSection, type RequestKind, type ReturnRequestView, type SaleInfo,
} from "../../lib/guest-types";
import type { publicProducts } from "../api-full-impl";
import type { GuestSessionRow, MemoryDb, OrderRow } from "../db";
import { placeOrder, requestGuestCancellation } from "./orders";
import { openTicket } from "./support";

export type Catalog = ReturnType<typeof publicProducts>;
type Item = Catalog[number];

export const GUEST_SESSION_TTL_MS = 30 * 24 * 3_600_000;
export const GUEST_MAX_SESSIONS = 20_000;
const MAX_ENQUIRIES = 20, MAX_REQUESTS = 10;

/* ---------- small, strict sanitisers (all client text is untrusted) ---------- */
const oneLine = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const multiLine = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE = /^[+0-9()\-\s]{7,20}$/;
export const isEmail = (s: string) => EMAIL.test(s);

/* ---------- catalogue helpers ---------- */
function index(db: MemoryDb, catalog: Catalog) {
  const visible = new Map<string, Item>(), bySlug = new Map<string, Item>();
  for (const p of catalog) { visible.set(p.variantId, p); bySlug.set(p.slug, p); }
  const slugOfProduct = new Map<string, string>(), productOfSlug = new Map<string, string>();
  for (const pr of db.products.values()) { slugOfProduct.set(pr.id, pr.slug); productOfSlug.set(pr.slug, pr.id); }
  return { visible, bySlug, slugOfProduct, productOfSlug };
}
const purchasableNow = (p: Item) => p.availability === "available" || p.availability === "pre_order";
const unitNow = (p: Item, cur: Currency) => (p.salePrice?.[cur] ?? p.price[cur]);

/* ---------- session rows ---------- */
export function getRow(db: MemoryDb, sid: string, now = Date.now()): GuestSessionRow | undefined {
  const r = db.guestSessions.get(sid);
  return r && r.lastSeen + GUEST_SESSION_TTL_MS > now ? r : undefined;
}

/** Removes sessions idle past the TTL. Sessions that placed orders keep nothing the orders need (orders are separate records). */
export function pruneGuestSessions(db: MemoryDb, now = Date.now()): number {
  let n = 0;
  for (const [id, r] of db.guestSessions) if (r.lastSeen + GUEST_SESSION_TTL_MS <= now) { db.guestSessions.delete(id); n++; }
  return n;
}

/** Creates the server-side record on first write. Returns null only if the store is saturated even after pruning. */
export function ensureRow(db: MemoryDb, sid: string, now = Date.now()): GuestSessionRow | null {
  const existing = getRow(db, sid, now);
  if (existing) { existing.lastSeen = now; return existing; }
  if (db.guestSessions.size >= GUEST_MAX_SESSIONS) {
    pruneGuestSessions(db, now);
    if (db.guestSessions.size >= GUEST_MAX_SESSIONS) return null;
  }
  const row: GuestSessionRow = {
    id: sid, createdAt: now, lastSeen: now, cart: [], wishlist: [], compare: [], viewed: [], searches: [], addresses: [],
    prefs: { ...DEFAULT_GUEST_PREFS }, orderIds: [], enquiryIds: [], returnIds: [], notificationsReadAt: 0,
  };
  db.guestSessions.set(sid, row);
  return row;
}

/** Forget this visitor entirely. Orders already placed stay (the business must keep them); they simply stop being linked. */
export function deleteSession(db: MemoryDb, sid: string) { db.guestSessions.delete(sid); }

/** Clears browsing activity only (recently viewed, searches, comparison). Cart, saved items and preferences are kept. */
export function clearActivity(row: GuestSessionRow) { row.viewed = []; row.searches = []; row.compare = []; }

/* ---------- state ---------- */
export function orderSummary(o: OrderRow, now = Date.now()): GuestOrderSummary {
  return { ref: o.ref, status: o.status, currency: o.currency, total: o.total, createdAt: o.createdAt, itemCount: o.items.reduce((s, i) => s + i.qty, 0), hasPreorder: o.hasPreorder, payBy: o.status === "pending_payment" && o.reservedUntil > now ? o.reservedUntil : null };
}
const ownedOrders = (db: MemoryDb, row: GuestSessionRow) => row.orderIds.map((id) => db.orders.get(id)).filter((o): o is OrderRow => !!o);

export function buildState(db: MemoryDb, row: GuestSessionRow | undefined, catalog: Catalog, expiresAt: number, now = Date.now()): GuestState {
  if (!row) return { expiresAt, cart: [], wishlist: [], compare: [], viewed: [], searches: [], addresses: [], prefs: { ...DEFAULT_GUEST_PREFS }, orders: [], unreadNotifications: 0 };
  const ix = index(db, catalog);
  const slugs = (ids: string[]) => ids.map((id) => ix.slugOfProduct.get(id)).filter((s): s is string => !!s && ix.bySlug.has(s));
  const notes = notifications(db, row, catalog, now);
  return {
    expiresAt,
    cart: row.cart.filter((l) => ix.visible.has(l.variantId)).map((l) => ({ ...l })),
    wishlist: slugs(row.wishlist.map((w) => w.productId)),
    compare: slugs(row.compare),
    viewed: slugs(row.viewed.map((v) => v.productId)),
    searches: row.searches.map((s) => s.q),
    addresses: row.addresses.map((a) => ({ ...a })),
    prefs: { ...row.prefs },
    orders: ownedOrders(db, row).sort((a, b) => b.createdAt - a.createdAt).map((o) => orderSummary(o, now)),
    unreadNotifications: notes.filter((n) => !n.standing && n.at > row.notificationsReadAt).length,
  };
}

/* ---------- cart ---------- */
export type Mutation = { ok: true } | { ok: false; error: string };

/** Sets an absolute quantity (0 removes). The purchasing rule is the same one checkout uses; the cart never holds a price. */
export function setCartQty(db: MemoryDb, row: GuestSessionRow, catalog: Catalog, variantId: string, qty: number, now = Date.now()): Mutation {
  if (!Number.isInteger(qty) || qty < 0 || qty > GUEST_LIMITS.qty) return { ok: false, error: `Choose a quantity between 0 and ${GUEST_LIMITS.qty}.` };
  if (qty === 0) { row.cart = row.cart.filter((l) => l.variantId !== variantId); return { ok: true }; }
  const item = index(db, catalog).visible.get(variantId), v = db.variants.get(variantId);
  if (!item || !v) return { ok: false, error: "This product is no longer available." };
  const d = canPurchase(v, qty, now);
  if (!d.ok) return { ok: false, error: d.reason };
  const have = row.cart.find((l) => l.variantId === variantId);
  if (have) have.qty = qty;
  else if (row.cart.length >= GUEST_LIMITS.cartLines) return { ok: false, error: `A cart can hold up to ${GUEST_LIMITS.cartLines} different products.` };
  else row.cart.push({ variantId, qty });
  return { ok: true };
}

/** Server-authoritative pricing of THIS session's cart. Client prices are never accepted; no tax/handling charge is invented. */
export function quoteCart(db: MemoryDb, row: GuestSessionRow, catalog: Catalog, i: { currency: Currency; region?: string; zoneId?: string; discountCode?: string }, now = Date.now()): QuoteResult {
  const ix = index(db, catalog);
  const lines = row.cart.filter((l) => ix.visible.has(l.variantId));
  const zone = i.zoneId ? db.zones.get(i.zoneId) : undefined;
  const r = priceCart({ lines, currency: i.currency, ...(i.discountCode ? { discountCode: i.discountCode } : {}) }, db.variants, {
    discounts: db.discounts, customer: { priorOrders: 0, redemptionsByCode: {} }, ...(zone && i.region ? { zone, region: i.region } : {}), now: new Date(now),
  });
  if (!r.ok) return { ok: false, errors: r.errors };
  const c = r.cart;
  const quote: CartQuote = {
    currency: c.currency, subtotal: c.subtotal.amount, discount: c.discount.amount, shipping: c.shipping.amount, total: c.total.amount,
    appliedCode: c.appliedCode ?? null, shippingEstimate: c.shippingEstimate ?? null, hasPreorder: c.hasPreorder, taxesAndCharges: "none_configured",
    lines: c.lines.map((l) => ({ variantId: l.variantId, slug: ix.visible.get(l.variantId)?.slug ?? null, name: l.name, qty: l.qty, unit: l.unit.amount, line: l.line.amount, mode: l.mode })),
  };
  return { ok: true, quote };
}

/* ---------- wishlist / compare / viewed / searches ---------- */
export function setWishlist(db: MemoryDb, row: GuestSessionRow, catalog: Catalog, slug: string, on: boolean): Mutation {
  const ix = index(db, catalog), item = ix.bySlug.get(slug), pid = ix.productOfSlug.get(slug);
  if (!item || !pid) return { ok: false, error: "This product is no longer available." };
  row.wishlist = row.wishlist.filter((w) => w.productId !== pid);
  if (on) {
    if (row.wishlist.length >= GUEST_LIMITS.wishlist) return { ok: false, error: "Your saved list is full." };
    const ghs = unitNow(item, "GHS"), usd = unitNow(item, "USD");
    row.wishlist.unshift({ productId: pid, at: Date.now(), avail: item.availability, ...(ghs !== undefined ? { ghs } : {}), ...(usd !== undefined ? { usd } : {}) });
  }
  return { ok: true };
}
export function setCompare(db: MemoryDb, row: GuestSessionRow, catalog: Catalog, slug: string, on: boolean): Mutation {
  const ix = index(db, catalog), pid = ix.productOfSlug.get(slug);
  if (!pid || !ix.bySlug.has(slug)) return { ok: false, error: "This product is no longer available." };
  const without = row.compare.filter((id) => id !== pid);
  if (!on) { row.compare = without; return { ok: true }; }
  if (row.compare.includes(pid)) return { ok: true };
  if (without.length >= GUEST_LIMITS.compare) return { ok: false, error: `You can compare up to ${GUEST_LIMITS.compare} products. Remove one first.` };
  row.compare = [...without, pid];
  return { ok: true };
}
export function recordViewed(db: MemoryDb, row: GuestSessionRow, catalog: Catalog, slug: string, now = Date.now()): Mutation {
  const ix = index(db, catalog), pid = ix.productOfSlug.get(slug);
  if (!pid || !ix.bySlug.has(slug)) return { ok: false, error: "Unknown product." };
  row.viewed = [{ productId: pid, at: now }, ...row.viewed.filter((v) => v.productId !== pid)].slice(0, GUEST_LIMITS.viewed);
  return { ok: true };
}
export function recordSearch(row: GuestSessionRow, raw: unknown, now = Date.now()): Mutation {
  const q = oneLine(raw, 80);
  if (q.length < 2) return { ok: false, error: "Search is too short." };
  row.searches = [{ q, at: now }, ...row.searches.filter((s) => s.q.toLowerCase() !== q.toLowerCase())].slice(0, GUEST_LIMITS.searches);
  return { ok: true };
}

/* ---------- preferences & addresses ---------- */
export function savePrefs(row: GuestSessionRow, raw: Record<string, unknown>): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [], next: GuestPrefs = { ...row.prefs };
  if ("preferredName" in raw) next.preferredName = oneLine(raw["preferredName"], 60);
  if ("email" in raw) { const e = oneLine(raw["email"], 254).toLowerCase(); if (e && !isEmail(e)) errors.push("Enter a valid email address."); else next.email = e; }
  if ("phone" in raw) { const p = oneLine(raw["phone"], 20); if (p && !PHONE.test(p)) errors.push("Enter a valid phone number."); else next.phone = p; }
  if ("currency" in raw) { const c = raw["currency"]; if (c === "GHS" || c === "USD" || c === "DUAL") next.currency = c; else errors.push("Choose GHS, USD or both."); }
  if ("region" in raw) { const r = oneLine(raw["region"], 40); if (r && !(GHANA_REGIONS as readonly string[]).includes(r)) errors.push("Choose one of Ghana's regions."); else next.region = r; }
  if ("interests" in raw) {
    const xs = Array.isArray(raw["interests"]) ? raw["interests"] : [];
    next.interests = [...new Set(xs.map((x) => oneLine(x, 40)).filter(Boolean))].slice(0, 10);
  }
  for (const k of ["notifyOrderUpdates", "notifyBackInStock", "notifyPriceAlerts", "notifyMarketing"] as const) if (k in raw) { if (typeof raw[k] === "boolean") next[k] = raw[k] as boolean; else errors.push("Notification choices must be on or off."); }
  if (errors.length) return { ok: false, errors };
  row.prefs = next;
  return { ok: true };
}
export function saveAddress(row: GuestSessionRow, raw: Record<string, unknown>): { ok: true } | { ok: false; errors: string[] } {
  const a = { label: oneLine(raw["label"], 30) || "Address", recipient: oneLine(raw["recipient"], 80), region: oneLine(raw["region"], 40), city: oneLine(raw["city"], 60), street: oneLine(raw["street"], 160), phone: oneLine(raw["phone"], 20) };
  const errors: string[] = [];
  if (!a.recipient) errors.push("Enter the recipient's name.");
  if (!(GHANA_REGIONS as readonly string[]).includes(a.region)) errors.push("Choose one of Ghana's regions.");
  if (!a.city) errors.push("Enter the city or town.");
  if (!a.street) errors.push("Enter the street address.");
  if (a.phone && !PHONE.test(a.phone)) errors.push("Enter a valid phone number.");
  if (row.addresses.length >= GUEST_LIMITS.addresses) errors.push(`You can keep up to ${GUEST_LIMITS.addresses} addresses.`);
  if (errors.length) return { ok: false, errors };
  row.addresses.push({ id: `adr_${randomToken(6)}`, label: a.label, recipient: a.recipient, region: a.region, city: a.city, street: a.street, ...(a.phone ? { phone: a.phone } : {}) });
  return { ok: true };
}
export const removeAddress = (row: GuestSessionRow, id: string) => { row.addresses = row.addresses.filter((a) => a.id !== id); };

/* ---------- orders ---------- */
export function orderDetail(db: MemoryDb, o: OrderRow, now = Date.now()): OrderDetail {
  return {
    ref: o.ref, status: o.status, createdAt: o.createdAt, currency: o.currency, subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, total: o.total,
    paymentMethod: o.paymentMethod ?? null, payBy: o.status === "pending_payment" && o.reservedUntil > now ? o.reservedUntil : null, hasPreorder: o.hasPreorder,
    items: o.items.map((i) => { const v = db.variants.get(i.variantId), pr = v ? db.products.get(v.productId) : undefined; return { variantId: i.variantId, slug: pr?.slug ?? null, image: pr?.image ?? null, name: i.name, qty: i.qty, unit: i.unit, line: i.line, mode: i.mode }; }),
    history: o.history.map((h) => ({ to: h.to, at: h.at })),
    destination: { region: o.address.region, city: o.address.city },
    shipment: o.shipment ? { ...o.shipment } : null,
  };
}
export const sessionOrder = (db: MemoryDb, row: GuestSessionRow, ref: string) => ownedOrders(db, row).find((o) => o.ref === ref.trim().toUpperCase());

/** Finds an order by reference AND proves possession of its tracking code. Wrong code and unknown reference are indistinguishable. */
export async function orderByCode(db: MemoryDb, ref: string, secret: string): Promise<OrderRow | null> {
  const wanted = ref.trim().toUpperCase();
  const o = [...db.orders.values()].find((x) => x.ref === wanted);
  const ok = !!o && !!secret && timingSafeEqual(await sha256Hex(secret.trim()), o.trackingSecretHash);
  return ok && o ? o : null;
}
export async function claimOrder(db: MemoryDb, row: GuestSessionRow, ref: string, secret: string): Promise<OrderRow | null> {
  const o = await orderByCode(db, ref, secret);
  if (!o) return null;
  if (!row.orderIds.includes(o.id)) row.orderIds.unshift(o.id);
  return o;
}
/** For a session that owns an unpaid order but no longer holds the one-time code (page refreshed): issues a NEW code; the old one stops working. */
export async function reissueTrackingCode(db: MemoryDb, row: GuestSessionRow, ref: string): Promise<string | null> {
  const o = sessionOrder(db, row, ref);
  if (!o || o.status !== "pending_payment") return null;
  const secret = randomToken(18);
  o.trackingSecretHash = await sha256Hex(secret);
  db.log("order.tracking_code_reissued", { orderId: o.id });
  return secret;
}

export interface GuestCheckoutInput {
  currency: Currency; region: string; zoneId: string; email: string; address: { recipient: string; region: string; city: string; street: string; phone?: string };
  discountCode?: string; idempotencyKey: string; acceptedTerms: boolean; preorderAcknowledged?: boolean;
}
export async function guestCheckout(db: MemoryDb, row: GuestSessionRow, catalog: Catalog, i: GuestCheckoutInput, now = Date.now()):
  Promise<{ ok: true; order: OrderRow; trackingSecret?: string; duplicate: boolean } | { ok: false; errors: string[] }> {
  const email = oneLine(i.email, 254).toLowerCase();
  if (!isEmail(email)) return { ok: false, errors: ["Enter a valid email address for your order confirmation."] };
  if (typeof i.idempotencyKey !== "string" || i.idempotencyKey.length < 8 || i.idempotencyKey.length > 80) return { ok: false, errors: ["Something went wrong. Please refresh and try again."] };
  const prior = [...db.orders.values()].find((o) => o.idempotencyKey === i.idempotencyKey);
  if (prior && !row.orderIds.includes(prior.id)) return { ok: false, errors: ["Something went wrong. Please refresh and try again."] }; // never reveal another visitor's order
  const lines = row.cart.filter((l) => index(db, catalog).visible.has(l.variantId));
  if (!lines.length && !prior) return { ok: false, errors: ["Your cart is empty."] };
  // Fail closed: without a configured delivery zone covering the region, an order would silently ship free.
  const zone = db.zones.get(i.zoneId);
  if (!prior && (!zone || !zone.regions.includes(i.region))) return { ok: false, errors: [db.zones.size === 0 ? "Delivery isn't set up yet. Please contact us to arrange your order." : "We don't currently deliver to that region with the selected delivery option."] };
  const address = { recipient: oneLine(i.address.recipient, 80), region: oneLine(i.address.region, 40), city: oneLine(i.address.city, 60), street: oneLine(i.address.street, 160), ...(oneLine(i.address.phone, 20) ? { phone: oneLine(i.address.phone, 20) } : {}) };
  if (address.phone && !PHONE.test(address.phone)) return { ok: false, errors: ["Enter a valid phone number."] };
  if (!address.city) return { ok: false, errors: ["Enter the city or town."] };
  const r = await placeOrder(db, {
    guestEmail: email, lines, currency: i.currency, region: i.region, zoneId: i.zoneId, address, ...(i.discountCode ? { discountCode: oneLine(i.discountCode, 32) } : {}),
    idempotencyKey: i.idempotencyKey, acceptedTerms: i.acceptedTerms === true, preorderAcknowledged: i.preorderAcknowledged === true, now,
  });
  if (!r.ok) return r;
  if (!r.duplicate) {
    row.orderIds.unshift(r.order.id);
    const ordered = new Set(r.order.items.map((x) => x.variantId));
    row.cart = row.cart.filter((l) => !ordered.has(l.variantId));
  }
  return r;
}

/* ---------- notifications: derived from real records, never invented ---------- */
const NOTE_KIND: Record<string, GuestNotification["kind"]> = {
  payment_confirmed: "payment_confirmed", dispatched: "shipment_update", in_transit: "shipment_update", out_for_delivery: "shipment_update", ready_for_pickup: "shipment_update",
  delivery_attempted: "shipment_update", delivered: "delivered", refund_pending: "refund_update", partially_refunded: "refund_update", refunded: "refund_update",
};
export function notifications(db: MemoryDb, row: GuestSessionRow, catalog: Catalog, now = Date.now()): GuestNotification[] {
  const out: GuestNotification[] = [];
  for (const o of ownedOrders(db, row)) {
    o.history.forEach((h, i) => {
      const placed = i === 0;
      out.push({ id: `${o.id}:${i}`, kind: placed ? "order_placed" : (NOTE_KIND[h.to] ?? "order_status"), title: placed ? `Order ${o.ref} received` : `Order ${o.ref}: ${labelOf(h.to)}`, body: placed ? "We have your order and are holding the items while you pay." : (h.note ?? labelOf(h.to)), at: h.at, orderRef: o.ref });
    });
  }
  for (const id of row.enquiryIds) {
    const e = db.enquiries.get(id), t = e ? db.tickets.get(e.ticketId) : undefined;
    if (!e || !t) continue;
    t.messages.forEach((m, i) => { if (!m.internal && m.author !== "customer") out.push({ id: `${t.id}:${i}`, kind: "support_reply", title: `Reply to ${e.ref}`, body: "Our team has replied to your enquiry.", at: m.at }); });
  }
  const ix = index(db, catalog);
  for (const w of row.wishlist) {
    const slug = ix.slugOfProduct.get(w.productId), item = slug ? ix.bySlug.get(slug) : undefined;
    if (!slug || !item) continue;
    const wasBuyable = w.avail === "available" || w.avail === "pre_order";
    if (row.prefs.notifyBackInStock && !wasBuyable && purchasableNow(item)) out.push({ id: `avail:${w.productId}`, kind: "wishlist_available", title: `${item.name} is now available`, body: "A product on your saved list can be ordered now.", at: now, slug, standing: true });
    if (row.prefs.notifyPriceAlerts) {
      for (const cur of ["GHS", "USD"] as const) {
        const was = cur === "GHS" ? w.ghs : w.usd, nowP = unitNow(item, cur);
        if (was !== undefined && nowP !== undefined && was !== nowP) { out.push({ id: `price:${w.productId}:${cur}`, kind: "price_change", title: `Price changed: ${item.name}`, body: nowP < was ? "The price has dropped since you saved it." : "The price has gone up since you saved it.", at: now, slug, standing: true }); break; }
      }
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/* ---------- enquiries & returns: both open a ticket in the staff inbox (existing support workflow) ---------- */
const ticketStatusLabel = (s: string) => (s === "resolved" ? "Resolved" : s === "pending" ? "Replied — in progress" : "Received");

export function createEnquiry(db: MemoryDb, row: GuestSessionRow, raw: Record<string, unknown>, now = Date.now()): { ok: true; ref: string } | { ok: false; errors: string[] } {
  const category = oneLine(raw["category"], 20) as EnquiryCategory, email = oneLine(raw["email"], 254).toLowerCase(), name = oneLine(raw["name"], 80);
  const subject = oneLine(raw["subject"], 120), message = multiLine(raw["message"], 2000), orderRef = oneLine(raw["orderRef"], 24).toUpperCase();
  const errors: string[] = [];
  if (!(ENQUIRY_CATEGORIES as readonly string[]).includes(category)) errors.push("Choose what your enquiry is about.");
  if (!isEmail(email)) errors.push("Enter a valid email address so we can reply.");
  if (subject.length < 3) errors.push("Enter a short subject.");
  if (message.length < 10) errors.push("Tell us a little more (at least 10 characters).");
  if (row.enquiryIds.length >= MAX_ENQUIRIES) errors.push("You have reached the enquiry limit for this session. Please contact us directly.");
  if (errors.length) return { ok: false, errors };
  const ticket = openTicket(db, null, { email, subject: `[${category}] ${subject}`, body: `${message}${orderRef ? `\n\nOrder reference: ${orderRef}` : ""}${name ? `\n\nName: ${name}` : ""}` });
  const id = db.nextId("enq"), ref = `ENQ-${randomToken(5).replace(/[^A-Za-z0-9]/g, "X").toUpperCase().slice(0, 6)}`;
  db.enquiries.set(id, { id, ref, sessionId: row.id, ticketId: ticket.id, category, ...(orderRef ? { orderRef } : {}), subject, createdAt: now });
  row.enquiryIds.unshift(id);
  return { ok: true, ref };
}
export function listEnquiries(db: MemoryDb, row: GuestSessionRow): EnquiryView[] {
  const out: EnquiryView[] = [];
  for (const id of row.enquiryIds) {
    const e = db.enquiries.get(id), t = e ? db.tickets.get(e.ticketId) : undefined;
    if (!e || !t) continue;
    out.push({ ref: e.ref, category: e.category as EnquiryCategory, subject: e.subject, createdAt: e.createdAt, status: ticketStatusLabel(t.status), messages: t.messages.filter((m) => !m.internal).map((m) => ({ fromStaff: m.author !== "customer", body: m.body, at: m.at })) });
  }
  return out;
}

const AFTER_DELIVERY: RequestKind[] = ["return", "refund", "damaged", "incorrect"];
const RETURNABLE = ["delivered", "returned"];
export async function createReturnRequest(db: MemoryDb, row: GuestSessionRow, raw: Record<string, unknown>, now = Date.now()):
  Promise<{ ok: true; ref: string; outcome: "cancelled" | "requested" | "logged" } | { ok: false; errors: string[] }> {
  const kind = oneLine(raw["kind"], 20) as RequestKind, ref = oneLine(raw["orderRef"], 24).toUpperCase(), reason = oneLine(raw["reason"], 200), description = multiLine(raw["description"], 2000);
  const variantId = oneLine(raw["variantId"], 120), secret = oneLine(raw["trackingCode"], 80);
  const errors: string[] = [];
  if (!(REQUEST_KINDS as readonly string[]).includes(kind)) errors.push("Choose what you would like to do.");
  if (!reason) errors.push("Choose or enter a reason.");
  if (kind !== "cancellation" && description.length < 10) errors.push("Please describe the problem (at least 10 characters).");
  if (row.returnIds.length >= MAX_REQUESTS) errors.push("You have reached the request limit for this session. Please contact us directly.");
  if (errors.length) return { ok: false, errors };
  let order = sessionOrder(db, row, ref);
  if (!order && secret) order = (await claimOrder(db, row, ref, secret)) ?? undefined;
  if (!order) return { ok: false, errors: ["We couldn't find that order. Check the reference, or enter its tracking code."] };
  const item = variantId ? order.items.find((x) => x.variantId === variantId) : undefined;
  if (variantId && !item) return { ok: false, errors: ["That product isn't part of this order."] };
  if ([...db.returnRequests.values()].some((r) => r.sessionId === row.id && r.orderId === order!.id && r.kind === kind && (r.variantId ?? "") === variantId && r.outcome !== "cancelled")) return { ok: false, errors: ["You've already sent this request. Our team will reply by email."] };
  if (AFTER_DELIVERY.includes(kind) && !RETURNABLE.includes(order.status)) return { ok: false, errors: ["Returns, refunds and problem reports can be sent once the order has been delivered."] };

  const id = db.nextId("ret"), code = `RET-${randomToken(5).replace(/[^A-Za-z0-9]/g, "X").toUpperCase().slice(0, 6)}`;
  let outcome: "cancelled" | "requested" | "logged" = "logged";
  if (kind === "cancellation") {
    const c = requestGuestCancellation(db, order.id, now);
    if (!c.ok) return { ok: false, errors: [c.error] };
    outcome = c.outcome;
  }
  let ticketId: string | undefined;
  const email = order.guestEmail ?? row.prefs.email;
  if (outcome !== "cancelled" && isEmail(email)) {
    ticketId = openTicket(db, null, { email, subject: `[${kind}] Order ${order.ref}`, body: `Request ${code}\nOrder: ${order.ref}${item ? `\nProduct: ${item.name}` : ""}\nReason: ${reason}\n\n${description || "(no further details)"}` }).id;
  }
  db.returnRequests.set(id, { id, ref: code, sessionId: row.id, orderId: order.id, orderRef: order.ref, kind, ...(variantId ? { variantId } : {}), ...(item ? { productName: item.name } : {}), reason, description, ...(ticketId ? { ticketId } : {}), outcome, createdAt: now });
  row.returnIds.unshift(id);
  return { ok: true, ref: code, outcome };
}
export function listReturns(db: MemoryDb, row: GuestSessionRow): ReturnRequestView[] {
  const out: ReturnRequestView[] = [];
  for (const id of row.returnIds) {
    const r = db.returnRequests.get(id); if (!r) continue;
    const o = db.orders.get(r.orderId), t = r.ticketId ? db.tickets.get(r.ticketId) : undefined;
    const status = r.outcome === "cancelled" ? "Order cancelled" : t ? ticketStatusLabel(t.status) : "Received";
    out.push({ ref: r.ref, kind: r.kind as RequestKind, orderRef: r.orderRef, productName: r.productName ?? null, reason: r.reason, description: r.description, createdAt: r.createdAt, status, orderStatus: o ? labelOf(o.status) : "—", replies: (t?.messages ?? []).slice(1).filter((m) => !m.internal).map((m) => ({ fromStaff: m.author !== "customer", body: m.body, at: m.at })) });
  }
  return out;
}

/* ---------- promotions: derived from real sale prices and their real windows ---------- */
export function promotions(db: MemoryDb, catalog: Catalog, now = Date.now()): SaleInfo[] {
  const out: SaleInfo[] = [];
  for (const p of catalog) {
    const v = db.variants.get(p.variantId); if (!v || !purchasableNow(p)) continue;
    for (const cur of ["GHS", "USD"] as const) {
      const base = v.price[cur], cur$ = activeUnitPrice(v, cur, new Date(now));
      if (base === undefined || !cur$ || cur$.amount >= base) continue;
      out.push({ slug: p.slug, currency: cur, original: base, sale: cur$.amount, percentOff: Math.max(1, Math.floor(((base - cur$.amount) * 100) / base)), startsAt: v.saleStartsAt ?? null, endsAt: v.saleEndsAt ?? null });
    }
  }
  return out;
}

/* ---------- recommendations ---------- */
const PAID = new Set(["payment_confirmed", "processing", "preparing_dispatch", "ready_for_pickup", "dispatched", "in_transit", "out_for_delivery", "delivered", "delivery_attempted"]);
/** Sales aggregates from genuinely paid orders only. */
export function salesData(db: MemoryDb, now = Date.now()): SalesData {
  const bySlug: Record<string, number> = {}, recentBySlug: Record<string, number> = {}, pairs: Record<string, Record<string, number>> = {};
  const slugOfVariant = (id: string) => { const v = db.variants.get(id); return v ? db.products.get(v.productId)?.slug : undefined; };
  for (const o of db.orders.values()) {
    if (!PAID.has(o.status)) continue;
    const recent = now - o.createdAt <= 30 * 86_400_000;
    const slugs = [...new Set(o.items.map((i) => slugOfVariant(i.variantId)).filter((s): s is string => !!s))];
    for (const s of slugs) { bySlug[s] = (bySlug[s] ?? 0) + 1; if (recent) recentBySlug[s] = (recentBySlug[s] ?? 0) + 1; }
    for (const a of slugs) for (const b of slugs) if (a !== b) { (pairs[a] ??= {})[b] = (pairs[a]![b] ?? 0) + 1; }
  }
  return { bySlug, recentBySlug, pairs };
}

export function recommendationsFor(db: MemoryDb, row: GuestSessionRow | undefined, catalog: Catalog, focus: string | undefined, now = Date.now()): RecSection[] {
  const ix = index(db, catalog);
  const slugs = (ids: string[]) => ids.map((id) => ix.slugOfProduct.get(id)).filter((s): s is string => !!s);
  const signals = row
    ? { viewed: slugs(row.viewed.map((v) => v.productId)), wishlist: slugs(row.wishlist.map((w) => w.productId)), cart: row.cart.map((l) => ix.visible.get(l.variantId)?.slug).filter((s): s is string => !!s), compare: slugs(row.compare), searches: row.searches.map((s) => s.q), interests: row.prefs.interests }
    : { viewed: [], wishlist: [], cart: [], compare: [], searches: [], interests: [] };
  const products: RecProduct[] = catalog.map((p) => ({ slug: p.slug, name: p.name, categoryId: p.categoryId, createdAt: p.createdAt, availability: p.availability, attributes: p.attributes, shortDescription: p.shortDescription }));
  return recommend(products, db.categories, signals, salesData(db, now), { ...(focus ? { focus } : {}) });
}

