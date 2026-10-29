/**
 * Computes the SHA-256 hash of the owner's administrator enrolment reference.
 * Usage:  bun scripts/hash-bootstrap-ref.ts
 * The reference is read from stdin (never from argv, so it does not land in shell history).
 * Store ONLY the printed hash as the server secret ADMIN_BOOTSTRAP_REF_HASH (e.g. `wrangler secret put`).
 */
import { sha256Hex } from "../src/lib/security/crypto";

const raw = (await new Response(Bun.stdin.stream()).text()).trim();
if (!raw) { console.error("Provide the enrolment reference on stdin."); process.exit(1); }
console.log(await sha256Hex(raw));
