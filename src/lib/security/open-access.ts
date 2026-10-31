/**
 * TEMPORARY development unlock for Dera Darko Trade admin.
 *
 * When true:
 * - Staff may sign in without a correct password / MFA / email verification
 * - Owner enrolment does not need ADMIN_BOOTSTRAP_REF_HASH
 * - A default portal path is used if ADMIN_PORTAL_PATH is unset
 * - The Worker may run the API on in-memory persistence if D1/secrets are missing
 *
 * Set to false and redeploy before real production traffic.
 */
export const STAFF_OPEN_ACCESS = true;

/** Default secret portal path used only while STAFF_OPEN_ACCESS is true and ADMIN_PORTAL_PATH is unset. */
export const OPEN_ACCESS_PORTAL_PATH = "dera-owner-console";
