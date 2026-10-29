import type { MemoryDb, TicketRow } from "../db";
import { requirePermission, type Actor } from "../rbac";

export function openTicket(db: MemoryDb, actor: Actor | null, i: { email: string; subject: string; body: string }): TicketRow {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email) || !i.subject.trim() || !i.body.trim()) throw new Error("Email, subject and message are required.");
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
  const t = db.tickets.get(ticketId); if (!t) throw new Error("Unknown ticket");
  t.messages.push({ author: actor.id, internal, body, at: Date.now() });
  if (!internal) t.status = "pending";
  db.log("ticket.replied", { ticketId, internal }, actor.id);
}
export function setTicketStatus(db: MemoryDb, actor: Actor | null, ticketId: string, status: TicketRow["status"]) {
  requirePermission(actor, "customer.support");
  const t = db.tickets.get(ticketId); if (!t) throw new Error("Unknown ticket"); t.status = status;
}
