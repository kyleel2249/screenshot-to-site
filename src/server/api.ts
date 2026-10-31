/**
 * TEMP open-access API: admin dashboard needs no login.
 * Minimal surface so the storefront and /dera-owner-console work while STAFF_OPEN_ACCESS is on.
 */
import { STAFF_OPEN_ACCESS } from "../lib/security/open-access";
import { resolvePortalPath } from "../lib/security/enrolment";
import type { MemoryDb } from "./db";
import type { Persistence } from "./persistence/transact";
import { transact } from "./persistence/transact";
import { requirePermission } from "./rbac";
import type { R2Like } from "./media";
import { openAccessActor } from "./open-access-actor";

export interface Env {
  SESSION_SECRET: string; SITE_ORIGIN: string; ADMIN_BOOTSTRAP_REF_HASH?: string; ADMIN_PORTAL_PATH?: string;
  EMAIL_API_KEY?: string; EMAIL_FROM?: string; PAYMENT_WEBHOOK_SECRET?: string; PAYMENT_PROVIDER?: string; PAYMENT_SECRET_KEY?: string;
  BANK_TRANSFER_DETAILS?: string; BANK_TRANSFER_HOLD_HOURS?: string; PAYMENT_METHODS?: string; PBKDF2_ITERATIONS?: string;
  DATA_ENCRYPTION_KEY?: string; CSP_MODE?: string; MAINTENANCE_KEY?: string; MEDIA?: R2Like;
  EXCHANGE_RATE_GHS_PER_USD?: string; EXCHANGE_RATE_SOURCE?: string; EXCHANGE_RATE_DATE?: string;
  DEV_OPEN_ADMIN?: string;
}
export type NoticeTemplate = "order_received" | "order_update" | "payment_received" | "quote_ready" | "ticket_reply";
export interface Deps {
  payments?: unknown;
  notify?: ((to: string, template: NoticeTemplate, data: { ref: string; subject?: string }) => Promise<void>) | undefined;
  mail?: ((to: string, template: "verify_email" | "password_reset" | "owner_verify" | "staff_invite", data: { token: string }) => Promise<void>) | undefined;
}

export function publicProducts(db: MemoryDb, _now = new Date()) {
  const out: unknown[] = [];
  for (const p of db.products.values()) {
    if (p.archived) continue;
    const v = [...db.variants.values()].find((x) => x.productId === p.id);
    if (!v || !v.published) continue;
    out.push({
      slug: p.slug, name: p.name, categoryId: p.categoryId, createdAt: p.createdAt, shortDescription: p.shortDescription,
      image: p.image, imageAlt: p.imageAlt, availability: v.availability, labels: [], price: v.price, salePrice: v.salePrice ?? null,
      variantId: v.id, attributes: p.attributes ?? {},
    });
  }
  return out;
}

export function effectiveRate(db: MemoryDb, _env: Env) {
  if (db.exchangeRate) return { rate: db.exchangeRate, fromConfig: false };
  return { rate: null, fromConfig: false };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" } });

export async function handle(req: Request, env: Env, p: Persistence, _deps: Deps = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const portal = resolvePortalPath(env) ?? (STAFF_OPEN_ACCESS ? "/dera-owner-console" : null);

  if (path === "/api/products" && req.method === "GET") return json(await transact(p, (db) => publicProducts(db)));
  if (path === "/api/categories" && req.method === "GET") return json(await transact(p, (db) => db.categories.filter((c) => c.published)));
  if (path === "/api/site" && req.method === "GET") return json(await transact(p, (db) => db.business ?? { name: "Dera Darko Trade" }));
  if (path === "/api/rates" && req.method === "GET") return json({ displayMode: "DUAL", rate: null });

  if (STAFF_OPEN_ACCESS && portal && (path === `${portal}/api` || path.startsWith(`${portal}/api/`))) {
    const sub = path.slice(portal.length + 4) || "/";
    const open = await transact(p, (db) => openAccessActor(db));
    if (!open) return json({ error: "Not found" }, 404);
    const { actor } = open;
    if (sub === "/me" && req.method === "GET") {
      return json({ id: actor.id, roles: actor.roles, mfa: "verified", mustChangePassword: false });
    }
    if (sub === "/products" && req.method === "GET") {
      requirePermission(actor, "product.read");
      return json(await transact(p, (db) => [...db.products.values()].map((pr) => {
        const v = [...db.variants.values()].find((x) => x.productId === pr.id);
        return {
          id: pr.id, slug: pr.slug, name: pr.name, archived: pr.archived, variantId: v?.id ?? null,
          sku: v?.id.split("::")[1] ?? null, availability: v?.availability ?? null, published: v?.published ?? false,
          categoryId: pr.categoryId, attributes: pr.attributes ?? {}, price: v?.price ?? {}, salePrice: v?.salePrice ?? null,
          onHand: v?.onHand ?? 0, reserved: v?.reserved ?? 0, preOrderEnabled: !!v?.preOrder?.enabled,
        };
      })));
    }
    if (sub === "/overview" && req.method === "GET") return json({ products: 0, orders: 0, openTickets: 0 });
    if (sub === "/categories" && req.method === "GET") return json(await transact(p, (db) => db.categories));
    if (req.method === "GET") return json([]);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}
