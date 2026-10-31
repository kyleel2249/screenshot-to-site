# Canva product imagery and dual-currency pricing — status report

## Phase 1 — Catalogue audit (done)
- Full category taxonomy A–O is built.
- Starter catalogue: 85 generic, unpublished “Coming soon / price pending” items (`data/catalogue-seed.csv`).
- No fabricated prices, brands, medical claims, stock levels or certifications.
- Every SKU has a navy/gold branded placeholder tile at `public/products/DDT-XXX.png`.

## Phase 2 — Canva setup (done on connected account)
Master folder **DERA DARKO TRADE — MASTER PRODUCT IMAGE LIBRARY**  
https://www.canva.com/folder/FAHZmugXN_k  
Folder ID: `FAHZmugXN_k`

| Folder | ID |
|---|---|
| Cars | FAHZmuRzLig |
| Household & Kitchen | FAHZmkdAwDw |
| Clothing & Fashion | FAHZmic4XbE |
| Shoes & Footwear | FAHZmmQYZ7U |
| Phones & Accessories | FAHZmuwbN88 |
| Gift Sets | FAHZmr4UIbM |
| Jewellery | FAHZmrQ_dMA |
| Teas, Gummies & Supplements | FAHZmlWR1ek |
| Bags & Luggage | FAHZmuF5mMY |
| Toiletries & Personal Care | FAHZmihi72I |
| Hair & Hair Accessories | FAHZmv0gJgQ |
| Equipment & Medical Equipment | FAHZmuTjsyE |
| Farm Tools | FAHZmsooa4I |
| Cosmetics & Fragrances | FAHZmtWTHFk |
| Building Materials & Fixtures | FAHZmhqdxM8 |
| Other Products | FAHZmmHDnbs |
| Product Promotional Graphics | FAHZmp1mV4w |
| Homepage Featured Products | FAHZmuZoPJw |
| Best Sellers | FAHZmv0FFyM |
| New Arrivals | FAHZmt_bxlc |
| Seasonal Campaigns | FAHZmxwIpM8 |

## Owner decision (2026-10-31)
**Illustrative AI images are approved for use as temporary product photos.**
- Do **not** show any “illustrative”, “AI-generated”, or similar notice to shoppers.
- Treat generated images as normal product images on the storefront.
- Keep internal tracking only (admin / manifest) so real supplier photos can replace them later without customer-facing change.
- Vehicles, medical equipment, health teas/supplements and building materials remain “enquire” placeholders (no AI generation) to avoid looking like exact items for sale.

## Phase 3 — Image generation (in progress, credit-limited)
Generation jobs have been started for:
- DDT-029 Classic White Sneakers
- DDT-010 Leather-Look Tote Bag
- DDT-054 Everyday Backpack
- DDT-037 Portable Power Bank
- DDT-038 Smart Watch
- DDT-044 Gold-Tone Chain Necklace
- DDT-045 Hoop Earrings

Further batches are blocked until Canva AI image credits are restored on the connected account.

**Workflow when credits return**
1. Generate remaining safe-category images (fashion, shoes, bags, phones accessories, jewellery, cosmetics, household, gift sets, toiletries, hair).
2. Move each asset into its category folder under `FAHZmugXN_k`.
3. Owner (or admin) downloads PNG ≥ 800×800 from Canva → replaces `public/products/<SKU>.png` or uploads via Products → Product images.
4. Mark internally as placeholder until a verified photo is uploaded; never surface that flag to customers.

## Dual-currency pricing (already built)
- Default display: both GHS and USD.
- Exchange rate: 11.47 GHS per USD (owner-set, 2026-10-31). Dashboard override supported.
- Products stay unpublished until a price is approved.
- Integer micro-unit arithmetic; audit log; no invented rates.

## What the website supports
- Image upload to Cloudflare R2 with validation.
- Canva design/media IDs stored internally only.
- Product cards and detail pages ready for dual currency + availability labels.
- Admin Products tab: CSV import, image assignment, price approval.

## Honest limitations
- Direct Canva → site auto-upload is not wired (by design; no stored Canva credentials in the app).
- Export path: Canva Download → admin upload or replace file in `public/products/`.
- Bulk “generate whole category” dashboard action not yet built.
- Canva AI credits are finite; generation must resume when credits are available.
