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

## Admin (only under the secret `ADMIN_PORTAL_PATH`, e.g. `/ops-xxxx/api/...`)
Unauthenticated or non-staff requests receive a plain 404. Authorisation is checked per action (RBAC).
`POST /enrol` (one-time), `POST /reauth`, `POST /products`, `POST /products/status` (bulk, all-or-nothing), `POST /products/publish`,
`POST /prices`, `POST /stock`, `GET /orders`, `POST /orders/status`, `POST /refunds` (+ recent re-auth), `POST /refunds/complete`,
`GET /export/orders.csv` (+ recent re-auth), `GET /audit`.
