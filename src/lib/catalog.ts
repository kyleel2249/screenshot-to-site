import electronics from "@/assets/cat-electronics.jpg";
import home from "@/assets/cat-home.jpg";
import fashion from "@/assets/cat-fashion.jpg";

export type Availability = "in_stock" | "preorder";

export interface Category {
  slug: string;
  name: string;
  description: string;
  image: string;
}

export interface Product {
  slug: string;
  name: string;
  category: string;
  price: number; // GHS
  compareAt?: number;
  availability: Availability;
  leadTime?: string;
  description: string;
  image: string;
}

export const categories: Category[] = [
  { slug: "electronics", name: "Electronics", description: "Phones, audio and smart accessories.", image: electronics },
  { slug: "home-kitchen", name: "Home & Kitchen", description: "Cookware and appliances built to last.", image: home },
  { slug: "fashion-beauty", name: "Fashion & Beauty", description: "Bags, footwear and fragrance.", image: fashion },
];

// DEMO DATA — replace with real inventory before launch.
export const products: Product[] = [
  { slug: "wireless-earbuds-pro", name: "Wireless Earbuds Pro (Demo)", category: "electronics", price: 850, availability: "in_stock", description: "Noise-cancelling earbuds with charging case.", image: electronics },
  { slug: "smartwatch-series", name: "Smartwatch Series (Demo)", category: "electronics", price: 1650, compareAt: 1900, availability: "preorder", leadTime: "Est. 3–4 weeks", description: "Fitness tracking, notifications and all-day battery.", image: electronics },
  { slug: "stainless-cookware-set", name: "Stainless Cookware Set (Demo)", category: "home-kitchen", price: 1200, availability: "in_stock", description: "Five-piece tri-ply stainless steel set.", image: home },
  { slug: "power-blender", name: "Power Blender 1.5L (Demo)", category: "home-kitchen", price: 690, availability: "preorder", leadTime: "Est. 2–3 weeks", description: "High-speed blender with glass jar.", image: home },
  { slug: "leather-tote", name: "Leather Tote Bag (Demo)", category: "fashion-beauty", price: 980, availability: "in_stock", description: "Structured everyday tote in tan leather.", image: fashion },
  { slug: "everyday-sneakers", name: "Everyday Sneakers (Demo)", category: "fashion-beauty", price: 560, availability: "in_stock", description: "Comfortable suede-trim sneakers.", image: fashion },
];

export const formatGHS = (n: number) => `GH₵ ${n.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`;
export const getProduct = (slug: string) => products.find((p) => p.slug === slug);
export const getCategory = (slug: string) => categories.find((c) => c.slug === slug);

// Placeholder contact details — to be supplied by the business.
export const business = {
  name: "Dera Darko Trade",
  email: "hello@example.com (placeholder)",
  phone: "+233 — (to be provided)",
  location: "Ghana",
};
