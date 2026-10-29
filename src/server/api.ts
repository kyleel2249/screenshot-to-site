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
import { exportOrdersCsv } from "./services/analytics";
import { adjustStock, createProduct, setAvailability, setPrices, setPublishedState, ValidationError } from "./services/catalog-admin";
import { completeRefund, getOrderForCustomer, handleVerifiedPayment, listOrdersForCustomer, placeOrder, requestCancellation, requestRefund, staffUpdateStatus, trackOrder } from "./services/orders";
import { openTicket } from "./services/support";
import type { OrderStatus } from "../lib/domain/commerce";
import type { Availability } from "../lib/domain/status";

export interface Env {
  SESSION_SECRET: string; SITE_ORIGIN: string; ADMIN_BOOTSTRAP_REF_HASH?: string; ADMIN_PORTAL_PATH?: string;
  PAYMENT_WEBHOOK_SECRET?: string; PBKDF2_ITERATIONS?: string;
}
export interface Deps {
  /** Outbound email. Tokens are only ever delivered here, never returned in an HTTP response. */
  mail?: (to: string, template: "verify_email" | "password_reset" | "owner_verify", data: { token: string }) => Promise<void>;
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
    const v = [...db.variants.values()].find((x) => x.productId === p.id);
    if (!v || !v.published || (v.publishAt && new Date(v.publishAt) > now)) continue;
    const hasSale = !!v.salePrice;
    out.push({
      slug: p.slug, name: p.name, categoryId: p.categoryId, createdAt: p.createdAt, shortDescription: p.shortDescription, image: p.image, imageAlt: p.imageAlt,
      availability: effectiveAvailability(v), labels: activePromoLabels(p.promo, v, { ...(p.showLimitedBelow !== undefined ? { showLimitedBelow: p.showLimitedBelow } : {}), hasValidSale: hasSale }, now),
      price: v.price, salePrice: v.salePrice ?? null, variantId: v.id,
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

    const isWebhook = path === "/api/webhooks/payments";
    if (!["GET", "HEAD"].includes(req.method) && !isWebhook) {
      const origin = req.headers.get("origin");
      if (origin !== env.SITE_ORIGIN) return json({ error: "Forbidden" }, 403); // CSRF: same-origin only
    }

    /* ---------- payment webhook: raw body + HMAC, no cookies involved ---------- */
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
        if (sub === "/me" && req.method === "GET") return json({ id: actor.id, roles: actor.roles });
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
          return json(await transact(p, (db) => [...db.orders.values()].map((o) => ({ ...orderView(o), guestEmail: o.guestEmail ?? null, address: o.address }))));
        }
        if (sub === "/orders/status" && req.method === "POST") { await transact(p, (db) => staffUpdateStatus(db, actor, str(body, "orderId"), str(body, "to") as OrderStatus, str(body, "note") || undefined)); return json({ ok: true }); }
        if (sub === "/refunds" && req.method === "POST") {
          const r = await transact(p, (db) => requestRefund(db, actor, str(body, "orderId"), num(body, "amount"))); return json(r);
        }
        if (sub === "/refunds/complete" && req.method === "POST") { requirePermission(actor, "order.refund"); await transact(p, (db) => completeRefund(db, str(body, "orderId"), num(body, "amount"))); return json({ ok: true }); }
        if (sub === "/export/orders.csv" && req.method === "GET") {
          const csv = await transact(p, (db) => exportOrdersCsv(db, actor));
          return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="orders.csv"', ...NO_STORE } });
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
      return json({ order: orderView(r.order), ...(r.trackingSecret ? { trackingSecret: r.trackingSecret } : {}), paymentRequired: true }, r.duplicate ? 200 : 201);
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
