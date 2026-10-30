/** Editable site pages. Defaults ship with the app; the owner's saved version (if any) replaces them. Plain text only — never HTML. */
export const PAGE_SLUGS = ["about", "faq", "shipping", "returns", "preorder", "privacy", "terms"] as const;
export type PageSlug = (typeof PAGE_SLUGS)[number];
export interface Section { heading: string; body: string }
export interface PageContent { slug: PageSlug; title: string; sections: Section[]; /** Legal text only: true once the owner confirms it has been reviewed. */ reviewed: boolean }
export const isLegal = (s: string) => ["shipping", "returns", "preorder", "privacy", "terms"].includes(s);
export const isPageSlug = (s: string): s is PageSlug => (PAGE_SLUGS as readonly string[]).includes(s);

export const DEFAULT_PAGES: Record<PageSlug, PageContent> = {
  about: { slug: "about", title: "About Dera Darko Trade", reviewed: false, sections: [
    { heading: "", body: "Dera Darko Trade sells imported products to shoppers, resellers and business buyers in Ghana, with in-stock items, pre-orders and bulk purchasing." } ] },
  faq: { slug: "faq", title: "Frequently asked questions", reviewed: false, sections: [
    { heading: "What does Pre-order mean?", body: "A pre-order is a reservation for an item that has not yet arrived. The expected arrival window is shown on the product and is an estimate, not a guarantee." },
    { heading: "Why can't I buy some items?", body: "Items marked Out of stock, Coming soon, Temporarily unavailable or Discontinued cannot be purchased. Pre-order items can be reserved when pre-orders are open." },
    { heading: "Which currencies do you show?", body: "You can view prices in Ghana cedis, US dollars or both using the selector in the header. Your order is charged in the single currency confirmed at checkout." },
    { heading: "Do you offer wholesale?", body: "Yes. Use the Wholesale page to request a written quote for bulk quantities and business pricing." },
    { heading: "Are health products medical treatments?", body: "No. Teas, gummies and supplements are sold as consumer products. We do not claim they treat or cure any condition." } ] },
  shipping: { slug: "shipping", title: "Shipping & delivery", reviewed: false, sections: [
    { heading: "Where we deliver", body: "We deliver to the regions and areas listed at checkout. Choose your delivery area and you will see the delivery fee and estimated delivery period before you pay. If we don't deliver to your area, checkout will say so rather than let you pay." },
    { heading: "Delivery fees", body: "Delivery fees depend on your area and, where applicable, the weight of your order. The fee shown at checkout is the fee you pay; we add nothing afterwards." },
    { heading: "Delivery times", body: "Delivery periods shown are estimates, not promises, until your order is dispatched. After dispatch you can follow progress with your order reference and tracking code on the Track Order page. Pre-order items are delivered after they arrive; see the Pre-order terms." },
    { heading: "Delivery attempts", body: "We will try to reach you using the phone number and address you gave. If delivery cannot be completed, we will contact you to arrange another attempt. Please make sure your address and phone number are correct." },
    { heading: "Damaged or wrong items", body: "Please check your parcel when you receive it. If something arrives damaged or is not what you ordered, contact us with your order reference as soon as possible so we can put it right; see Returns & refunds." } ] },
  returns: { slug: "returns", title: "Returns & refunds", reviewed: false, sections: [
    { heading: "Your rights", body: "Nothing in this policy limits any right you have under Ghanaian consumer law." },
    { heading: "Items that arrive faulty, damaged or not as described", body: "Contact us promptly with your order reference and a short description (photos help). We will repair, replace or refund the affected item, or agree another fair remedy with you." },
    { heading: "Change of mind", body: "Unless an item is listed as non-returnable, you may ask to return unused items in their original packaging. Contact us first so we can confirm the return. Items that are worn, used, damaged by you or missing parts or packaging may be refused or refunded in part. For hygiene reasons some items (for example underwear, swimwear and opened beauty or health products) cannot be returned unless faulty." },
    { heading: "Cars and special orders", body: "Vehicles and items made or sourced specially for you are covered by the written quotation or agreement we give you, not by the standard return rules above." },
    { heading: "How refunds are paid", body: "Approved refunds go back to the original payment method and in the original currency of the order. Card and Mobile Money refunds can take several working days to appear, depending on your bank or network. Bank-transfer orders are refunded to the account you tell us to use, which we will confirm with you first." },
    { heading: "Cancelling an order", body: "You can request to cancel an order before it is dispatched. If you have already paid, an approved cancellation is refunded as described above." } ] },
  preorder: { slug: "preorder", title: "Pre-order terms", reviewed: false, sections: [
    { heading: "What a pre-order is", body: "A pre-order reserves an item that has not yet arrived with us. It is clearly labelled on the product and at checkout, and you must acknowledge these terms before ordering." },
    { heading: "Expected arrival", body: "The arrival window shown is our best estimate, not a guaranteed date. It may change because of supplier, shipping or customs delays. We will tell you if your item is delayed." },
    { heading: "If your pre-order is delayed or cannot be fulfilled", body: "If we cannot supply the item, or it is significantly delayed, we will tell you and offer to cancel with a full refund of what you paid for it, or to keep waiting. We will not keep your money for an item we cannot supply." },
    { heading: "Mixed orders", body: "If an order contains both in-stock and pre-order items, the whole order is paid for together. Tell us if you would rather receive the in-stock items first and we will arrange it where we can." },
    { heading: "Order of fulfilment", body: "When stock arrives, paid pre-orders are fulfilled in the order they were paid for." } ] },
  privacy: { slug: "privacy", title: "Privacy policy", reviewed: false, sections: [
    { heading: "Who we are", body: "Dera Darko Trade is the business responsible for your personal data on this website. Our contact details are on the Contact page." },
    { heading: "What we collect and why", body: "Account details (name, email, password stored only as a secure hash), delivery addresses and phone numbers, your orders, messages you send us, and reviews you write. We use these to process orders, deliver goods, provide support, prevent fraud and meet our legal and accounting duties." },
    { heading: "Payments", body: "Card and Mobile Money payments are made on our payment partner's secure page; we never see or store your card number or Mobile Money PIN. For bank transfers we record only the amount and the bank's transaction reference. We keep a record of what was paid and when." },
    { heading: "Analytics and cookies", body: "We use one essential cookie to keep you signed in. Optional analytics run only if you accept them in the consent banner, use anonymous identifiers that change every day, and never store your name, email or address. You can change your choice at any time using the cookie settings link in the footer." },
    { heading: "Who we share data with", body: "Only the services we need to run the shop: our payment provider, our email provider, delivery partners (name, address and phone number for your delivery), and our hosting provider. We do not sell your personal data." },
    { heading: "Your rights", body: "You can see and correct your details in your account, download your data, and delete your account. When you delete your account we erase your profile, addresses, saved items, cart and sign-in details; order records we are required to keep for tax and accounting are kept without your identity attached. You may also ask us to restrict or stop certain uses of your data by contacting us. If you are unhappy with how we handle your data you can complain to Ghana's Data Protection Commission." },
    { heading: "How long we keep data", body: "Order and payment records are kept for as long as the law requires. Account data is kept while your account is open. Support messages are kept for as long as needed to resolve your matter." },
    { heading: "Security", body: "Passwords are stored hashed, staff accounts use two-step verification, and sensitive actions need fresh sign-in. No online service can promise perfect security; if a breach affects you we will tell you and the authorities as the law requires." } ] },
  terms: { slug: "terms", title: "Terms & conditions", reviewed: false, sections: [
    { heading: "Agreement", body: "By placing an order you agree to these terms, the Shipping & delivery, Returns & refunds, Pre-order and Privacy policies. If you do not agree, please do not place an order." },
    { heading: "Prices and availability", body: "Prices are shown in Ghana cedis (GHS), US dollars (USD) or both. Your order is charged in the one currency confirmed at checkout. Prices, availability and delivery fees are confirmed when you place the order; we may correct obvious pricing errors and will tell you before proceeding." },
    { heading: "Placing and paying for an order", body: "Items in your order are held for you for a short time while you pay. If payment is not completed in that time the order is cancelled and the items are released. An order is confirmed only when we have verified your payment. Bank-transfer orders are confirmed once we have received the money." },
    { heading: "Payment methods", body: "We accept the payment methods shown at checkout, which may include card, Mobile Money and bank transfer. Which methods are available can depend on the currency of your order." },
    { heading: "Delivery, returns and refunds", body: "These are covered by the Shipping & delivery and Returns & refunds policies, which form part of these terms." },
    { heading: "Accounts", body: "Keep your sign-in details private and tell us if you think someone else has used your account. You must give accurate information when ordering." },
    { heading: "Reviews", body: "Only customers with a delivered order can review a product. Reviews are checked before they appear. We publish honest reviews, including critical ones, and may reject reviews that are abusive, unlawful or unrelated to the product." },
    { heading: "Health products", body: "Health and wellness products are sold as consumer goods. We do not claim that they diagnose, treat or cure any condition. Speak to a qualified health professional about medical concerns." },
    { heading: "Our responsibility", body: "We take care to describe products accurately and to deliver what you ordered. Nothing in these terms limits any liability that cannot lawfully be limited, including your rights under Ghanaian consumer law." },
    { heading: "Changes and contact", body: "We may update these terms; the version shown when you order applies to that order. Questions? Use the Contact page." } ] },
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
