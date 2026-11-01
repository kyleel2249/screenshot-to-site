/**
 * Guest (anonymous-session) customer API, mounted at /api/guest/*. Returns null for any other path so the dispatcher can continue.
 *
 * Session model — there is NO login:
 *  - First visit: GET /api/guest/session issues a signed, expiring cookie (`ddt_guest`: HttpOnly, Secure, SameSite=Strict). The id inside is
 *    random and server-generated. No database row is written until the visitor first changes something, so bots cost nothing.
 *  - Every call re-verifies the signature and expiry server-side. The cookie is renewed when it is past half-life.
 *  - Mutating calls need a same-origin `Origin` header (CSRF). Bodies are size-capped. Per-IP rate limits apply.
 *  - A session can only reach records linked to it. Order tracking additionally accepts a one-time tracking code, with no session.
 */
import { NO_STORE } from "../lib/security/headers";
import { RateLimiter, randomToken, signSession, verifySession } from "../lib/security/crypto";
import type { Currency } from "../lib/domain/money";
import type { GuestState } from "../lib/guest-types";
import { publicProducts, type Deps, type Env } from "./api-full-impl";
import type { GuestSessionRow, MemoryDb } from "./db";
import { ConflictError, transact, type Persistence } from "./persistence/transact";
import { ValidationError } from "./services/catalog-admin";
import * as G from "./services/guest";

const COOKIE = "ddt_guest";
const limiters = { general: new RateLimiter(240, 60_000), sensitive: new RateLimiter(12, 60_000), writes: new RateLimiter(6, 10 * 60_000) };

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", ...NO_STORE, ...extra } });
const setCookie = (token: string, maxAgeSec: number) => `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;

function cookieOf(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) { const [k, ...v] = part.trim().split("="); if (k === name) return v.join("="); }
  return undefined;
}
async function readBody(req: Request, limit = 60_000): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get("content-length") ?? 0) > limit) return null;
  const text = await req.text();
  if (text.length > limit) return null;
  try { const v: unknown = JSON.parse(text || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null; } catch { return null; }
}
const str = (b: Record<string, unknown>, k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
const cur = (v: unknown): Currency | null => (v === "GHS" || v === "USD" ? v : null);

/** Thrown inside a transaction to ABANDON it (nothing is saved) and answer with `res`. */
class Abort extends Error { constructor(public res: Response) { super("abort"); } }

export async function handleGuest(req: Request, env: Env, p: Persistence, deps: Deps): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/api/guest" && !path.startsWith("/api/guest/")) return null;
  const sub = path.slice("/api/guest".length) || "/";
  const method = req.method;
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const now = Date.now();

  try {
    if (!limiters.general.check(ip).allowed) return json({ error: "Too many requests" }, 429);
    const reads = method === "GET" || method === "HEAD";
    if (!reads && req.headers.get("origin") !== env.SITE_ORIGIN) return json({ error: "Forbidden" }, 403); // CSRF: same-origin only
    let body: Record<string, unknown> = {};
    if (!reads) { const b = await readBody(req); if (!b) return json({ error: "Bad request" }, 400); body = b; }

    /* ---- routes that need no session ---- */
    if (sub === "/track" && method === "GET") {
      const ref = url.searchParams.get("ref") ?? "", secret = url.searchParams.get("secret") ?? "";
      if (!limiters.sensitive.check(`track:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const found = await transact(p, async (db) => { const o = await G.orderByCode(db, ref, secret); return o ? G.orderDetail(db, o, now) : null; });
      return found ? json(found) : json({ error: "Not found" }, 404); // unknown reference and wrong code look identical
    }
    if (sub === "/promotions" && method === "GET") return json(await transact(p, (db) => G.promotions(db, publicProducts(db), now)), 200, { "Cache-Control": "public, max-age=60" });

    /* ---- session resolution ---- */
    const token = cookieOf(req, COOKIE);
    const claims = token ? await verifySession(token, env.SESSION_SECRET, now) : null;
    const valid = claims && claims.sub === "guest" && /^gs_[A-Za-z0-9_-]{16,}$/.test(claims.sid) ? claims : null;
    const ttlSec = Math.floor(G.GUEST_SESSION_TTL_MS / 1000);

    if (sub === "/session" && method === "GET") {
      let sid = valid?.sid ?? "", exp = valid?.exp ?? 0, cookie: string | undefined;
      if (!valid || exp - now < G.GUEST_SESSION_TTL_MS / 2) { // new visitor, or renew a session past half-life (same id, fresh expiry)
        sid = valid?.sid ?? `gs_${randomToken(18)}`; exp = now + G.GUEST_SESSION_TTL_MS;
        cookie = setCookie(await signSession({ sid, sub: "guest", exp }, env.SESSION_SECRET), ttlSec);
      }
      const state = await transact(p, (db) => G.buildState(db, G.getRow(db, sid, now), publicProducts(db), exp, now));
      return json({ state }, 200, cookie ? { "Set-Cookie": cookie } : {});
    }
    if (sub === "/recommendations" && method === "GET") {
      const focus = url.searchParams.get("slug") ?? undefined;
      return json(await transact(p, (db) => G.recommendationsFor(db, valid ? G.getRow(db, valid.sid, now) : undefined, publicProducts(db), focus && focus.length <= 160 ? focus : undefined, now)));
    }
    if (!valid) return json({ error: "no_session" }, 401); // the client re-opens GET /session and retries
    const sid = valid.sid, exp = valid.exp;

    /* ---- helpers bound to this session ---- */
    const read = <T,>(fn: (db: MemoryDb, row: GuestSessionRow | undefined, catalog: G.Catalog) => T | Promise<T>) => transact(p, (db) => fn(db, G.getRow(db, sid, now), publicProducts(db)));
    /** Runs a change against this session's row. A failed change abandons the transaction, so nothing partial or empty is saved. */
    const mutate = async (fn: (db: MemoryDb, row: GuestSessionRow, catalog: G.Catalog) => G.Mutation | Promise<G.Mutation>, extra?: (db: MemoryDb, row: GuestSessionRow, catalog: G.Catalog) => Record<string, unknown>) => {
      try {
        return json(await transact(p, async (db) => {
          const catalog = publicProducts(db), row = G.ensureRow(db, sid, now);
          if (!row) throw new Abort(json({ error: "We're busy right now. Please try again shortly." }, 503));
          const m = await fn(db, row, catalog);
          if (!m.ok) throw new Abort(json({ errors: [m.error] }, 422));
          return { state: G.buildState(db, row, catalog, exp, now), ...(extra ? extra(db, row, catalog) : {}) };
        }));
      } catch (e) { if (e instanceof Abort) return e.res; throw e; }
    };
    const withRow = async <T,>(fn: (db: MemoryDb, row: GuestSessionRow, catalog: G.Catalog) => T | Promise<T>): Promise<T> => transact(p, async (db) => {
      const row = G.ensureRow(db, sid, now);
      if (!row) throw new Abort(json({ error: "We're busy right now. Please try again shortly." }, 503));
      return fn(db, row, publicProducts(db));
    });

    /* ---- cart ---- */
    if (sub === "/cart" && method === "POST") return mutate((db, row, cat) => G.setCartQty(db, row, cat, str(body, "variantId"), typeof body["qty"] === "number" ? (body["qty"] as number) : NaN, now));
    if (sub === "/cart" && method === "DELETE") return mutate((_db, row) => { row.cart = []; return { ok: true }; });
    if (sub === "/cart/quote" && method === "POST") {
      const c = cur(body["currency"]); if (!c) return json({ errors: ["Choose GHS or USD."] }, 422);
      const out = await read((db, row, cat) => row ? G.quoteCart(db, row, cat, { currency: c, ...(str(body, "region") ? { region: str(body, "region") } : {}), ...(str(body, "zoneId") ? { zoneId: str(body, "zoneId") } : {}), ...(str(body, "discountCode") ? { discountCode: str(body, "discountCode").slice(0, 32) } : {}) }, now) : ({ ok: false, errors: ["Your cart is empty."] } as const));
      return json(out, out.ok ? 200 : 422);
    }

    /* ---- saved items, comparison, activity ---- */
    if (sub === "/wishlist" && method === "POST") return mutate((db, row, cat) => G.setWishlist(db, row, cat, str(body, "slug"), body["on"] === true));
    if (sub === "/compare" && method === "POST") return mutate((db, row, cat) => G.setCompare(db, row, cat, str(body, "slug"), body["on"] === true));
    if (sub === "/compare" && method === "DELETE") return mutate((_db, row) => { row.compare = []; return { ok: true }; });
    if (sub === "/viewed" && method === "POST") return mutate((db, row, cat) => G.recordViewed(db, row, cat, str(body, "slug"), now));
    if (sub === "/searches" && method === "POST") return mutate((_db, row) => G.recordSearch(row, body["q"], now));
    if (sub === "/searches" && method === "DELETE") return mutate((_db, row) => { row.searches = []; return { ok: true }; });
    if (sub === "/activity/clear" && method === "POST") return mutate((_db, row) => { G.clearActivity(row); return { ok: true }; });

    /* ---- preferences & addresses ---- */
    if (sub === "/preferences" && (method === "PUT" || method === "POST")) {
      try { return json(await transact(p, (db) => { const row = G.ensureRow(db, sid, now); if (!row) throw new Abort(json({ error: "We're busy right now. Please try again shortly." }, 503)); const r = G.savePrefs(row, body); if (!r.ok) throw new Abort(json({ errors: r.errors }, 422)); return { state: G.buildState(db, row, publicProducts(db), exp, now) }; })); }
      catch (e) { if (e instanceof Abort) return e.res; throw e; }
    }
    if (sub === "/addresses" && method === "POST") {
      try { return json(await transact(p, (db) => { const row = G.ensureRow(db, sid, now); if (!row) throw new Abort(json({ error: "We're busy right now. Please try again shortly." }, 503)); const r = G.saveAddress(row, body); if (!r.ok) throw new Abort(json({ errors: r.errors }, 422)); return { state: G.buildState(db, row, publicProducts(db), exp, now) }; }), 201); }
      catch (e) { if (e instanceof Abort) return e.res; throw e; }
    }
    if (sub === "/addresses" && method === "DELETE") return mutate((_db, row) => { G.removeAddress(row, str(body, "id")); return { ok: true }; });

    /* ---- forget me: deletes the server-side record and rotates the cookie. Placed orders remain with the business. ---- */
    if (sub === "/data" && method === "DELETE") {
      await transact(p, (db) => { G.deleteSession(db, sid); });
      const fresh = `gs_${randomToken(18)}`, fexp = now + G.GUEST_SESSION_TTL_MS;
      const state = await transact(p, (db) => G.buildState(db, undefined, publicProducts(db), fexp, now));
      return json({ state }, 200, { "Set-Cookie": setCookie(await signSession({ sid: fresh, sub: "guest", exp: fexp }, env.SESSION_SECRET), ttlSec) });
    }

    /* ---- orders & checkout ---- */
    if (sub === "/orders" && method === "GET") return json(await read((db, row) => (row ? row.orderIds.map((id) => db.orders.get(id)).filter((o) => !!o).sort((a, b) => b!.createdAt - a!.createdAt).slice(0, 50).map((o) => G.orderDetail(db, o!, now)) : [])));
    if (sub === "/orders/claim" && method === "POST") {
      if (!limiters.sensitive.check(`claim:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      try {
        return json(await withRow(async (db, row, cat) => {
          const o = await G.claimOrder(db, row, str(body, "ref"), str(body, "secret"));
          if (!o) throw new Abort(json({ error: "We couldn't find an order with those details." }, 404));
          return { order: G.orderDetail(db, o, now), state: G.buildState(db, row, cat, exp, now) };
        }));
      } catch (e) { if (e instanceof Abort) return e.res; throw e; }
    }
    if (sub === "/orders/reissue" && method === "POST") {
      if (!limiters.sensitive.check(`reissue:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const code = await withRow((db, row) => G.reissueTrackingCode(db, row, str(body, "ref")));
      return code ? json({ trackingCode: code }) : json({ error: "Not found" }, 404);
    }
    if (sub === "/checkout" && method === "POST") {
      if (!limiters.sensitive.check(`checkout:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      const c = cur(body["currency"]); if (!c) return json({ errors: ["Choose GHS or USD."] }, 422);
      const a = (body["address"] && typeof body["address"] === "object" && !Array.isArray(body["address"]) ? body["address"] : {}) as Record<string, unknown>;
      try {
        const r = await withRow(async (db, row, cat) => {
          const out = await G.guestCheckout(db, row, cat, {
            currency: c, region: str(body, "region"), zoneId: str(body, "zoneId"), email: str(body, "email"),
            address: { recipient: str(a, "recipient"), region: str(a, "region"), city: str(a, "city"), street: str(a, "street"), ...(str(a, "phone") ? { phone: str(a, "phone") } : {}) },
            ...(str(body, "discountCode") ? { discountCode: str(body, "discountCode") } : {}), idempotencyKey: str(body, "idempotencyKey"), acceptedTerms: body["acceptedTerms"] === true, preorderAcknowledged: body["preorderAcknowledged"] === true,
          }, now);
          if (!out.ok) throw new Abort(json({ errors: out.errors }, 422));
          return { out, order: G.orderDetail(db, out.order, now), email: out.order.guestEmail, state: G.buildState(db, row, cat, exp, now) };
        });
        if (!r.out.duplicate && r.email) { try { await deps.notify?.(r.email, "order_received", { ref: r.order.ref }); } catch { /* a failed notice never fails the order */ } }
        return json({ order: r.order, ...(r.out.trackingSecret ? { trackingSecret: r.out.trackingSecret } : {}), state: r.state }, r.out.duplicate ? 200 : 201);
      } catch (e) { if (e instanceof Abort) return e.res; throw e; }
    }

    /* ---- notifications ---- */
    if (sub === "/notifications" && method === "GET") return json(await read((db, row, cat) => (row ? G.notifications(db, row, cat, now) : [])));
    if (sub === "/notifications/read" && method === "POST") return mutate((_db, row) => { row.notificationsReadAt = now; return { ok: true }; });

    /* ---- support: enquiries and return / refund / cancellation requests ---- */
    if (sub === "/enquiries" && method === "GET") return json(await read((db, row) => (row ? G.listEnquiries(db, row) : [])));
    if (sub === "/enquiries" && method === "POST") {
      if (!limiters.writes.check(`enq:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      try { return json(await withRow((db, row) => { const r = G.createEnquiry(db, row, body, now); if (!r.ok) throw new Abort(json({ errors: r.errors }, 422)); return { ref: r.ref }; }), 201); }
      catch (e) { if (e instanceof Abort) return e.res; throw e; }
    }
    if (sub === "/returns" && method === "GET") return json(await read((db, row) => (row ? G.listReturns(db, row) : [])));
    if (sub === "/returns" && method === "POST") {
      if (!limiters.writes.check(`ret:${ip}`).allowed) return json({ error: "Too many requests" }, 429);
      try {
        return json(await withRow(async (db, row, cat) => {
          const r = await G.createReturnRequest(db, row, body, now);
          if (!r.ok) throw new Abort(json({ errors: r.errors }, 422));
          return { ref: r.ref, outcome: r.outcome, state: G.buildState(db, row, cat, exp, now) };
        }), 201);
      } catch (e) { if (e instanceof Abort) return e.res; throw e; }
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof Abort) return e.res;
    if (e instanceof ValidationError) return json({ errors: e.errors }, 422);
    if (e instanceof ConflictError) return json({ error: e.message }, 409);
    console.error("guest api error", e instanceof Error ? e.message : "unknown"); // never echo internals to the client
    return json({ error: "Something went wrong" }, 500);
  }
}

export type { GuestState };
