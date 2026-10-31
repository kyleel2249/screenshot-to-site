/**
 * TEMP: synthesise an owner Actor + session when STAFF_OPEN_ACCESS is on and the request has no staff cookie.
 */
import { STAFF_OPEN_ACCESS } from "../lib/security/open-access";
import type { MemoryDb } from "./db";
import type { Actor } from "./rbac";

export function openAccessActor(db: MemoryDb): { actor: Actor; sid: string } | null {
  if (!STAFF_OPEN_ACCESS) return null;
  let u = [...db.users.values()].find((x) => x.kind === "staff" && x.roles.includes("owner"));
  if (!u) {
    const id = db.nextId("usr");
    u = {
      id,
      email: "owner@open.local",
      passwordHash: "open",
      kind: "staff",
      roles: ["owner"],
      status: "active",
      emailVerified: true,
      failedLogins: 0,
      lockedUntil: 0,
      mfaRequired: false,
      createdAt: Date.now(),
    };
    db.users.set(id, u);
    db.adminSetupClosed = true;
    db.log("open_access.auto_owner", { userId: id });
  }
  const sid = db.nextId("ses");
  db.sessions.set(sid, {
    id: sid,
    userId: u.id,
    expiresAt: Date.now() + 12 * 3600_000,
    revoked: false,
    authAt: Date.now(),
    mfaOk: true,
  });
  return {
    actor: { id: u.id, kind: "staff", roles: u.roles, recentAuthAt: Date.now(), mfaOk: true },
    sid,
  };
}
