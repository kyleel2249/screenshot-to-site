import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSite } from "@/lib/site";
import { DEFAULT_PAGES, isLegal, type PageContent, type PageSlug } from "@/lib/content";

/** Renders an editable page as plain text. Starts from the shipped default (so content is present in the first paint), then swaps in the owner's version. */
export function PageView({ slug }: { slug: PageSlug }) {
  const [page, setPage] = useState<PageContent>(DEFAULT_PAGES[slug]);
  useEffect(() => { setPage(DEFAULT_PAGES[slug]); void api.page(slug).then((r) => { if (r.ok && r.data) setPage(r.data); }); }, [slug]);
  const legal = isLegal(slug); const site = useSite();
  return (
    <div className="container-x max-w-3xl py-16">
      {legal && !page.reviewed && <p className="rounded-md bg-secondary p-3 text-xs text-muted-foreground">DRAFT — pending review by the business owner and qualified legal advice for Ghana before launch.</p>}
      <h1 className="mt-6 font-display text-4xl font-bold">{page.title}</h1>
      {slug === "faq" ? (
        <div className="mt-8 divide-y divide-border">{page.sections.map((s, i) => <details key={i} className="py-4"><summary className="cursor-pointer font-medium text-primary">{s.heading}</summary><p className="mt-2 whitespace-pre-line text-foreground/80">{s.body}</p></details>)}</div>
      ) : page.sections.map((s, i) => (
        <section key={i} className="mt-6">{s.heading && <h2 className="font-display text-xl font-bold">{s.heading}</h2>}<p className="mt-2 whitespace-pre-line leading-relaxed text-foreground/80">{s.body}</p></section>
      ))}
      {slug === "about" && (site.registrationNumber || site.tin || site.address) && (
        <section className="mt-6" aria-label="Business details"><h2 className="font-display text-xl font-bold">Business details</h2>
          <ul className="mt-2 space-y-1 text-foreground/80">
            {site.registrationNumber && <li>Registration number: {site.registrationNumber}</li>}{site.tin && <li>TIN: {site.tin}</li>}
            {site.address && <li className="whitespace-pre-line">{site.address}{site.city ? `\n${site.city}` : ""}</li>}
          </ul></section>)}
      {legal && <Link to="/contact" className="mt-8 inline-block text-primary hover:underline">Questions? Contact us</Link>}
    </div>
  );
}
