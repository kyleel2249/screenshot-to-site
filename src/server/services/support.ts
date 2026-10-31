import type { MemoryDb, TicketRow } from "../db";
import { requirePermission, type Actor } from "../rbac";
import { ValidationError } from "./catalog-admin";

export function openTicket(db: MemoryDb, actor: Actor | null, i: { email: string; subject: string; body: string }): TicketRow {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email) || !i.subject.trim() || !i.body.trim()) throw new ValidationError(["Email, subject and message are required."]);
  const id = db.nextId("tkt");
  const t: TicketRow = { id, ...(actor?.kind === "customer" ? { userId: actor.id } : {}), email: i.email.toLowerCase(), subject: i.subject.trim().slice(0, 200), status: "open", priority: "normal", messages: [{ author: "customer", internal: false, body: i.body.trim().slice(0, 5000), at: Date.now() }], createdAt: Date.now() };
  db.tickets.set(id, t); return t;
}
/** Customers see their own tickets with internal staff notes stripped. */
export function myTickets(db: MemoryDb, actor: Actor | null) {
  if (!actor || actor.kind !== "customer") return [];
  return [...db.tickets.values()].filter((t) => t.userId === actor.id).map((t) => ({ ...t, messages: t.messages.filter((m) => !m.internal) }));
}
export function staffReply(db: MemoryDb, actor: Actor | null, ticketId: string, body: string, internal = false) {
  requirePermission(actor, "customer.support");
  const t = db.tickets.get(ticketId); if (!t) throw new ValidationError(["Unknown ticket."]);
  if (!body.trim()) throw new ValidationError(["A reply can't be empty."]);
  t.messages.push({ author: actor.id, internal, body: body.trim().slice(0, 5000), at: Date.now() });
  if (!internal) t.status = "pending";
  db.log("ticket.replied", { ticketId, internal }, actor.id);
}
export function setTicketStatus(db: MemoryDb, actor: Actor | null, ticketId: string, status: TicketRow["status"]) {
  requirePermission(actor, "customer.support");
  const t = db.tickets.get(ticketId); if (!t) throw new ValidationError(["Unknown ticket."]);
  if (!["open", "pending", "resolved"].includes(status)) throw new ValidationError(["Unknown status."]);
  t.status = status; db.log("ticket.status", { ticketId, status }, actor.id);
}

/** Staff inbox: newest activity first. Includes internal notes (staff only). */
export function listTickets(db: MemoryDb, actor: Actor | null) {
  requirePermission(actor, "customer.support");
  const last = (t: TicketRow) => t.messages.at(-1)?.at ?? t.createdAt;
  return [...db.tickets.values()].sort((a, b) => last(b) - last(a));
}
