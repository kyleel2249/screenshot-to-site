import { slugify } from "@/lib/domain/categories";

/** Category id/slug → short SKU prefix for DDT-PREFIX-#### style codes. */
const PREFIX: Record<string, string> = {
  cars: "CAR",
  "household-and-kitchen": "HOME",
  "clothing-and-fashion": "FASH",
  "shoes-and-footwear": "SHOE",
  "phones-and-accessories": "PHONE",
  "gift-sets": "GIFT",
  jewellery: "JWL",
  "teas-gummies-and-supplements": "WELL",
  "bags-and-luggage": "BAG",
  "toiletries-and-personal-care-essentials": "CARE",
  "hair-and-hair-accessories": "HAIR",
  "equipment-medical-equipment-and-farm-tools": "EQP",
  "cosmetics-and-fragrances": "COS",
  "building-materials-and-fixtures": "BLD",
  "other-products": "OTH",
};

export function categorySkuPrefix(categoryId: string): string {
  const raw = categoryId.replace(/^cat-/, "");
  const parent = raw.split("--")[0] ?? raw;
  const fromMap = PREFIX[parent];
  if (fromMap) return fromMap;
  const sliced = parent.slice(0, 4).toUpperCase().replace(/[^A-Z]/g, "");
  return sliced || "GEN";
}

/** Suggest SKU from category + existing product count (server still validates uniqueness). */
export function suggestSku(categoryId: string, existingSkus: string[]): string {
  const prefix = categorySkuPrefix(categoryId);
  const re = new RegExp(`^DDT-${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const s of existingSkus) {
    const m = re.exec(s);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `DDT-${prefix}-${String(max + 1).padStart(4, "0")}`;
}

export function suggestSlug(name: string): string {
  return slugify(name) || "product";
}

/** Draft short description from name + category label (editable suggestion, not a model call). */
export function suggestShortDescription(name: string, categoryName: string): string {
  const n = name.trim();
  const c = categoryName.trim();
  if (!n) return "";
  if (c) return `${n} from the ${c} range at Dera Darko Trade. Quality product with clear GH₵ and USD pricing.`;
  return `${n} available at Dera Darko Trade. Check availability and dual-currency pricing on the product page.`;
}

export function suggestImageAlt(name: string, categoryName: string): string {
  const n = name.trim();
  if (!n) return "Product image";
  return categoryName.trim() ? `${n} — ${categoryName}` : n;
}
