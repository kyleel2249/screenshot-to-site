/**
 * Suppliers and purchase orders. Costs are internal (never exposed publicly). Receiving stock goes through `adjustStock`,
 * so every unit that enters inventory is audited with the PO reference, and cannot exceed what was ordered.
 */
import type { MemoryDb, PurchaseOrderRow, SupplierRow } from "../db";
import { requirePermission, type Actor } from "../rbac";
import { adjustStock, ValidationError } from "./catalog-admin";

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);

export function listSuppliers(db: MemoryDb, actor: Actor | null) { requirePermission(actor, "product.write"); return [...db.suppliers.values()]; }
export function saveSupplier(db: MemoryDb, actor: Actor | null, raw: Record<string, unknown>): SupplierRow {
  requirePermission(actor, "product.write");
  const name = clip(raw["name"], 120), email = clip(raw["email"], 200);
  const errors: string[] = [];
  if (!name) errors.push("Supplier name is required.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Supplier email looks invalid.");
  const id = clip(raw["id"], 60);
  if (id && !db.suppliers.has(id)) errors.push("Unknown supplier.");
  if (errors.length) throw new ValidationError(errors);
  const row: SupplierRow = { id: id || db.nextId("sup"), name, contact: clip(raw["contact"], 120), email, phone: clip(raw["phone"], 40), country: clip(raw["country"], 60), notes: clip(raw["notes"], 1000), active: raw["active"] !== false };
  db.suppliers.set(row.id, row); db.log(id ? "supplier.updated" : "supplier.created", { supplierId: row.id }, actor.id);
  return row;
}

export function listPurchaseOrders(db: MemoryDb, actor: Actor | null) {
  requirePermission(actor, "product.write");
  return [...db.purchaseOrders.values()].sort((a, b) => b.createdAt - a.createdAt).map((po) => ({ ...po, supplier: db.suppliers.get(po.supplierId)?.name ?? "(removed)" }));
}
export function createPurchaseOrder(db: MemoryDb, actor: Actor | null, raw: Record<string, unknown>, now = Date.now()): PurchaseOrderRow {
  requirePermission(actor, "product.write");
  const errors: string[] = [];
  const sup = db.suppliers.get(clip(raw["supplierId"], 60));
  if (!sup || !sup.active) errors.push("Choose an active supplier.");
  const currency = clip(raw["currency"], 10).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.push("Enter a 3-letter currency code, e.g. USD, GHS, CNY.");
  const lines: PurchaseOrderRow["lines"] = [];
  const input = Array.isArray(raw["lines"]) ? raw["lines"].slice(0, 100) : [];
  if (!input.length) errors.push("Add at least one line.");
  for (const l of input) {
    const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const v = db.variants.get(clip(o["variantId"], 120)); const qty = int(o["qty"]), unitCost = int(o["unitCost"]);
    if (!v) { errors.push("A line references an unknown product."); continue; }
    if (!(qty >= 1 && qty <= 100000)) errors.push(`${v.name}: quantity must be 1–100,000.`);
    if (!(unitCost >= 0)) errors.push(`${v.name}: unit cost must be zero or more.`);
    if (lines.some((x) => x.variantId === v.id)) errors.push(`${v.name} appears twice; combine the lines.`);
    lines.push({ variantId: v.id, name: v.name, qty, unitCost, received: 0 });
  }
  const expectedAt = clip(raw["expectedAt"], 40); if (expectedAt && Number.isNaN(Date.parse(expectedAt))) errors.push("The expected date isn't valid.");
  if (errors.length) throw new ValidationError([...new Set(errors)]);
  const id = db.nextId("po"), ref = `PO-${id.slice(3, 9).toUpperCase()}`;
  const po: PurchaseOrderRow = { id, ref, supplierId: sup!.id, status: "draft", currency, lines, ...(expectedAt ? { expectedAt } : {}), notes: clip(raw["notes"], 1000), createdAt: now, receipts: [] };
  db.purchaseOrders.set(id, po); db.log("po.created", { ref }, actor.id);
  return po;
}
export function setPurchaseOrderStatus(db: MemoryDb, actor: Actor | null, id: string, to: unknown) {
  requirePermission(actor, "product.write");
  const po = db.purchaseOrders.get(id); if (!po) throw new ValidationError(["Unknown purchase order."]);
  if (to === "ordered" && po.status === "draft") po.status = "ordered";
  else if (to === "cancelled" && ["draft", "ordered"].includes(po.status) && po.lines.every((l) => l.received === 0)) po.status = "cancelled";
  else throw new ValidationError([`A ${po.status.replace("_", " ")} order can't be changed to ${String(to)}.`]);
  db.log(`po.${po.status}`, { ref: po.ref }, actor.id);
}
/** Receives goods. All-or-nothing: if any line is invalid, nothing is added to stock. */
export function receivePurchaseOrder(db: MemoryDb, actor: Actor | null, id: string, raw: unknown, now = Date.now()) {
  requirePermission(actor, "inventory.adjust"); requirePermission(actor, "product.write");
  const po = db.purchaseOrders.get(id); if (!po) throw new ValidationError(["Unknown purchase order."]);
  if (po.status !== "ordered" && po.status !== "partially_received") throw new ValidationError(["Only an ordered purchase order can receive stock."]);
  const lines = (Array.isArray(raw) ? raw : []).map((l) => { const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>; return { variantId: clip(o["variantId"], 120), qty: int(o["qty"]) }; }).filter((l) => l.qty !== 0);
  const errors: string[] = [];
  if (!lines.length) errors.push("Enter a received quantity for at least one line.");
  for (const l of lines) {
    const pl = po.lines.find((x) => x.variantId === l.variantId);
    if (!pl) errors.push("A received line isn't on this order.");
    else if (!(l.qty >= 1)) errors.push(`${pl.name}: received quantity must be 1 or more.`);
    else if (pl.received + l.qty > pl.qty) errors.push(`${pl.name}: only ${pl.qty - pl.received} still expected. Use a stock adjustment for any extra.`);
  }
  if (new Set(lines.map((l) => l.variantId)).size !== lines.length) errors.push("Each product can appear once per delivery.");
  if (errors.length) throw new ValidationError([...new Set(errors)]);
  for (const l of lines) { adjustStock(db, actor, l.variantId, l.qty, `Received on ${po.ref}`); po.lines.find((x) => x.variantId === l.variantId)!.received += l.qty; }
  po.receipts.push({ at: now, by: actor.id, lines });
  po.status = po.lines.every((l) => l.received >= l.qty) ? "received" : "partially_received";
  db.log("po.received", { ref: po.ref, units: lines.reduce((a, l) => a + l.qty, 0) }, actor.id);
}
