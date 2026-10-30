/**
 * Bulk product import from CSV, so the owner can load the real catalogue instead of typing items one by one.
 * Columns (header row required, any order): name, sku, category, price_ghs, price_usd, stock, short_description, description, image, image_alt,
 * weight_grams, availability, expected_window, published, plus optional attr_<key> columns for the category's filter details.
 * Prices are written in normal money units (12.50). All-or-nothing: if any row is invalid nothing is created and every problem is listed with its row number.
 */
import { parseCsv } from "../../lib/csv";
import type { Availability } from "../../lib/domain/status";
import type { MemoryDb } from "../db";
import { requirePermission, type Actor } from "../rbac";
import { createProduct, ValidationError, type NewProduct } from "./catalog-admin";

export const IMPORT_MAX_ROWS = 500, IMPORT_MAX_BYTES = 1_000_000;
const AVAIL: Record<string, Availability> = { available: "available", "in stock": "available", pre_order: "pre_order", "pre-order": "pre_order", preorder: "pre_order", coming_soon: "coming_soon", "coming soon": "coming_soon", out_of_stock: "out_of_stock", "out of stock": "out_of_stock" };
const money = (v: string) => { const t = v.trim().replace(/^(GHS|GH₵|₵|USD|\$)\s*/i, "").replace(/,/g, ""); return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : NaN; };
const bool = (v: string) => /^(1|true|yes|y)$/i.test(v.trim());


export function importProducts(db: MemoryDb, actor: Actor | null, csv: unknown, dryRun: boolean) {
  requirePermission(actor, "product.write");
  if (typeof csv !== "string" || !csv.trim()) throw new ValidationError(["Choose a CSV file with a header row and at least one product."]);
  if (new TextEncoder().encode(csv).length > IMPORT_MAX_BYTES) throw new ValidationError(["The file is too large (1 MB maximum). Split it into smaller files."]);
  let rows: string[][]; try { rows = parseCsv(csv); } catch (e) { throw new ValidationError([(e as Error).message]); }
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  if (!rows.length) throw new ValidationError(["The file has a header row but no products."]);
  if (rows.length > IMPORT_MAX_ROWS) throw new ValidationError([`Too many rows (${IMPORT_MAX_ROWS} maximum per file).`]);
  for (const need of ["name", "sku", "category", "short_description", "image", "image_alt"]) if (!header.includes(need)) throw new ValidationError([`The header row must include a "${need}" column.`]);
  if (!header.includes("price_ghs") && !header.includes("price_usd")) throw new ValidationError(['Include a "price_ghs" and/or "price_usd" column.']);
  const col = (r: string[], k: string) => { const i = header.indexOf(k); return i < 0 ? "" : (r[i] ?? "").trim(); };
  const catByKey = new Map<string, string>();
  for (const c of db.categories) { catByKey.set(c.id.toLowerCase(), c.id); catByKey.set(c.slug.toLowerCase(), c.id); }
  const byName = new Map<string, string[]>(); for (const c of db.categories) { const k = c.name.toLowerCase(); byName.set(k, [...(byName.get(k) ?? []), c.id]); }
  const existing = new Set([...db.variants.values()].map((v) => (v.id.split("::")[1] ?? "").toLowerCase()));
  const errors: string[] = [], seen = new Set<string>(), inputs: { row: number; input: NewProduct }[] = [];
  rows.forEach((r, idx) => {
    const n = idx + 2, bad = (m: string) => errors.push(`Row ${n}: ${m}`);
    const sku = col(r, "sku"), cat = col(r, "category").toLowerCase();
    if (!sku) return bad("sku is required."); if (seen.has(sku.toLowerCase())) return bad(`sku "${sku}" appears more than once in the file.`); seen.add(sku.toLowerCase()); if (existing.has(sku.toLowerCase())) return bad(`SKU "${sku}" already exists in your catalogue.`);
    let categoryId = catByKey.get(cat); if (!categoryId) { const named = byName.get(cat); if (named?.length === 1) categoryId = named[0]; else if (named && named.length > 1) return bad(`category "${col(r, "category")}" matches several categories; use its id or slug.`); }
    if (!categoryId) return bad(`unknown category "${col(r, "category")}". Use the category's name, slug or id.`);
    const input: NewProduct = { name: col(r, "name"), sku, categoryId, shortDescription: col(r, "short_description"), image: col(r, "image"), imageAlt: col(r, "image_alt") };
    const ghs = col(r, "price_ghs"), usd = col(r, "price_usd"), stock = col(r, "stock"), weight = col(r, "weight_grams"), av = col(r, "availability").toLowerCase();
    if (ghs) { const m = money(ghs); if (Number.isNaN(m)) return bad(`price_ghs "${ghs}" isn't a valid amount (e.g. 12.50).`); input.priceGhs = m; }
    if (usd) { const m = money(usd); if (Number.isNaN(m)) return bad(`price_usd "${usd}" isn't a valid amount (e.g. 12.50).`); input.priceUsd = m; }
    if (stock) { if (!/^\d{1,7}$/.test(stock)) return bad(`stock "${stock}" must be a whole number.`); input.onHand = Number(stock); }
    if (weight) { if (!/^\d{1,7}$/.test(weight)) return bad(`weight_grams "${weight}" must be a whole number.`); input.weightGrams = Number(weight); }
    if (av) { const a = AVAIL[av]; if (!a) return bad(`availability "${av}" isn't recognised (use available, pre_order, coming_soon or out_of_stock).`); input.availability = a; if (a === "pre_order") input.preOrderEnabled = true; }
    const win = col(r, "expected_window"); if (win) input.expectedWindow = win.slice(0, 80);
    const desc = col(r, "description"); if (desc) input.description = desc;
    if (header.includes("published") && bool(col(r, "published"))) input.published = true;
    const attrs: Record<string, string> = {}; header.forEach((h, i) => { if (h.startsWith("attr_") && (r[i] ?? "").trim()) attrs[h.slice(5)] = (r[i] ?? "").trim(); });
    if (Object.keys(attrs).length) input.attributes = attrs;
    inputs.push({ row: n, input });
  });
  if (errors.length) throw new ValidationError(errors.slice(0, 50).concat(errors.length > 50 ? [`…and ${errors.length - 50} more problems.`] : []));
  // Validate every row against the live catalogue (duplicate SKUs, attribute rules, pre-order rules) before creating anything.
  const created: { row: number; name: string; sku: string }[] = [];
  const snapshot = { products: new Map(db.products), variants: new Map(db.variants) };
  try {
    for (const { row, input } of inputs) {
      try { const pr = createProduct(db, actor, input); created.push({ row, name: pr.name, sku: input.sku }); }
      catch (e) { if (e instanceof ValidationError) errors.push(...e.errors.map((m) => `Row ${row}: ${m}`)); else throw e; }
    }
  } finally { if (errors.length) { db.products = snapshot.products; db.variants = snapshot.variants; } }
  if (errors.length) throw new ValidationError(errors.slice(0, 50));
  if (!dryRun) db.log("products.imported", { count: created.length }, actor!.id);
  return { dryRun, count: created.length, created: created.slice(0, 20) };
}
