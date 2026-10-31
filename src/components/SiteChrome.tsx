import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Heart, Menu, Search, ShoppingCart, User } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useCart } from "@/lib/cart";
import { useCurrency } from "@/lib/currency";
import { useSite } from "@/lib/site";
import { waLink } from "@/lib/business";
import { api } from "@/lib/api";
import { resetWishlist, useWishlist } from "@/lib/wishlist";
import { useCatalog } from "@/lib/catalog-store";
import { ConsentLink } from "@/components/ConsentBanner";
import logo from "@/assets/logo.png";
import { childrenOf, topLevel } from "@/lib/domain/categories";
import type { DisplayMode } from "@/lib/domain/money";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Primary links shown in the desktop bar (Shop and Categories carry menus). */
const PRIMARY = [
  { to: "/new-arrivals", label: "New Arrivals", wideOnly: false },
  { to: "/deals", label: "Deals", wideOnly: false },
  { to: "/about", label: "About", wideOnly: true },
  { to: "/contact", label: "Contact", wideOnly: true },
] as const;
/** Extra links kept out of the bar so it never crowds; they live under "More" and in the mobile drawer. */
const MORE = [
  { to: "/preorders", label: "Pre-orders" },
  { to: "/wholesale", label: "Wholesale" },
  { to: "/faq", label: "FAQ" },
] as const;
/** Shown at the top of "More" only while the bar is too narrow to hold them (below 1700px). */
const MORE_NARROW = PRIMARY.filter((n) => n.wideOnly);
/** The full bar (Home, About, Contact inline) needs ~1700px because the logo and wordmark take room; below that those links live in menus.
 *  Class names are written out in full on purpose: Tailwind only generates CSS for names it can find literally in the source. */
const hideBelowWide = "max-[1699px]:hidden";

const navLink =
  "relative flex h-full items-center text-[15px] font-medium text-foreground/80 transition-colors hover:text-primary focus-visible:text-primary after:absolute after:inset-x-0 after:bottom-4 after:h-0.5 after:origin-left after:scale-x-0 after:bg-gold after:transition-transform motion-reduce:after:transition-none hover:after:scale-x-100 focus-visible:after:scale-x-100";
const navActive = "text-primary after:scale-x-100";
const iconBtn =
  "relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-primary transition-colors hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const menuPanel =
  "invisible absolute left-0 top-full z-50 rounded-b-xl border border-t-0 border-border bg-background p-5 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 motion-reduce:transition-none";

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-gold-foreground">{n > 99 ? "99+" : n}</span>;
}

function CurrencySelect({ id, className = "" }: { id: string; className?: string }) {
  const { mode, setMode } = useCurrency();
  return (
    <>
      <label className="sr-only" htmlFor={id}>Display currency</label>
      <select id={id} value={mode} onChange={(e) => setMode(e.target.value as DisplayMode)} className={`rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground ${className}`}>
        <option value="GHS">GH₵</option><option value="USD">US$</option><option value="DUAL">Both</option>
      </select>
    </>
  );
}

/** Product search. Sends the words to the shop page (`/shop?q=`), which already filters the live catalogue. */
function SearchForm({ id, autoFocus = false, onDone }: { id: string; autoFocus?: boolean; onDone?: () => void }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    void navigate({ to: "/shop", search: q ? { q } : {} });
    onDone?.();
  };
  return (
    <form role="search" onSubmit={submit} className="relative w-full">
      <label htmlFor={id} className="sr-only">Search products</label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
      <input
        id={id} type="search" name="q" value={value} onChange={(e) => setValue(e.target.value)} autoFocus={autoFocus}
        placeholder="Search products…" autoComplete="off" enterKeyHint="search"
        className="h-11 w-full rounded-lg border-2 border-input bg-background pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </form>
  );
}

function AccountMenu({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  const { afterLogout } = useCart();
  const signOut = () => void api.logout().then(() => { resetWishlist(); afterLogout(); void navigate({ to: "/" }); });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={signedIn ? "Account menu" : "Sign in or create an account"} className={`${iconBtn} bg-gold/15`}>
          <User className="h-5 w-5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {signedIn ? (
          <>
            <DropdownMenuItem asChild><Link to="/account">My account</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/track" search={{ ref: "" }}>Track an order</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem asChild><Link to="/login">Sign in</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/register">Create an account</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link to="/track" search={{ ref: "" }}>Track an order</Link></DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SiteHeader() {
  const { count } = useCart();
  const { categories } = useCatalog();
  const wish = useWishlist();
  const signedIn = wish.status === "ready";
  const savedCount = signedIn ? wish.slugs.size : 0;
  const [drawer, setDrawer] = useState(false);
  const [searchRow, setSearchRow] = useState(false);
  const tops = topLevel(categories);
  const close = () => setDrawer(false);
  return (
    <>
      <div className="bg-primary text-primary-foreground text-center text-xs font-medium py-1.5 px-4">
        Pre-orders open on selected imported items — expected arrival windows shown on each product
      </div>
      <header className="sticky top-0 z-40 border-t-[3px] border-gold border-b border-b-border bg-background text-foreground shadow-sm">
        <div className="mx-auto flex h-[72px] w-full max-w-[110rem] items-center gap-3 px-4 md:px-8 xl:gap-6">
          <Link to="/" className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Dera Darko Trade — home">
            <img src={logo} alt="" width={360} height={219} decoding="async" className="h-11 w-auto sm:h-12" />
            <span className="hidden font-display text-lg font-bold tracking-wide text-primary sm:inline">
              DERA <span className="text-gold-dark">DARKO</span> TRADE
            </span>
          </Link>

          <nav className={`hidden h-full items-stretch gap-5 min-[1700px]:gap-7 xl:flex`} aria-label="Main">
            <Link to="/" activeOptions={{ exact: true }} className={`${navLink} ${hideBelowWide}`} activeProps={{ className: navActive }}>Home</Link>
            <div className="group relative flex h-full items-center">
              <Link to="/shop" search={{}} className={`${navLink} gap-1`} activeProps={{ className: navActive }}>Shop <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></Link>
              <div className={`${menuPanel} w-[44rem] max-w-[90vw]`}>
                <ul className="grid grid-cols-3 gap-x-8 gap-y-5">
                  {tops.map((c) => (
                    <li key={c.id}>
                      <Link to="/shop" search={{ category: c.slug }} className="font-semibold text-primary hover:underline">{c.name}</Link>
                      <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                        {childrenOf(categories, c.id).slice(0, 4).map((s) => <li key={s.id}><Link to="/shop" search={{ category: s.slug }} className="hover:text-primary hover:underline">{s.name}</Link></li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="group relative flex h-full items-center">
              <button type="button" className={`${navLink} gap-1`} aria-haspopup="true">Categories <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
              <ul className={`${menuPanel} w-64 space-y-1 text-sm`}>
                {tops.map((c) => <li key={c.id}><Link to="/shop" search={{ category: c.slug }} className="block rounded-md px-2 py-1.5 text-foreground/80 hover:bg-gold/15 hover:text-primary">{c.name}</Link></li>)}
                <li className="border-t border-border pt-1"><Link to="/shop" search={{}} className="block rounded-md px-2 py-1.5 font-medium text-primary hover:bg-gold/15">All products</Link></li>
              </ul>
            </div>
            {PRIMARY.map((n) => <Link key={n.to} to={n.to} className={n.wideOnly ? `${navLink} ${hideBelowWide}` : navLink} activeProps={{ className: navActive }}>{n.label}</Link>)}
            <div className="group relative flex h-full items-center">
              <button type="button" className={`${navLink} gap-1`} aria-haspopup="true">More <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
              <ul className={`${menuPanel} w-48 space-y-1 text-sm`}>
                {MORE_NARROW.map((n) => <li key={n.to} className="min-[1700px]:hidden"><Link to={n.to} className="block rounded-md px-2 py-1.5 text-foreground/80 hover:bg-gold/15 hover:text-primary">{n.label}</Link></li>)}
                {MORE.map((n) => <li key={n.to}><Link to={n.to} className="block rounded-md px-2 py-1.5 text-foreground/80 hover:bg-gold/15 hover:text-primary">{n.label}</Link></li>)}
              </ul>
            </div>
          </nav>

          <div className="ml-auto hidden min-w-0 max-w-md flex-1 sm:block"><SearchForm id="header-search" /></div>

          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            <button type="button" className={`${iconBtn} sm:hidden`} aria-label="Search products" aria-expanded={searchRow} onClick={() => setSearchRow((v) => !v)}>
              <Search className="h-5 w-5" aria-hidden="true" />
            </button>
            <CurrencySelect id="display-currency" className="mr-1 hidden xl:block" />
            <Link to={signedIn ? "/account" : "/login"} hash={signedIn ? "saved" : undefined} className={iconBtn} aria-label={signedIn ? `Saved items, ${savedCount}` : "Sign in to see your saved items"}>
              <Heart className="h-5 w-5" aria-hidden="true" /><Badge n={savedCount} />
            </Link>
            <Link to="/cart" className={iconBtn} aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}>
              <ShoppingCart className="h-5 w-5" aria-hidden="true" /><Badge n={count} />
            </Link>
            <AccountMenu signedIn={signedIn} />
            <button type="button" className={`${iconBtn} xl:hidden`} aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        {searchRow && <div className="border-t border-border px-4 py-3 sm:hidden"><SearchForm id="header-search-mobile" autoFocus onDone={() => setSearchRow(false)} /></div>}
      </header>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="right" className="w-[85vw] max-w-sm overflow-y-auto bg-background p-0">
          <SheetHeader className="border-b border-border p-5 text-left">
            <SheetTitle className="font-display text-primary">Menu</SheetTitle>
            <SheetDescription className="sr-only">Site navigation</SheetDescription>
          </SheetHeader>
          <nav className="flex flex-col p-3 text-base" aria-label="Mobile">
            <Link to="/" onClick={close} className="rounded-md px-3 py-3 font-medium hover:bg-gold/15">Home</Link>
            <Link to="/shop" search={{}} onClick={close} className="rounded-md px-3 py-3 font-medium hover:bg-gold/15">Shop all products</Link>
            <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Categories</div>
            {tops.map((c) => {
              const subs = childrenOf(categories, c.id);
              return subs.length === 0 ? (
                <Link key={c.id} to="/shop" search={{ category: c.slug }} onClick={close} className="rounded-md px-3 py-2.5 hover:bg-gold/15">{c.name}</Link>
              ) : (
                <details key={c.id} className="group rounded-md">
                  <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-3 py-2.5 hover:bg-gold/15">
                    {c.name}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <ul className="mb-1 ml-3 border-l border-border pl-3 text-sm">
                    <li><Link to="/shop" search={{ category: c.slug }} onClick={close} className="block rounded-md px-3 py-2 font-medium text-primary">All {c.name}</Link></li>
                    {subs.map((s) => <li key={s.id}><Link to="/shop" search={{ category: s.slug }} onClick={close} className="block rounded-md px-3 py-2 text-foreground/80 hover:bg-gold/15">{s.name}</Link></li>)}
                  </ul>
                </details>
              );
            })}
            <div className="mt-2 border-t border-border pt-2" />
            {[...PRIMARY, ...MORE].map((n) => <Link key={n.to} to={n.to} onClick={close} className="rounded-md px-3 py-3 font-medium hover:bg-gold/15">{n.label}</Link>)}
            <div className="mt-2 border-t border-border pt-2" />
            {signedIn ? (
              <>
                <Link to="/account" onClick={close} className="rounded-md px-3 py-3 font-medium hover:bg-gold/15">My account</Link>
                <Link to="/account" hash="saved" onClick={close} className="rounded-md px-3 py-3 font-medium hover:bg-gold/15">Saved items{savedCount > 0 ? ` (${savedCount})` : ""}</Link>
              </>
            ) : (
              <>
                <Link to="/login" onClick={close} className="rounded-md px-3 py-3 font-medium hover:bg-gold/15">Sign in</Link>
                <Link to="/register" onClick={close} className="rounded-md px-3 py-3 font-medium hover:bg-gold/15">Create an account</Link>
              </>
            )}
            <Link to="/track" search={{ ref: "" }} onClick={close} className="rounded-md px-3 py-3 font-medium hover:bg-gold/15">Track an order</Link>
            <div className="mt-3 flex items-center gap-2 px-3 text-sm">
              <span>Currency</span><CurrencySelect id="display-currency-mobile" />
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </>
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
