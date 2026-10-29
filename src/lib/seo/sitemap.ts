import type { CategoryNode } from "../domain/categories";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export interface SitemapInput { siteUrl: string; categories: CategoryNode[]; products: { slug: string; updatedAt: string; published: boolean; archived?: boolean }[]; staticPaths?: string[] }

/** Only published, canonical, public URLs. Private/admin/cart/checkout/account paths can never appear. */
export function buildSitemap(i: SitemapInput): string {
  const base = i.siteUrl.replace(/\/+$/, "");
  const urls: { loc: string; lastmod?: string }[] = [];
  for (const p of i.staticPaths ?? ["/", "/shop", "/new-arrivals", "/preorders", "/deals", "/wholesale", "/about", "/faq", "/contact"]) urls.push({ loc: base + p });
  for (const c of i.categories) if (c.published) urls.push({ loc: `${base}/shop?category=${encodeURIComponent(c.slug)}` });
  for (const p of i.products) if (p.published && !p.archived) urls.push({ loc: `${base}/product/${encodeURIComponent(p.slug)}`, lastmod: p.updatedAt.slice(0, 10) });
  const body = urls.map((u) => `<url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export function buildRobots(siteUrl: string, portalPath?: string | null): string {
  // The portal path is deliberately NOT listed (listing it would reveal it); it is protected by auth and noindex headers instead.
  void portalPath;
  return ["User-agent: *", "Allow: /", "Disallow: /cart", "Disallow: /checkout", "Disallow: /account", "Disallow: /login", "Disallow: /register", "Disallow: /track", "Disallow: /reset-password", "Disallow: /verify-email", `Sitemap: ${siteUrl.replace(/\/+$/, "")}/sitemap.xml`, ""].join("\n");
}
