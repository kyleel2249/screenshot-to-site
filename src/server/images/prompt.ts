/**
 * Product-specific prompt builder for commercial product photography.
 * One generic prompt is never used for all categories.
 */
import type { ImageAngle, ImageGenerationRequest } from "../../lib/domain/image-generation";

const BASE =
  "Professional e-commerce product photography, commercial retail quality, sharp focus, realistic materials and proportions, clean studio lighting, no text overlays, no brand logos, no watermarks, no fake packaging claims";

const ANGLE_HINT: Record<ImageAngle, string> = {
  primary: "hero product shot, centred, 1:1 square composition",
  front: "front view, product facing camera",
  side: "side profile view",
  rear: "rear view",
  detail: "close-up detail showing texture and craftsmanship",
  lifestyle: "subtle lifestyle setting that does not obscure the product",
  packaging: "product packaging presentation, clean retail style",
  promotional: "premium promotional product presentation, navy and gold compatible mood, no promotional text",
};

function categoryPrompt(categorySlug: string, name: string, extras: string[]): string {
  const c = categorySlug.toLowerCase();
  const e = extras.filter(Boolean).join(", ");

  if (c.includes("shoe") || c.includes("sneaker") || c.includes("sandal") || c.includes("footwear")) {
    return `${BASE}. Premium footwear photography of ${name}${e ? `, ${e}` : ""}. Accurate sole and upper materials, natural shadows, isolated on seamless white or light grey background. ${ANGLE_HINT.primary}`;
  }
  if (c.includes("handbag") || c.includes("bag") || c.includes("luggage") || c.includes("backpack")) {
    return `${BASE}. Structured bag photography of ${name}${e ? `, ${e}` : ""}. Realistic leather or fabric texture, accurate proportions, handles visible, isolated on clean white background.`;
  }
  if (c.includes("jewellery") || c.includes("necklace") || c.includes("earring") || c.includes("bracelet") || c.includes("ring")) {
    return `${BASE}. High-detail jewellery photography of ${name}${e ? `, ${e}` : ""}. Realistic metallic finish, soft reflections, macro-quality detail, isolated on clean white or soft grey background.`;
  }
  if (c.includes("phone") || c.includes("watch") || c.includes("power-bank") || c.includes("electronics") || c.includes("ring-light")) {
    return `${BASE}. Clean technology product photography of ${name}${e ? `, ${e}` : ""}. Accurate device proportions, realistic materials, soft studio lighting, isolated on pure white background.`;
  }
  if (c.includes("perfume") || c.includes("fragrance") || c.includes("cosmetic") || c.includes("deodorant")) {
    return `${BASE}. Luxury beauty product photography of ${name}${e ? `, ${e}` : ""}. Accurate bottle or packaging silhouette, glass reflections where appropriate, elegant neutral background.`;
  }
  if (c.includes("clothing") || c.includes("fashion") || c.includes("dress") || c.includes("shirt") || c.includes("legging") || c.includes("lingerie") || c.includes("nightwear")) {
    return `${BASE}. Fashion product photography of ${name}${e ? `, ${e}` : ""}. Accurate garment drape and fabric texture, professional presentation on simple mannequin or flat lay, clean light background.`;
  }
  if (c.includes("wig") || c.includes("hair")) {
    return `${BASE}. Realistic hair product photography of ${name}${e ? `, ${e}` : ""}. Natural hair texture and colour, displayed on neutral mannequin head where appropriate, clean studio background.`;
  }
  if (c.includes("kitchen") || c.includes("household")) {
    return `${BASE}. Home and kitchen product photography of ${name}${e ? `, ${e}` : ""}. Realistic materials, accurate scale, isolated on clean white background.`;
  }
  if (c.includes("gift")) {
    return `${BASE}. Premium gift set presentation of ${name}${e ? `, ${e}` : ""}. Attractive packaging arrangement, soft studio lighting, elegant neutral background.`;
  }
  if (c.includes("toiletries") || c.includes("diaper") || c.includes("tissue") || c.includes("sanitary")) {
    return `${BASE}. Clean retail packaging photography of ${name}${e ? `, ${e}` : ""}. Accurate pack shape, soft lighting, isolated on white background. No invented labels or claims.`;
  }
  // Generic commercial fallback
  return `${BASE}. Product photography of ${name}${e ? `, ${e}` : ""}. Isolated on clean white background, accurate proportions.`;
}

export function buildProductImagePrompt(req: ImageGenerationRequest): string {
  const extras: string[] = [];
  if (req.colour) extras.push(req.colour);
  if (req.material) extras.push(req.material);
  if (req.attributes) {
    for (const [k, v] of Object.entries(req.attributes)) {
      if (v) extras.push(`${k}: ${v}`);
    }
  }
  const base = categoryPrompt(req.categorySlug, req.name, extras);
  const angle = ANGLE_HINT[req.angle] ?? ANGLE_HINT.primary;
  const desc = req.description ? ` Context: ${req.description.slice(0, 200)}.` : "";
  return `${base} ${angle}.${desc}`;
}
