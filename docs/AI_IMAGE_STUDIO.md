# Product imagery — primary and optional paths

## Primary path (required for operations)
**Upload real product photos in the admin dashboard** (Products → images) or place files at `public/products/<SKU>.png`.
Bind Cloudflare R2 as `MEDIA` for production uploads (see `docs/DEPLOYMENT.md`).

**No image API key is required.**

## Optional AI generation (not required)
Modules under `src/server/images/` and `src/lib/domain/image-generation.ts` support an OpenAI-compatible Images API if you later set `IMAGE_API_KEY`. Without a key, those jobs fail closed. Do not depend on AI generation for launch.

## Policy
- No Canva dependency for product imagery.
- Never invent prices, stock, medical claims, logos, or certifications.
- Prefer verified supplier / owner photographs on the storefront.

## Related
- Storefront collection layout: `docs/STOREFRONT.md`
- Deployment & R2: `docs/DEPLOYMENT.md`
