/**
 * Server-side SEO for product pages. The storefront loads its catalogue in the browser, so the HTML a crawler or link-preview
 * bot receives would otherwise carry only the generic site title. Here the edge reads the product straight from the database
 * and writes the title, description, canonical URL, Open Graph tags and Product JSON-LD into the document head — mirroring
 * exactly what the page shows (price, availability, only real published review ratings).
 */
export interface SeoProduct {
  slug: string; name: string; shortDescription: string; image: string; availability: string;
  price: Partial<Record<string, number>>; salePrice: Partial<Record<string, number>> | null; rating?: { average: number; count: number } | null;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** JSON safe inside a <script> element: no way to close the tag or break out via line separators. */
export const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const AVAIL: Record<string, string> = { available: "https://schema.org/InStock", pre_order: "https://schema.org/PreOrder" };

export function productJsonLd(p: SeoProduct, origin: string) {
  const ghs = (p.salePrice ?? p.price)["GHS"];
  const image = /^https?:\/\//.test(p.image) ? p.image : `${origin}${p.image.startsWith("/") ? "" : "/"}${p.image}`;
  return {
    "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.shortDescription, image,
    ...(p.rating && p.rating.count > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: p.rating.average, reviewCount: p.rating.count } } : {}),
    ...(ghs !== undefined ? { offers: { "@type": "Offer", priceCurrency: "GHS", price: (ghs / 100).toFixed(2), availability: AVAIL[p.availability] ?? "https://schema.org/OutOfStock", url: `${origin}/product/${encodeURIComponent(p.slug)}` } } : {}),
  };
}

export function injectProductSeo(html: string, p: SeoProduct, siteOrigin: string): string {
  const origin = siteOrigin.replace(/\/+$/, "");
  const url = `${origin}/product/${encodeURIComponent(p.slug)}`, title = `${p.name} — Dera Darko Trade`, desc = p.shortDescription.slice(0, 300);
  const ld = productJsonLd(p, origin);
  const tags = [
    `<meta name="description" content="${esc(desc)}">`, `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="product">`, `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`, `<meta property="og:image" content="${esc(ld.image)}">`,
    `<meta name="twitter:title" content="${esc(title)}">`, `<meta name="twitter:description" content="${esc(desc)}">`, `<meta name="twitter:image" content="${esc(ld.image)}">`,
    `<script type="application/ld+json" data-seo="product">${safeJson(ld)}</script>`,
  ].join("");
  let out = html
    .replace(/<meta\s+(?:name|property)=["'](?:description|og:type|og:title|og:description|og:url|og:image|twitter:title|twitter:description|twitter:image)["'][^>]*>/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "").replace(/<head[^>]*>/i, (m) => `${m}<title>${esc(title)}</title>`);
  return /<\/head>/i.test(out) ? out.replace(/<\/head>/i, () => `${tags}</head>`) : out;
}
