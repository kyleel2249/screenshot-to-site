import { canTransition, type OrderStatus } from "./domain/commerce";

export const ORDER_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment", payment_confirmed: "Payment confirmed", processing: "Being prepared", preparing_dispatch: "Preparing for dispatch",
  ready_for_pickup: "Ready for pickup", dispatched: "Dispatched", in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered",
  delivery_attempted: "Delivery attempted", returned: "Returned", cancellation_requested: "Cancellation requested", cancelled: "Cancelled",
  refund_pending: "Refund pending", partially_refunded: "Partially refunded", refunded: "Refunded", payment_under_review: "Payment under review",
};
export const ALL_STATUSES = Object.keys(ORDER_LABEL) as OrderStatus[];
export const labelOf = (s: string) => ORDER_LABEL[s as OrderStatus] ?? s;
/** Statuses an order may legally move to next (mirrors the server state machine; the server still enforces it). */
export const nextStatuses = (from: string) => ALL_STATUSES.filter((to) => canTransition(from as OrderStatus, to));
