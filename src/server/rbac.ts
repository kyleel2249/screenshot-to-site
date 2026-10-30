/** Least-privilege RBAC. Every privileged service call must go through `requirePermission`. */
export type Role = "owner" | "manager" | "inventory" | "fulfilment" | "support" | "marketing" | "finance" | "analyst";
export type Permission =
  | "product.write" | "product.read" | "inventory.adjust" | "category.write" | "order.read" | "order.update" | "order.refund" | "payment.confirm"
  | "customer.read" | "customer.support" | "discount.write" | "settings.write" | "shipping.write" | "content.write"
  | "analytics.read" | "export.data" | "staff.manage" | "audit.read";

const ALL: Permission[] = ["product.write", "product.read", "inventory.adjust", "category.write", "order.read", "order.update", "order.refund", "payment.confirm", "customer.read", "customer.support", "discount.write", "settings.write", "shipping.write", "content.write", "analytics.read", "export.data", "staff.manage", "audit.read"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  manager: ALL.filter((p) => p !== "staff.manage"),
  inventory: ["product.read", "product.write", "inventory.adjust", "category.write"],
  fulfilment: ["order.read", "order.update", "product.read"],
  support: ["order.read", "customer.read", "customer.support"],
  marketing: ["product.read", "discount.write", "content.write", "analytics.read"],
  finance: ["order.read", "order.refund", "payment.confirm", "analytics.read", "export.data"],
  analyst: ["product.read", "order.read", "analytics.read"],
};
/** High-impact actions that additionally need a recent re-authentication. */
export const SENSITIVE: Permission[] = ["order.refund", "payment.confirm", "export.data", "staff.manage", "settings.write"];

export interface Actor { id: string; kind: "staff" | "customer"; roles: Role[]; recentAuthAt?: number; mfaOk?: boolean }

export class Forbidden extends Error { constructor(msg = "Forbidden") { super(msg); this.name = "Forbidden"; } }

export function can(actor: Actor | null | undefined, perm: Permission): boolean {
  return !!actor && actor.kind === "staff" && actor.roles.some((r) => ROLE_PERMISSIONS[r]?.includes(perm));
}
export function requirePermission(actor: Actor | null | undefined, perm: Permission, now = Date.now()): asserts actor is Actor {
  if (!can(actor, perm)) throw new Forbidden();
  if (SENSITIVE.includes(perm) && (!actor!.recentAuthAt || now - actor!.recentAuthAt > 10 * 60_000)) throw new Forbidden("Re-authentication required");
}
