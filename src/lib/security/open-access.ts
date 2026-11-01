/**
 * Open admin dashboard (owner decision): the dashboard has NO login, NO password, NO two-step verification and NO enrolment.
 * Anyone who opens this address manages the shop. Keep the address private, and put Cloudflare Access (or similar) in front of
 * it if you ever need to restrict who can reach it. See docs/OPEN_ADMIN.md.
 */

/** The dashboard path (also the admin API prefix: /dera-owner-console/api/...). */
export const OPEN_ACCESS_PORTAL_PATH = "dera-owner-console";

/**
 * Reserved address of the built-in owner. ".local" is not a deliverable domain and the account has no usable password,
 * so it is only ever used internally to attribute audit entries.
 */
export const OPEN_ACCESS_EMAIL = "owner@open.local";
