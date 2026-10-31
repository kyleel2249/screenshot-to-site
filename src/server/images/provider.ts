/**
 * Image generation provider abstraction.
 * Secrets stay server-side (IMAGE_API_KEY). Never expose keys to the frontend.
 *
 * Supported mode: OpenAI Images API-compatible endpoint
 * (https://api.openai.com/v1/images/generations or a compatible proxy).
 *
 * If IMAGE_API_KEY is unset, generate() fails closed with a clear error —
 * we never claim an image was generated.
 */

import type { GeneratedImageMeta } from "../../lib/domain/image-generation";

export interface ImageProviderResult {
  /** Raw image bytes */
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  meta: GeneratedImageMeta;
}

export interface ImageGenerationProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;
  generate(input: {
    prompt: string;
    width: number;
    height: number;
    /** Optional seed / style hint for the provider */
    quality?: "standard" | "hd";
  }): Promise<ImageProviderResult>;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string; // default https://api.openai.com/v1
  model?: string; // e.g. gpt-image-1 or dall-e-3
  fetchImpl?: typeof fetch;
}

function sizeFor(width: number, height: number): string {
  // OpenAI Images API common sizes
  if (width === height) return "1024x1024";
  if (width > height) return "1792x1024";
  return "1024x1792";
}

/** OpenAI Images API (and compatible proxies). */
export class OpenAICompatibleImageProvider implements ImageGenerationProvider {
  readonly id = "openai-compatible";
  readonly displayName = "OpenAI-compatible Images API";
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: ProviderConfig = {}) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = cfg.model ?? "gpt-image-1";
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 8);
  }

  async generate(input: {
    prompt: string;
    width: number;
    height: number;
    quality?: "standard" | "hd";
  }): Promise<ImageProviderResult> {
    if (!this.isConfigured()) {
      throw new Error(
        "IMAGE_API_KEY is not configured. Set the server secret before generating product images.",
      );
    }

    const body = {
      model: this.model,
      prompt: input.prompt,
      n: 1,
      size: sizeFor(input.width, input.height),
      quality: input.quality === "hd" ? "hd" : "standard",
      response_format: "b64_json",
    };

    const res = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Image provider HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string; revised_prompt?: string; url?: string }>;
    };
    const item = json.data?.[0];
    if (!item?.b64_json) {
      throw new Error("Image provider returned no image data");
    }

    const binary = Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0));
    const now = new Date().toISOString();
    return {
      bytes: binary,
      mimeType: "image/png",
      width: input.width,
      height: input.height,
      meta: {
        provider: this.id,
        model: this.model,
        prompt: input.prompt,
        revisedPrompt: item.revised_prompt,
        width: input.width,
        height: input.height,
        mimeType: "image/png",
        generatedAt: now,
      },
    };
  }
}

/** Factory from environment (Worker / Node). */
export function createImageProviderFromEnv(env: {
  IMAGE_API_KEY?: string;
  IMAGE_API_BASE_URL?: string;
  IMAGE_MODEL?: string;
}): ImageGenerationProvider {
  return new OpenAICompatibleImageProvider({
    apiKey: env.IMAGE_API_KEY,
    baseUrl: env.IMAGE_API_BASE_URL,
    model: env.IMAGE_MODEL,
  });
}
