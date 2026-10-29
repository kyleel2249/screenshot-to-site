import { createFileRoute, Link, notFound } from "@tanstack/react-router";

interface Policy { title: string; body: string[] }
const POLICIES: Record<string, Policy> = {
  shipping: { title: "Shipping & delivery", body: ["Delivery areas, fees and estimated delivery periods are configured by the business and shown before you pay.", "Delivery dates shown are estimates, not confirmed dates, until your order is dispatched."] },
  returns: { title: "Returns & refunds", body: ["Return eligibility and timeframes will be set by the business. Nothing in this policy limits any rights you have under applicable consumer law.", "Refunds are issued to the original payment method in the original currency."] },
  preorder: { title: "Pre-order terms", body: ["Pre-order items are reserved before they arrive. Expected arrival windows are estimates and may change.", "If a pre-order is delayed or cannot be fulfilled you will be told, and cancellation and refund options will be offered."] },
  privacy: { title: "Privacy policy", body: ["We collect only the information needed to process orders, deliver goods and support you. We do not store card numbers or Mobile Money PINs.", "You may request access to, correction of, or deletion of your personal data."] },
  terms: { title: "Terms & conditions", body: ["By placing an order you agree to these terms. Prices and availability are confirmed at checkout and may change before an order is placed."] },
};

export const Route = createFileRoute("/policies/$slug")({
  loader: ({ params }) => { const policy = POLICIES[params.slug]; if (!policy) throw notFound(); return { policy }; },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.policy.title ?? "Policy"} — Dera Darko Trade` }] }),
  component: () => {
    const { policy } = Route.useLoaderData();
    return (
      <div className="container-x max-w-3xl py-16">
        <p className="rounded-md bg-secondary p-3 text-xs text-muted-foreground">DRAFT — pending review by the business owner and qualified legal advice for Ghana before launch.</p>
        <h1 className="mt-6 font-display text-4xl font-bold">{policy.title}</h1>
        {policy.body.map((b) => <p key={b} className="mt-4 leading-relaxed text-foreground/80">{b}</p>)}
        <Link to="/contact" className="mt-8 inline-block text-primary hover:underline">Questions? Contact us</Link>
      </div>
    );
  },
});
