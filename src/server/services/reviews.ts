/**
 * Product reviews. Only a signed-in customer whose order containing the product has been DELIVERED may review it, once per product.
 * Reviews are held for moderation and never edited by staff (publish or reject only). Nothing here rewards or incentivises reviews.
 */
import type { MemoryDb, ReviewRow } from "../db";
import { requirePermission, type Actor } from "../rbac";
import { ValidationError } from "./catalog-admin";

const productBySlug = (db: MemoryDb, slug: string) => [...db.products.values()].find((p) => p.slug === slug && !p.archived);
const deliveredOrderFor = (db: MemoryDb, userId: string, productId: string) =>
  [...db.orders.values()].find((o) => o.userId === userId && o.status === "delivered" && o.items.some((i) => db.variants.get(i.variantId)?.productId === productId));

export function summary(db: MemoryDb, productId: string) {
  const rs = [...db.reviews.values()].filter((r) => r.productId === productId && r.status === "published");
  return { count: rs.length, average: rs.length ? Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 10) / 10 : 0 };
}
export function listPublished(db: MemoryDb, actor: Actor | null, slug: string) {
  const p = productBySlug(db, slug); if (!p) return null;
  const reviews = [...db.reviews.values()].filter((r) => r.productId === p.id && r.status === "published").sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ rating: r.rating, title: r.title, body: r.body, author: r.author, at: r.createdAt }));
  const mine = actor?.kind === "customer" ? [...db.reviews.values()].find((r) => r.userId === actor.id && r.productId === p.id) : undefined;
  const canReview = actor?.kind === "customer" && !mine && !!deliveredOrderFor(db, actor.id, p.id);
  return { summary: summary(db, p.id), reviews, canReview, myReview: mine ? { status: mine.status } : null };
}
export function submitReview(db: MemoryDb, actor: Actor | null, slug: string, input: { rating: unknown; title: unknown; body: unknown }, now = Date.now()) {
  if (!actor || actor.kind !== "customer") throw new ValidationError(["Sign in to write a review."]);
  const p = productBySlug(db, slug); if (!p) throw new ValidationError(["Unknown product."]);
  const rating = input.rating, title = typeof input.title === "string" ? input.title.trim() : "", body = typeof input.body === "string" ? input.body.trim() : "";
  const errors: string[] = [];
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) errors.push("Choose a rating from 1 to 5.");
  if (title.length > 100) errors.push("The title can be up to 100 characters.");
  if (body.length < 10 || body.length > 2000) errors.push("Write between 10 and 2,000 characters.");
  if (errors.length) throw new ValidationError(errors);
  if ([...db.reviews.values()].some((r) => r.userId === actor.id && r.productId === p.id)) throw new ValidationError(["You've already reviewed this product."]);
  const order = deliveredOrderFor(db, actor.id, p.id);
  if (!order) throw new ValidationError(["Only customers whose order has been delivered can review this product."]);
  const prof = db.profiles.get(actor.id);
  const id = db.nextId("rev");
  db.reviews.set(id, { id, productId: p.id, userId: actor.id, orderId: order.id, rating: rating as number, title, body, author: prof ? `${prof.firstName} ${prof.lastName.charAt(0)}.` : "Customer", status: "pending", createdAt: now });
  db.log("review.submitted", { reviewId: id });
}
export function listForModeration(db: MemoryDb, actor: Actor | null) {
  requirePermission(actor, "content.write");
  return [...db.reviews.values()].sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.createdAt - a.createdAt)
    .map((r) => ({ id: r.id, product: db.products.get(r.productId)?.name ?? "(removed)", rating: r.rating, title: r.title, body: r.body, author: r.author, status: r.status, createdAt: r.createdAt }));
}
export function moderate(db: MemoryDb, actor: Actor | null, id: string, action: unknown) {
  requirePermission(actor, "content.write");
  const r = db.reviews.get(id); if (!r) throw new ValidationError(["Unknown review."]);
  if (action !== "publish" && action !== "reject") throw new ValidationError(["Choose publish or reject."]);
  r.status = action === "publish" ? "published" : "rejected"; db.log(`review.${r.status}`, { reviewId: id }, actor.id);
}
export type { ReviewRow };
