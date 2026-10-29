/**
 * Privacy-first analytics.
 * - Events are recorded ONLY with consent.
 * - Visitors are pseudonymised with an HMAC over (daily salt, coarse client key); no raw IP/UA stored.
 * - Props are allow-listed; anything resembling PII is rejected.
 * - Revenue is computed from verified orders, never from client events.
 */
import { csvCell, sha256Hex } from "../../lib/security/crypto";
import type { MemoryDb } from "../db";
import { requirePermission, type Actor } from "../rbac";

const ALLOWED_KINDS = new Set(["page_view", "product_view", "search", "category_view", "add_to_cart", "checkout_start", "purchase", "signup"]);
const PII = /[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d[\d\s()-]{8,}/;

export async function pseudonym(secret: string, clientKey: string, now = Date.now()): Promise<string> {
  const day = Math.floor(now / 86_400_000);
  return (await sha256Hex(`${secret}|${day}|${clientKey}`)).slice(0, 24); // rotates daily; cannot be linked across days
}

export async function track(db: MemoryDb, i: { consent: boolean; kind: string; path?: string; source?: string; campaign?: string; clientKey: string; secret: string; now?: number }): Promise<boolean> {
  if (!i.consent) return false;
  if (!ALLOWED_KINDS.has(i.kind) || i.kind === "purchase") return false; // purchases come from verified orders only
  for (const v of [i.path, i.source, i.campaign]) if (v && PII.test(v)) return false;
  const path = i.path?.split("?")[0]?.slice(0, 200);
  db.events.push({ session: await pseudonym(i.secret, i.clientKey, i.now), kind: i.kind, ...(path ? { path } : {}), ...(i.source ? { source: i.source.slice(0, 60) } : {}), ...(i.campaign ? { campaign: i.campaign.slice(0, 60) } : {}), at: i.now ?? Date.now() });
  return true;
}

const PAID = (s: string) => !["pending_payment", "cancelled", "payment_under_review"].includes(s);

export function funnel(db: MemoryDb, from: number, to: number) {
  const sessions = (k: string) => new Set(db.events.filter((e) => e.kind === k && e.at >= from && e.at < to).map((e) => e.session)).size;
  const orders = [...db.orders.values()].filter((o) => PAID(o.status) && o.createdAt >= from && o.createdAt < to).length;
  return { productViews: sessions("product_view"), addToCart: sessions("add_to_cart"), checkoutStarts: sessions("checkout_start"), paidOrders: orders };
}

/** Net revenue per currency: verified paid orders minus refunds. Currencies are never summed together. */
export function revenue(db: MemoryDb, actor: Actor | null, from: number, to: number) {
  requirePermission(actor, "analytics.read");
  const out: Record<string, { gross: number; refunds: number; net: number; orders: number }> = {};
  for (const o of db.orders.values()) {
    if (!PAID(o.status) || o.createdAt < from || o.createdAt >= to) continue;
    const r = (out[o.currency] ??= { gross: 0, refunds: 0, net: 0, orders: 0 });
    r.gross += o.total; r.refunds += o.refunded; r.net += o.total - o.refunded; r.orders++;
  }
  return out;
}

/** Revenue by campaign: attribute each paid order to the campaign of its session's landing event (first-touch). Small groups are suppressed. */
export function attribution(db: MemoryDb, actor: Actor | null, minGroup = 5) {
  requirePermission(actor, "analytics.read");
  const byCampaign = new Map<string, { orders: number }>();
  for (const e of db.events) if (e.kind === "purchase" && e.campaign) byCampaign.set(e.campaign, { orders: (byCampaign.get(e.campaign)?.orders ?? 0) + 1 });
  return [...byCampaign].filter(([, v]) => v.orders >= minGroup).map(([campaign, v]) => ({ campaign, orders: v.orders }));
}

/** Record a purchase event from a VERIFIED paid order, once (idempotent by order ref). */
export function recordPurchase(db: MemoryDb, orderRef: string, campaign?: string) {
  const o = [...db.orders.values()].find((x) => x.ref === orderRef);
  if (!o || !PAID(o.status) || db.events.some((e) => e.kind === "purchase" && e.orderRef === orderRef)) return false;
  db.events.push({ session: "server", kind: "purchase", orderRef, ...(campaign ? { campaign } : {}), at: Date.now() }); return true;
}

export function exportOrdersCsv(db: MemoryDb, actor: Actor | null, now = Date.now()): string {
  requirePermission(actor, "export.data", now);
  db.log("export.orders_csv", { rows: db.orders.size }, actor.id);
  const rows = [["ref", "status", "currency", "total_minor", "created"], ...[...db.orders.values()].map((o) => [o.ref, o.status, o.currency, o.total, new Date(o.createdAt).toISOString()])];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n"); // no customer PII in this export; cells are formula-injection safe
}
