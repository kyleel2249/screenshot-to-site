/** Editable site pages. Defaults ship with the app; the owner's saved version (if any) replaces them. Plain text only — never HTML. */
export const PAGE_SLUGS = ["about", "faq", "shipping", "returns", "preorder", "privacy", "terms"] as const;
export type PageSlug = (typeof PAGE_SLUGS)[number];
export interface Section { heading: string; body: string }
export interface PageContent { slug: PageSlug; title: string; sections: Section[]; /** Legal text only: true once the owner confirms it has been reviewed. */ reviewed: boolean }
export const isLegal = (s: string) => ["shipping", "returns", "preorder", "privacy", "terms"].includes(s);
export const isPageSlug = (s: string): s is PageSlug => (PAGE_SLUGS as readonly string[]).includes(s);

export const DEFAULT_PAGES: Record<PageSlug, PageContent> = {
  about: { slug: "about", title: "About Dera Darko Trade", reviewed: false, sections: [
    { heading: "", body: "Dera Darko Trade sells imported products to shoppers, resellers and business buyers in Ghana, with in-stock items, pre-orders and bulk purchasing." },
    { heading: "Business details", body: "Business registration details, address, supplier relationships and any certifications will be published here only once supplied and verified by the owner." } ] },
  faq: { slug: "faq", title: "Frequently asked questions", reviewed: false, sections: [
    { heading: "What does Pre-order mean?", body: "A pre-order is a reservation for an item that has not yet arrived. The expected arrival window is shown on the product and is an estimate, not a guarantee." },
    { heading: "Why can't I buy some items?", body: "Items marked Out of stock, Coming soon, Temporarily unavailable or Discontinued cannot be purchased. Pre-order items can be reserved when pre-orders are open." },
    { heading: "Which currencies do you show?", body: "You can view prices in Ghana cedis, US dollars or both using the selector in the header. Your order is charged in the single currency confirmed at checkout." },
    { heading: "Do you offer wholesale?", body: "Yes. Use the Wholesale page to request a written quote for bulk quantities and business pricing." },
    { heading: "Are health products medical treatments?", body: "No. Teas, gummies and supplements are sold as consumer products. We do not claim they treat or cure any condition." } ] },
  shipping: { slug: "shipping", title: "Shipping & delivery", reviewed: false, sections: [
    { heading: "", body: "Delivery areas, fees and estimated delivery periods are configured by the business and shown before you pay." },
    { heading: "", body: "Delivery dates shown are estimates, not confirmed dates, until your order is dispatched." } ] },
  returns: { slug: "returns", title: "Returns & refunds", reviewed: false, sections: [
    { heading: "", body: "Return eligibility and timeframes will be set by the business. Nothing in this policy limits any rights you have under applicable consumer law." },
    { heading: "", body: "Refunds are issued to the original payment method in the original currency." } ] },
  preorder: { slug: "preorder", title: "Pre-order terms", reviewed: false, sections: [
    { heading: "", body: "Pre-order items are reserved before they arrive. Expected arrival windows are estimates and may change." },
    { heading: "", body: "If a pre-order is delayed or cannot be fulfilled you will be told, and cancellation and refund options will be offered." } ] },
  privacy: { slug: "privacy", title: "Privacy policy", reviewed: false, sections: [
    { heading: "", body: "We collect only the information needed to process orders, deliver goods and support you. We do not store card numbers or Mobile Money PINs." },
    { heading: "", body: "You may request access to, correction of, or deletion of your personal data. Analytics run only if you accept them, use anonymous identifiers that rotate daily, and never store your IP address." } ] },
  terms: { slug: "terms", title: "Terms & conditions", reviewed: false, sections: [
    { heading: "", body: "By placing an order you agree to these terms. Prices and availability are confirmed at checkout and may change before an order is placed." } ] },
};

export interface PageError { errors: string[] }
/** Validates and normalises editor input. Returns the clean page or a list of problems. */
export function cleanPage(slug: PageSlug, raw: { title?: unknown; sections?: unknown }): { ok: true; title: string; sections: Section[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title || title.length > 120) errors.push("Title is required (up to 120 characters).");
  const list = Array.isArray(raw.sections) ? raw.sections : [];
  if (list.length < 1 || list.length > 40) errors.push("A page needs between 1 and 40 sections.");
  const sections: Section[] = [];
  for (const s of list.slice(0, 40)) {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const heading = typeof o["heading"] === "string" ? o["heading"].trim() : "", body = typeof o["body"] === "string" ? o["body"].trim() : "";
    if (heading.length > 200) errors.push("Headings can be up to 200 characters.");
    if (!body || body.length > 5000) errors.push("Every section needs text (up to 5,000 characters).");
    if (slug === "faq" && !heading) errors.push("Every FAQ entry needs a question.");
    sections.push({ heading, body });
  }
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, title, sections };
}
