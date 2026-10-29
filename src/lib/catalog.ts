import electronics from "@/assets/cat-electronics.jpg";
import home from "@/assets/cat-home.jpg";
import fashion from "@/assets/cat-fashion.jpg";
import { SEED_CATEGORIES, findBySlug, descendantIds, type CategoryNode } from "@/lib/domain/categories";
import { effectiveAvailability, activePromoLabels, type Availability, type PromoLabel, type PromoWindow, type Sellable } from "@/lib/domain/status";
import { priceLabels, type DisplayMode, type ExchangeRate, type PriceSet } from "@/lib/domain/money";
import type { VariantRecord } from "@/lib/domain/commerce";

/**
 * DATA SOURCE BOUNDARY.
 * Everything below `SEED` stands in for database rows that the administrator edits. The storefront only
 * talks to the functions exported here, so swapping the seed for D1/Postgres queries does not touch any UI.
 * ALL PRODUCTS BELOW ARE DEMO DATA (clearly labelled) — replace with real inventory before launch.
 */
export const categories: CategoryNode[] = SEED_CATEGORIES;
export { findBySlug, descendantIds };

export interface Product {
  slug: string;
  name: string;
  categoryId: string;
  shortDescription: string;
  description: string;
  image: string;
  imageAlt: string;
  createdAt: string;
  promo: PromoWindow[];
  showLimitedBelow?: number;
  expectedWindow?: string; // pre-order only, set by the owner — never invented
  attributes: Record<string, string>;
  variants: VariantRecord[];
}

const base = (o: Partial<Sellable> = {}): Sellable => ({ availability: "available", trackInventory: true, onHand: 10, reserved: 0, allowBackorder: false, published: true, ...o });

function mk(slug: string, name: string, categoryId: string, img: string, p: { ghs: number; usd: number; sale?: { ghs: number; usd: number }; sell?: Partial<Sellable>; promo?: PromoWindow[]; short: string; weight?: number; expected?: string; attrs?: Record<string, string>; created?: string; limited?: number }): Product {
  const sellable = base(p.sell);
  const v: VariantRecord = {
    id: `${slug}-default`, productId: slug, name: `${name} (Demo)`, price: { GHS: p.ghs, USD: p.usd },
    ...(p.sale ? { salePrice: { GHS: p.sale.ghs, USD: p.sale.usd } } : {}),
    weightGrams: p.weight ?? 500, categoryIds: [categoryId], ...sellable,
  };
  return {
    slug, name: `${name} (Demo)`, categoryId, shortDescription: p.short, description: `${p.short} This is demonstration data and not a real listing.`,
    image: img, imageAlt: `${name} — demo product image`, createdAt: p.created ?? "2026-10-01T00:00:00Z", promo: p.promo ?? [],
    ...(p.limited !== undefined ? { showLimitedBelow: p.limited } : {}), ...(p.expected ? { expectedWindow: p.expected } : {}),
    attributes: p.attrs ?? {}, variants: [v],
  };
}

const IN = (id: string) => `cat-${id}`;
export const products: Product[] = [
  mk("wireless-earbuds-pro", "Wireless Earbuds Pro", IN("phones-and-accessories--phone-accessories"), electronics, { ghs: 85000, usd: 5500, short: "Noise-cancelling earbuds with charging case.", promo: [{ label: "featured" }, { label: "new_arrival" }], attrs: { Compatibility: "Bluetooth 5" } }),
  mk("smartwatch-series", "Smartwatch Series", IN("phones-and-accessories--smart-watches"), electronics, { ghs: 165000, usd: 10500, sale: { ghs: 150000, usd: 9500 }, sell: { availability: "pre_order", preOrder: { enabled: true } }, expected: "Owner to confirm", promo: [{ label: "on_sale" }], short: "Fitness tracking and notifications." }),
  mk("power-bank-20k", "Power Bank 20,000mAh", IN("phones-and-accessories--power-banks"), electronics, { ghs: 29000, usd: 1900, sell: { onHand: 3 }, limited: 5, promo: [{ label: "limited_stock" }, { label: "just_landed", endsAt: "2027-12-31T00:00:00Z" }], short: "Dual-port fast-charging power bank.", attrs: { Capacity: "20,000mAh" } }),
  mk("ring-light-26", "Ring Light 26cm", IN("phones-and-accessories--ring-lights"), electronics, { ghs: 18000, usd: 1200, sell: { availability: "out_of_stock", onHand: 0 }, short: "Dimmable ring light with phone holder." }),
  mk("stainless-cookware-set", "Stainless Cookware Set", IN("household-and-kitchen--kitchen-items"), home, { ghs: 120000, usd: 7800, short: "Five-piece tri-ply stainless steel set.", promo: [{ label: "best_seller" }] }),
  mk("power-blender", "Power Blender 1.5L", IN("household-and-kitchen--kitchen-items"), home, { ghs: 69000, usd: 4500, sell: { availability: "pre_order", preOrder: { enabled: true } }, expected: "Owner to confirm", short: "High-speed blender with glass jar." }),
  mk("storage-baskets", "Storage Basket Set", IN("household-and-kitchen--household-items"), home, { ghs: 21000, usd: 1400, short: "Set of three woven storage baskets." }),
  mk("leather-tote", "Leather Tote Bag", IN("clothing-and-fashion--handbags"), fashion, { ghs: 98000, usd: 6300, short: "Structured everyday tote.", promo: [{ label: "featured" }] }),
  mk("everyday-sneakers", "Everyday Sneakers", IN("shoes-and-footwear--sneakers"), fashion, { ghs: 56000, usd: 3600, short: "Comfortable suede-trim sneakers.", attrs: { Sizes: "Per variant" } }),
  mk("travel-backpack", "Travel Backpack 35L", IN("bags-and-luggage--backpacks"), fashion, { ghs: 42000, usd: 2700, short: "Water-resistant 35L backpack.", sell: { availability: "coming_soon" } }),
  mk("gift-set-classic", "Classic Gift Set", IN("gift-sets--gift-sets"), fashion, { ghs: 35000, usd: 2300, short: "Gift-ready set with packaging.", promo: [{ label: "new_arrival" }], created: "2026-10-20T00:00:00Z" }),
  mk("old-model-kettle", "Electric Kettle (older model)", IN("household-and-kitchen--kitchen-items"), home, { ghs: 15000, usd: 1000, sell: { availability: "discontinued", onHand: 0 }, short: "Superseded by a newer model." }),
];

export const getProduct = (slug: string) => products.find((p) => p.slug === slug);
export const getVariantMap = () => new Map(products.flatMap((p) => p.variants.map((v) => [v.id, v] as const)));
export const getVariant = (id: string) => getVariantMap().get(id);

export interface View {
  availability: Availability;
  labels: PromoLabel[];
  priceSet: PriceSet;
  saleSet: PriceSet | undefined;
}

export function viewOf(p: Product, now = new Date()): View {
  const v = p.variants[0]!;
  const hasSale = !!v.salePrice;
  return {
    availability: effectiveAvailability(v),
    labels: activePromoLabels(p.promo, v, { ...(p.showLimitedBelow !== undefined ? { showLimitedBelow: p.showLimitedBelow } : {}), hasValidSale: hasSale }, now),
    priceSet: v.price,
    saleSet: v.salePrice,
  };
}

/** Prices to display for a display mode. Exchange rate is owner-configured; none is assumed. */
export function displayPrice(p: Product, mode: DisplayMode, rate?: ExchangeRate) {
  const v = viewOf(p);
  return { current: priceLabels(v.saleSet ?? v.priceSet, mode, rate), original: v.saleSet ? priceLabels(v.priceSet, mode, rate) : [] };
}

export function productsIn(categoryId?: string) {
  if (!categoryId) return products;
  const ids = new Set(descendantIds(categories, categoryId));
  return products.filter((p) => ids.has(p.categoryId));
}

// Placeholder contact details — to be supplied and verified by the business. Never invented.
export const business = {
  name: "Dera Darko Trade",
  email: "To be provided by the owner",
  phone: "To be provided by the owner",
  location: "Ghana",
};
