import { applyPaymentEvent, canTransition, priceCart, transition, type OrderStatus, type PaymentEvent } from "../../lib/domain/commerce";
import { money, type Currency } from "../../lib/domain/money";
import { randomToken, sha256Hex, timingSafeEqual } from "../../lib/security/crypto";
import type { MemoryDb, OrderRow } from "../db";
import { requirePermission, type Actor } from "../rbac";
import { ValidationError } from "./catalog-admin";

export const RESERVATION_MS = 30 * 60_000;

export interface PlaceOrderInput {
  userId?: string; guestEmail?: string; lines: { variantId: string; qty: number }[]; currency: Currency; region: string;
  address: OrderRow["address"]; discountCode?: string; idempotencyKey: string; acceptedTerms: boolean; preorderAcknowledged?: boolean; zoneId: string; now?: number;
}
export type PlaceResult = { ok: true; order: OrderRow; trackingSecret?: string; duplicate: boolean } | { ok: false; errors: string[] };

const countPaidOrders = (db: MemoryDb, userId?: string) => userId ? [...db.orders.values()].filter((o) => o.userId === userId && !["pending_payment", "cancelled"].includes(o.status)).length : 0;

/** Prices on the server from authoritative records, then reserves stock atomically. Client totals are never accepted. */
export async function placeOrder(db: MemoryDb, i: PlaceOrderInput): Promise<PlaceResult> {
  const now = i.now ?? Date.now();
  const existing = [...db.orders.values()].find((o) => o.idempotencyKey === i.idempotencyKey);
  if (existing) return { ok: true, order: existing, duplicate: true }; // retry/double-submit safe
  if (!i.acceptedTerms) return { ok: false, errors: ["You must accept the terms to place an order."] };
  if (!i.userId && !i.guestEmail) return { ok: false, errors: ["An email address is required."] };
  if (!i.address.recipient.trim() || !i.address.street.trim()) return { ok: false, errors: ["A complete delivery address is required."] };

  const user = i.userId;
  const redemptionsByCode: Record<string, number> = {};
  if (user && i.discountCode) redemptionsByCode[i.discountCode.trim().toUpperCase()] = db.redemptions.get(`${user}|${i.discountCode.trim().toUpperCase()}`) ?? 0;
  const zone = db.zones.get(i.zoneId);
  const priced = priceCart({ lines: i.lines, currency: i.currency, ...(i.discountCode ? { discountCode: i.discountCode } : {}) }, db.variants, {
    discounts: db.discounts, customer: { priorOrders: countPaidOrders(db, user), redemptionsByCode }, ...(zone ? { zone } : {}), region: i.region, now: new Date(now),
  });
  if (!priced.ok) return { ok: false, errors: priced.errors };
  const cart = priced.cart;
  if (cart.hasPreorder && !i.preorderAcknowledged) return { ok: false, errors: ["Please acknowledge the pre-order terms for pre-order items."] };

  // --- atomic section (single synchronous block; a SQL adapter wraps this in a transaction) ---
  for (const l of cart.lines) {
    const v = db.variants.get(l.variantId)!;
    if (l.mode === "stock" && v.trackInventory) v.reserved += l.qty;
    if (l.mode === "preorder" && v.preOrder) v.preOrder.sold = (v.preOrder.sold ?? 0) + l.qty;
  }
  const trackingSecret = randomToken(18);
  const id = db.nextId("ord");
  const order: OrderRow = {
    id, ref: `DDT-${id.slice(4, 10).toUpperCase()}`, ...(i.userId ? { userId: i.userId } : {}), ...(i.guestEmail ? { guestEmail: i.guestEmail.toLowerCase() } : {}),
    idempotencyKey: i.idempotencyKey, status: "pending_payment", currency: i.currency,
    subtotal: cart.subtotal.amount, discount: cart.discount.amount, shipping: cart.shipping.amount, total: cart.total.amount,
    ...(cart.appliedCode ? { discountCode: cart.appliedCode } : {}), address: i.address,
    items: cart.lines.map((l) => ({ variantId: l.variantId, name: l.name, sku: l.variantId.split("::")[1] ?? l.variantId, unit: l.unit.amount, qty: l.qty, line: l.line.amount, mode: l.mode })),
    hasPreorder: cart.hasPreorder, trackingSecretHash: await sha256Hex(trackingSecret), processedEvents: [],
    history: [{ from: null, to: "pending_payment", at: now }], reservedUntil: now + RESERVATION_MS, createdAt: now, refunded: 0,
  };
  db.orders.set(id, order);
  db.log("order.placed", { orderId: id, total: order.total, currency: order.currency });
  return { ok: true, order, trackingSecret, duplicate: false };
}

function releaseReservation(db: MemoryDb, o: OrderRow) {
  for (const it of o.items) {
    const v = db.variants.get(it.variantId); if (!v) continue;
    if (it.mode === "stock" && v.trackInventory) v.reserved = Math.max(0, v.reserved - it.qty);
    if (it.mode === "preorder" && v.preOrder) v.preOrder.sold = Math.max(0, (v.preOrder.sold ?? 0) - it.qty);
  }
}
const setStatus = (o: OrderRow, to: OrderStatus, actor?: string, note?: string, now = Date.now()) => {
  o.history.push({ from: o.status, to: transition(o.status, to), ...(actor ? { actor } : {}), ...(note ? { note } : {}), at: now }); o.status = to;
};

/** Unpaid orders past their reservation window are cancelled and stock is released (explicit timeout policy). */
export function releaseExpired(db: MemoryDb, now = Date.now()): number {
  let n = 0;
  for (const o of db.orders.values()) if (o.status === "pending_payment" && o.reservedUntil <= now) { releaseReservation(db, o); setStatus(o, "cancelled", undefined, "Payment window expired", now); n++; }
  return n;
}

/** Call ONLY after the provider signature has been verified. A browser redirect must never reach this. */
export function handleVerifiedPayment(db: MemoryDb, ev: PaymentEvent, now = Date.now()): { kind: "applied" | "duplicate" | "mismatch" | "ignored" | "review" } {
  const o = [...db.orders.values()].find((x) => x.ref === ev.orderRef);
  if (!o) return { kind: "mismatch" };
  const out = applyPaymentEvent({ ref: o.ref, total: o.total, currency: o.currency, status: o.status, processedEvents: o.processedEvents }, ev);
  if (out.kind !== "applied") return { kind: out.kind };
  const before = o.status;
  o.processedEvents = out.order.processedEvents;
  if (out.order.status === "payment_under_review") { if (before !== "payment_under_review") setStatus(o, "payment_under_review", undefined, "Amount/currency mismatch", now); db.log("payment.review", { orderId: o.id }); return { kind: "review" }; }
  // Paid: convert reservation into a committed stock deduction.
  for (const it of o.items) { const v = db.variants.get(it.variantId); if (v && it.mode === "stock" && v.trackInventory) { v.onHand = Math.max(0, v.onHand - it.qty); v.reserved = Math.max(0, v.reserved - it.qty); } }
  setStatus(o, "payment_confirmed", undefined, "Payment verified", now);
  if (o.userId && o.discountCode) db.redemptions.set(`${o.userId}|${o.discountCode}`, (db.redemptions.get(`${o.userId}|${o.discountCode}`) ?? 0) + 1);
  if (o.discountCode) { const d = db.discounts.get(o.discountCode); if (d) d.redeemed++; }
  db.log("payment.confirmed", { orderId: o.id });
  return { kind: "applied" };
}

/* ---------- reads: customers see only their own data; tracking needs the secret ---------- */
export function getOrderForCustomer(db: MemoryDb, actor: Actor | null, orderId: string): OrderRow | null {
  const o = db.orders.get(orderId);
  return actor && o && o.userId === actor.id ? o : null; // same answer for "missing" and "not yours" — no enumeration
}
export const listOrdersForCustomer = (db: MemoryDb, actor: Actor | null) => actor ? [...db.orders.values()].filter((o) => o.userId === actor.id) : [];

export async function trackOrder(db: MemoryDb, ref: string, secret: string) {
  const o = [...db.orders.values()].find((x) => x.ref === ref);
  const ok = !!o && timingSafeEqual(await sha256Hex(secret), o.trackingSecretHash);
  if (!ok || !o) return null;
  // Deliberately omits address, email, payment details.
  return { ref: o.ref, status: o.status, history: o.history.map((h) => ({ to: h.to, at: h.at })), hasPreorder: o.hasPreorder };
}

export function requestCancellation(db: MemoryDb, actor: Actor | null, orderId: string, now = Date.now()) {
  const o = getOrderForCustomer(db, actor, orderId);
  if (!o) return { ok: false as const, error: "Order not found." };
  if (o.status === "pending_payment") { releaseReservation(db, o); setStatus(o, "cancelled", actor!.id, "Customer cancelled", now); return { ok: true as const }; }
  if (!canTransition(o.status, "cancellation_requested")) return { ok: false as const, error: "This order can no longer be cancelled online." };
  setStatus(o, "cancellation_requested", actor!.id, "Customer request", now);
  return { ok: true as const };
}

/* ---------- staff operations ---------- */
export function staffUpdateStatus(db: MemoryDb, actor: Actor | null, orderId: string, to: OrderStatus, note?: string) {
  requirePermission(actor, "order.update");
  const o = db.orders.get(orderId); if (!o) throw new ValidationError(["Unknown order."]);
  if (to === "payment_confirmed") throw new ValidationError(["Payment can only be confirmed by a verified provider event."]);
  if (!canTransition(o.status, to)) throw new ValidationError([`An order cannot move from ${o.status} to ${to}.`]);
  const from = o.status; setStatus(o, to, actor.id, note);
  db.log("order.status_changed", { orderId, from, to }, actor.id);
}

export function requestRefund(db: MemoryDb, actor: Actor | null, orderId: string, amount: number, now = Date.now()) {
  requirePermission(actor, "order.refund", now);
  const o = db.orders.get(orderId); if (!o) throw new ValidationError(["Unknown order."]);
  if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError(["Invalid refund amount."]);
  if (o.refunded + amount > o.total) throw new ValidationError(["Refund exceeds the amount paid."]);
  if (!canTransition(o.status, "refund_pending") && o.status !== "refund_pending") throw new ValidationError(["This order is not refundable in its current state."]);
  if (o.status !== "refund_pending") setStatus(o, "refund_pending", actor.id, `Refund of ${money(amount, o.currency).amount} requested`, now);
  db.log("refund.requested", { orderId, amount, currency: o.currency }, actor.id); // refunds keep the order currency
  return { orderId, amount, currency: o.currency };
}
/** Called when the provider confirms the refund. */
export function completeRefund(db: MemoryDb, orderId: string, amount: number, now = Date.now()) {
  const o = db.orders.get(orderId); if (!o || o.status !== "refund_pending") throw new ValidationError(["No pending refund."]);
  o.refunded += amount;
  setStatus(o, o.refunded >= o.total ? "refunded" : "partially_refunded", undefined, "Refund completed", now);
  db.log("refund.completed", { orderId, amount }); 
}

/** Who may start a payment for an order: its signed-in owner, or a guest holding the one-time tracking code. Same answer for "no such order" and "not yours". */
export async function orderForPayment(db: MemoryDb, actor: Actor | null, ref: string, secret: string, now = Date.now()): Promise<{ order: OrderRow; email: string } | { error: string } | null> {
  const o = [...db.orders.values()].find((x) => x.ref === ref.trim().toUpperCase());
  if (!o) return null;
  const owner = !!actor && actor.kind === "customer" && o.userId === actor.id;
  if (!owner && !(secret && timingSafeEqual(await sha256Hex(secret), o.trackingSecretHash))) return null;
  if (o.status !== "pending_payment") return { error: "This order isn't waiting for payment." };
  if (o.reservedUntil <= now) return { error: "The payment window for this order has expired. Please place a new order." };
  const email = o.guestEmail ?? (o.userId ? db.users.get(o.userId)?.email : undefined);
  return email ? { order: o, email } : { error: "This order has no email address for the payment receipt." };
}
