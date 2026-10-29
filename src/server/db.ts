/**
 * Storage boundary. `MemoryDb` is the reference implementation used by tests and local dev.
 * Production swaps in a D1/Postgres adapter exposing the same shape; services never touch storage directly.
 * Mutations inside one synchronous block are atomic here; a SQL adapter must wrap the same blocks in a transaction.
 */
import type { CategoryNode } from "../lib/domain/categories";
import type { Discount, OrderStatus, ShippingZone, VariantRecord } from "../lib/domain/commerce";
import type { Currency } from "../lib/domain/money";
import type { PromoWindow } from "../lib/domain/status";
import type { Role } from "./rbac";

export interface ProductRow {
  id: string; slug: string; name: string; categoryId: string; shortDescription: string; description: string;
  image: string; imageAlt: string; promo: PromoWindow[]; showLimitedBelow?: number; expectedWindow?: string; attributes: Record<string, string>;
  createdAt: string; updatedAt: string; archived: boolean;
}
export interface UserRow { id: string; email: string; passwordHash: string; kind: "customer" | "staff"; roles: Role[]; status: "active" | "suspended" | "deleted"; emailVerified: boolean; failedLogins: number; lockedUntil: number; mfaRequired: boolean; createdAt: number }
export interface ProfileRow { userId: string; firstName: string; lastName: string; phone?: string; preferredCurrency?: Currency; marketingConsent: boolean }
export interface AddressRow { id: string; userId: string; recipient: string; region: string; city: string; street: string; phone?: string; isDefault: boolean }
export interface OrderItemRow { variantId: string; name: string; sku: string; unit: number; qty: number; line: number; mode: "stock" | "preorder" | "backorder" }
export interface OrderRow {
  id: string; ref: string; userId?: string; guestEmail?: string; idempotencyKey: string; status: OrderStatus; currency: Currency;
  subtotal: number; discount: number; shipping: number; total: number; discountCode?: string; address: { recipient: string; region: string; city: string; street: string; phone?: string };
  items: OrderItemRow[]; hasPreorder: boolean; trackingSecretHash: string; processedEvents: string[]; history: { from: OrderStatus | null; to: OrderStatus; actor?: string; at: number; note?: string }[];
  reservedUntil: number; createdAt: number; refunded: number;
}
export interface SessionRow { id: string; userId: string; expiresAt: number; revoked: boolean }
export interface TicketRow { id: string; userId?: string; email: string; subject: string; status: "open" | "pending" | "resolved"; priority: "low" | "normal" | "high"; messages: { author: string; internal: boolean; body: string; at: number }[]; createdAt: number }
export interface EventRow { session: string; kind: string; path?: string; source?: string; campaign?: string; orderRef?: string; at: number }
export interface PrivacyRequest { id: string; userId: string; kind: "export" | "deletion" | "correction"; status: "open" | "done"; at: number }
export interface AuditRow { id: number; actor?: string; event: string; detail: Record<string, string | number | boolean>; at: number }

export class MemoryDb {
  products = new Map<string, ProductRow>();
  variants = new Map<string, VariantRecord>();
  categories: CategoryNode[] = [];
  users = new Map<string, UserRow>();
  profiles = new Map<string, ProfileRow>();
  addresses = new Map<string, AddressRow>();
  orders = new Map<string, OrderRow>();
  sessions = new Map<string, SessionRow>();
  discounts = new Map<string, Discount>();
  zones = new Map<string, ShippingZone>();
  audit: AuditRow[] = [];
  tickets = new Map<string, TicketRow>();
  events: EventRow[] = [];
  wishlist = new Map<string, Set<string>>(); // userId -> productIds
  consents: { userId: string; kind: string; granted: boolean; policyVersion?: string; at: number }[] = [];
  privacy = new Map<string, PrivacyRequest>();
  tokens = new Map<string, { userId: string; kind: "verify" | "reset"; expiresAt: number }>();
  settings: Record<string, string> = { displayMode: "GHS" };
  adminSetupClosed = false;
  redemptions = new Map<string, number>(); // `${userId}|${code}`
  private seq = 0;
  nextId(prefix: string) { return `${prefix}_${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
  log(event: string, detail: Record<string, string | number | boolean> = {}, actor?: string) {
    this.audit.push({ id: this.audit.length + 1, ...(actor ? { actor } : {}), event, detail, at: Date.now() });
  }
}
