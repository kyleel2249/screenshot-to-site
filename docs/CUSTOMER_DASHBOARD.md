# Customer dashboard (`/dashboard`)

An authentication-free shopping dashboard. Visitors never see a login, registration or email prompt; a signed anonymous guest session is created automatically.

## What exists
- **Route:** `src/routes/dashboard.tsx` (noindex; `/dashboard` is disallowed in robots.txt and treated as a private page by the edge). Module chosen with `?m=<id>`; presets `q`, `cat`, `ref`, `kind`, `order`.
- **22 modules:** Home, Shop All, Categories, New Arrivals, Best Sellers, Featured, Special Offers, Wishlist, Cart, Comparison, Recently Viewed, Orders, Track, Returns & Refunds, Addresses, Notifications, Support, FAQ, Delivery, About, Contact, Preferences (`src/components/dashboard/*`).
- **Layout:** left sidebar, top bar (search, currency), collapsible right panel (cart, wishlist, viewed, recommended, offers, delivery, support); mobile drawer, bottom bar and expandable panel.
- **Server:** `src/server/guest.ts` (HTTP) + `src/server/services/guest.ts` (rules) + `src/lib/recommend.ts`; see `docs/API.md`.
- **Data (inside the existing single-document store):** `guestSessions`, `enquiries`, `returnRequests`, `OrderRow.shipment`. No SQL migration is needed because persistence is one JSON document; the D1 schema is unchanged.

## Security model
Signed HMAC session cookie; server-generated IDs; session-only records reachable only through the owning session; tracking by reference + one-time code (stored hashed); same-origin CSRF check; rate limits; 60 KB body cap; prices and stock never trusted from the browser; order views omit street, phone and email; return/refund/cancel are requests for staff approval, never automatic refunds.

## No invented data
No sample products, prices, stock, reviews, ratings, orders or delivery rules. Unpriced products show "Price on request". Specs missing from a product show "Not provided". Recommendations use only the visitor's own session and real paid orders.

## Verification status (honest)
| Area | Status |
|---|---|
| Server guest API, session/CSRF/IDOR/rate-limit/checkout/tracking/returns | **Tested**: `src/test/guest.test.ts` (37 tests) |
| Pure dashboard helpers | **Tested**: `src/test/dashboard-lib.test.ts` (12 tests) |
| Full suite (after merging the upstream open-admin change) | 240 pass; the only error is the missing `@tanstack/react-query` package (not installable here) |
| UI components and route | **Syntax-checked only** (`bun build --no-bundle`). No `vite build`, type-check, browser, screenshot, Lighthouse, e2e or deployment was possible: the npm registry is unreachable from this environment |
| `routeTree.gen.ts` | Hand-edited to add `/dashboard`; regenerate with `vite build`/dev server |

## Known limitations
No photo upload on return requests; guests cannot post reviews (the existing review system needs a delivered-order customer); no tax or handling charges exist; coupon codes are not listed publicly; email notices need the mail key; no staff-portal screen yet to enter shipment details (`setShipment` service exists and is tested).

## Owner actions
Set `SESSION_SECRET` and `SITE_ORIGIN`; publish delivery zones; configure payment keys and the mail key; add real products with approved prices; run `bun install && bun run build` and fix anything the type-checker reports.
