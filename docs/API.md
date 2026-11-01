# API reference (`src/server/api.ts`)

All responses are JSON with `Cache-Control: private, no-store`. State-changing requests require an `Origin` header equal to `SITE_ORIGIN`.
Session cookie `ddt_session` is HttpOnly, Secure, SameSite=Strict.

## Public
| Method & path | Notes |
|---|---|
| `GET /api/products` | Published products only; availability/labels/prices from the database. No costs or exact stock. |
| `POST /api/register` | Same 201 response whether or not the email exists. Token is emailed, never returned. |
| `POST /api/verify-email` `{token}` | |
| `POST /api/login` `{email,password}` | Generic error; lockout after 5 failures; sets cookie. |
| `POST /api/logout` | Revokes the server-side session. |
| `POST /api/password/forgot` `{email}` | Always generic 200. |
| `POST /api/password/reset` `{token,password}` | Single-use; revokes all sessions. |
| `POST /api/checkout` | Server prices everything; idempotent by `idempotencyKey`; reserves stock for 30 min. Returns `trackingSecret` once. |
| `GET /api/track?ref=&secret=` | Status only; no address/email/payment data. |
| `POST /api/support` | Opens a ticket. |
| `POST /api/webhooks/payments` | HMAC signature over the raw body (`x-signature`); duplicates are no-ops. |

## Signed-in customer
`GET /api/me`, `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/cancel`, `POST /api/account/profile`,
`GET|POST /api/account/addresses`, `GET /api/account/export`, `POST /api/account/delete`.
Other customers' resources return 404 (indistinguishable from missing).

## Admin (open, no login; only under `/dera-owner-console/api/...`)
Unauthenticated or non-staff requests receive a plain 404. Authorisation is checked per action (RBAC).
`POST /reauth` (always ok), `POST /products`, `POST /products/status` (bulk, all-or-nothing), `POST /products/publish`,
`POST /prices`, `POST /stock`, `GET /orders`, `POST /orders/status`, `POST /refunds` (+ recent re-auth), `POST /refunds/complete`,
`GET /export/orders.csv` (+ recent re-auth), `GET /audit`.

## Anonymous guest dashboard (`/api/guest/*`)
No login. `GET /api/guest/session` issues a signed `ddt_guest` cookie (HttpOnly, Secure, SameSite=Strict, 30-day sliding expiry); nothing is stored until the first write.
All writes require same-origin `Origin` (CSRF) and are rate-limited (general 240/min, sensitive 12/min, writes 6/10 min). Without a valid session: `401 {"error":"no_session"}`.

| Endpoint | Notes |
|---|---|
| `GET /track?ref=&secret=` | No session needed. Wrong code and unknown ref give identical 404s. No street/phone/email in the view. |
| `GET /promotions` | Real sale prices inside their sale window only. |
| `GET /session`, `GET /recommendations?slug=` | Rule-based; session signals + real paid-order aggregates. "Bought together" needs ≥2 real co-purchases. |
| `POST\|DELETE /cart`, `POST /cart/quote` | Quantities only are stored; prices and stock are re-validated server-side (`canPurchase`, `priceCart`). |
| `POST /wishlist`, `POST\|DELETE /compare` (max 4), `POST /viewed`, `POST\|DELETE /searches`, `POST /activity/clear` | Session-scoped. |
| `PUT /preferences`, `POST\|DELETE /addresses` | Optional profile; max 5 addresses. |
| `GET /orders`, `POST /orders/claim`, `POST /orders/reissue` | Only orders placed by, or claimed with ref + code into, this session. |
| `POST /checkout` | Guest checkout via `placeOrder`; amount/currency server-validated; fails closed without a matching delivery zone. Returns the one-time tracking code. |
| `GET /notifications`, `POST /notifications/read` | Derived from real order/ticket history; price alerts and marketing are opt-in. |
| `GET\|POST /enquiries`, `GET\|POST /returns` | Opens a staff ticket / a return, refund, cancellation, damaged or incorrect-item request. Never an automatic refund. |
| `DELETE /data` | "Forget me": deletes the server record and rotates the cookie. Placed orders remain with the business. |
