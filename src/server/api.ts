/**
 * HTTP API (Web-standard Request → Response). Mount at /api/* in a Cloudflare Worker / Pages Function / TanStack server route.
 * Security model:
 *  - session cookie: HttpOnly, Secure, SameSite=Strict; state-changing calls also require a same-origin Origin header (CSRF)
 *  - every privileged route authenticates server-side and checks RBAC; knowing a URL grants nothing
 *  - the admin API only exists under the secret portal path; unauthenticated probes get a plain 404
 *  - payment webhooks are accepted only with a valid HMAC signature over the raw body
 */
import { sellableQty, effectiveAvailability, activePromoLabels } from "../lib/domain/status";
import type { Currency } from "../lib/domain/money";
import { verifyWebhook } from "../lib/payments/webhook";
import { NO_STORE } from "../lib/security/headers";
import { RateLimiter, verifySession } from "../lib/security/crypto";
import { deleteZone, listDiscounts, listZones, saveDiscount, saveZone, setDiscountActive } from "./services/promotions";
import { resolvePortalPath } from "../lib/security/enrolment";
import type { MemoryDb } from "./db";
import { Forbidden, requirePermission, type Actor } from "./rbac";
import { ConflictError, transact, type Persistence } from "./persistence/transact";
import { addAddress, deleteMyAccount, exportMyData, getProfile, listAddresses, updateProfile } from "./services/account";
import { adminStoreFor, authenticate, enrolOwner, login, logout, reauthenticate, registerCustomer, requestPasswordReset, resetPassword, verifyEmail } from "./services/auth";
import { exportOrdersCsv, funnel, revenue, track } from "./services/analytics";
import { createPurchaseOrder, listPurchaseOrders, listSuppliers, receivePurchaseOrder, saveSupplier, setPurchaseOrderStatus } from "./services/purchasing";
import { listForModeration, listPublished, moderate, submitReview, summary } from "./services/reviews";
import { getPage, listPages, resetPage, savePage } from "./services/content";
import { isMethod, providerFromEnv, type PaymentMethod, type PaymentProvider } from "../lib/payments/provider";
import { listQuotes, lookupQuote, requestQuote, respondToQuote, sendQuote } from "./services/quotes";
import { confirmMfaSetup, mfaState, resetStaffMfa, startMfaSetup, verifyMfa } from "./services/mfa";
import { acceptInvite, inviteStaff, listStaff, setStaffActive, setStaffRoles } from "./services/staff";
import { listTickets, myTickets, openTicket, setTicketStatus, staffReply } from "./services/support";
import { adjustStock, categoryAdmin, createProduct, setAvailability, setPrices, setPublishedState, ValidationError } from "./services/catalog-admin";
import { beginBankTransfer, completeRefund, confirmBankTransfer, getOrderForCustomer, handleVerifiedPayment, listOrdersForCustomer, orderForPayment, placeOrder, requestCancellation, requestRefund, staffUpdateStatus, trackOrder } from "./services/orders";
import type { OrderStatus } from "../lib/domain/commerce";
import type { Availability } from "../lib/domain/status";

export interface Env {
  SESSION_SECRET: string; SITE_ORIGIN: string; ADMIN_BOOTSTRAP_REF_HASH?: string; ADMIN_PORTAL_PATH?: string;
  EMAIL_API_KEY?: string; EMAIL_FROM?: string; PAYMENT_WEBHOOK_SECRET?: string; PAYMENT_PROVIDER?: string; PAYMENT_SECRET_KEY?: string; BANK_TRANSFER_DETAILS?: string; BANK_TRANSFER_HOLD_HOURS?: string; PAYMENT_METHODS?: string; PBKDF2_ITERATIONS?: string;
}
export type NoticeTemplate = "order_received" | "quote_ready" | "ticket_reply";
export interface Deps {
  /** Payment provider; defaults to the one configured by PAYMENT_PROVIDER / PAYMENT_SECRET_KEY. Injectable for tests. */
  payments?: PaymentProvider;
  /** Informational notices. Carry a reference and a subject line only — never tokens, secrets or message bodies. */
  notify?: (to: string, template: NoticeTemplate, data: { ref: string; subject?: string }) => Promise<void>;
  /** Outbound email. Tokens are only ever delivered here, never returned in an HTTP response. */
  mail?: (to: string, template: "verify_email" | "password_reset" | "owner_verify" | "staff_invite", data: { token: string }) => Promise<void>;
}
type Body = Record<string, unknown>;

const limiters = { auth: new RateLimiter(10, 60_000), general: new RateLimiter(120, 60_000), enrol: new RateLimiter(5, 15 * 60_000) };
const COOKIE = "ddt_session";

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", ...NO_STORE, ...extra } });
const notFound = () => json({ error: "Not found" }, 404);
const str = (b: Body, k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
const num = (b: Body, k: string) => (typeof b[k] === "number" ? (b[k] as number) : NaN);
const bool = (b: Body, k: string) => b[k] === true;

function cookieOf(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) { const [k, ...v] = part.trim().split("="); if (k === name) return v.join("="); }
  return undefined;
}
const sessionCookie = (token: string, maxAge: number) => `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

async function readBody(req: Request): Promise<Body | null> {
  const text = await req.text();
  if (text.length > 200_000) return null;
  try { const v: unknown = JSON.parse(text || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? (v as Body) : null; } catch { return null; }
}

const orderView = (o: { id: string; ref: string; status: string; currency: string; total: number; subtotal: number; discount: number; shipping: number; hasPreorder: boolean; createdAt: number; items: { name: string; qty: number; unit: number; line: number; mode: string }[]; history: { to: string; at: number }[] }) =>
  ({ id: o.id, ref: o.ref, status: o.status, currency: o.currency, subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, total: o.total, hasPreorder: o.hasPreorder, createdAt: o.createdAt, items: o.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, line: i.line, mode: i.mode })), history: o.history.map((h) => ({ to: h.to, at: h.at })) });

/** Public catalogue straight from the database: never exposes costs, exact stock (unless limited-stock display is on), or unpublished items. */
function publicProducts(db: MemoryDb, now = new Date()) {
  const out = [];
  for (const p of db.products.values()) {
    if (p.archived) continue;
    const cat = db.categories.find((c) => c.id === p.categoryId); // hiding a category hides its products from the public list
    if (cat && (!cat.published || (cat.parentId && db.categories.find((c) => c.id === cat.parentId)?.published === false))) continue;
    const v = [...db.variants.values()].find((x) => x.productId === p.id);
    if (!v || !v.published || (v.publishAt && new Date(v.publishAt) > now)) continue;
    const hasSale = !!v.salePrice;
    out.push({
      slug: p.slug, name: p.name, categoryId: p.categoryId, createdAt: p.createdAt, shortDescription: p.shortDescription, image: p.image, imageAlt: p.imageAlt,
      availability: effectiveAvailability(v), labels: activePromoLabels(p.promo, v, { ...(p.showLimitedBelow !== undefined ? { showLimitedBelow: p.showLimitedBelow } : {}), hasValidSale: hasSale }, now),
      price: v.price, salePrice: v.salePrice ?? null, variantId: v.id, rating: summary(db, p.id),
      ...(p.showLimitedBelow !== undefined && v.trackInventory && sellableQty(v) > 0 && sellableQty(v) <= p.showLimitedBelow ? { remaining: sellableQty(v) } : {}),
      ...(v.availability === "pre_order" ? { expectedWindow: p.expectedWindow ?? null } : {}),
    });
  }
  return out;
}

export async function handle(req: Request, env: Env, p: Persistence, deps: Deps = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const iterations = env.PBKDF2_ITERATIONS ? parseInt(env.PBKDF2_ITERATIONS, 10) : undefined;
  const portal = resolvePortalPath(env);

  try {
    if (!limiters.general.check(`${ip}`).allowed) return json({ error: "Too many requests" }, 429);

    const provider = deps.payments ?? providerFromEnv(env);
    const isWebhook = path === "/api/webhooks/payments" || (!!provider && path === `/api/webhooks/${provider.name}`);
    if (!["GET", "HEAD"].includes(req.method) && !isWebhook) {
      const origin = req.headers.get("origin");
      if (origin !== env.SITE_ORIGIN) return json({ error: "Forbidden" }, 403); // CSRF: same-origin only
    }

    /* ---------- payment webhook: raw body + HMAC, no cookies involved ---------- */
    if (isWebhook && req.method === "POST" && provider && path === `/api/webhooks/${provider.name}`) {
      // Provider webhook: authenticity is the provider's signature over the RAW body; amounts are re-checked against our own order.
      const raw = await req.text();
      const ev = await provider.parseWebhook(raw, req.headers);
      if (ev === null) return json({ error: "Invalid signature" }, 401);
      if (ev === "ignored") return json({ received: true, result: "ignored" });
      const r = await transact(p, (db) => handleVerifiedPayment(db, ev));
      return json({ received: true, result: r.kind });
    }
    if (isWebhook && req.method === "POST") {
      const raw = await req.text();
      if (!(await verifyWebhook({ secret: env.PAYMENT_WEBHOOK_SECRET, rawBody: raw, signature: req.headers.get("x-signature") }))) return json({ error: "Invalid signature" }, 401);
      let ev: Body; try { ev = JSON.parse(raw) as Body; } catch { return json({ error: "Bad request" }, 400); }
      const amount = num(ev, "amount"), currency = str(ev, "currency"), status = str(ev, "status");
      if (!str(ev, "eventId") || !str(ev, "orderRef") || !Number.isInteger(amount) || (currency !== "GHS" && currency !== "USD") || (status !== "success" && status !== "failed")) return json({ error: "Bad request" }, 400);
      const r = await transact(p, (db) => handleVerifiedPayment(db, { eventId: str(ev, "eventId"), orderRef: str(ev, "orderRef"), amount, currency, status }));
      return json({ received: true, result: r.kind });
    }

    let body: Body = {};
    if (!["GET", "HEAD"].includes(req.method)) {
      const parsed = await readBody(req);
      if (!parsed) return json({ error: "Bad request" }, 400); // malformed or oversized JSON
      body = parsed;
    }

    /* ---------- authentication helper ---------- */
    const token = cookieOf(req, COOKIE);
    const who = async (): Promise<{ actor: Actor | null; sid?: string }> => {
      if (!token) return { actor: null };
      const sess = await verifySession(token, env.SESSION_SECRET);
      if (!sess) return { actor: null };
      const actor = await transact(p, (db) => authenticate(db, token, env.SESSION_SECRET));
      return actor ? { actor, sid: sess.sid } : { actor: null };
    };

    /* ---------- admin API: only under the secret portal path ---------- */
    if (portal && (path === `${portal}/api` || path.startsWith(`${portal}/api/`))) {
      const sub = path.slice(portal.length + 4) || "/";
      if (sub === "/enrol" && req.method === "POST") {
        if (!limiters.enrol.check(ip).allowed) return json({ error: "Too many requests" }, 429);
        const r = await transact(p, async (db) => enrolOwner(adminStoreFor(db), env.ADMIN_BOOTSTRAP_REF_HASH ? { ADMIN_BOOTSTRAP_REF_HASH: env.ADMIN_BOOTSTRAP_REF_HASH } : {}, { reference: str(body, "reference"), email: str(body, "email"), password: str(body, "password"), clientKey: ip }));
        if (!r.ok) return json({ error: r.code === "weak_password" ? "Password too weak" : "Enrolment unavailable", ...(r.errors ? { errors: r.errors } : {}) }, r.code === "weak_password" ? 422 : 404);
        await deps.mail?.(str(body, "email"), "owner_verify", { token: r.verifyToken });
        return json({ ok: true });
      }
      const { actor, sid } = await who();
      if (!actor || actor.kind !== "staff") return notFound(); // unauthenticated probes learn nothing
      try {
        const mfa = await transact(p, (db) => mfaState(db, actor, sid!));
        if (sub === "/me" && req.method === "GET") return json({ id: actor.id, roles: mfa === "verified" ? actor.roles : [], mfa });
        if (sub === "/mfa/setup" && req.method === "POST") return json(await transact(p, (db) => startMfaSetup(db, actor)));
        if (sub === "/mfa/confirm" && req.method === "POST") {
          if (!limiters.auth.check(`mfa:${actor.id}`).allowed) return json({ error: "Too many attempts. Try again later." }, 429);
          return json(await transact(p, (db) => confirmMfaSetup(db, actor, sid!, str(body, "code"))));
        }
        if (sub === "/mfa/verify" && req.method === "POST") {
          if (!limiters.auth.check(`mfa:${actor.id}`).allowed) return json({ error: "Too many attempts. Try again later." }, 429);
          return (await transact(p, (db) => verifyMfa(db, actor, sid!, str(body, "code")))) ? json({ ok: true }) : json({ error: "That code isn't right." }, 401);
        }
        if (mfa !== "verified") return json({ error: "Two-step verification required" }, 403); // nothing else is reachable until the second factor is proven
        if (sub === "/staff/mfa-reset" && req.method === "POST") { await transact(p, (db) => resetStaffMfa(db, actor, str(body, "userId"))); return json({ ok: true }); }
        if (sub === "/products" && req.method === "GET") {
          requirePermission(actor, "product.read");
          return json(await transact(p, (db) => [...db.products.values()].map((pr) => {
            const v = [...db.variants.values()].find((x) => x.productId === pr.id);
            return { id: pr.id, slug: pr.slug, name: pr.name, archived: pr.archived, variantId: v?.id ?? null, sku: v?.id.split("::")[1] ?? null, availability: v?.availability ?? null, published: v?.published ?? false,
              price: v?.price ?? {}, salePrice: v?.salePrice ?? null, onHand: v?.onHand ?? 0, reserved: v?.reserved ?? 0, preOrderEnabled: !!v?.preOrder?.enabled };
          })));
        }
        if (sub === "/reauth" && req.method === "POST") return (await transact(p, (db) => reauthenticate(db, sid!, str(body, "password")))) ? json({ ok: true }) : json({ error: "Incorrect password" }, 401);
        if (sub === "/products" && req.method === "POST") {
          const prod = await transact(p, (db) => createProduct(db, actor, body as never));
          return json({ id: prod.id, slug: prod.slug }, 201);
        }
        if (sub === "/products/status" && req.method === "POST") {
          const ids = Array.isArray(body["ids"]) ? (body["ids"] as unknown[]).filter((x): x is string => typeof x === "string") : [];
          await transact(p, (db) => setAvailability(db, actor, ids, str(body, "availability") as Availability)); return json({ ok: true });
        }
        if (sub === "/products/publish" && req.method === "POST") { await transact(p, (db) => setPublishedState(db, actor, str(body, "productId"), bool(body, "published"))); return json({ ok: true }); }
        if (sub === "/prices" && req.method === "POST") { await transact(p, (db) => setPrices(db, actor, str(body, "variantId"), body as never)); return json({ ok: true }); }
        if (sub === "/stock" && req.method === "POST") { await transact(p, (db) => adjustStock(db, actor, str(body, "variantId"), num(body, "delta"), str(body, "reason"))); return json({ ok: true }); }
        if (sub === "/orders" && req.method === "GET") {
          requirePermission(actor, "order.read");
          return json(await transact(p, (db) => [...db.orders.values()].map((o) => ({ ...orderView(o), guestEmail: o.guestEmail ?? null, address: o.address, paymentMethod: o.paymentMethod ?? null }))));
        }
        if (sub === "/orders/status" && req.method === "POST") { await transact(p, (db) => staffUpdateStatus(db, actor, str(body, "orderId"), str(body, "to") as OrderStatus, str(body, "note") || undefined)); return json({ ok: true }); }
        if (sub === "/orders/confirm-bank-transfer" && req.method === "POST") { const kind = await transact(p, (db) => confirmBankTransfer(db, actor, str(body, "orderId"), num(body, "amount"), str(body, "reference"))); return json({ ok: true, result: kind }); }
        if (sub === "/refunds" && req.method === "POST") {
          const r = await transact(p, (db) => requestRefund(db, actor, str(body, "orderId"), num(body, "amount"))); return json(r);
        }
        if (sub === "/refunds/complete" && req.method === "POST") { requirePermission(actor, "order.refund"); await transact(p, (db) => completeRefund(db, str(body, "orderId"), num(body, "amount"))); return json({ ok: true }); }
        if (sub === "/export/orders.csv" && req.method === "GET") {
          const csv = await transact(p, (db) => exportOrdersCsv(db, actor));
          return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="orders.csv"', ...NO_STORE } });
        }
        if (sub === "/categories" && req.method === "GET") return json(await transact(p, (db) => categoryAdmin(db, actor).list()));
        if (sub === "/categories" && req.method === "POST") { await transact(p, (db) => categoryAdmin(db, actor).add(str(body, "name"), str(body, "parentId") || null, (str(body, "filterProfile") || undefined) as never)); return json({ ok: true }, 201); }
        if (sub === "/categories/rename" && req.method === "POST") { await transact(p, (db) => categoryAdmin(db, actor).rename(str(body, "id"), str(body, "name"))); return json({ ok: true }); }
        if (sub === "/categories/visibility" && req.method === "POST") { await transact(p, (db) => categoryAdmin(db, actor).hide(str(body, "id"), bool(body, "hidden"))); return json({ ok: true }); }
        if (sub === "/categories/move" && req.method === "POST") { await transact(p, (db) => categoryAdmin(db, actor).move(str(body, "id"), num(body, "position"))); return json({ ok: true }); }
        if (sub === "/staff" && req.method === "GET") return json(await transact(p, (db) => listStaff(db, actor)));
        if (sub === "/staff/invite" && req.method === "POST") {
          const r = await transact(p, (db) => inviteStaff(db, actor, { email: str(body, "email"), roles: body["roles"] }));
          await deps.mail?.(r.email, "staff_invite", { token: r.token }); // token only ever goes to the invitee's inbox
          return json({ ok: true }, 201);
        }
        if (sub === "/staff/roles" && req.method === "POST") { await transact(p, (db) => setStaffRoles(db, actor, str(body, "userId"), body["roles"])); return json({ ok: true }); }
        if (sub === "/staff/active" && req.method === "POST") { await transact(p, (db) => setStaffActive(db, actor, str(body, "userId"), bool(body, "active"))); return json({ ok: true }); }
        if (sub === "/suppliers" && req.method === "GET") return json(await transact(p, (db) => listSuppliers(db, actor)));
        if (sub === "/suppliers" && req.method === "POST") return json(await transact(p, (db) => saveSupplier(db, actor, body)), 201);
        if (sub === "/purchase-orders" && req.method === "GET") return json(await transact(p, (db) => listPurchaseOrders(db, actor)));
        if (sub === "/purchase-orders" && req.method === "POST") { const po = await transact(p, (db) => createPurchaseOrder(db, actor, body)); return json({ id: po.id, ref: po.ref }, 201); }
        if (sub === "/purchase-orders/status" && req.method === "POST") { await transact(p, (db) => setPurchaseOrderStatus(db, actor, str(body, "id"), body["to"])); return json({ ok: true }); }
        if (sub === "/purchase-orders/receive" && req.method === "POST") { await transact(p, (db) => receivePurchaseOrder(db, actor, str(body, "id"), body["lines"])); return json({ ok: true }); }
        if (sub === "/reviews" && req.method === "GET") return json(await transact(p, (db) => listForModeration(db, actor)));
        if (sub === "/reviews/moderate" && req.method === "POST") { await transact(p, (db) => moderate(db, actor, str(body, "id"), body["action"])); return json({ ok: true }); }
        if (sub === "/pages" && req.method === "GET") return json(await transact(p, (db) => listPages(db, actor)));
        if (sub === "/pages" && req.method === "POST") { await transact(p, (db) => savePage(db, actor, str(body, "slug"), { title: body["title"], sections: body["sections"], reviewed: body["reviewed"] })); return json({ ok: true }); }
        if (sub === "/pages/reset" && req.method === "POST") { await transact(p, (db) => resetPage(db, actor, str(body, "slug"))); return json({ ok: true }); }
        if (sub === "/quotes" && req.method === "GET") return json(await transact(p, (db) => listQuotes(db, actor)));
        if (sub === "/quotes/send" && req.method === "POST") {
          const to = await transact(p, (db) => { sendQuote(db, actor, str(body, "id"), { currency: body["currency"], total: body["total"], validDays: body["validDays"], message: body["message"] }); const q = db.quotes.get(str(body, "id"))!; return { email: q.email, ref: q.ref }; });
          await deps.notify?.(to.email, "quote_ready", { ref: to.ref });
          return json({ ok: true });
        }
        if (sub === "/tickets" && req.method === "GET") return json(await transact(p, (db) => listTickets(db, actor)));
        if (sub === "/tickets/reply" && req.method === "POST") {
          const t = await transact(p, (db) => { staffReply(db, actor, str(body, "ticketId"), str(body, "body"), bool(body, "internal")); const x = db.tickets.get(str(body, "ticketId"))!; return { email: x.email, subject: x.subject, id: x.id }; });
          if (!bool(body, "internal")) await deps.notify?.(t.email, "ticket_reply", { ref: t.id, subject: t.subject }); // internal notes never leave the building
          return json({ ok: true });
        }
        if (sub === "/tickets/status" && req.method === "POST") { await transact(p, (db) => setTicketStatus(db, actor, str(body, "ticketId"), str(body, "status") as never)); return json({ ok: true }); }
        if (sub === "/analytics" && req.method === "GET") {
          requirePermission(actor, "analytics.read");
          const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10) || 30));
          const to = Date.now(), from = to - days * 86_400_000;
          return json(await transact(p, (db) => ({ days, funnel: funnel(db, from, to), revenue: revenue(db, actor, from, to) })));
        }
        if (sub === "/zones" && req.method === "GET") return json(await transact(p, (db) => listZones(db, actor)));
        if (sub === "/zones" && req.method === "POST") return json(await transact(p, (db) => saveZone(db, actor, body)), 201);
        if (sub === "/zones/delete" && req.method === "POST") { await transact(p, (db) => deleteZone(db, actor, str(body, "id"))); return json({ ok: true }); }
        if (sub === "/discounts" && req.method === "GET") return json(await transact(p, (db) => listDiscounts(db, actor)));
        if (sub === "/discounts" && req.method === "POST") return json(await transact(p, (db) => saveDiscount(db, actor, body)), 201);
        if (sub === "/discounts/active" && req.method === "POST") { await transact(p, (db) => setDiscountActive(db, actor, str(body, "code"), bool(body, "active"))); return json({ ok: true }); }
        if (sub === "/audit" && req.method === "GET") { requirePermission(actor, "audit.read"); return json(await transact(p, (db) => db.audit.slice(-200))); }
      } catch (e) { return mapError(e); }
      return notFound();
    }

    /* ---------- public / customer API ---------- */
    if (path === "/api/events" && req.method === "POST") {
      // Consent-gated, allow-listed, pseudonymised (see services/analytics.ts). Always 200 so the endpoint reveals nothing.
      const recorded = await transact(p, (db) => track(db, { consent: bool(body, "consent"), kind: str(body, "kind"), path: str(body, "path"), source: str(body, "source"), campaign: str(body, "campaign"), clientKey: ip, secret: env.SESSION_SECRET }));
      return json({ recorded });
    }
    if (path === "/api/reviews" && req.method === "GET") {
      const { actor } = await who();
      const r = await transact(p, (db) => listPublished(db, actor, url.searchParams.get("slug") ?? ""));
      return r ? json(r) : notFound();
    }
    if (path === "/api/reviews" && req.method === "POST") {
      if (!limiters.auth.check(`rev:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const { actor } = await who();
      try { await transact(p, (db) => submitReview(db, actor, str(body, "slug"), { rating: body["rating"], title: body["title"], body: body["body"] })); return json({ ok: true }, 201); } catch (e) { return mapError(e); }
    }
    if (path.startsWith("/api/pages/") && req.method === "GET") {
      const page = await transact(p, (db) => getPage(db, path.slice("/api/pages/".length)));
      return page ? json(page, 200, { "Cache-Control": "public, max-age=60" }) : notFound();
    }
    if (path === "/api/categories" && req.method === "GET") return json(await transact(p, (db) => db.categories.filter((c) => c.published && (!c.parentId || db.categories.find((x) => x.id === c.parentId)?.published))));
    if (path === "/api/shipping-zones" && req.method === "GET") return json(await transact(p, (db) => [...db.zones.values()].map((z) => ({ id: z.id, name: z.name, regions: z.regions, currency: z.currency, baseFee: z.baseFee, estimate: z.estimate }))));
    if (path === "/api/products" && req.method === "GET") return json(await transact(p, (db) => publicProducts(db)));

    if (path === "/api/register" && req.method === "POST") {
      if (!limiters.auth.check(`reg:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const r = await transact(p, (db) => registerCustomer(db, { email: str(body, "email"), password: str(body, "password"), firstName: str(body, "firstName"), lastName: str(body, "lastName"), acceptTerms: bool(body, "acceptTerms"), marketingConsent: bool(body, "marketingConsent") }, iterations));
      if (!r.ok) return json({ errors: r.errors }, 422);
      if ("verifyToken" in r && r.verifyToken) await deps.mail?.(str(body, "email"), "verify_email", { token: r.verifyToken });
      return json({ ok: true }, 201); // identical whether or not the email already existed
    }
    if (path === "/api/verify-email" && req.method === "POST") return (await transact(p, (db) => verifyEmail(db, str(body, "token")))) ? json({ ok: true }) : json({ error: "Invalid or expired link" }, 400);

    if (path === "/api/login" && req.method === "POST") {
      if (!limiters.auth.check(`login:${ip}`).allowed) return json({ error: "Too many attempts. Try again later." }, 429);
      const r = await transact(p, (db) => login(db, { email: str(body, "email"), password: str(body, "password"), secret: env.SESSION_SECRET }));
      return r.ok ? json({ ok: true }, 200, { "Set-Cookie": sessionCookie(r.token, 43200) }) : json({ error: r.error }, 401);
    }
    if (path === "/api/logout" && req.method === "POST") {
      const { sid } = await who(); if (sid) await transact(p, (db) => logout(db, sid));
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
    }
    if (path === "/api/password/forgot" && req.method === "POST") {
      if (!limiters.auth.check(`fp:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const r = await transact(p, (db) => requestPasswordReset(db, str(body, "email")));
      if ("token" in r && r.token) await deps.mail?.(str(body, "email"), "password_reset", { token: r.token });
      return json({ ok: true }); // generic: no account enumeration
    }
    if (path === "/api/password/reset" && req.method === "POST") {
      const r = await transact(p, (db) => resetPassword(db, str(body, "token"), str(body, "password"), Date.now(), iterations));
      return r.ok ? json({ ok: true }) : json({ errors: r.errors }, 400);
    }

    if (path === "/api/quotes" && req.method === "POST") {
      if (!limiters.auth.check(`quote:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const r = await transact(p, (db) => requestQuote(db, body));
      return json(r, 201); // the secret is shown once to the requester
    }
    if (path === "/api/quotes/status" && req.method === "GET") {
      if (!limiters.auth.check(`quote:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const q = await transact(p, (db) => lookupQuote(db, url.searchParams.get("ref") ?? "", url.searchParams.get("secret") ?? ""));
      return q ? json(q) : notFound();
    }
    if (path === "/api/quotes/respond" && req.method === "POST") {
      if (!limiters.auth.check(`quote:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const q = await transact(p, (db) => respondToQuote(db, str(body, "ref"), str(body, "secret"), bool(body, "accept")));
      return q ? json(q) : notFound();
    }
    if (path === "/api/staff/accept-invite" && req.method === "POST") {
      if (!limiters.auth.check(`inv:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const r = await transact(p, (db) => acceptInvite(db, str(body, "token"), str(body, "password"), Date.now(), iterations));
      return r.ok ? json({ ok: true }) : json({ errors: r.errors }, 400);
    }

    // Methods the owner allows (PAYMENT_METHODS, comma-separated; default all). Online methods also need a provider that supports them;
    // bank transfer needs the owner's bank details to be configured — we never invent account details.
    const allowed = (env.PAYMENT_METHODS ? env.PAYMENT_METHODS.split(",").map((x) => x.trim()).filter(isMethod) : ["card", "mobile_money", "bank_transfer"]) as PaymentMethod[];
    const bankDetails = (env.BANK_TRANSFER_DETAILS ?? "").trim().slice(0, 600);
    const methodsFor = (currency: "GHS" | "USD"): PaymentMethod[] => [
      ...(provider ? provider.methods(currency).filter((m) => allowed.includes(m)) : []),
      ...(bankDetails && allowed.includes("bank_transfer") ? (["bank_transfer"] as PaymentMethod[]) : []),
    ];
    if (path === "/api/payments/config" && req.method === "GET") {
      const methods = { GHS: methodsFor("GHS"), USD: methodsFor("USD") };
      return json({ enabled: methods.GHS.length + methods.USD.length > 0, methods, ...(provider ? { provider: provider.name } : {}) });
    }
    if ((path === "/api/payments/start" || path === "/api/payments/bank-transfer") && req.method === "POST") {
      if (!limiters.auth.check(`pay:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const { actor } = await who();
      const bank = path.endsWith("bank-transfer");
      const method: PaymentMethod | undefined = bank ? "bank_transfer" : isMethod(body["method"]) ? body["method"] : undefined;
      if (body["method"] !== undefined && !bank && !method) return json({ errors: ["Choose a valid payment method."] }, 422);
      if (bank) {
        const r = await transact(p, async (db) => {
          const found = await orderForPayment(db, actor, str(body, "orderRef"), str(body, "trackingSecret"));
          if (found && !("error" in found) && !methodsFor(found.order.currency).includes("bank_transfer")) return { error: "Bank transfer isn't available for this order." };
          return found && "error" in found ? found : found ? beginBankTransfer(db, actor, str(body, "orderRef"), str(body, "trackingSecret"), Number(env.BANK_TRANSFER_HOLD_HOURS) || 24) : null;
        });
        if (!r) return notFound();
        if ("error" in r) return json({ errors: [r.error] }, 409);
        return json({ instructions: bankDetails, reference: r.order.ref, amount: r.order.total, currency: r.order.currency, holdUntil: r.order.reservedUntil });
      }
      if (!provider) return json({ errors: ["Online payment isn't available yet. The business will contact you to arrange payment."] }, 503);
      const found = await transact(p, (db) => orderForPayment(db, actor, str(body, "orderRef"), str(body, "trackingSecret")));
      if (!found) return notFound();
      if ("error" in found) return json({ errors: [found.error] }, 409);
      const online: PaymentMethod[] = methodsFor(found.order.currency).filter((m) => m !== "bank_transfer");
      if (!online.length) return json({ errors: ["Online payment isn't available for this currency."] }, 503);
      if (method && !online.includes(method)) return json({ errors: [`That payment method isn't available for ${found.order.currency} orders.`] }, 422);
      // Amount and currency come from OUR stored order — never from the request.
      const init = await provider.initialize({ orderRef: found.order.ref, amount: found.order.total, currency: found.order.currency, email: found.email, callbackUrl: `${env.SITE_ORIGIN.replace(/\/+$/, "")}/track?ref=${encodeURIComponent(found.order.ref)}`, ...(method === "card" || method === "mobile_money" ? { method } : {}) });
      if (init.ok && method) await transact(p, (db) => { const o = [...db.orders.values()].find((x) => x.ref === found.order.ref); if (o && o.status === "pending_payment") o.paymentMethod = method; });
      return init.ok ? json({ redirectUrl: init.redirectUrl }) : json({ errors: [init.error] }, 502);
    }
    if (path === "/api/checkout" && req.method === "POST") {
      const { actor } = await who();
      const cur = str(body, "currency"); if (cur !== "GHS" && cur !== "USD") return json({ error: "Unsupported currency" }, 422);
      const lines = Array.isArray(body["lines"]) ? (body["lines"] as Body[]).map((l) => ({ variantId: str(l, "variantId"), qty: num(l, "qty") })) : [];
      const a = (body["address"] && typeof body["address"] === "object" ? body["address"] : {}) as Body;
      const guestEmail = str(body, "guestEmail");
      const r = await transact(p, (db) => placeOrder(db, {
        ...(actor?.kind === "customer" ? { userId: actor.id } : {}), ...(actor?.kind !== "customer" && guestEmail ? { guestEmail } : {}),
        lines, currency: cur as Currency, region: str(body, "region"), zoneId: str(body, "zoneId"),
        address: { recipient: str(a, "recipient"), region: str(a, "region"), city: str(a, "city"), street: str(a, "street"), ...(str(a, "phone") ? { phone: str(a, "phone") } : {}) },
        ...(str(body, "discountCode") ? { discountCode: str(body, "discountCode") } : {}), idempotencyKey: str(body, "idempotencyKey"), acceptedTerms: bool(body, "acceptedTerms"), preorderAcknowledged: bool(body, "preorderAcknowledged"),
      }));
      if (!r.ok) return json({ errors: r.errors }, 422);
      if (!r.duplicate) { const to = await transact(p, (db) => (r.order.guestEmail ?? (r.order.userId ? db.users.get(r.order.userId)?.email : undefined))); if (to) await deps.notify?.(to, "order_received", { ref: r.order.ref }); }
      return json({ order: orderView(r.order), ...(r.trackingSecret ? { trackingSecret: r.trackingSecret } : {}), paymentRequired: true, paymentAvailable: methodsFor(r.order.currency).length > 0, paymentMethods: methodsFor(r.order.currency) }, r.duplicate ? 200 : 201);
    }
    if (path === "/api/track" && req.method === "GET") {
      if (!limiters.auth.check(`track:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const t = await transact(p, (db) => trackOrder(db, url.searchParams.get("ref") ?? "", url.searchParams.get("secret") ?? ""));
      return t ? json(t) : notFound();
    }
    if (path === "/api/support" && req.method === "POST") {
      const { actor } = await who();
      try { const t = await transact(p, (db) => openTicket(db, actor, { email: str(body, "email"), subject: str(body, "subject"), body: str(body, "body") })); return json({ id: t.id }, 201); } catch { return json({ error: "Email, subject and message are required." }, 422); }
    }

    /* ---------- signed-in customer routes ---------- */
    const { actor } = await who();
    if (path.startsWith("/api/") && ["/api/me", "/api/orders", "/api/account"].some((x) => path === x || path.startsWith(x + "/"))) {
      if (!actor || actor.kind !== "customer") return json({ error: "Not signed in" }, 401);
      if (path === "/api/me") return json(await transact(p, (db) => getProfile(db, actor)));
      if (path === "/api/account/tickets" && req.method === "GET") return json(await transact(p, (db) => myTickets(db, actor)));
      if (path === "/api/orders" && req.method === "GET") return json(await transact(p, (db) => listOrdersForCustomer(db, actor).map(orderView)));
      const m = /^\/api\/orders\/([^/]+)(\/cancel)?$/.exec(path);
      if (m) {
        const id = m[1]!;
        if (m[2] && req.method === "POST") { const r = await transact(p, (db) => requestCancellation(db, actor, id)); return r.ok ? json({ ok: true }) : json({ error: r.error }, 404); }
        if (!m[2] && req.method === "GET") { const o = await transact(p, (db) => getOrderForCustomer(db, actor, id)); return o ? json(orderView(o)) : notFound(); }
      }
      try {
        if (path === "/api/account/profile" && req.method === "POST") { await transact(p, (db) => updateProfile(db, actor, body as never)); return json({ ok: true }); }
        if (path === "/api/account/addresses" && req.method === "GET") return json(await transact(p, (db) => listAddresses(db, actor)));
        if (path === "/api/account/addresses" && req.method === "POST") return json(await transact(p, (db) => addAddress(db, actor, body as never)), 201);
        if (path === "/api/account/export" && req.method === "GET") return json(await transact(p, (db) => exportMyData(db, actor)));
        if (path === "/api/account/delete" && req.method === "POST") {
          await transact(p, (db) => deleteMyAccount(db, actor)); return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
        }
      } catch (e) { return mapError(e); }
    }
    return notFound();
  } catch (e) {
    return mapError(e);
  }
}

function mapError(e: unknown): Response {
  if (e instanceof Forbidden) return json({ error: e.message }, 403);
  if (e instanceof ValidationError) return json({ errors: e.errors }, 422);
  if (e instanceof ConflictError) return json({ error: e.message }, 409);
  if (e instanceof Error && /Not signed in/.test(e.message)) return json({ error: "Not signed in" }, 401);
  return json({ error: "Something went wrong" }, 500); // never leak internals
}
