/**
 * Orchestrates prompt → provider → permanent storage → product link.
 * Does not mark success until bytes are stored and linked.
 */
import {
  DEFAULT_PRIMARY_SIZE,
  type ImageAngle,
  type ImageGenerationRequest,
  type ImageJob,
  type ImageJobStatus,
  type ProductImageRecord,
  shouldSkipAiGeneration,
} from "../../lib/domain/image-generation";
import { buildProductImagePrompt } from "./prompt";
import type { ImageGenerationProvider, ImageProviderResult } from "./provider";

export interface ImageStorage {
  /** Persist bytes; returns a permanent public or signed URL path. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<{ url: string }>;
}

export interface ImageServiceDeps {
  provider: ImageGenerationProvider;
  storage: ImageStorage;
  now?: () => Date;
  id?: () => string;
}

function newId(): string {
  return `img_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function jobId(): string {
  return `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export class ImageGenerationService {
  private readonly provider: ImageGenerationProvider;
  private readonly storage: ImageStorage;
  private readonly now: () => Date;
  private readonly id: () => string;
  private jobs = new Map<string, ImageJob>();

  constructor(deps: ImageServiceDeps) {
    this.provider = deps.provider;
    this.storage = deps.storage;
    this.now = deps.now ?? (() => new Date());
    this.id = deps.id ?? newId;
  }

  providerConfigured(): boolean {
    return this.provider.isConfigured();
  }

  listJobs(): ImageJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJob(id: string): ImageJob | undefined {
    return this.jobs.get(id);
  }

  /**
   * Generate one image for a product. Returns the job record.
   * On success, status becomes "generated" and imageId is set;
   * caller still decides approval / linking.
   */
  async generateOne(
    req: ImageGenerationRequest,
  ): Promise<{ job: ImageJob; image?: ProductImageRecord; result?: ImageProviderResult }> {
    const createdAt = this.now().toISOString();
    const job: ImageJob = {
      id: jobId(),
      productId: req.productId,
      sku: req.sku,
      angle: req.angle,
      status: "pending",
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
    };
    this.jobs.set(job.id, job);

    if (req.respectSafetySkip !== false && shouldSkipAiGeneration(req.categorySlug)) {
      return this.fail(job, `AI generation skipped for safety category: ${req.categorySlug}`);
    }

    if (!this.provider.isConfigured()) {
      return this.fail(
        job,
        "IMAGE_API_KEY is not configured. Set the server secret before generating product images.",
      );
    }

    const prompt = buildProductImagePrompt(req);
    job.prompt = prompt;
    job.status = "processing";
    job.provider = this.provider.id;
    job.attempts += 1;
    job.updatedAt = this.now().toISOString();
    this.jobs.set(job.id, job);

    try {
      const result = await this.provider.generate({
        prompt,
        width: DEFAULT_PRIMARY_SIZE.width,
        height: DEFAULT_PRIMARY_SIZE.height,
        quality: "standard",
      });

      const key = `products/${req.sku}/${req.angle}-${job.id}.png`;
      const stored = await this.storage.put(key, result.bytes, result.mimeType);

      const image: ProductImageRecord = {
        id: this.id(),
        productId: req.productId,
        url: stored.url,
        alt: req.name,
        position: req.angle === "primary" ? 0 : 1,
        isPrimary: req.angle === "primary",
        source: "ai_generated",
        customerRole: "product_image",
        angle: req.angle,
        generation: { ...result.meta, jobId: job.id },
      };

      job.status = "generated";
      job.imageId = image.id;
      job.completedAt = this.now().toISOString();
      job.updatedAt = job.completedAt;
      this.jobs.set(job.id, job);

      return { job, image, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.fail(job, message);
    }
  }

  /** Queue multiple products; processes sequentially with optional concurrency limit later. */
  async generateBatch(
    requests: ImageGenerationRequest[],
  ): Promise<{ jobs: ImageJob[]; images: ProductImageRecord[] }> {
    const jobs: ImageJob[] = [];
    const images: ProductImageRecord[] = [];
    for (const req of requests) {
      const { job, image } = await this.generateOne(req);
      jobs.push(job);
      if (image) images.push(image);
    }
    return { jobs, images };
  }

  private fail(job: ImageJob, error: string): { job: ImageJob } {
    job.status = "failed";
    job.error = error;
    job.updatedAt = this.now().toISOString();
    this.jobs.set(job.id, job);
    return { job };
  }
}

/** In-memory storage for tests. */
export class MemoryImageStorage implements ImageStorage {
  public files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.files.set(key, { bytes, contentType });
    return { url: `/media/${key}` };
  }
}

export type { ImageAngle, ImageJobStatus };
