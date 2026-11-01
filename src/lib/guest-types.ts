/**
 * Types shared by the guest-dashboard API (server) and its browser client. No server imports: safe to bundle for the browser.
 *
 * A guest is an ANONYMOUS browser session: a signed, expiring, HttpOnly cookie identifies a server-side record holding the
 * visitor's cart, saved items, comparison list, recently viewed products, preferences and the orders placed from it.
 * Nothing here is a login. Private order data is only ever reachable through the session that placed the order or a tracking code.
 */
import type { Availability } from "./domain/status";
import type { Currency } from "./domain/money";

export type DisplayChoice = "GHS" | "USD" | "DUAL";

export interface GuestPrefs {
  preferredName: string;
  email: string;
  phone: string;
  currency: DisplayChoice;
  region: string;
  /** Free-text interests the visitor chose (used only for their own recommendations). */
  interests: string[];
  notifyOrderUpdates: boolean;
  notifyBackInStock: boolean;
  /** Price-change alerts and marketing are opt-in: false until the visitor switches them on. */
  notifyPriceAlerts: boolean;
  notifyMarketing: boolean;
}
export const DEFAULT_GUEST_PREFS: GuestPrefs = {
  preferredName: "", email: "", phone: "", currency: "DUAL", region: "", interests: [],
  notifyOrderUpdates: true, notifyBackInStock: true, notifyPriceAlerts: false, notifyMarketing: false,
};

export interface GuestAddress { id: string; label: string; recipient: string; region: string; city: string; street: string; phone?: string }

/** Order summary safe to show to the session that placed it: no street address, email or phone. */
export interface GuestOrderSummary { ref: string; status: string; currency: Currency; total: number; createdAt: number; itemCount: number; hasPreorder: boolean; payBy: number | null }

export interface GuestState {
  /** Epoch ms when this anonymous session expires unless it is used again. */
  expiresAt: number;
  cart: { variantId: string; qty: number }[];
  /** Product slugs, newest first. Only publicly visible products are returned. */
  wishlist: string[];
  compare: string[];
  viewed: string[];
  searches: string[];
  addresses: GuestAddress[];
  prefs: GuestPrefs;
  orders: GuestOrderSummary[];
  unreadNotifications: number;
}

export interface QuoteLine { variantId: string; slug: string | null; name: string; qty: number; unit: number; line: number; mode: "stock" | "preorder" | "backorder" }
export interface CartQuote {
  currency: Currency; lines: QuoteLine[]; subtotal: number; discount: number; shipping: number; total: number;
  appliedCode: string | null; shippingEstimate: string | null; hasPreorder: boolean;
  /** The store has no tax or handling-fee configuration, so none is added. The total is what is charged. */
  taxesAndCharges: "none_configured";
}
export type QuoteResult = { ok: true; quote: CartQuote } | { ok: false; errors: string[] };

export interface OrderDetail {
  ref: string; status: string; createdAt: number; currency: Currency; subtotal: number; discount: number; shipping: number; total: number;
  paymentMethod: string | null; payBy: number | null; hasPreorder: boolean;
  items: { variantId: string; slug: string | null; image: string | null; name: string; qty: number; unit: number; line: number; mode: string }[];
  history: { to: string; at: number }[];
  /** Region and city only — never the street, phone or email. */
  destination: { region: string; city: string };
  /** Only present once staff have recorded it; nothing is invented. */
  shipment: { carrier?: string; trackingRef?: string; estimatedDelivery?: string } | null;
}

export type NotificationKind = "order_placed" | "payment_confirmed" | "shipment_update" | "delivered" | "order_status" | "refund_update" | "support_reply" | "wishlist_available" | "price_change";
export interface GuestNotification { id: string; kind: NotificationKind; title: string; body: string; at: number; orderRef?: string; slug?: string; /** True for alerts that describe current state rather than a dated event. */ standing?: boolean }

export const REQUEST_KINDS = ["cancellation", "return", "refund", "damaged", "incorrect", "complaint"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const REQUEST_KIND_LABEL: Record<RequestKind, string> = {
  cancellation: "Cancel an order", return: "Return an item", refund: "Request a refund", damaged: "Report a damaged product", incorrect: "Report an incorrect delivery", complaint: "Submit a complaint",
};
export interface ReturnRequestView { ref: string; kind: RequestKind; orderRef: string; productName: string | null; reason: string; description: string; createdAt: number; status: string; orderStatus: string; replies: { fromStaff: boolean; body: string; at: number }[] }

export const ENQUIRY_CATEGORIES = ["order", "product", "delivery", "returns", "payment", "other"] as const;
export type EnquiryCategory = (typeof ENQUIRY_CATEGORIES)[number];
export interface EnquiryView { ref: string; category: EnquiryCategory; subject: string; createdAt: number; status: string; messages: { fromStaff: boolean; body: string; at: number }[] }

export interface SaleInfo { slug: string; currency: Currency; original: number; sale: number; percentOff: number; startsAt: string | null; endsAt: string | null }
export interface RecSection { id: "for_you" | "similar" | "bought_together" | "trending" | "popular"; title: string; slugs: string[] }
export interface PublicDelivery { zones: { id: string; name: string; regions: string[]; currency: Currency; baseFee: number; estimate: string }[] }

export const GUEST_LIMITS = { cartLines: 50, qty: 99, compare: 4, viewed: 30, searches: 10, addresses: 5, wishlist: 200 } as const;

/** Statuses an order moves through while it is still "in progress" for the dashboard counters. */
export const COMPLETED_STATUSES = ["delivered"];
export const CLOSED_STATUSES = ["cancelled", "refunded", "returned"];
export type { Availability };
