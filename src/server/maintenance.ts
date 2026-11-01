/**
 * Periodic housekeeping, run by a Cron Trigger. Idempotent and safe to run concurrently with live traffic
 * (it goes through the same compare-and-swap `transact`).
 *  - cancels unpaid orders whose stock hold has expired and releases the reserved stock
 *  - drops expired/revoked sessions and expired one-time tokens (verify/reset/invite)
 *  - drops anonymous guest sessions idle past their 30-day lifetime
 *  - removes leftover storage chunks from writes that crashed mid-way
 */
import { pruneGuestSessions } from "./services/guest";
import { releaseExpired } from "./services/orders";
import { transact, type Persistence } from "./persistence/transact";

export async function runMaintenance(p: Persistence, now = Date.now()) {
  const orphanRows = (await p.cleanup?.(now)) ?? 0;
  const r = await transact(p, (db) => {
    const released = releaseExpired(db, now);
    let sessions = 0, tokens = 0;
    const guests = pruneGuestSessions(db, now);
    for (const [id, s] of db.sessions) if (s.revoked || s.expiresAt <= now) { db.sessions.delete(id); sessions++; }
    for (const [id, t] of db.tokens) if (t.expiresAt <= now) { db.tokens.delete(id); tokens++; }
    if (released) db.log("maintenance.orders_released", { released });
    if (guests) db.log("maintenance.guest_sessions_pruned", { guests });
    return { released, sessions, tokens, guests };
  });
  return { ...r, orphanRows };
}
