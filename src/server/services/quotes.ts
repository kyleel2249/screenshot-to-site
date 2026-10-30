/**
 * Wholesale quote requests. Prices are NEVER computed or implied automatically: a quote exists only when staff
 * type one in, with an expiry. Requesters follow up with a reference + one-time secret (no account needed).
 */
import { randomToken, sha256Hex, timingSafeEqual } from "../../lib/security/crypto";
import type { MemoryDb, QuoteRow } from "../db";
import { requirePermission, type Actor } from "../rbac";
import { ValidationError } from "./catalog-admin";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function requestQuote(db: MemoryDb, raw: Record<string, unknown>, now = Date.now()): Promise<{ ref: string; secret: string }> {
  const errors: string[] = [];
  const email = clip(raw["email"], 200).toLowerCase();
  if (!EMAIL.test(email)) errors.push("Enter a valid email address.");
  const contactName = clip(raw["contactName"], 120), business = clip(raw["business"], 160), region = clip(raw["region"], 60);
  if (!contactName) errors.push("Contact name is required.");
  if (!region) errors.push("Delivery region is required.");
  const phone = clip(raw["phone"], 30);
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) errors.push("Phone number looks invalid.");
  const items = (Array.isArray(raw["items"]) ? raw["items"] : []).slice(0, 30).map((i) => {
    const o = (i && typeof i === "object" ? i : {}) as Record<string, unknown>;
    return { description: clip(o["description"], 200), qty: typeof o["qty"] === "number" ? Math.trunc(o["qty"]) : 0 };
  });
  if (!items.length) errors.push("Add at least one item.");
  if (items.some((i) => !i.description || i.qty < 1 || i.qty > 100000)) errors.push("Every item needs a description and a quantity of 1 or more.");
  if (errors.length) throw new ValidationError(errors);
  const id = db.nextId("qte"), ref = `Q-${id.slice(4, 10).toUpperCase()}`, secret = randomToken();
  db.quotes.set(id, { id, ref, secretHash: await sha256Hex(secret), status: "new", business, contactName, email, ...(phone ? { phone } : {}), region, notes: clip(raw["notes"], 2000), items, createdAt: now });
  db.log("quote.requested", { ref });
  return { ref, secret };
}

const view = (q: QuoteRow, now: number) => ({ ref: q.ref, status: effectiveStatus(q, now), items: q.items, createdAt: q.createdAt, ...(q.quote ? { quote: { currency: q.quote.currency, total: q.quote.total, validUntil: q.quote.validUntil, message: q.quote.message } } : {}) });
export const effectiveStatus = (q: QuoteRow, now: number): QuoteRow["status"] => (q.status === "quoted" && q.quote && q.quote.validUntil < now ? "expired" : q.status);

export async function lookupQuote(db: MemoryDb, ref: string, secret: string, now = Date.now()) {
  const q = [...db.quotes.values()].find((x) => x.ref === ref.trim().toUpperCase());
  const ok = !!q && timingSafeEqual(await sha256Hex(secret.trim()), q.secretHash);
  return ok ? view(q!, now) : null; // identical result for unknown ref and wrong secret
}
/** The requester accepts or declines a live quote. */
export async function respondToQuote(db: MemoryDb, ref: string, secret: string, accept: boolean, now = Date.now()) {
  const found = await lookupQuote(db, ref, secret, now); if (!found) return null;
  const q = [...db.quotes.values()].find((x) => x.ref === found.ref)!;
  if (effectiveStatus(q, now) !== "quoted") throw new ValidationError(["This quote can no longer be accepted. Please contact us."]);
  q.status = accept ? "accepted" : "declined"; db.log(accept ? "quote.accepted" : "quote.declined", { ref: q.ref });
  return view(q, now);
}

export function listQuotes(db: MemoryDb, actor: Actor | null, now = Date.now()) {
  requirePermission(actor, "order.read");
  return [...db.quotes.values()].sort((a, b) => b.createdAt - a.createdAt).map((q) => ({ id: q.id, ref: q.ref, business: q.business, contactName: q.contactName, email: q.email, phone: q.phone ?? null, region: q.region, notes: q.notes, items: q.items, status: effectiveStatus(q, now), quote: q.quote ?? null, createdAt: q.createdAt }));
}
export function sendQuote(db: MemoryDb, actor: Actor | null, id: string, i: { currency: unknown; total: unknown; validDays: unknown; message: unknown }, now = Date.now()) {
  requirePermission(actor, "order.update");
  const q = db.quotes.get(id); if (!q) throw new ValidationError(["Unknown quote request."]);
  if (q.status === "accepted") throw new ValidationError(["This quote was already accepted."]);
  const errors: string[] = [];
  if (i.currency !== "GHS" && i.currency !== "USD") errors.push("Currency must be GHS or USD.");
  if (typeof i.total !== "number" || !Number.isInteger(i.total) || i.total <= 0) errors.push("Enter a total greater than zero.");
  if (typeof i.validDays !== "number" || !Number.isInteger(i.validDays) || i.validDays < 1 || i.validDays > 90) errors.push("Validity must be 1–90 days.");
  if (errors.length) throw new ValidationError(errors);
  q.quote = { currency: i.currency as "GHS" | "USD", total: i.total as number, validUntil: now + (i.validDays as number) * 86_400_000, message: clip(i.message, 2000), quotedAt: now };
  q.status = "quoted"; db.log("quote.sent", { ref: q.ref }, actor.id);
}
