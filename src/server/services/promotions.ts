import type { Discount, ShippingZone } from "../../lib/domain/commerce";
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
