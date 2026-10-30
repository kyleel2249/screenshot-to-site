# Deployment guide (Cloudflare)

> Status: the API, persistence and security code are implemented and tested offline. Items marked **TODO-LOCAL** need a machine with npm access.

## 1. Prerequisites
- Cloudflare account, `wrangler` CLI, Node 20+.
- A payment provider chosen **after** confirming your Ghana merchant eligibility (card / Mobile Money). Not yet integrated.
- A transactional email provider (the API calls an injectable `deps.mail`; no provider is wired yet).

## 2. Database (D1)
```
wrangler d1 create dera-darko-trade
```
Bind it as `DB`. `D1Persistence` creates its `app_state` table automatically and commits with compare-and-swap + retry, so concurrent
checkouts cannot oversell (verified in `src/test/persistence.test.ts`).
**Scale note:** the current adapter stores the whole application state as one versioned document. It is correct and safe for a small shop
but grows linearly; the normalised schema in `db/migrations/0001_init.sql` is the migration target when the catalogue/order volume grows.

## 3. Secrets (never commit)
```
echo -n "<owner enrolment reference>" | bun scripts/hash-bootstrap-ref.ts     # copy the hash
wrangler secret put ADMIN_BOOTSTRAP_REF_HASH
wrangler secret put ADMIN_PORTAL_PATH      # >=12 chars, [a-z0-9-], must not contain "admin"
wrangler secret put SESSION_SECRET         # 32+ random bytes
wrangler secret put EMAIL_API_KEY          # optional until you choose a provider (Resend adapter built in)
wrangler secret put EMAIL_FROM
wrangler secret put PAYMENT_WEBHOOK_SECRET
```
`SITE_ORIGIN` (e.g. `https://deradarkotrade.com`) is a plain variable; it is the only origin allowed to make state-changing calls.

## 4. First-run owner enrolment
`POST https://<site>/<ADMIN_PORTAL_PATH>/api/enrol` with `{reference,email,password}`. It works once, only while no staff account exists, then
closes permanently. Verify the owner email via the emailed link, then log in. The reference is never stored or logged.

## 5. Wiring (TODO-LOCAL)
Expose `createFetchHandler()` from `src/server/worker-entry.ts` for `/api/*` and the portal path (a TanStack Start server route or a
Pages Function). Then `npm i && npm run build && npm test`, deploy with `wrangler pages deploy`.
Apply `securityHeaders()` (src/lib/security/headers.ts) to HTML responses with a per-response nonce; serve `buildSitemap()`/`buildRobots()` at
`/sitemap.xml` and `/robots.txt`.

## 6. Before taking real money
- Provider adapter + webhook mapping to `{eventId, orderRef, amount, currency, status}`; test with sandbox credentials; confirm settlement currency.
- Scheduled job calling `releaseExpired()` every few minutes (Cron Trigger).
- Backups: `wrangler d1 export` on a schedule to private R2; **perform and record a restore test** — backups are not real until restored.
- Legal review of the draft policy pages for Ghana; replace demo data and placeholder contact details.


## How requests are routed
`src/server.ts` hands every request to `src/server/edge.ts` when the Worker has the `DB` D1 binding plus `SESSION_SECRET` and `SITE_ORIGIN`:

| Path | Answered by |
|---|---|
| `/api/*`, `<ADMIN_PORTAL_PATH>/api/*` | API handler (`src/server/api.ts`) |
| `/sitemap.xml`, `/robots.txt` | generated (published products only) |
| everything else | TanStack Start SSR, plus security headers; account/checkout/auth/tracking/portal pages are `no-store` + `noindex` |

Without those bindings (plain `vite dev`) pages still render and `/api/*` returns 503. Delete `public/robots.txt` before deploying so the generated one (which carries the Sitemap line) is served. A nonce-based CSP (`buildCsp`) is not applied yet; add it after a real build confirms the framework's inline scripts carry the nonce.
