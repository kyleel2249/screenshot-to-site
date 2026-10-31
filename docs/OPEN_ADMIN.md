# Temporary open admin access

**Status: ON** for development.

While `STAFF_OPEN_ACCESS = true` in `src/server/services/auth.ts`:

- Staff / owner can sign in with **email only** (password may be blank or anything).
- **Email verification** is not required for staff.
- **MFA / authenticator** is not required.
- Step-up re-auth and forced password change are skipped for staff.
- Customer accounts are **unchanged** (still need password).

## How to sign in
1. Enrol the owner once (portal enrol) if you have not already.
2. Open the site login / portal login.
3. Enter the **owner email** and any password (or leave blank if the form allows).
4. You should reach the dashboard without email links or MFA codes.

## How to lock down for production
1. Set `STAFF_OPEN_ACCESS = false` in `src/server/services/auth.ts`.
2. Redeploy.
3. Ensure every staff user has a strong password, verified email, and MFA set up.
4. Rotate `SESSION_SECRET` if this mode was ever enabled on a public URL.

**Do not leave open access enabled on a public production site.** Anyone who knows a staff email can take over the admin.
