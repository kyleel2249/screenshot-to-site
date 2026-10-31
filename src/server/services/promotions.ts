import type { Discount, ShippingZone } from "../../lib/domain/commerce";
import { GHANA_REGIONS } from "../../lib/domain/regions";
import type { MemoryDb } from "../db";
import { requirePermission, type Actor } from "../rbac";
import { ValidationError } from "./catalog-admin";

export function upsertDiscount(db: MemoryDb, actor: Actor | null, d: Omit<Discount, "redeemed"> & { redeemed?: number }) {
  requirePermission(actor, "discount.write");
  const errors: string[] = [];
  const code = d.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) errors.push("Code must be 3–32 letters, numbers, - or _.");
  if (d.kind === "percent" && !(Number.isInteger(d.value) && d.value > 0 && d.value <= 10000)) errors.push("Percent must be 0.01%–100% (basis points).");
  if (d.kind === "fixed" && (!(Number.isInteger(d.value) && d.value > 0) || !d.currency)) errors.push("Fixed discounts need a positive amount and a currency.");
  if (d.startsAt && d.endsAt && new Date(d.startsAt) >= new Date(d.endsAt)) errors.push("Start must be before end.");
  if (errors.length) throw new ValidationError(errors);
  const prev = db.discounts.get(code);
  db.discounts.set(code, { ...d, code, redeemed: prev?.redeemed ?? d.redeemed ?? 0 });
  db.log(prev ? "discount.updated" : "discount.created", { code }, actor.id);
}
export function setDiscountActive(db: MemoryDb, actor: Actor | null, code: string, active: boolean) {
  requirePermission(actor, "discount.write");
  const d = db.discounts.get(code.toUpperCase()); if (!d) throw new ValidationError(["Unknown code."]);
  d.active = active; db.log("discount.toggled", { code: d.code, active }, actor.id);
}

export function upsertZone(db: MemoryDb, actor: Actor | null, z: ShippingZone) {
  requirePermission(actor, "shipping.write");
  const errors: string[] = [];
  if (!z.name.trim() || z.regions.length === 0) errors.push("Name and at least one region are required.");
  for (const [k, n] of [["base fee", z.baseFee], ["per-kg fee", z.perKgFee], ["free-over", z.freeOver]] as const) if (n !== undefined && !(Number.isInteger(n) && n >= 0)) errors.push(`${k} must be a non-negative integer in minor units.`);
  if (!z.estimate.trim()) errors.push("An estimate label is required (shown to customers as an estimate).");
  if (errors.length) throw new ValidationError(errors);
  db.zones.set(z.id, z); db.log("shipping.zone_saved", { zone: z.id }, actor.id);
}

const isCur = (c: unknown): c is "GHS" | "USD" => c === "GHS" || c === "USD";
const optInt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined);
const optStr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Builds a ShippingZone from untrusted input; only known fields and types survive. */
export function saveZone(db: MemoryDb, actor: Actor | null, raw: Record<string, unknown>): ShippingZone {
  requirePermission(actor, "shipping.write");
  const errors: string[] = [];
  const regions = Array.isArray(raw["regions"]) ? [...new Set((raw["regions"] as unknown[]).filter((r): r is string => typeof r === "string"))] : [];
  for (const r of regions) if (!(GHANA_REGIONS as readonly string[]).includes(r)) errors.push(`Unknown region: ${r}.`);
  if (!isCur(raw["currency"])) errors.push("Currency must be GHS or USD.");
  const id = optStr(raw["id"]);
  if (id && !db.zones.has(id)) errors.push("Unknown zone.");
  if (errors.length) throw new ValidationError(errors);
  const freeOver = optInt(raw["freeOver"]);
  const zone: ShippingZone = {
    id: id ?? db.nextId("zone"), name: typeof raw["name"] === "string" ? raw["name"].trim() : "", regions, currency: raw["currency"] as "GHS" | "USD",
    baseFee: optInt(raw["baseFee"]) ?? -1, perKgFee: optInt(raw["perKgFee"]) ?? 0, estimate: typeof raw["estimate"] === "string" ? raw["estimate"].trim() : "",
    ...(freeOver !== undefined ? { freeOver } : {}), ...(raw["quotationOnly"] === true ? { quotationOnly: true } : {}),
  };
  upsertZone(db, actor, zone);
  return zone;
}
export function deleteZone(db: MemoryDb, actor: Actor | null, id: string) {
  requirePermission(actor, "shipping.write");
  if (!db.zones.delete(id)) throw new ValidationError(["Unknown zone."]);
  db.log("shipping.zone_deleted", { zone: id }, actor.id);
}
export function listZones(db: MemoryDb, actor: Actor | null) { requirePermission(actor, "shipping.write"); return [...db.zones.values()]; }
export function listDiscounts(db: MemoryDb, actor: Actor | null) { requirePermission(actor, "discount.write"); return [...db.discounts.values()]; }

/** Builds a Discount from untrusted input (redemption count is server-owned and never taken from the client). */
export function saveDiscount(db: MemoryDb, actor: Actor | null, raw: Record<string, unknown>): Discount {
  requirePermission(actor, "discount.write");
  const kind = raw["kind"];
  if (kind !== "percent" && kind !== "fixed" && kind !== "free_shipping") throw new ValidationError(["Choose a discount type."]);
  const currency = isCur(raw["currency"]) ? raw["currency"] : undefined;
  const startsAt = optStr(raw["startsAt"]), endsAt = optStr(raw["endsAt"]);
  for (const [k, v] of [["start", startsAt], ["end", endsAt]] as const) if (v && Number.isNaN(Date.parse(v))) throw new ValidationError([`The ${k} date is not valid.`]);
  const minSubtotal = optInt(raw["minSubtotal"]), maxRedemptions = optInt(raw["maxRedemptions"]), perCustomerLimit = optInt(raw["perCustomerLimit"]);
  const d: Omit<Discount, "redeemed"> = {
    code: typeof raw["code"] === "string" ? raw["code"] : "", kind, value: optInt(raw["value"]) ?? 0, active: raw["active"] !== false,
    ...(currency ? { currency } : {}), ...(startsAt ? { startsAt } : {}), ...(endsAt ? { endsAt } : {}),
    ...(minSubtotal !== undefined ? { minSubtotal } : {}), ...(maxRedemptions !== undefined ? { maxRedemptions } : {}), ...(perCustomerLimit !== undefined ? { perCustomerLimit } : {}),
    ...(raw["firstPurchaseOnly"] === true ? { firstPurchaseOnly: true } : {}),
  };
  upsertDiscount(db, actor, d);
  return db.discounts.get(d.code.trim().toUpperCase())!;
}
