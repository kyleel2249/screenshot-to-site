import { cleanPage, DEFAULT_PAGES, isLegal, isPageSlug, PAGE_SLUGS, type PageContent } from "../../lib/content";
import type { MemoryDb } from "../db";
import { can, requirePermission, type Actor } from "../rbac";
import { ValidationError } from "./catalog-admin";

export function getPage(db: MemoryDb, slug: string): PageContent | null {
  if (!isPageSlug(slug)) return null;
  const s = db.pages[slug];
  return s ? { slug, title: s.title, sections: s.sections, reviewed: s.reviewed } : DEFAULT_PAGES[slug];
}
export function listPages(db: MemoryDb, actor: Actor | null) {
  requirePermission(actor, "content.write");
  return PAGE_SLUGS.map((slug) => ({ ...getPage(db, slug)!, customised: !!db.pages[slug], legal: isLegal(slug), updatedAt: db.pages[slug]?.updatedAt ?? null }));
}
/**
 * Saves a page. Marking legal text as reviewed needs `settings.write` (owner/manager, recent re-auth);
 * any edit by someone without it drops the page back to "not reviewed", so unreviewed wording never wears a reviewed badge.
 */
export function savePage(db: MemoryDb, actor: Actor | null, slug: string, input: { title?: unknown; sections?: unknown; reviewed?: unknown }, now = Date.now()) {
  requirePermission(actor, "content.write");
  if (!isPageSlug(slug)) throw new ValidationError(["Unknown page."]);
  const c = cleanPage(slug, input); if (!c.ok) throw new ValidationError(c.errors);
  let reviewed = false;
  if (isLegal(slug) && input.reviewed === true) { requirePermission(actor, "settings.write", now); reviewed = true; }
  else if (isLegal(slug) && can(actor, "settings.write") && input.reviewed === undefined) reviewed = db.pages[slug]?.reviewed === true && JSON.stringify(db.pages[slug]!.sections) === JSON.stringify(c.sections);
  db.pages[slug] = { slug, title: c.title, sections: c.sections, reviewed, updatedAt: now, updatedBy: actor.id };
  db.log("content.saved", { slug, reviewed }, actor.id);
}
export function resetPage(db: MemoryDb, actor: Actor | null, slug: string) {
  requirePermission(actor, "content.write");
  if (!isPageSlug(slug)) throw new ValidationError(["Unknown page."]);
  delete db.pages[slug]; db.log("content.reset", { slug }, actor.id);
}
