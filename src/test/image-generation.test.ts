import { describe, expect, it } from "vitest";
import {
  shouldSkipAiGeneration,
  type ImageGenerationRequest,
} from "../lib/domain/image-generation";
import { buildProductImagePrompt } from "../server/images/prompt";
import {
  ImageGenerationService,
  MemoryImageStorage,
} from "../server/images/service";
import type { ImageGenerationProvider, ImageProviderResult } from "../server/images/provider";
import { OpenAICompatibleImageProvider } from "../server/images/provider";

const baseReq = (over: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest => ({
  productId: "p1",
  sku: "DDT-029",
  name: "Classic White Sneakers",
  categorySlug: "cat-shoes-and-footwear--sneakers",
  angle: "primary",
  ...over,
});

describe("shouldSkipAiGeneration", () => {
  it("skips cars, medical, teas, building", () => {
    expect(shouldSkipAiGeneration("cat-cars--suvs")).toBe(true);
    expect(shouldSkipAiGeneration("cat-equipment-medical-equipment-and-farm-tools--medical-equipment")).toBe(true);
    expect(shouldSkipAiGeneration("cat-teas-gummies-and-supplements--fibroid-tea-products")).toBe(true);
    expect(shouldSkipAiGeneration("cat-building-materials-and-fixtures--sinks")).toBe(true);
  });
  it("allows fashion, shoes, jewellery", () => {
    expect(shouldSkipAiGeneration("cat-shoes-and-footwear--sneakers")).toBe(false);
    expect(shouldSkipAiGeneration("cat-clothing-and-fashion--handbags")).toBe(false);
    expect(shouldSkipAiGeneration("cat-jewellery--necklaces")).toBe(false);
  });
});

describe("buildProductImagePrompt", () => {
  it("builds footwear-specific prompt", () => {
    const p = buildProductImagePrompt(baseReq());
    expect(p.toLowerCase()).toContain("footwear");
    expect(p).toContain("Classic White Sneakers");
    expect(p.toLowerCase()).not.toContain("whatsapp");
  });
  it("builds jewellery-specific prompt", () => {
    const p = buildProductImagePrompt(
      baseReq({
        name: "Gold-Tone Chain Necklace",
        categorySlug: "cat-jewellery--necklaces",
        sku: "DDT-044",
      }),
    );
    expect(p.toLowerCase()).toContain("jewellery");
  });
  it("never invents medical claims for tea category (skipped upstream, prompt still neutral)", () => {
    const p = buildProductImagePrompt(
      baseReq({
        name: "Herbal Tea Blend",
        categorySlug: "cat-teas-gummies-and-supplements--fibroid-tea-products",
      }),
    );
    expect(p.toLowerCase()).not.toContain("cure");
    expect(p.toLowerCase()).not.toContain("treat fibroids");
  });
});

describe("OpenAICompatibleImageProvider", () => {
  it("is not configured without key", () => {
    const p = new OpenAICompatibleImageProvider({});
    expect(p.isConfigured()).toBe(false);
  });
  it("fails closed when generating without key", async () => {
    const p = new OpenAICompatibleImageProvider({});
    await expect(
      p.generate({ prompt: "test", width: 1024, height: 1024 }),
    ).rejects.toThrow(/IMAGE_API_KEY/);
  });
});

class FakeProvider implements ImageGenerationProvider {
  readonly id = "fake";
  readonly displayName = "Fake";
  constructor(private ok: boolean) {}
  isConfigured() {
    return this.ok;
  }
  async generate(): Promise<ImageProviderResult> {
    if (!this.ok) throw new Error("IMAGE_API_KEY is not configured");
    const bytes = new Uint8Array([137, 80, 78, 71]); // tiny PNG header-ish
    return {
      bytes,
      mimeType: "image/png",
      width: 1200,
      height: 1200,
      meta: {
        provider: this.id,
        prompt: "x",
        width: 1200,
        height: 1200,
        mimeType: "image/png",
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

describe("ImageGenerationService", () => {
  it("fails with clear error when provider not configured", async () => {
    const svc = new ImageGenerationService({
      provider: new FakeProvider(false),
      storage: new MemoryImageStorage(),
    });
    const { job } = await svc.generateOne(baseReq());
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/IMAGE_API_KEY/);
  });

  it("skips safety categories", async () => {
    const svc = new ImageGenerationService({
      provider: new FakeProvider(true),
      storage: new MemoryImageStorage(),
    });
    const { job } = await svc.generateOne(
      baseReq({
        categorySlug: "cat-cars--suvs",
        name: "Family SUV",
        sku: "DDT-001",
      }),
    );
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/safety/i);
  });

  it("stores image and marks generated when provider succeeds", async () => {
    const storage = new MemoryImageStorage();
    const svc = new ImageGenerationService({
      provider: new FakeProvider(true),
      storage,
    });
    const { job, image } = await svc.generateOne(baseReq());
    expect(job.status).toBe("generated");
    expect(image).toBeDefined();
    expect(image!.source).toBe("ai_generated");
    expect(image!.customerRole).toBe("product_image");
    expect(image!.url).toMatch(/^\/media\/products\/DDT-029\//);
    expect(storage.files.size).toBe(1);
  });
});
