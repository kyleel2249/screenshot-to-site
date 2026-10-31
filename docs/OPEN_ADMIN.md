# Temporary open admin access (NO LOGIN)

**Status: ON** — `STAFF_OPEN_ACCESS = true` in `src/lib/security/open-access.ts`.

## Open the dashboard

Go to:

**`/dera-owner-console`**

Example: `https://your-domain/dera-owner-console`

There is **no sign-in, password, email verification, or MFA**. Opening the URL is enough.

The API auto-creates an owner actor (`owner@open.local`) on first request.

## Notes

- Without Cloudflare D1, data is **in-memory** and resets when the Worker restarts.
- Some advanced admin API routes are simplified while open access is on; core product/catalogue management works.
- **Customer** checkout and accounts are separate; this only unlocks the staff portal.

## Lock down for production

1. Set `STAFF_OPEN_ACCESS = false` in `src/lib/security/open-access.ts`.
2. Restore full `src/server/api.ts` from git history before the open-access simplification (or re-apply the complete API).
3. Configure D1, `SESSION_SECRET`, `SITE_ORIGIN`, `ADMIN_BOOTSTRAP_REF_HASH`, `ADMIN_PORTAL_PATH`.
4. Redeploy and enrol with real MFA.
