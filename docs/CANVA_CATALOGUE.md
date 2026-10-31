# Canva product imagery and dual-currency pricing — status report

## Phase 1 — Catalogue audit (done)
- The repository ships **no real products**. The catalogue is empty until the owner imports products (Products tab → CSV import) or adds them by hand. Category structure (A–O) is built in.
- Because no product records exist, **no product images have been generated**. Generating images for imaginary items would fabricate a catalogue, which the brief forbids.
- Gaps found and fixed in this phase: (1) no stored, owner-approved exchange rate existed — now built; (2) the site's default display currency was hard-coded to GHS instead of both — now both unless the owner chooses otherwise; (3) images had no provenance or approval state — now built.

## Phase 2 — Canva setup (done for folders; templates pending owner decision)
Master folder **DERA DARKO TRADE — MASTER PRODUCT IMAGE LIBRARY** — https://www.canva.com/folder/FAHZmbTWqr4 (ID `FAHZmbTWqr4`), with 21 subfolders:

| Folder | ID |
|---|---|
| Cars | FAHZme--GLw |
| Household & Kitchen | FAHZmY_UqwE |
| Clothing & Fashion | FAHZmanHmGw |
| Shoes & Footwear | FAHZmW1FAsk |
| Phones & Accessories | FAHZmee15z8 |
| Gift Sets | FAHZma1vCrk |
| Jewellery | FAHZmTCtsUo |
| Teas, Gummies & Supplements | FAHZmZhCbiA |
| Bags & Luggage | FAHZmQeN8bU |
| Toiletries & Personal Care | FAHZmXDqC-s |
| Hair & Hair Accessories | FAHZmbES7wA |
| Equipment & Medical Equipment | FAHZmY2KCLY |
| Farm Tools | FAHZmbC2mqw |
| Cosmetics & Fragrances | FAHZmVXMoWw |
| Building Materials & Fixtures | FAHZmeaO10o |
| Other Products | FAHZmbLLniw |
| Product Promotional Graphics | FAHZmXYL3wk |
| Homepage Featured Products | FAHZmbtAbC4 |
| Best Sellers | FAHZmThw3ZQ |
| New Arrivals | FAHZmVIkNnM |
| Seasonal Campaigns | FAHZmc8R0Rs |

Not yet done: product-image and promotional templates, and any image generation. These wait for real product records and for the owner's approval of the approach (decision gate below).

## What the website now supports (built and tested)
- **Exchange rate**: the owner enters cedis-per-dollar as text (parsed to integer micro-units, no floating point), names the source, and gives the effective date. Changes need a recent password re-check and are audit-logged (previous rate recorded). Rates over 14 days old are flagged. Nothing is assumed: with no approved rate, only prices the owner set are shown.
- **Display mode**: cedis only, dollars only, or both (default). Shoppers may override for display; checkout always charges in the currency the owner priced. A converted price is labelled approximate with the rate, source and date.
- **Image provenance**: each image is a verified photo or an illustration; new images are hidden until approved; making an image the main one keeps the previous one; the live main image can't be rejected; shoppers see an "Illustrative image" note on illustrations; Canva design IDs are stored internally and never exposed publicly.
- **Photo upload** to Cloudflare R2 (see DEPLOYMENT.md) with byte-level validation.

## Not built from the brief (honest list)
- Direct Canva-to-website export/upload: Canva's connection here can export a design to a download link, but this site has no stored Canva credentials (by design). Workflow: export from Canva → upload in the Products tab → add with its Canva design ID.
- Per-product original/sale/wholesale/cost price fields beyond the existing price and sale price; cost-based pricing and "Pending Price Approval" status.
- Bulk "generate images for a whole category" from the dashboard.
- Image-generation history beyond the audit log.

## Decision gate — owner approval needed
1. Provide real products (CSV import) or confirm a starting list to illustrate.
2. Confirm that illustrative (generated) images may be used as placeholders, shown with the "Illustrative image" note, until verified photos replace them.
3. Approve an exchange rate and its source.
