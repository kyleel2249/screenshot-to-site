import type { Currency } from "../../lib/domain/money";
import type { AddressRow, MemoryDb } from "../db";
import { requirePermission, type Actor } from "../rbac";
import { revokeAllSessions } from "./auth";

const own = (actor: Actor | null): Actor => { if (!actor || actor.kind !== "customer") throw new Error("Not signed in"); return actor; };

export function getProfile(db: MemoryDb, actor: Actor | null) {
  const a = own(actor); const p = db.profiles.get(a.id), u = db.users.get(a.id);
  return p && u ? { ...p, email: u.email, emailVerified: u.emailVerified } : null; // never includes hashes or tokens
}

export function updateProfile(db: MemoryDb, actor: Actor | null, patch: { firstName?: string; lastName?: string; phone?: string; preferredCurrency?: Currency }) {
  const a = own(actor); const p = db.profiles.get(a.id); if (!p) throw new Error("No profile");
  if (patch.preferredCurrency && patch.preferredCurrency !== "GHS" && patch.preferredCurrency !== "USD") throw new Error("Unsupported currency");
  if (patch.phone !== undefined && !/^\+?[0-9 ()-]{7,20}$/.test(patch.phone)) throw new Error("Invalid phone number");
  // Email and security fields are intentionally NOT editable here (they require a verification flow).
  Object.assign(p, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
}

export function setMarketingConsent(db: MemoryDb, actor: Actor | null, granted: boolean, policyVersion?: string) {
  const a = own(actor); const p = db.profiles.get(a.id); if (!p) throw new Error("No profile");
  p.marketingConsent = granted;
  db.consents.push({ userId: a.id, kind: "marketing", granted, ...(policyVersion ? { policyVersion } : {}), at: Date.now() });
}

export function addAddress(db: MemoryDb, actor: Actor | null, a: Omit<AddressRow, "id" | "userId" | "isDefault"> & { makeDefault?: boolean }): AddressRow {
  const me = own(actor);
  if (!a.recipient.trim() || !a.street.trim() || !a.city.trim() || !a.region.trim()) throw new Error("Complete address required");
  const mine = [...db.addresses.values()].filter((x) => x.userId === me.id);
  const isDefault = a.makeDefault === true || mine.length === 0;
  if (isDefault) for (const x of mine) x.isDefault = false;
  const { makeDefault: _m, ...rest } = a; void _m;
  const row: AddressRow = { ...rest, id: db.nextId("adr"), userId: me.id, isDefault };
  db.addresses.set(row.id, row); return row;
}
/** IDOR-safe: addresses belonging to someone else behave exactly like missing ones. */
const ownedAddress = (db: MemoryDb, me: Actor, id: string) => { const x = db.addresses.get(id); return x && x.userId === me.id ? x : undefined; };
export function editAddress(db: MemoryDb, actor: Actor | null, id: string, patch: Partial<Pick<AddressRow, "recipient" | "region" | "city" | "street" | "phone">>) {
  const x = ownedAddress(db, own(actor), id); if (!x) throw new Error("Address not found"); Object.assign(x, patch);
}
export function removeAddress(db: MemoryDb, actor: Actor | null, id: string) {
  const me = own(actor), x = ownedAddress(db, me, id); if (!x) throw new Error("Address not found");
  db.addresses.delete(id);
  if (x.isDefault) { const next = [...db.addresses.values()].find((y) => y.userId === me.id); if (next) next.isDefault = true; }
}
export function setDefaultAddress(db: MemoryDb, actor: Actor | null, id: string) {
  const me = own(actor), x = ownedAddress(db, me, id); if (!x) throw new Error("Address not found");
  for (const y of db.addresses.values()) if (y.userId === me.id) y.isDefault = false; x.isDefault = true;
}
export const listAddresses = (db: MemoryDb, actor: Actor | null) => [...db.addresses.values()].filter((x) => x.userId === own(actor).id);

export function toggleWishlist(db: MemoryDb, actor: Actor | null, productId: string): boolean {
  const me = own(actor); if (!db.products.has(productId)) throw new Error("Unknown product");
  const set = db.wishlist.get(me.id) ?? new Set<string>(); db.wishlist.set(me.id, set);
  if (set.has(productId)) { set.delete(productId); return false; } set.add(productId); return true;
}

/** Self-service data export: the customer's own data only, never credentials. */
export function exportMyData(db: MemoryDb, actor: Actor | null) {
  const me = own(actor);
  db.privacy.set(db.nextId("prv"), { id: "", userId: me.id, kind: "export", status: "done", at: Date.now() });
  db.log("privacy.export", { userId: me.id });
  return { profile: getProfile(db, me), addresses: listAddresses(db, me), wishlist: [...(db.wishlist.get(me.id) ?? [])], consents: db.consents.filter((c) => c.userId === me.id),
    reviews: [...db.reviews.values()].filter((r) => r.userId === me.id).map((r) => ({ product: db.products.get(r.productId)?.name ?? "", rating: r.rating, title: r.title, body: r.body, status: r.status })),
    orders: [...db.orders.values()].filter((o) => o.userId === me.id).map((o) => ({ ref: o.ref, status: o.status, currency: o.currency, total: o.total, items: o.items.map((i) => ({ name: i.name, qty: i.qty, line: i.line })) })) };
}

/**
 * Deletion = anonymise. Orders are retained (tax/accounting) but detached from identity; credentials, profile,
 * addresses, wishlist are erased and all sessions revoked.
 */
export function deleteMyAccount(db: MemoryDb, actor: Actor | null) {
  const me = own(actor), u = db.users.get(me.id); if (!u) return;
  for (const [id, r] of db.reviews) if (r.userId === me.id) db.reviews.delete(id); // reviews are personal content: erased with the account
  for (const o of db.orders.values()) if (o.userId === me.id) { delete o.userId; delete o.guestEmail; o.address = { recipient: "Deleted customer", region: o.address.region, city: "", street: "" }; }
  for (const [k, a] of db.addresses) if (a.userId === me.id) db.addresses.delete(k);
  db.profiles.delete(me.id); db.wishlist.delete(me.id);
  revokeAllSessions(db, me.id);
  u.email = `deleted+${me.id}@invalid`; u.passwordHash = "!"; u.status = "deleted"; u.emailVerified = false;
  db.log("privacy.account_deleted", { userId: me.id });
}

/** Staff view: only what support legitimately needs. Access to personal data is audited. No credentials, ever. */
export function staffViewCustomer(db: MemoryDb, actor: Actor | null, userId: string) {
  requirePermission(actor, "customer.read");
  const u = db.users.get(userId), p = db.profiles.get(userId); if (!u || u.kind !== "customer") return null;
  db.log("customer.viewed_by_staff", { userId }, actor.id);
  const orders = [...db.orders.values()].filter((o) => o.userId === userId);
  return { id: u.id, email: u.email, status: u.status, emailVerified: u.emailVerified, name: p ? `${p.firstName} ${p.lastName}` : "", orders: orders.length, spent: orders.filter((o) => !["pending_payment", "cancelled"].includes(o.status)).reduce((s, o) => s + o.total, 0) };
}
