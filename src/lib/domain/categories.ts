/**
 * Initial hierarchical category taxonomy for Dera Darko Trade (sections A–O of the brief).
 * In production these rows live in the database and are editable by administrators;
 * this module is the SEED and the pure tree helpers used by both storefront and admin.
 */
export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  description: string;
  position: number;
  published: boolean;
  /** Which attribute filters apply to products in this branch. */
  filterProfile: FilterProfile;
}

export type FilterProfile = "general" | "vehicle" | "footwear" | "apparel" | "electronics" | "health" | "equipment" | "building";

export const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

interface Seed { name: string; description: string; profile: FilterProfile; children: string[] }

const SEED: Seed[] = [
  { name: "Cars", description: "Vehicle listings with enquiry and quotation options.", profile: "vehicle", children: ["SUVs", "Saloon Cars"] },
  { name: "Household & Kitchen", description: "Everyday home and kitchen essentials.", profile: "general", children: ["Household Items", "Kitchen Items", "Other Household Products"] },
  { name: "Clothing & Fashion", description: "Fashion for women, men, children and everyone.", profile: "apparel", children: ["Fabrics", "Handbags", "Hair & Wigs", "Hair Accessories", "Children's Clothes", "Women's Clothes", "Men's Clothes", "Nightwear", "Unisex Wear", "Underwear", "Waist Trainers", "Lingerie & Bralettes", "Leggings"] },
  { name: "Shoes & Footwear", description: "Footwear for the whole family.", profile: "footwear", children: ["Children's Shoes", "Women's Shoes", "Men's Shoes", "Sneakers", "Sandals", "Slip-ons", "Flip-flops"] },
  { name: "Phones & Accessories", description: "Phones, power and accessories.", profile: "electronics", children: ["Mobile Phones", "Phone Accessories", "Power Banks", "Smart Watches", "Ring Lights"] },
  { name: "Gift Sets", description: "Ready-made gifting.", profile: "general", children: ["Gift Sets", "Personalised Gift Sets", "Seasonal Gift Sets"] },
  { name: "Jewellery", description: "Necklaces, earrings, bracelets and rings.", profile: "general", children: ["Jewellery", "Necklaces", "Earrings", "Bracelets", "Rings", "Watches and Jewellery Accessories"] },
  { name: "Teas, Gummies & Supplements", description: "Wellness products. Listed as products, not medical treatments.", profile: "health", children: ["Fibroid Tea Products", "Slimming Tea", "Flat Tummy Tea", "Gummies", "Supplements"] },
  { name: "Bags & Luggage", description: "Backpacks, school bags and travel bags.", profile: "general", children: ["Backpacks", "Children's Backpacks", "School Bags", "Travel Bags"] },
  { name: "Toiletries & Personal Care Essentials", description: "Everyday personal care.", profile: "general", children: ["Toilet Tissue", "Diapers", "Sanitary Pads"] },
  { name: "Hair & Hair Accessories", description: "Hair products, wigs, extensions and styling accessories.", profile: "general", children: ["Hair Products", "Hair Accessories", "Wigs", "Hair Extensions", "Hair Styling Accessories"] },
  { name: "Equipment, Medical Equipment & Farm Tools", description: "Equipment and tools with documented specifications.", profile: "equipment", children: ["Equipment", "Medical Equipment", "Farm Tools", "Agricultural Equipment"] },
  { name: "Cosmetics & Fragrances", description: "Cosmetics, perfumes and deodorants.", profile: "general", children: ["Cosmetics", "Fragrances", "Perfumes", "Perfume Oils", "Deodorants"] },
  { name: "Building Materials & Fixtures", description: "Materials, switches, lighting and sanitaryware.", profile: "building", children: ["Building Materials", "Electrical Switches", "Lighting & Fixtures", "Water Closets (WC)", "Sinks", "Plumbing Fixtures"] },
  { name: "Other Products", description: "Everything else, plus newly added ranges.", profile: "general", children: ["Other Items", "Miscellaneous Products", "Newly Added Categories"] },
];

function build(): CategoryNode[] {
  const nodes: CategoryNode[] = [];
  SEED.forEach((s, i) => {
    const parent: CategoryNode = { id: `cat-${slugify(s.name)}`, slug: slugify(s.name), name: s.name, parentId: null, description: s.description, position: i, published: true, filterProfile: s.profile };
    nodes.push(parent);
    s.children.forEach((c, j) => {
      // Child slugs are namespaced by parent so repeated names (e.g. "Hair Accessories", "Gift Sets") never collide.
      const slug = c === s.name ? `${parent.slug}-all` : slugify(c);
      const id = `cat-${parent.slug}--${slugify(c)}`;
      nodes.push({ id, slug: nodes.some((n) => n.slug === slug) ? `${parent.slug}-${slug}` : slug, name: c, parentId: parent.id, description: `${c} in ${s.name}.`, position: j, published: true, filterProfile: s.profile });
    });
  });
  return nodes;
}

export const SEED_CATEGORIES: CategoryNode[] = build();

export const topLevel = (all: CategoryNode[]) => all.filter((c) => c.parentId === null && c.published).sort((a, b) => a.position - b.position);
export const childrenOf = (all: CategoryNode[], id: string) => all.filter((c) => c.parentId === id && c.published).sort((a, b) => a.position - b.position);
export const findBySlug = (all: CategoryNode[], slug: string) => all.find((c) => c.slug === slug);

/** The category itself plus every published descendant id — used so a parent page lists its children's products. */
export function descendantIds(all: CategoryNode[], id: string): string[] {
  const out = [id];
  for (const c of all) if (c.parentId === id && c.published) out.push(...descendantIds(all, c.id));
  return out;
}

export function breadcrumb(all: CategoryNode[], id: string): CategoryNode[] {
  const trail: CategoryNode[] = [];
  let cur = all.find((c) => c.id === id);
  while (cur) { trail.unshift(cur); cur = cur.parentId ? all.find((c) => c.id === cur!.parentId) : undefined; }
  return trail;
}

/** Admin operations (pure): return a new list; the caller persists and audits. */
export function renameCategory(all: CategoryNode[], id: string, name: string): CategoryNode[] {
  if (!name.trim()) throw new Error("Name required");
  return all.map((c) => (c.id === id ? { ...c, name: name.trim() } : c));
}
export function setPublished(all: CategoryNode[], id: string, published: boolean): CategoryNode[] {
  return all.map((c) => (c.id === id ? { ...c, published } : c));
}
export function reorder(all: CategoryNode[], id: string, newPosition: number): CategoryNode[] {
  const target = all.find((c) => c.id === id);
  if (!target) throw new Error("Unknown category");
  const siblings = all.filter((c) => c.parentId === target.parentId && c.id !== id).sort((a, b) => a.position - b.position);
  siblings.splice(Math.max(0, Math.min(newPosition, siblings.length)), 0, target);
  const pos = new Map(siblings.map((s, i) => [s.id, i]));
  return all.map((c) => (pos.has(c.id) ? { ...c, position: pos.get(c.id)! } : c));
}
export function addCategory(all: CategoryNode[], input: { name: string; parentId: string | null; description?: string; filterProfile?: FilterProfile }): CategoryNode[] {
  const name = input.name.trim();
  if (!name) throw new Error("Name required");
  let slug = slugify(name), n = 2;
  while (all.some((c) => c.slug === slug)) slug = `${slugify(name)}-${n++}`;
  const siblings = all.filter((c) => c.parentId === input.parentId);
  const parent = input.parentId ? all.find((c) => c.id === input.parentId) : undefined;
  return [...all, { id: `cat-${slug}`, slug, name, parentId: input.parentId, description: input.description ?? "", position: siblings.length, published: true, filterProfile: input.filterProfile ?? parent?.filterProfile ?? "general" }];
}
