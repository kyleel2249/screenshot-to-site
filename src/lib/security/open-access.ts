/**
 * TEMPORARY development unlock for Dera Darko Trade admin.
 *
 * When true:
 * - Admin dashboard needs NO login, password, email verification, or MFA
 * - Any visit to the portal path auto-grants an owner session
 * - Owner enrolment bootstrap hash is not required
 * - API may run on in-memory persistence if D1/secrets are missing
 *
 * Set to false and redeploy before real production traffic.
 */
export const STAFF_OPEN_ACCESS = true;

/** Default secret portal path used only while STAFF_OPEN_ACCESS is true and ADMIN_PORTAL_PATH is unset. */
export const OPEN_ACCESS_PORTAL_PATH = "dera-owner-console";
