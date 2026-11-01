/**
 * The built-in owner behind the open dashboard (see src/lib/security/open-access.ts).
 * The actor is derived per request: no sessions or cookies are involved and nothing is written after the first request.
 */
import { OPEN_ACCESS_EMAIL } from "../lib/security/open-access";
import type { MemoryDb, UserRow } from "./db";
import type { Actor } from "./rbac";

export const isOpenAccessUser = (u: Pick<UserRow, "email">) => u.email === OPEN_ACCESS_EMAIL;

/** Creates the built-in owner on first use. Does nothing (and so writes nothing) when it already exists. */
export function ensureOpenAccessOwner(db: MemoryDb): UserRow {
  for (const u of db.users.values()) if (u.kind === "staff" && isOpenAccessUser(u)) return u;
  const id = db.nextId("usr");
  const row: UserRow = {
    id,
    email: OPEN_ACCESS_EMAIL,
    passwordHash: "disabled", // not a valid hash: nobody can sign in to this account
    kind: "staff",
    roles: ["owner"],
    status: "active",
    emailVerified: true,
    failedLogins: 0,
    lockedUntil: 0,
    mfaRequired: false,
    createdAt: Date.now(),
  };
  db.users.set(id, row);
  db.log("open_access.owner_created", { userId: id });
  return row;
}

/** The actor for every dashboard request. `recentAuthAt` is always now, so sensitive actions never ask for a password. */
export function openAccessActor(db: MemoryDb, now = Date.now()): Actor {
  const u = ensureOpenAccessOwner(db);
  return { id: u.id, kind: "staff", roles: [...u.roles], recentAuthAt: now };
}
