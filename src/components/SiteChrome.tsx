import { Link } from "@tanstack/react-router";
import { ShoppingBag, Menu, X } from "lucide-react";
import { useState } from "react";
import { useCart } from "@/lib/cart";
import { business, categories } from "@/lib/catalog";

export function SiteHeader() {
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const nav = [
    { to: "/shop", label: "Shop" },
    { to: "/wholesale", label: "Wholesale" },
    { to: "/contact", label: "Contact" },
  ] as const;
  return (
    <header className="sticky top-0 z-40 bg-primary text-primary-foreground">
      <div className="bg-gold text-gold-foreground text-center text-xs font-medium py-1.5 px-4">
        Preorders open on selected imported items — prices shown in GH₵
      </div>
      <div className="container-x flex h-16 items-center justify-between gap-4">
        <Link to="/" className="font-display text-xl font-bold tracking-wide">
          DERA <span className="text-gold">DARKO</span> TRADE
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium" aria-label="Main">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} className="hover:text-gold transition-colors" activeProps={{ className: "text-gold" }}>{n.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/cart" className="relative p-2 hover:text-gold transition-colors" aria-label={`Cart, ${count} items`}>
            <ShoppingBag className="h-5 w-5" />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-gold-foreground">{count}</span>
            )}
          </Link>
          <button className="md:hidden p-2" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="md:hidden border-t border-primary-foreground/10 container-x py-4 flex flex-col gap-3" aria-label="Mobile">
          {nav.map((n) => <Link key={n.to} to={n.to} onClick={() => setOpen(false)}>{n.label}</Link>)}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-primary text-primary-foreground mt-20">
      <div className="container-x grid gap-10 py-14 md:grid-cols-3">
        <div>
          <p className="font-display text-xl font-bold">DERA <span className="text-gold">DARKO</span> TRADE</p>
          <p className="mt-3 text-sm text-primary-foreground/70 max-w-xs">Quality imported products for shoppers, resellers and businesses in Ghana.</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-gold">Shop</p>
          <ul className="mt-3 space-y-2 text-sm text-primary-foreground/80">
            {categories.map((c) => <li key={c.slug}><Link to="/shop" search={{ category: c.slug }}>{c.name}</Link></li>)}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-gold">Contact</p>
          <ul className="mt-3 space-y-2 text-sm text-primary-foreground/80">
            <li>{business.location}</li><li>{business.email}</li><li>{business.phone}</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-primary-foreground/10 py-5 text-center text-xs text-primary-foreground/60">
        © {new Date().getFullYear()} Dera Darko Trade. All prices in GHS.
      </div>
    </footer>
  );
}
