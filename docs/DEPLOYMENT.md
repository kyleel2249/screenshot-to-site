# Deployment guide (Cloudflare)

> Status: the API, persistence and security code are implemented and covered by offline tests. The React pages were written and type-checked against stand-in library types, but have **not been built** (the build environment could not reach the npm registry). Your first `npm i && npm run build && npm test` is part of acceptance — fix anything it reports before going live.

## 1. Prerequisites
- Cloudflare account, `wrangler` CLI, Node 20+.
- A payment provider chosen **after** confirming your Ghana merchant eligibility. The Paystack adapter (card + Mobile Money) is built; it has not run against the live service.
- A transactional email provider: the Resend adapter is built; you need an API key and a verified sending domain.

## 2. Database (D1)
```
wrangler d1 create dera-darko-trade
```
Bind it as `DB`. `D1Persistence` creates its `app_state` table automatically and commits with compare-and-swap + retry, so concurrent
checkouts cannot oversell (verified in `src/test/persistence.test.ts`).
**Scale note:** the adapter stores the whole application state as one versioned document. D1 rejects rows over ~2 MB, so once the document passes ~700 KB it is
automatically split into ~400 KB chunk rows (written first, then switched in by the same compare-and-swap, so readers never see a half-written state; leftovers from a crashed write are
removed by the maintenance job). This is correct and safe for a small-to-medium shop, but every change rewrites the whole document, so it gets slower as orders accumulate (thousands of orders is fine;
tens of thousands is the point to move to the normalised schema in `db/migrations/0001_init.sql`). Archive or export old orders before then.

## 3. Secrets (never commit)
```
echo -n "<owner enrolment reference>" | bun scripts/hash-bootstrap-ref.ts     # copy the hash
wrangler secret put ADMIN_BOOTSTRAP_REF_HASH
wrangler secret put ADMIN_PORTAL_PATH      # >=12 chars, [a-z0-9-], must not contain "admin"
wrangler secret put SESSION_SECRET         # 32+ random bytes
wrangler secret put DATA_ENCRYPTION_KEY    # 32+ random bytes; encrypts staff authenticator seeds. Keep it separate from SESSION_SECRET and never rotate without re-enrolling staff 2FA. Falls back to SESSION_SECRET if unset.
wrangler secret put EMAIL_API_KEY          # optional until you choose a provider (Resend adapter built in)
wrangler secret put EMAIL_FROM
wrangler secret put PAYMENT_PROVIDER        # "paystack"
wrangler secret put PAYMENT_SECRET_KEY      # provider secret key (sk_live_… only after going live)
wrangler secret put PAYMENT_WEBHOOK_SECRET
# Payment methods: card and Mobile Money run through the provider above (Mobile Money is GHS-only on Paystack).
# Bank transfer needs your real account details; it stays hidden until they are set. Staff then confirm receipt in the portal Orders tab
# (recorded amount + bank reference; a wrong amount goes to manual review, a reused reference is refused). Optional: PAYMENT_METHODS, BANK_TRANSFER_HOLD_HOURS.
wrangler secret put BANK_TRANSFER_DETAILS
```
`SITE_ORIGIN` (e.g. `https://deradarkotrade.com`) is a plain variable; it is the only origin allowed to make state-changing calls.

## 4. First-run owner enrolment
`POST https://<site>/<ADMIN_PORTAL_PATH>/api/enrol` with `{reference,email,password}`. It works once, only while no staff account exists, then
closes permanently. Verify the owner email via the emailed link, then log in. The reference is never stored or logged.

## 5. Build and deploy
`src/server.ts` is already wired: with the `DB`, `SESSION_SECRET` and `SITE_ORIGIN` bindings present it routes everything through `src/server/edge.ts` (API, generated sitemap/robots, per-product SEO tags, security headers, CSP). Then:
```
npm i && npm run build && npm test     # regenerates src/routeTree.gen.ts; fix any type errors it reports
```
Use `wrangler.example.jsonc` as the starting point for your Cloudflare config (D1 binding `DB`, `SITE_ORIGIN`, cron trigger) and adapt it to the Worker output your build produces. If your platform does not run the Worker's `scheduled` handler, schedule a `POST https://<site>/api/maintenance` with header `x-maintenance-key: <MAINTENANCE_KEY>` every 5 minutes instead (any scheduler works; the endpoint stays disabled until you set a `MAINTENANCE_KEY` of 24+ characters).

## 6. Before taking real money
- Provider adapter + webhook mapping to `{eventId, orderRef, amount, currency, status}`; test with sandbox credentials; confirm settlement currency.
- Maintenance Cron Trigger: add `"triggers": { "crons": ["*/5 * * * *"] }` to your wrangler config. The Worker's `scheduled` handler releases expired stock holds (bank-transfer holds included) and clears expired sessions and tokens.
- Backups: `wrangler d1 export` on a schedule to private R2; **perform and record a restore test** — backups are not real until restored.
- Legal review of the policy pages for Ghana, then tick "reviewed" in the portal Content tab (until then they show a DRAFT banner).
- In the portal: fill in Business details, import your real products (Products → Import), set shipping zones and your exchange rate, and add your bank details secret if you want bank transfer.
- Place a test order of each kind (card, Mobile Money, bank transfer, pre-order) and a refund before announcing the shop.


## How requests are routed
`src/server.ts` hands every request to `src/server/edge.ts` when the Worker has the `DB` D1 binding plus `SESSION_SECRET` and `SITE_ORIGIN`:

| Path | Answered by |
|---|---|
| `/api/*`, `<ADMIN_PORTAL_PATH>/api/*` | API handler (`src/server/api.ts`) |
| `/sitemap.xml`, `/robots.txt` | generated (published products only) |
| everything else | TanStack Start SSR, plus security headers; account/checkout/auth/tracking/portal pages are `no-store` + `noindex` |

Without those bindings (plain `vite dev`) pages still render and `/api/*` returns 503. Delete `public/robots.txt` before deploying so the generated one (which carries the Sitemap line) is served. The nonce-based CSP is applied to every HTML page in **report-only** mode by default (the edge adds a fresh nonce to every `<script>` tag). After your first real deploy, browse the shop, checkout and portal, check the logs for `csp-violation` lines (browsers report to `/api/csp-report`), fix anything flagged, then set `CSP_MODE=enforce`. Cached public product pages reuse one nonce for their cache lifetime; that is acceptable because no page reflects user input.


## Two-step verification recovery (owner)
Every staff account must use an authenticator app. If the owner loses both the phone and the recovery codes, an operator with D1 access clears the owner's `mfa` field in the stored state (the `users` entry for the owner), after which the next sign-in forces a fresh setup. Other staff are reset by the owner from Dashboard → Staff → Reset 2-step. Keep the owner's recovery codes offline.


## Going live with Paystack
1. In the Paystack dashboard set the webhook URL to `https://<your-site>/api/webhooks/paystack` (events: `charge.success`). Paystack signs with your secret key; the Worker verifies HMAC-SHA512 over the raw body.
2. Start with a **test** key, place an order, press Pay now, complete a test payment, and confirm the order becomes *Payment confirmed* in the dashboard. Only then switch to live keys.
3. The adapter has never run against the real service; treat the first test payments as part of acceptance testing. Mismatched amounts or currencies are held as *Payment under review* — never marked paid.
4. USD charging requires USD to be enabled on your Paystack account; GHS is the default.
