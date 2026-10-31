import { Link } from "@tanstack/react-router";
import { ShoppingBag, Menu, X, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useCart } from "@/lib/cart";
import { useCurrency } from "@/lib/currency";
import { useSite } from "@/lib/site";
import { waLink } from "@/lib/business";
import { useCatalog } from "@/lib/catalog-store";
import { ConsentLink } from "@/components/ConsentBanner";
import { childrenOf, topLevel } from "@/lib/domain/categories";
import type { DisplayMode } from "@/lib/domain/money";

export function SiteHeader() {
  const { count } = useCart();
  const { categories } = useCatalog();
  const { mode, setMode } = useCurrency();
  const [open, setOpen] = useState(false);
  const tops = topLevel(categories);
  const nav = [
    { to: "/new-arrivals", label: "New" },
    { to: "/preorders", label: "Pre-orders" },
    { to: "/deals", label: "Deals" },
    { to: "/wholesale", label: "Wholesale" },
    { to: "/contact", label: "Contact" },
  ] as const;
  return (
    <header className="sticky top-0 z-40 bg-primary text-primary-foreground">
      <div className="bg-gold text-gold-foreground text-center text-xs font-medium py-1.5 px-4">
        Pre-orders open on selected imported items — expected arrival windows shown on each product
      </div>
      <div className="container-x flex h-16 items-center justify-between gap-4">
        <Link to="/" className="font-display text-xl font-bold tracking-wide">
          DERA <span className="text-gold">DARKO</span> TRADE
        </Link>
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium" aria-label="Main">
          <div className="group relative">
            <Link to="/shop" search={{}} className="inline-flex items-center gap-1 hover:text-gold transition-colors">Shop <ChevronDown className="h-3.5 w-3.5" /></Link>
            <div className="invisible absolute left-0 top-full z-50 w-[44rem] max-w-[90vw] rounded-b-xl bg-primary p-6 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
              <ul className="grid grid-cols-3 gap-x-8 gap-y-5">
                {tops.map((c) => (
                  <li key={c.id}>
                    <Link to="/shop" search={{ category: c.slug }} className="font-semibold text-gold">{c.name}</Link>
                    <ul className="mt-1.5 space-y-1 text-xs text-primary-foreground/80">
                      {childrenOf(categories, c.id).slice(0, 4).map((s) => <li key={s.id}><Link to="/shop" search={{ category: s.slug }} className="hover:text-gold">{s.name}</Link></li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {nav.map((n) => <Link key={n.to} to={n.to} className="hover:text-gold transition-colors" activeProps={{ className: "text-gold" }}>{n.label}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="display-currency">Display currency</label>
          <select id="display-currency" value={mode} onChange={(e) => setMode(e.target.value as DisplayMode)} className="rounded-md border border-primary-foreground/30 bg-primary px-2 py-1 text-xs">
            <option value="GHS">GH₵</option><option value="USD">US$</option><option value="DUAL">Both</option>
          </select>
          <Link to="/cart" className="relative p-2 hover:text-gold transition-colors" aria-label={`Cart, ${count} items`}>
            <ShoppingBag className="h-5 w-5" />
            {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-gold-foreground">{count}</span>}
          </Link>
          <button className="lg:hidden p-2" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
        </div>
      </div>
      {open && (
        <nav className="lg:hidden max-h-[70vh] overflow-y-auto border-t border-primary-foreground/10 container-x py-4 flex flex-col gap-3" aria-label="Mobile">
          <Link to="/shop" search={{}} onClick={() => setOpen(false)} className="font-semibold text-gold">All products</Link>
          {tops.map((c) => <Link key={c.id} to="/shop" search={{ category: c.slug }} onClick={() => setOpen(false)}>{c.name}</Link>)}
          <hr className="border-primary-foreground/10" />
          {nav.map((n) => <Link key={n.to} to={n.to} onClick={() => setOpen(false)}>{n.label}</Link>)}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  const site = useSite();
  const { categories } = useCatalog();
  const info = [
    { to: "/about", label: "About" }, { to: "/faq", label: "FAQ" },
    { to: "/policies/$slug", params: { slug: "shipping" }, label: "Shipping & delivery" },
    { to: "/policies/$slug", params: { slug: "returns" }, label: "Returns & refunds" },
    { to: "/policies/$slug", params: { slug: "preorder" }, label: "Pre-order terms" },
    { to: "/policies/$slug", params: { slug: "privacy" }, label: "Privacy" },
    { to: "/policies/$slug", params: { slug: "terms" }, label: "Terms" },
  ] as const;
  return (
    <footer className="bg-primary text-primary-foreground mt-20">
      <div className="container-x grid gap-10 py-14 md:grid-cols-4">
        <div>
          <p className="font-display text-xl font-bold">DERA <span className="text-gold">DARKO</span> TRADE</p>
          <p className="mt-3 text-sm text-primary-foreground/70 max-w-xs">Quality imported products for shoppers, resellers and businesses in Ghana.</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-gold">Shop</p>
          <ul className="mt-3 space-y-2 text-sm text-primary-foreground/80">
            {topLevel(categories).slice(0, 7).map((c) => <li key={c.id}><Link to="/shop" search={{ category: c.slug }}>{c.name}</Link></li>)}
            <li><Link to="/shop" search={{}} className="text-gold">All categories</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-gold">Information</p>
          <ul className="mt-3 space-y-2 text-sm text-primary-foreground/80">
            {info.map((i) => <li key={i.label}>{"params" in i ? <Link to={i.to} params={i.params}>{i.label}</Link> : <Link to={i.to}>{i.label}</Link>}</li>)}
            <li><ConsentLink className="underline-offset-2 hover:underline" /></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-gold">Contact</p>
          <ul className="mt-3 space-y-2 text-sm text-primary-foreground/80">
            {site.address && <li className="whitespace-pre-line">{site.address}{site.city ? `\n${site.city}` : ""}</li>}
            {!site.address && site.city && <li>{site.city}</li>}
            {site.email && <li><a href={`mailto:${site.email}`} className="underline-offset-2 hover:underline">{site.email}</a></li>}
            {site.phone && <li><a href={`tel:${site.phone.replace(/[^+\d]/g, "")}`} className="underline-offset-2 hover:underline">{site.phone}</a></li>}
            {site.whatsapp && <li><a href={waLink(site.whatsapp)} rel="noopener noreferrer" target="_blank" className="underline-offset-2 hover:underline">WhatsApp</a></li>}
            {site.hours && <li className="whitespace-pre-line text-primary-foreground/70">{site.hours}</li>}
            <li><Link to="/contact" className="underline-offset-2 hover:underline">Send us a message</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-primary-foreground/10 py-5 text-center text-xs text-primary-foreground/60">
        © {new Date().getFullYear()} Dera Darko Trade.{site.registrationNumber ? ` Registration no. ${site.registrationNumber}.` : ""}
      </div>
    </footer>
  );
}
