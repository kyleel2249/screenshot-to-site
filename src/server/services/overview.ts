/**
 * The dashboard home: what needs attention right now. Every section is included only if the signed-in staff member holds the
 * permission that section needs, so a role never sees counts it couldn't open elsewhere.
 */
import type { MemoryDb } from "../db";
import type { Actor } from "../rbac";
import { can } from "../rbac";
import { preorderQueue } from "./orders";

export const LOW_STOCK_THRESHOLD = 5;
const PAID_NOT_PACKED = new Set(["payment_confirmed", "processing", "preparing_dispatch"]);
const NOT_REVENUE = new Set(["pending_payment", "cancelled", "payment_under_review"]);
const DAY = 86_400_000;

export function overview(db: MemoryDb, actor: Actor | null, now = Date.now()) {
  const a = actor as Actor;
  const out: Record<string, unknown> = {};
  if (can(a, "order.read")) {
    const orders = [...db.orders.values()];
    out["orders"] = {
      toFulfil: orders.filter((o) => PAID_NOT_PACKED.has(o.status)).length,
      awaitingPayment: orders.filter((o) => o.status === "pending_payment").length,
      bankTransfersToConfirm: orders.filter((o) => o.paymentMethod === "bank_transfer" && (o.status === "pending_payment" || o.status === "payment_under_review")).length,
      paymentsUnderReview: orders.filter((o) => o.status === "payment_under_review").length,
      cancellationRequests: orders.filter((o) => o.status === "cancellation_requested").length,
      refundsPending: orders.filter((o) => o.status === "refund_pending").length,
      preordersWaiting: preorderQueue(db, a).length,
      newQuotes: [...db.quotes.values()].filter((q) => q.status === "new").length,
    };
  }
  if (can(a, "product.read")) {
    const live = [...db.variants.values()].filter((v) => v.published && v.trackInventory && !v.allowBackorder);
    const free = (v: { onHand: number; reserved: number }) => v.onHand - v.reserved;
    out["stock"] = {
      outOfStock: live.filter((v) => free(v) <= 0).length,
      low: live.filter((v) => free(v) > 0 && free(v) <= LOW_STOCK_THRESHOLD).map((v) => ({ variantId: v.id, name: v.name, available: free(v) })).sort((x, y) => x.available - y.available).slice(0, 10),
      threshold: LOW_STOCK_THRESHOLD,
      incomingUnits: [...db.purchaseOrders.values()].filter((p) => p.status === "ordered" || p.status === "partially_received").reduce((n, p) => n + p.lines.reduce((m, l) => m + Math.max(0, l.qty - l.received), 0), 0),
    };
  }
  if (can(a, "content.write")) out["reviewsToModerate"] = [...db.reviews.values()].filter((r) => r.status === "pending").length;
  if (can(a, "customer.support")) out["openTickets"] = [...db.tickets.values()].filter((t) => t.status !== "resolved").length;
  if (can(a, "analytics.read")) {
    const sum = (days: number) => {
      const by: Record<string, { orders: number; revenue: number }> = {};
      for (const o of db.orders.values()) {
        if (NOT_REVENUE.has(o.status) || o.createdAt < now - days * DAY) continue;
        const r = (by[o.currency] ??= { orders: 0, revenue: 0 }); r.orders++; r.revenue += o.total - o.refunded;
      }
      return by;
    };
    out["sales"] = { last7Days: sum(7), last30Days: sum(30) };
  }
  return out;
}
