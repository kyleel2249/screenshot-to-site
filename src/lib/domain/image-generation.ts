/**
 * AI product image generation — domain types.
 * No Canva dependency. Images are generated via a pluggable provider,
 * stored permanently, and linked to product records.
 *
 * Owner policy (2026-10-31): AI placeholders may be shown as ordinary
 * product photos. Do not surface "AI" or "illustrative" labels to shoppers.
 * Track source internally only so real supplier photos can replace them later.
 */

export type ImageSource =
  | "verified_supplier"
  | "manufacturer"
  | "ai_generated"
  | "owner_upload"
  | "awaiting_approval";

/** Customer-facing presentation: always treat as a normal product image. */
export type CustomerImageRole = "product_image";

export type ImageJobStatus =
  | "pending"
  | "queued"
  | "processing"
  | "generated"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "exported"
  | "uploaded"
  | "linked"
  | "failed";

export type ImageAngle =
  | "primary"
  | "front"
  | "side"
  | "rear"
  | "detail"
  | "lifestyle"
  | "packaging"
  | "promotional";

export interface ImageGenerationRequest {
  productId: string;
  sku: string;
  name: string;
  categorySlug: string;
  subcategorySlug?: string;
  description?: string;
  colour?: string;
  material?: string;
  attributes?: Record<string, string>;
  angle: ImageAngle;
  /** When true, skip categories that must not be AI-generated (vehicles, medical, health teas, building). */
  respectSafetySkip?: boolean;
}

export interface GeneratedImageMeta {
  provider: string;
  model?: string;
  prompt: string;
  revisedPrompt?: string;
  width: number;
  height: number;
  mimeType: string;
  generatedAt: string; // ISO
  costMinorUnits?: number; // optional tracking in USD cents
  jobId?: string;
}

export interface ProductImageRecord {
  id: string;
  productId: string;
  url: string;
  alt: string;
  position: number;
  isPrimary: boolean;
  source: ImageSource;
  customerRole: CustomerImageRole;
  angle: ImageAngle;
  generation?: GeneratedImageMeta;
  approvedAt?: string;
  approvedBy?: string;
  replacedBy?: string; // later real photo id
}

export interface ImageJob {
  id: string;
  productId: string;
  sku: string;
  angle: ImageAngle;
  status: ImageJobStatus;
  provider?: string;
  prompt?: string;
  error?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  imageId?: string;
}

/** Categories that must not receive AI product photos (risk of looking like exact items for sale). */
export const AI_SAFETY_SKIP_CATEGORY_PREFIXES = [
  "cat-cars",
  "cat-equipment-medical",
  "cat-teas-gummies",
  "cat-building-materials",
] as const;

export function shouldSkipAiGeneration(categorySlug: string): boolean {
  const s = categorySlug.toLowerCase();
  return AI_SAFETY_SKIP_CATEGORY_PREFIXES.some((p) => s.startsWith(p) || s.includes(p.replace("cat-", "")));
}

export const DEFAULT_PRIMARY_SIZE = { width: 1200, height: 1200 } as const;
export const DEFAULT_PROMO_SIZE = { width: 1080, height: 1350 } as const;
