/**
 * Product attributes that drive the storefront filters for each category branch (category.filterProfile).
 * Values are free text unless the owner-facing field defines fixed options. Only keys defined here are ever stored or filtered on.
 */
import type { FilterProfile } from "./categories";

export interface AttributeDef { key: string; label: string; options?: readonly string[]; numeric?: boolean }
const COLOUR: AttributeDef = { key: "colour", label: "Colour" };
const BRAND: AttributeDef = { key: "brand", label: "Brand" };

export const ATTRIBUTES: Record<FilterProfile, readonly AttributeDef[]> = {
  general: [BRAND, COLOUR],
  vehicle: [
    { key: "make", label: "Make" }, { key: "model", label: "Model" }, { key: "year", label: "Year", numeric: true },
    { key: "transmission", label: "Transmission", options: ["Automatic", "Manual"] },
    { key: "fuel", label: "Fuel", options: ["Petrol", "Diesel", "Hybrid", "Electric"] },
    { key: "condition", label: "Condition", options: ["New", "Foreign used", "Locally used"] },
  ],
  footwear: [{ key: "size", label: "Size" }, { key: "gender", label: "For", options: ["Women", "Men", "Children", "Unisex"] }, COLOUR, BRAND],
  apparel: [{ key: "size", label: "Size" }, { key: "gender", label: "For", options: ["Women", "Men", "Children", "Unisex"] }, COLOUR, { key: "material", label: "Material" }],
  electronics: [BRAND, { key: "model", label: "Model" }, { key: "storage", label: "Storage" }, COLOUR, { key: "condition", label: "Condition", options: ["New", "Used"] }],
  health: [BRAND, { key: "type", label: "Type" }],
  equipment: [BRAND, { key: "power", label: "Power" }, { key: "condition", label: "Condition", options: ["New", "Used"] }],
  building: [BRAND, { key: "material", label: "Material" }, { key: "size", label: "Size" }],
};

export const attributesFor = (profile: FilterProfile | undefined): readonly AttributeDef[] => ATTRIBUTES[profile ?? "general"];

/** Keeps only defined keys, trims, enforces fixed options and numeric fields; throws nothing — returns what was rejected so callers can report it. */
export function cleanAttributes(profile: FilterProfile | undefined, input: unknown): { attributes: Record<string, string>; rejected: string[] } {
  const attributes: Record<string, string> = {}, rejected: string[] = [];
  const src = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  for (const def of attributesFor(profile)) {
    const raw = src[def.key];
    if (raw === undefined || raw === null || raw === "") continue;
    const v = typeof raw === "string" || typeof raw === "number" ? String(raw).trim().replace(/\s+/g, " ").slice(0, 60) : "";
    if (!v) continue;
    if (def.options && !def.options.includes(v)) { rejected.push(`${def.label} must be one of: ${def.options.join(", ")}.`); continue; }
    if (def.numeric && !/^\d{1,6}$/.test(v)) { rejected.push(`${def.label} must be a number.`); continue; }
    attributes[def.key] = v;
  }
  return { attributes, rejected };
}

export type AttributeFilters = Readonly<Record<string, string>>;
/** Facet values that actually occur in `list`, with counts, so the shop never offers a filter that returns nothing. */
export function facets(list: readonly { attributes?: Record<string, string> | undefined }[], profile: FilterProfile | undefined) {
  return attributesFor(profile).map((def) => {
    const counts = new Map<string, number>();
    for (const p of list) { const v = p.attributes?.[def.key]; if (v) counts.set(v, (counts.get(v) ?? 0) + 1); }
    const values = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => (def.numeric ? Number(b.value) - Number(a.value) : a.value.localeCompare(b.value)));
    return { ...def, values };
  }).filter((f) => f.values.length > 0);
}
export function filterByAttributes<T extends { attributes?: Record<string, string> | undefined }>(list: readonly T[], selected: AttributeFilters): T[] {
  const entries = Object.entries(selected).filter(([, v]) => v);
  return entries.length ? list.filter((p) => entries.every(([k, v]) => p.attributes?.[k]?.toLowerCase() === v.toLowerCase())) : [...list];
}
/** URL form: repeated `f=key:value` params. Unknown keys are dropped so a crafted URL can't smuggle anything in. */
export function parseFilterParams(raw: unknown, profile: FilterProfile | undefined): Record<string, string> {
  const out: Record<string, string> = {}; const known = new Set(attributesFor(profile).map((d) => d.key));
  for (const item of Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []) {
    if (typeof item !== "string") continue;
    const i = item.indexOf(":"); if (i < 1) continue;
    const k = item.slice(0, i), v = item.slice(i + 1).trim().slice(0, 60);
    if (known.has(k) && v) out[k] = v;
  }
  return out;
}
export const toFilterParams = (f: AttributeFilters) => Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`);
