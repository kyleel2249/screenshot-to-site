import { createFileRoute } from "@tanstack/react-router";

const FAQ = [
  { q: "What does Pre-order mean?", a: "A pre-order is a reservation for an item that has not yet arrived. The expected arrival window is shown on the product and is an estimate, not a guarantee." },
  { q: "Why can't I buy some items?", a: "Items marked Out of stock, Coming soon, Temporarily unavailable or Discontinued cannot be purchased. Pre-order items can be reserved when pre-orders are open." },
  { q: "Which currencies do you show?", a: "You can view prices in Ghana cedis, US dollars or both using the selector in the header. Your order is charged in the single currency confirmed at checkout." },
  { q: "Do you offer wholesale?", a: "Yes. Use the Wholesale page to send an enquiry about bulk quantities and business pricing." },
  { q: "Are health products medical treatments?", a: "No. Teas, gummies and supplements are sold as consumer products. We do not claim they treat or cure any condition." },
];

export const Route = createFileRoute("/faq")({
  head: () => ({ meta: [{ title: "FAQ — Dera Darko Trade" }, { name: "description", content: "Answers about pre-orders, availability, currencies, wholesale and product information." }] }),
  component: () => (
    <div className="container-x max-w-3xl py-16">
      <h1 className="font-display text-4xl font-bold">Frequently asked questions</h1>
      <div className="mt-8 divide-y divide-border">
        {FAQ.map((f) => (
          <details key={f.q} className="py-4"><summary className="cursor-pointer font-medium text-primary">{f.q}</summary><p className="mt-2 text-foreground/80">{f.a}</p></details>
        ))}
      </div>
    </div>
  ),
});
