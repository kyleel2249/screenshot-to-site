# Temporary open admin access

**Status: ON** (`STAFF_OPEN_ACCESS = true` in `src/lib/security/open-access.ts`).

## Portal URL

While open access is on and `ADMIN_PORTAL_PATH` is unset, the owner console is at:

**`/dera-owner-console`**

Example: `https://your-site.example/dera-owner-console`

## First-time enrolment

1. Open the portal URL above.
2. Enrol with:
   - **Email** — your owner email
   - **Reference** — any text (ignored while open access is on)
   - **Password** — optional; blank is allowed
3. Sign in with that email (password optional).
4. No email verification or MFA is required.

You do **not** need `ADMIN_BOOTSTRAP_REF_HASH`, `SESSION_SECRET`, or D1 for this temporary mode. Without D1 the shop uses **in-memory** storage (data resets when the Worker restarts). For lasting data, create D1 + secrets as in `docs/DEPLOYMENT.md`.

## If you still see errors

| Message | Meaning |
|--------|--------|
| Enrolment unavailable / details rejected | An owner may already exist, or setup was closed. Clear the D1 `app_state` (or wait for a memory reset) and try once. |
| Service not configured | Old deploy without open-access server fallback — pull latest `main` and redeploy. |

## Lock down for production

1. Set `STAFF_OPEN_ACCESS = false` in `src/lib/security/open-access.ts`.
2. Configure D1, `SESSION_SECRET`, `SITE_ORIGIN`, `ADMIN_BOOTSTRAP_REF_HASH`, `ADMIN_PORTAL_PATH`.
3. Redeploy and complete real enrolment with MFA.
