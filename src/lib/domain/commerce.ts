/**
 * Server-authoritative commerce logic: pricing a cart, discounts, shipping, order state machine.
 * Client-submitted prices/totals are never trusted — callers pass only {variantId, qty} and codes.
 */
import { canPurchase, type Sellable } from "./status";
import { money, add, subtract, multiply, percentOf, type Currency, type Money } from "./money";

export interface VariantRecord extends Sellable {
  id: string;
  productId: string;
  name: string;
  /** Integer minor units per currency. Missing currency = not sellable in it. */
  price: Partial<Record<Currency, number>>;
  salePrice?: Partial<Record<Currency, number>>;
  saleStartsAt?: string;
  saleEndsAt?: string;
  weightGrams: number;
  categoryIds: string[];
}

export const activeUnitPrice = (v: VariantRecord, currency: Currency, now = new Date()): Money | null => {
  const base = v.price[currency];
  if (base === undefined) return null;
  const sale = v.salePrice?.[currency];
  const inWindow = (!v.saleStartsAt || new Date(v.saleStartsAt) <= now) && (!v.saleEndsAt || new Date(v.saleEndsAt) >= now);
  if (sale !== undefined && inWindow && sale < base) return money(sale, currency);
  return money(base, currency);
};

export interface Discount {
  code: string;
  kind: "percent" | "fixed" | "free_shipping";
  value: number; // bps for percent, minor units for fixed
  currency?: Currency; // required for fixed
  startsAt?: string;
  endsAt?: string;
  minSubtotal?: number;
  maxRedemptions?: number;
  redeemed: number;
  perCustomerLimit?: number;
  eligibleCategoryIds?: string[];
  eligibleCurrencies?: Currency[];
  firstPurchaseOnly?: boolean;
  active: boolean;
}

export interface CartInput { lines: { variantId: string; qty: number }[]; currency: Currency; discountCode?: string }
export interface Customer { id?: string; priorOrders: number; redemptionsByCode: Record<string, number> }
export interface ShippingZone {
  id: string; name: string; regions: string[]; currency: Currency;
  baseFee: number; perKgFee: number; freeOver?: number; estimate: string; quotationOnly?: boolean;
}

export interface PricedLine { variantId: string; name: string; qty: number; unit: Money; line: Money; mode: "stock" | "preorder" | "backorder" }
export interface PricedCart {
  currency: Currency; lines: PricedLine[]; subtotal: Money; discount: Money; shipping: Money; total: Money;
  hasPreorder: boolean; shippingEstimate?: string | undefined; appliedCode?: string | undefined;
}
export type PriceResult = { ok: true; cart: PricedCart } | { ok: false; errors: string[] };

export function validateDiscount(d: Discount | undefined, cart: { subtotal: Money; categoryIds: string[] }, customer: Customer, now = new Date()): { ok: true; discount: Discount } | { ok: false; reason: string } {
  if (!d || !d.active) return { ok: false, reason: "Invalid discount code." };
  if (d.startsAt && new Date(d.startsAt) > now) return { ok: false, reason: "This code is not active yet." };
  if (d.endsAt && new Date(d.endsAt) < now) return { ok: false, reason: "This code has expired." };
  if (d.maxRedemptions !== undefined && d.redeemed >= d.maxRedemptions) return { ok: false, reason: "This code has reached its redemption limit." };
  if (d.perCustomerLimit !== undefined && (customer.redemptionsByCode[d.code] ?? 0) >= d.perCustomerLimit) return { ok: false, reason: "You have already used this code." };
  if (d.firstPurchaseOnly && customer.priorOrders > 0) return { ok: false, reason: "This code is for first purchases only." };
  if (d.eligibleCurrencies && !d.eligibleCurrencies.includes(cart.subtotal.currency)) return { ok: false, reason: "This code is not valid in the selected currency." };
  if (d.minSubtotal !== undefined && cart.subtotal.amount < d.minSubtotal) return { ok: false, reason: "Minimum order value not reached." };
  if (d.eligibleCategoryIds && !cart.categoryIds.some((c) => d.eligibleCategoryIds!.includes(c))) return { ok: false, reason: "No eligible items in your cart." };
  if (d.kind === "fixed" && d.currency !== cart.subtotal.currency) return { ok: false, reason: "This code is not valid in the selected currency." };
  return { ok: true, discount: d };
}

export function quoteShipping(zone: ShippingZone | undefined, region: string, currency: Currency, subtotal: Money, weightGrams: number): { fee: Money; estimate: string } | { error: string } {
  if (!zone || !zone.regions.includes(region)) return { error: "We do not currently deliver to this location." };
  if (zone.quotationOnly) return { error: "Delivery to this area is by quotation. Please contact us." };
  if (zone.currency !== currency) return { error: "Shipping is not configured in the selected currency." };
  if (zone.freeOver !== undefined && subtotal.amount >= zone.freeOver) return { fee: money(0, currency), estimate: zone.estimate };
  const kg = Math.ceil(weightGrams / 1000);
  return { fee: money(zone.baseFee + zone.perKgFee * kg, currency), estimate: zone.estimate };
}

/** Prices a cart from authoritative records. Fails closed on any unpurchasable line. */
export function priceCart(input: CartInput, variants: Map<string, VariantRecord>, opts: { discounts?: Map<string, Discount>; customer?: Customer; zone?: ShippingZone; region?: string; now?: Date }): PriceResult {
  const now = opts.now ?? new Date();
  const errors: string[] = [];
  const lines: PricedLine[] = [];
  let subtotal = money(0, input.currency);
  let weight = 0;
  const categoryIds: string[] = [];
  if (input.lines.length === 0) return { ok: false, errors: ["Your cart is empty."] };
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (seen.has(l.variantId)) { errors.push("Duplicate cart line."); continue; }
    seen.add(l.variantId);
    const v = variants.get(l.variantId);
    if (!v) { errors.push("A product in your cart no longer exists."); continue; }
    const decision = canPurchase(v, l.qty, now);
    if (!decision.ok) { errors.push(`${v.name}: ${decision.reason}`); continue; }
    const unit = activeUnitPrice(v, input.currency, now);
    if (!unit) { errors.push(`${v.name}: not sold in ${input.currency}.`); continue; }
    const line = multiply(unit, l.qty);
    subtotal = add(subtotal, line);
    weight += v.weightGrams * l.qty;
    categoryIds.push(...v.categoryIds);
    lines.push({ variantId: v.id, name: v.name, qty: l.qty, unit, line, mode: decision.mode });
  }
  if (errors.length) return { ok: false, errors };

  let discount = money(0, input.currency);
  let freeShipping = false;
  let applied: string | undefined;
  if (input.discountCode) {
    const code = input.discountCode.trim().toUpperCase();
    const res = validateDiscount(opts.discounts?.get(code), { subtotal, categoryIds }, opts.customer ?? { priorOrders: 0, redemptionsByCode: {} }, now);
    if (!res.ok) return { ok: false, errors: [res.reason] };
    applied = code;
    if (res.discount.kind === "percent") discount = percentOf(subtotal, res.discount.value);
    else if (res.discount.kind === "fixed") discount = money(Math.min(res.discount.value, subtotal.amount), input.currency);
    else freeShipping = true;
    if (discount.amount > subtotal.amount) discount = subtotal;
  }

  let shipping = money(0, input.currency);
  let estimate: string | undefined;
  if (opts.zone && opts.region) {
    const q = quoteShipping(opts.zone, opts.region, input.currency, subtract(subtotal, discount), weight);
    if ("error" in q) return { ok: false, errors: [q.error] };
    shipping = freeShipping ? money(0, input.currency) : q.fee;
    estimate = q.estimate;
  }
  const total = add(subtract(subtotal, discount), shipping);
  return { ok: true, cart: { currency: input.currency, lines, subtotal, discount, shipping, total, hasPreorder: lines.some((l) => l.mode === "preorder"), shippingEstimate: estimate, appliedCode: applied } };
}

/* ---------------------------- Order state machine ---------------------------- */

export type OrderStatus =
  | "pending_payment" | "payment_confirmed" | "processing" | "preparing_dispatch" | "ready_for_pickup"
  | "dispatched" | "in_transit" | "out_for_delivery" | "delivered" | "delivery_attempted" | "returned"
  | "cancellation_requested" | "cancelled" | "refund_pending" | "partially_refunded" | "refunded" | "payment_under_review";

const T: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["payment_confirmed", "cancelled", "payment_under_review"],
  payment_under_review: ["payment_confirmed", "cancelled"],
  payment_confirmed: ["processing", "cancellation_requested", "refund_pending"],
  processing: ["preparing_dispatch", "cancellation_requested", "refund_pending"],
  preparing_dispatch: ["dispatched", "ready_for_pickup", "cancellation_requested"],
  ready_for_pickup: ["delivered", "refund_pending"],
  dispatched: ["in_transit", "out_for_delivery", "delivery_attempted"],
  in_transit: ["out_for_delivery", "delivery_attempted", "delivered"],
  out_for_delivery: ["delivered", "delivery_attempted"],
  delivery_attempted: ["out_for_delivery", "returned", "delivered"],
  delivered: ["returned", "refund_pending"],
  returned: ["refund_pending"],
  cancellation_requested: ["cancelled", "processing", "refund_pending"],
  cancelled: [],
  refund_pending: ["partially_refunded", "refunded"],
  partially_refunded: ["refunded", "refund_pending"],
  refunded: [],
};
export const canTransition = (from: OrderStatus, to: OrderStatus) => T[from].includes(to);
export function transition(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (!canTransition(from, to)) throw new Error(`Invalid order transition ${from} -> ${to}`);
  return to;
}
/** Customers may only ever request a cancellation; they can never set arbitrary states. */
export const CUSTOMER_ALLOWED: OrderStatus[] = ["cancellation_requested"];

/* ---------------------------- Payments (idempotent webhook handling) ---------------------------- */

export interface PaymentEvent { eventId: string; orderRef: string; amount: number; currency: Currency; status: "success" | "failed"; channel?: string }
export interface OrderPaymentView { ref: string; total: number; currency: Currency; status: OrderStatus; processedEvents: string[] }

export type WebhookOutcome = { kind: "applied"; order: OrderPaymentView } | { kind: "duplicate" } | { kind: "mismatch"; reason: string } | { kind: "ignored" };

/**
 * Applies a provider event that has ALREADY passed signature verification.
 * Duplicate events are no-ops; amount/currency mismatches are routed to manual review, never marked paid.
 */
export function applyPaymentEvent(order: OrderPaymentView, ev: PaymentEvent): WebhookOutcome {
  if (order.processedEvents.includes(ev.eventId)) return { kind: "duplicate" };
  if (ev.orderRef !== order.ref) return { kind: "mismatch", reason: "Order reference mismatch" };
  if (ev.status === "failed") return { kind: "ignored" };
  if (ev.amount !== order.total || ev.currency !== order.currency) {
    return { kind: "applied", order: { ...order, status: canTransition(order.status, "payment_under_review") ? "payment_under_review" : order.status, processedEvents: [...order.processedEvents, ev.eventId] } };
  }
  if (order.status !== "pending_payment" && order.status !== "payment_under_review") return { kind: "ignored" };
  return { kind: "applied", order: { ...order, status: transition(order.status, "payment_confirmed"), processedEvents: [...order.processedEvents, ev.eventId] } };
}
