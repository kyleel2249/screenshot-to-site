# Open admin dashboard (no login)

By the owner's decision, the dashboard has **no sign-in, password, two-step verification or enrolment**.

## Open it

Go to **`/dera-owner-console`** (for example `https://your-domain/dera-owner-console`). The full dashboard opens straight away:
overview, products, orders, purchasing, business, reviews, content, quotes, support, analytics, categories, shipping, discounts, audit.

## How it works

- Every request under `/dera-owner-console/api/...` is treated as the built-in owner (`owner@open.local`). That account has no usable
  password and no sessions or cookies are involved.
- Any other path is not an admin path (404). The path is not listed in `robots.txt`, and the page is sent `noindex`.
- Customer accounts, checkout and payments are unchanged.
- Removed entirely: staff login, owner enrolment (`ADMIN_BOOTSTRAP_REF_HASH`, `ADMIN_PORTAL_PATH`), two-step verification (authenticator
  codes, recovery codes), staff invitations/management, forced password change and re-authentication prompts.

## Important

**Anyone who learns this address can change prices, products, orders and refunds.** Keep it private. If you need to restrict who can
reach it later, put **Cloudflare Access** (or similar) in front of `/dera-owner-console*` — that needs no code change.

- Without a Cloudflare D1 database (binding `DB`), data lives in server memory and is lost on restart. The dashboard shows a red
  warning when that is the case. See `DEPLOYMENT.md`.
- Photo upload: with an R2 bucket (binding `MEDIA`) photos are stored normally; without one, small images (about 250 KB) are embedded.
