/**
 * API dispatcher.
 *
 *  - Under the portal path while STAFF_OPEN_ACCESS is on (TEMP): the open-access admin block below (no login; catalogue
 *    list/create/publish/seed + product image upload). It deliberately exposes NO customer data and NO order/payment mutations.
 *  - `/api/guest/*`: the anonymous-session customer dashboard layer (`./guest`).
 *  - Everything else: the complete authenticated API in `./api-full-impl` (public catalogue, checkout, tracking, support, payments,
 *    customer accounts and — when STAFF_OPEN_ACCESS is false — the secret-path staff API with MFA and RBAC).
 *
 * To lock down for production set STAFF_OPEN_ACCESS = false (src/lib/security/open-access.ts): the dispatcher then sends the
 * portal path to the full authenticated API as well. See docs/OPEN_ADMIN.md.
 */
import { STAFF_OPEN_ACCESS } from "../lib/security/open-access";
import { resolvePortalPath } from "../lib/security/enrolment";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import type { MemoryDb } from "./db";
import type { Persistence } from "./persistence/transact";
import { transact } from "./persistence/transact";
import { Forbidden, requirePermission } from "./rbac";
import type { R2Like } from "./media";
import { storeImage, serveImage, MEDIA_MAX_BYTES, sniffImage } from "./media";
import { openAccessActor } from "./open-access-actor";
import { createProduct, setPublishedState, ValidationError } from "./services/catalog-admin";
import type { Availability } from "../lib/domain/status";

import { handle as handleFull, publicProducts, effectiveRate, type Env, type Deps, type NoticeTemplate } from "./api-full-impl";
import { handleGuest } from "./guest";

export { publicProducts, effectiveRate };
export type { Env, Deps, NoticeTemplate };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" } });

function ensureCategories(db: MemoryDb) {
  if (!db.categories?.length) {
    db.categories = SEED_CATEGORIES.map((c) => ({ ...c }));
  }
  return db.categories;
}

function asMinor(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

function normalizeAvailability(raw: unknown): Availability {
  const s = String(raw ?? "available");
  if (s === "enquiry") return "temporarily_unavailable";
  const allowed: Availability[] = ["available", "pre_order", "out_of_stock", "coming_soon", "temporarily_unavailable", "discontinued"];
  return (allowed.includes(s as Availability) ? s : "available") as Availability;
}

function listAdminProducts(db: MemoryDb) {
  return [...db.products.values()].map((pr) => {
    const v = [...db.variants.values()].find((x) => x.productId === pr.id);
    return {
      id: pr.id, slug: pr.slug, name: pr.name, archived: pr.archived, variantId: v?.id ?? null,
      sku: v?.id.split("::")[1] ?? null, availability: v?.availability ?? null, published: v?.published ?? false,
      categoryId: pr.categoryId, attributes: pr.attributes ?? {}, price: v?.price ?? {}, salePrice: v?.salePrice ?? null,
      onHand: v?.onHand ?? 0, reserved: v?.reserved ?? 0, preOrderEnabled: !!v?.preOrder?.enabled,
      shortDescription: pr.shortDescription, image: pr.image, imageAlt: pr.imageAlt,
    };
  });
}

const SAMPLE_SEED: {
  name: string; sku: string; categoryId: string; shortDescription: string; image: string; imageAlt: string;
  priceGhs?: number; priceUsd?: number; onHand: number; published: boolean;
}[] = [
  { name: "Laundry Basket", sku: "DDT-003", categoryId: "cat-household-and-kitchen--household-items", shortDescription: "Sturdy laundry basket for home use.", image: "/products/DDT-003.png", imageAlt: "Laundry Basket", priceGhs: 8500, priceUsd: 800, onHand: 25, published: true },
  { name: "Storage Container Set", sku: "DDT-004", categoryId: "cat-household-and-kitchen--household-items", shortDescription: "Set of storage containers.", image: "/products/DDT-004.png", imageAlt: "Storage Container Set", priceGhs: 12000, priceUsd: 1100, onHand: 40, published: true },
  { name: "Cotton T-Shirt", sku: "DDT-010", categoryId: "cat-clothing-and-fashion--mens-clothes", shortDescription: "Everyday cotton t-shirt.", image: "/products/DDT-010.png", imageAlt: "Cotton T-Shirt", priceGhs: 4500, priceUsd: 400, onHand: 100, published: true },
  { name: "School Backpack", sku: "DDT-020", categoryId: "cat-bags-and-luggage--school-bags", shortDescription: "Durable school backpack.", image: "/products/DDT-020.png", imageAlt: "School Backpack", priceGhs: 15000, priceUsd: 1400, onHand: 30, published: true },
  { name: "Phone Power Bank", sku: "DDT-030", categoryId: "cat-phones-and-accessories--power-banks", shortDescription: "Portable power bank.", image: "/products/DDT-030.png", imageAlt: "Phone Power Bank", priceGhs: 18000, priceUsd: 1600, onHand: 50, published: true },
  { name: "Leather Belt", sku: "DDT-040", categoryId: "cat-clothing-and-fashion--mens-clothes", shortDescription: "Classic leather belt.", image: "/products/DDT-040.png", imageAlt: "Leather Belt", priceGhs: 7500, priceUsd: 700, onHand: 20, published: true },
  { name: "Hair Extension Pack", sku: "DDT-050", categoryId: "cat-hair-and-hair-accessories--hair-extensions", shortDescription: "Hair extension pack.", image: "/products/DDT-050.png", imageAlt: "Hair Extension Pack", priceGhs: 22000, priceUsd: 2000, onHand: 15, published: true },
  { name: "Ceramic Sink", sku: "DDT-060", categoryId: "cat-building-materials-and-fixtures--sinks", shortDescription: "Bathroom ceramic sink.", image: "/products/DDT-060.png", imageAlt: "Ceramic Sink", priceGhs: 45000, priceUsd: 4000, onHand: 8, published: true },
];

/** Customer-facing traffic: the guest dashboard layer first, then the full API. Neither needs the open-access admin block. */
async function handleCustomerSide(req: Request, env: Env, p: Persistence, deps: Deps): Promise<Response> {
  const guest = await handleGuest(req, env, p, deps);
  return guest ?? handleFull(req, env, p, deps);
}

export async function handle(req: Request, env: Env, p: Persistence, deps: Deps = {}): Promise<Response> {
  if (!STAFF_OPEN_ACCESS) return handleCustomerSide(req, env, p, deps); // production: the full API owns the portal path too
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const portal = resolvePortalPath(env) ?? "/dera-owner-console";
  const underPortal = path === `${portal}/api` || path.startsWith(`${portal}/api/`);

  const mediaMatch = path.match(/^\/media\/([a-f0-9]{32}\.(?:jpg|png|webp|gif))$/i);
  if (mediaMatch && req.method === "GET") {
    return serveImage(env.MEDIA, mediaMatch[1]!);
  }
  if (!underPortal) return handleCustomerSide(req, env, p, deps); // body untouched: the delegate reads it

  let body: Record<string, unknown> = {};
  const isMediaUpload = path === `${portal}/api/media` && req.method === "POST";
  if (!isMediaUpload && req.method !== "GET" && req.method !== "HEAD") {
    try { body = (await req.json()) as Record<string, unknown>; } catch { body = {}; }
  }

  if (underPortal) {
    const sub = path.slice(portal.length + 4) || "/";
    const open = await transact(p, (db) => openAccessActor(db));
    if (!open) return json({ error: "Not found" }, 404);
    const { actor } = open;

    try {
      if (sub === "/me" && req.method === "GET") {
        return json({ id: actor.id, roles: actor.roles, mfa: "verified", mustChangePassword: false });
      }
      if (sub === "/overview" && req.method === "GET") {
        return json(await transact(p, (db) => {
          ensureCategories(db);
          return {
            products: db.products.size,
            published: [...db.variants.values()].filter((v) => v.published).length,
            orders: db.orders.size,
            openTickets: [...db.tickets.values()].filter((t) => t.status === "open" || t.status === "pending").length,
            categories: db.categories.length,
          };
        }));
      }
      if (sub === "/categories" && req.method === "GET") {
        return json(await transact(p, (db) => ensureCategories(db)));
      }
      if (sub === "/products" && req.method === "GET") {
        requirePermission(actor, "product.read");
        return json(await transact(p, (db) => listAdminProducts(db)));
      }
      if (sub === "/products" && req.method === "POST") {
        requirePermission(actor, "product.write");
        const priceGhs = asMinor(body.priceGhs);
        const priceUsd = asMinor(body.priceUsd);
        const onHand = asMinor(body.onHand) ?? 0;
        let published = body.published === true;
        if (published && priceGhs === undefined && priceUsd === undefined) {
          published = false;
        }
        const availability = normalizeAvailability(body.availability);
        const name = String(body.name ?? "").trim();
        let sku = String(body.sku ?? "").trim();
        if (!sku && name) sku = `DDT-GEN-${Date.now().toString(36).toUpperCase()}`;

        const row = await transact(p, (db) => {
          ensureCategories(db);
          let categoryId = String(body.categoryId ?? "");
          if (!db.categories.some((c) => c.id === categoryId)) {
            const fallback = db.categories.find((c) => c.parentId) ?? db.categories[0];
            if (!fallback) throw new ValidationError(["No categories available. Refresh and try again."]);
            categoryId = fallback.id;
          }
          let image = String(body.image ?? "/products/placeholder.png");
          if (image.startsWith("blob:")) image = "/products/placeholder.png";

          return createProduct(db, actor, {
            name,
            categoryId,
            shortDescription: String(body.shortDescription ?? name),
            description: body.description ? String(body.description) : undefined,
            image,
            imageAlt: String(body.imageAlt ?? (name || "Product")),
            sku,
            priceGhs,
            priceUsd,
            onHand,
            published,
            availability,
            preOrderEnabled: availability === "pre_order",
          });
        });
        return json({ id: row.id, slug: row.slug, published });
      }
      if (sub === "/products/publish" && req.method === "POST") {
        await transact(p, (db) => setPublishedState(db, actor, String(body.productId ?? ""), body.published === true));
        return json({ ok: true });
      }
      if (sub === "/media" && req.method === "POST") {
        requirePermission(actor, "product.write");
        const data = await req.arrayBuffer();
        if (env.MEDIA) {
          const result = await storeImage(env.MEDIA, data);
          if ("error" in result) return json({ error: result.error, errors: [result.error] }, 400);
          return json({ url: result.url });
        }
        if (data.byteLength > MEDIA_MAX_BYTES) {
          return json({ error: "Image too large and MEDIA (R2) is not configured.", errors: ["Image too large and MEDIA (R2) is not configured."] }, 400);
        }
        const bytes = new Uint8Array(data);
        const kind = sniffImage(bytes);
        if (!kind) return json({ error: "Only JPEG, PNG, WebP or GIF images can be uploaded.", errors: ["Only JPEG, PNG, WebP or GIF images can be uploaded."] }, 400);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        const b64 = btoa(binary);
        return json({ url: `data:${kind.type};base64,${b64}` });
      }
      if (sub === "/products/seed" && req.method === "POST") {
        const created = await transact(p, (db) => {
          ensureCategories(db);
          const out: { name: string; sku: string }[] = [];
          for (const s of SAMPLE_SEED) {
            if ([...db.variants.values()].some((v) => v.id.split("::")[1] === s.sku)) continue;
            const cat = db.categories.find((c) => c.id === s.categoryId) ?? db.categories.find((c) => c.parentId) ?? db.categories[0];
            if (!cat) continue;
            try {
              createProduct(db, actor, {
                name: s.name,
                categoryId: cat.id,
                shortDescription: s.shortDescription,
                image: s.image,
                imageAlt: s.imageAlt,
                sku: s.sku,
                priceGhs: s.priceGhs,
                priceUsd: s.priceUsd,
                onHand: s.onHand,
                published: s.published,
                availability: "available",
              });
              out.push({ name: s.name, sku: s.sku });
            } catch {
              /* skip */
            }
          }
          return out;
        });
        return json({ ok: true, count: created.length, created });
      }
      if (req.method === "GET") return json([]);
      return json({ ok: true });
    } catch (e) {
      if (e instanceof ValidationError) return json({ error: e.message, errors: e.errors }, 422);
      if (e instanceof Forbidden) return json({ error: e.message || "Forbidden", errors: [e.message || "Forbidden"] }, 403);
      console.error(e);
      return json({ error: e instanceof Error ? e.message : "Something went wrong", errors: [e instanceof Error ? e.message : "Something went wrong"] }, 500);
    }
  }

  return json({ error: "Not found", errors: ["Not found"] }, 404);
}
