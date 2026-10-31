# Storefront & product imagery

## Product photos (owner path)
**Real product images are uploaded in the admin dashboard** (Products → product images), or by replacing files under `public/products/<SKU>.png` and redeploying.

- Preferred: Cloudflare R2 bucket bound as `MEDIA` (see `docs/DEPLOYMENT.md`). Staff upload JPEG/PNG/WebP/GIF (validated server-side).
- Fallback: public URL or static file under `/products/`.
- No image API key is required for day-to-day catalogue operation.
- Optional AI generation modules under `src/server/images/` remain available if a key is added later; they are not required.

## Shop collection (`/shop`)
Layout follows a retail collection pattern:

- Left category sidebar (desktop) / filter drawer (mobile)
- All 15 top-level categories with live counts and expandable subcategories
- Collection header: title + “Showing X of Y products”
- Sort: newest, price, name
- Search, availability, attribute facets
- Grid of product cards (2–4 columns responsive)
- Load more (24 products per page) so the **full** catalogue stays reachable

Brand: navy `#071D49`, gold `#F5B900`, white, charcoal — **no green UI**.

## Homepage (`/`)
- Hero: “Everything you need. All in one place.”
- CTAs into `/shop` (full catalogue)
- Category grid from the live category tree
- New arrivals strip from labelled products (or newest if none labelled)

## Pricing
- Dual GHS / USD via existing `money` + currency context
- Missing approved price → “Price on request” (never invent prices)
- Products stay unpublished until the owner sets a price and publishes

## Getting products onto the shop
1. Deploy with D1 + secrets (see `docs/DEPLOYMENT.md`).
2. Admin portal → Products → Import `data/catalogue-seed.csv` (or your real CSV).
3. Set GHS (and optionally USD) prices; publish items that should appear publicly.
4. Upload real photos per product in the Products tab (or replace `public/products/DDT-XXX.png`).
5. Shoppers see them on `/shop` and the homepage collections.
