import { Link } from "@tanstack/react-router";
import { Check, Copy, Minus, Plus, Printer, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Errors, Field, inputCls, Notice } from "@/components/Form";
import { PayPanel } from "@/components/PayPanel";
import { ProductImage } from "@/components/ProductImage";
import { DashProductCard, Empty, Grid, Heading, Price, Skeletons, StatusPill, useDash, useProducts, pick } from "@/components/dashboard/shared";
import { api, newIdempotencyKey } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { comparisonRows, newArrivals, orderBucket, sku, topCategories, withLabel } from "@/lib/dashboard-lib";
import { GHANA_REGIONS } from "@/lib/domain/regions";
import { formatMoney, type Currency } from "@/lib/domain/money";
import { useGuest } from "@/lib/guest";
import type { CartQuote, OrderDetail } from "@/lib/guest-types";
import { findByVariant, isPurchasable, type StoreProduct } from "@/lib/storefront";

const money = (amount: number, currency: Currency) => formatMoney({ amount, currency });

/* ============================== HOME ============================== */
function Tile({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="dash-fade rounded-2xl border border-border bg-card p-3 text-left shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5 hover:border-gold motion-reduce:transition-none sm:p-4">
      <span className="block font-display text-2xl font-bold text-primary">{value}</span><span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
    </button>
  );
}
function Strip({ title, note, items, more, onMore }: { title: string; note?: string | undefined; items: StoreProduct[]; more?: string; onMore?: () => void }) {
  if (!items.length) return null;
  return (
    <section className="mt-8" aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-2"><h3 className="font-display text-xl font-bold text-primary">{title}</h3>{onMore && <button className="text-sm text-primary underline" onClick={onMore}>{more ?? "See all"}</button>}</div>
      {note && <p className="mb-3 text-xs text-muted-foreground">{note}</p>}
      <Grid>{items.slice(0, 4).map((p) => <DashProductCard key={p.slug} p={p} />)}</Grid>
    </section>
  );
}
export function Home() {
  const g = useGuest(); const cart = useCart(); const { go } = useDash(); const { products, categories, status, bySlug } = useProducts();
  useEffect(() => { void g.refreshRecs(); void g.refreshPromos(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [g.state.viewed.join("|"), g.state.wishlist.join("|")]);
  const orders = g.state.orders;
  const n = (b: string) => orders.filter((o) => orderBucket(o.status) === b).length;
  const rec = (id: string) => pick(g.recs.find((r) => r.id === id)?.slugs ?? [], bySlug);
  const arrivals = useMemo(() => newArrivals(products, 4), [products]);
  const recent = useMemo(() => [...products].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4), [products]);
  const best = useMemo(() => { const l = withLabel(products, "best_seller"); return l.length ? l : rec("popular"); }, [products, g.recs]); // eslint-disable-line react-hooks/exhaustive-deps
  const offerItems = pick([...new Set(g.promos.map((p) => p.slug))], bySlug);
  const tops = useMemo(() => topCategories(products, categories).filter((c) => c.count > 0).sort((a, b) => b.count - a.count).slice(0, 6), [products, categories]);
  const name = g.state.prefs.preferredName;
  return (
    <div>
      <section className="dash-fade overflow-hidden rounded-3xl p-6 text-primary-foreground sm:p-8" style={{ background: "var(--gradient-navy)" }}>
        <h2 className="font-display text-2xl font-bold !text-white sm:text-3xl">{name ? `Welcome back, ${name}.` : "Welcome to Dera Darko Trade."}</h2>
        <p className="mt-2 max-w-xl text-sm text-white/80">Browse, save, compare and order — no account needed. Your cart, saved items and orders stay with this browser session{g.state.expiresAt ? ` until ${new Date(g.state.expiresAt).toLocaleDateString()} unless you keep using it` : ""}.</p>
        <div className="mt-4 flex flex-wrap gap-2"><button className="btn-primary" onClick={() => go("shop")}>Shop all products</button><button className="rounded-full border border-white/40 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/10" onClick={() => go("track")}>Track an order</button></div>
      </section>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Shopping overview">
        <Tile label="Cart items" value={cart.count} onClick={() => go("cart")} /><Tile label="Wishlist items" value={g.state.wishlist.length} onClick={() => go("wishlist")} />
        <Tile label="Recently viewed" value={g.state.viewed.length} onClick={() => go("viewed")} /><Tile label="Available promotions" value={offerItems.length} onClick={() => go("offers")} />
        <Tile label="Pending orders" value={n("pending")} onClick={() => go("orders")} /><Tile label="Active orders" value={n("active")} onClick={() => go("orders")} />
        <Tile label="Completed orders" value={n("completed")} onClick={() => go("orders")} /><Tile label="Recommended for you" value={rec("for_you").length} />
      </div>
      {status === "loading" && <div className="mt-8"><Skeletons n={4} /></div>}
      {status === "ready" && products.length === 0 && <div className="mt-8"><Empty title="Our catalogue is being prepared" action={<button className="btn-secondary" onClick={() => go("contact")}>Contact us</button>}>No products are published yet. We never show sample products — check back soon, or get in touch.</Empty></div>}
      <Strip title="Recommended for you" items={rec("for_you")} note="Based on what you've viewed, saved and searched in this session." />
      {rec("for_you").length === 0 && products.length > 0 && <p className="mt-6 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">Recommendations appear once you've looked at a few products — they're built only from your own activity in this session.</p>}
      <Strip title={arrivals.labelled ? "New arrivals" : "Latest additions"} items={arrivals.items} more="See all new arrivals" onMore={() => go("new")} />
      <Strip title="Best sellers" items={best} more="See best sellers" onMore={() => go("best")} />
      <Strip title="Trending products" items={rec("trending")} note="Most ordered in the last 30 days (from real paid orders)." />
      <Strip title="Featured collections" items={withLabel(products, "featured")} more="See featured" onMore={() => go("featured")} />
      <Strip title="Recently added" items={recent} />
      <Strip title="Special offers" items={offerItems} more="All offers" onMore={() => go("offers")} />
      {tops.length > 0 && <section className="mt-8" aria-label="Popular categories"><h3 className="mb-3 font-display text-xl font-bold text-primary">Popular categories</h3><div className="flex flex-wrap gap-2">{tops.map(({ node, count }) => <button key={node.id} className="rounded-full border border-border bg-card px-4 py-2 text-sm hover:border-gold hover:bg-gold/10" onClick={() => go("categories", { cat: node.id })}>{node.name} <span className="text-xs text-muted-foreground">({count})</span></button>)}</div></section>}
    </div>
  );
}

/* ============================== WISHLIST / VIEWED / COMPARE ============================== */
export function Wishlist() {
  const g = useGuest(); const { bySlug, status } = useProducts(); const { go } = useDash();
  const items = pick(g.state.wishlist, bySlug);
  const share = async () => {
    const text = items.map((p) => `${p.name} — ${window.location.origin}/product/${p.slug}`).join("\n");
    try { if (navigator.share) await navigator.share({ title: "My Dera Darko Trade wishlist", text }); else { await navigator.clipboard.writeText(text); toast("Wishlist copied"); } } catch { /* cancelled */ }
  };
  const moveAll = () => { let n = 0; for (const p of items) if (isPurchasable(p) && g.addToCart(p.variantId, p.name)) { n++; void g.toggleWishlist(p.slug, p.name); } if (!n) toast.error("None of your saved items can be ordered right now."); };
  if (status === "loading") return <Skeletons n={4} />;
  return (
    <section aria-label="My wishlist"><Heading title="My Wishlist" sub="Saved to this browser session — no account needed." right={items.length > 0 ? <div className="flex gap-2"><button className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary" onClick={() => void share()}>Share list</button><button className="btn-secondary" onClick={moveAll}>Move all to cart</button></div> : undefined} />
      {items.length === 0 ? <Empty title="Your wishlist is empty" action={<button className="btn-primary" onClick={() => go("shop")}>Find something you love</button>}>Tap the heart on any product to save it here.</Empty> : (
        <><Grid>{items.map((p) => (
          <div key={p.slug} className="flex flex-col gap-2"><DashProductCard p={p} /><div className="flex items-center justify-between px-1 text-xs"><StatusPill p={p} /><button className="text-primary underline disabled:opacity-40" disabled={!isPurchasable(p)} onClick={() => { if (g.addToCart(p.variantId, p.name)) void g.toggleWishlist(p.slug, p.name); }}>Move to cart</button></div></div>))}</Grid>
          <p className="mt-4 text-xs text-muted-foreground">Want to hear when a saved item is back in stock or its price changes? Turn on alerts in <button className="underline" onClick={() => go("preferences")}>Shopping Preferences</button> (you'll need to add an email address).</p></>)}
    </section>
  );
}
export function Viewed() {
  const g = useGuest(); const { bySlug } = useProducts(); const { go } = useDash();
  const items = pick(g.state.viewed, bySlug);
  const clear = async () => { const r = await g.call("POST", "/activity/clear", {}); toast(r.ok ? "Browsing activity cleared" : r.errors[0] ?? "Couldn't clear"); };
  return (
    <section aria-label="Recently viewed"><Heading title="Recently Viewed" sub="Your recent activity in this session. Only you can see it, and you can erase it at any time." right={(items.length > 0 || g.state.searches.length > 0) ? <button className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary" onClick={() => void clear()}>Clear browsing activity</button> : undefined} />
      {g.state.searches.length > 0 && <div className="mb-5"><h3 className="mb-2 text-sm font-semibold text-primary">Recent searches</h3><div className="flex flex-wrap gap-2">{g.state.searches.map((s) => <span key={s} className="rounded-full border border-border bg-card px-3 py-1 text-xs">{s}</span>)}</div></div>}
      {items.length === 0 ? <Empty title="Nothing viewed yet" action={<button className="btn-primary" onClick={() => go("shop")}>Start browsing</button>}>Products you open with Quick View appear here.</Empty> : <Grid>{items.map((p) => <DashProductCard key={p.slug} p={p} />)}</Grid>}
    </section>
  );
}
export function Compare() {
  const g = useGuest(); const { bySlug } = useProducts(); const { go } = useDash();
  const items = pick(g.state.compare, bySlug); const rows = useMemo(() => comparisonRows(items), [items]);
  return (
    <section aria-label="Product comparison"><Heading title="Product Comparison" sub="Compare up to four products side by side. Only specifications the business has provided are shown." right={items.length > 0 ? <button className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary" onClick={() => void g.call("DELETE", "/compare", {})}>Clear comparison</button> : undefined} />
      {items.length < 2 ? <Empty title={items.length ? "Add one more product to compare" : "Nothing to compare yet"} action={<button className="btn-primary" onClick={() => go("shop")}>Browse products</button>}>Use the compare button on any product card. You can compare up to four.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card"><table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Comparison of {items.map((p) => p.name).join(", ")}</caption>
          <thead><tr><th scope="col" className="w-32 p-3 text-left text-xs text-muted-foreground">Product</th>{items.map((p) => <th key={p.slug} scope="col" className="min-w-40 p-3 text-left align-top"><ProductImage src={p.image} alt={p.imageAlt || p.name} className="mb-2 h-28 w-full object-contain" /><span className="block font-medium">{p.name}</span><button className="mt-1 text-xs text-primary underline" onClick={() => void g.toggleCompare(p.slug, p.name)}>Remove</button></th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            <tr><th scope="row" className="p-3 text-left font-medium">Price</th>{items.map((p) => <td key={p.slug} className="p-3"><Price p={p} /></td>)}</tr>
            <tr><th scope="row" className="p-3 text-left font-medium">SKU</th>{items.map((p) => <td key={p.slug} className="p-3">{sku(p)}</td>)}</tr>
            <tr><th scope="row" className="p-3 text-left font-medium">Availability</th>{items.map((p) => <td key={p.slug} className="p-3"><StatusPill p={p} /></td>)}</tr>
            {rows.map((r) => <tr key={r.key}><th scope="row" className="p-3 text-left font-medium">{r.label}</th>{r.values.map((v, i) => <td key={i} className={`p-3 ${v ? "" : "text-muted-foreground"}`}>{v ?? "Not provided"}</td>)}</tr>)}
            <tr><th scope="row" className="p-3" /> {items.map((p) => <td key={p.slug} className="p-3"><button className="btn-secondary px-4 py-1.5 text-xs" disabled={!isPurchasable(p)} onClick={() => g.addToCart(p.variantId, p.name)}>Add to cart</button></td>)}</tr>
          </tbody></table></div>)}
    </section>
  );
}

/* ============================== CART + CHECKOUT ============================== */
interface Zone { id: string; name: string; regions: string[]; currency: Currency; baseFee: number; estimate: string }
function Receipt({ o, code, email }: { o: OrderDetail; code: string | undefined; email: string }) {
  return (
    <div className="dash-receipt rounded-2xl border border-border bg-card p-5">
      <h3 className="font-display text-lg font-bold text-primary">Receipt — {o.ref}</h3>
      <p className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString()} · Paid in {o.currency} · Status: awaiting payment · Confirmation to {email}</p>
      <ul className="mt-3 divide-y divide-border text-sm">{o.items.map((i) => <li key={i.variantId} className="flex justify-between gap-3 py-2"><span>{i.qty} × {i.name}{i.mode === "preorder" ? " (pre-order)" : ""}</span><span>{money(i.line, o.currency)}</span></li>)}</ul>
      <dl className="mt-3 space-y-1 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotal, o.currency)}</dd></div>{o.discount > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−{money(o.discount, o.currency)}</dd></div>}<div className="flex justify-between"><dt>Delivery</dt><dd>{money(o.shipping, o.currency)}</dd></div><div className="flex justify-between border-t border-border pt-1 font-semibold"><dt>Total ({o.currency})</dt><dd>{money(o.total, o.currency)}</dd></div></dl>
      {code && <p className="mt-3 text-xs">Tracking code: <strong>{code}</strong></p>}
    </div>
  );
}

function Checkout({ quoteCur, setQuoteCur, onBack }: { quoteCur: Currency; setQuoteCur: (c: Currency) => void; onBack: () => void }) {
  const g = useGuest(); const cart = useCart(); const { go } = useDash();
  const p = g.state.prefs;
  const [zones, setZones] = useState<Zone[]>([]); const [usdPay, setUsdPay] = useState(false);
  const [f, setF] = useState({ name: p.preferredName, email: p.email, phone: p.phone, region: p.region, city: "", street: "", note: "", zoneId: "", code: "", terms: false, pre: false });
  const [quote, setQuote] = useState<CartQuote | null>(null); const [qErr, setQErr] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ order: OrderDetail; secret: string | undefined } | null>(null); const key = useRef(newIdempotencyKey());
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { void api.zones().then((r) => { if (r.ok && r.data) setZones(r.data); }); void api.paymentConfig().then((r) => setUsdPay(!!r.ok && !!r.data && r.data.methods.USD.length > 0)); }, []);
  const options = zones.filter((z) => z.currency === quoteCur && (!f.region || z.regions.includes(f.region)));
  useEffect(() => { if (f.zoneId && !options.some((z) => z.id === f.zoneId)) set("zoneId", options.length === 1 ? options[0]!.id : ""); else if (!f.zoneId && options.length === 1 && f.region) set("zoneId", options[0]!.id); }, [quoteCur, f.region, zones.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true; const t = setTimeout(async () => {
      const r = await g.quote({ currency: quoteCur, ...(f.region && f.zoneId ? { region: f.region, zoneId: f.zoneId } : {}), ...(f.code.trim() ? { discountCode: f.code.trim() } : {}) });
      if (!live) return; if (r.ok) { setQuote(r.quote); setQErr([]); } else { setQuote(null); setQErr(r.errors); }
    }, 300); return () => { live = false; clearTimeout(t); };
  }, [quoteCur, f.region, f.zoneId, f.code, cart.count]); // eslint-disable-line react-hooks/exhaustive-deps
  const zone = zones.find((z) => z.id === f.zoneId);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErrors([]);
    const errs: string[] = [];
    if (!f.name.trim()) errs.push("Enter the recipient's full name."); if (!f.email.trim()) errs.push("Enter your email address."); if (!f.phone.trim()) errs.push("Enter a phone number for the delivery.");
    if (!f.region) errs.push("Choose your region."); if (!f.city.trim()) errs.push("Enter your city or town."); if (!f.street.trim()) errs.push("Enter your delivery address."); if (!f.zoneId) errs.push("Choose a delivery method.");
    if (!f.terms) errs.push("Please accept the terms to place your order."); if (quote?.hasPreorder && !f.pre) errs.push("Please acknowledge the pre-order terms.");
    if (errs.length) return setErrors(errs);
    setBusy(true);
    const street = f.note.trim() ? `${f.street.trim()} — Note: ${f.note.trim()}`.slice(0, 160) : f.street.trim();
    const r = await g.call<{ order: OrderDetail; trackingSecret?: string }>("POST", "/checkout", { currency: quoteCur, region: f.region, zoneId: f.zoneId, email: f.email, address: { recipient: f.name, region: f.region, city: f.city, street, phone: f.phone }, ...(f.code.trim() ? { discountCode: f.code.trim() } : {}), idempotencyKey: key.current, acceptedTerms: f.terms, preorderAcknowledged: f.pre });
    setBusy(false);
    if (!r.ok || !r.data) return setErrors(r.errors);
    cart.clear(); key.current = newIdempotencyKey();
    setDone({ order: r.data.order, secret: r.data.trackingSecret });
  };
  if (done) {
    const o = done.order;
    return (
      <div className="dash-fade space-y-4">
        <div className="rounded-2xl border border-gold bg-gold/10 p-5"><h3 className="flex items-center gap-2 font-display text-xl font-bold text-primary"><Check className="h-5 w-5" aria-hidden="true" />Order {o.ref} received</h3>
          <p className="mt-1 text-sm">We're holding your items{o.payBy ? ` until ${new Date(o.payBy).toLocaleTimeString()}` : ""}. Your order is confirmed once payment is received — it is <strong>not paid yet</strong>.</p></div>
        {done.secret && <Notice><strong>Save your tracking code:</strong> <code className="rounded bg-secondary px-1.5 py-0.5">{done.secret}</code> <button className="ml-2 inline-flex items-center gap-1 text-xs underline" onClick={() => void navigator.clipboard?.writeText(done.secret!).then(() => toast("Copied"))}><Copy className="h-3 w-3" aria-hidden="true" />Copy</button><br /><span className="text-xs text-muted-foreground">Shown only once. With your order reference it lets you track this order from any device. This order is also saved under My Orders in this session.</span></Notice>}
        {o.payBy && <div className="rounded-2xl border border-border bg-card p-5"><h3 className="mb-3 font-display text-lg font-bold text-primary">Pay for your order</h3><PayPanel orderRef={o.ref} trackingSecret={done.secret} total={o.total} currency={o.currency} payBy={o.payBy} /></div>}
        <Receipt o={o} code={done.secret} email={f.email} />
        <div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />Print / save receipt</button><button className="rounded-full border border-border px-5 py-2.5 text-sm hover:bg-secondary" onClick={() => go("orders")}>View my orders</button><button className="rounded-full border border-border px-5 py-2.5 text-sm hover:bg-secondary" onClick={() => go("shop")}>Keep shopping</button></div>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate aria-label="Guest checkout">
      <button type="button" className="text-sm text-primary underline" onClick={onBack}>← Back to cart</button>
      <Errors errors={errors} />
      <fieldset className="rounded-2xl border border-border bg-card p-4"><legend className="px-1 text-sm font-semibold text-primary">Payment currency</legend>
        <div className="flex flex-wrap gap-4 text-sm"><label className="inline-flex items-center gap-2"><input type="radio" name="cur" checked={quoteCur === "GHS"} onChange={() => setQuoteCur("GHS")} />Ghanaian Cedi (GHS)</label>
          <label className="inline-flex items-center gap-2"><input type="radio" name="cur" disabled={!usdPay} checked={quoteCur === "USD"} onChange={() => setQuoteCur("USD")} />US Dollar (USD){!usdPay && <span className="text-xs text-muted-foreground">(not available for online payment yet)</span>}</label></div>
        <p className="mt-2 text-xs text-muted-foreground">You will be charged in <strong>{quoteCur}</strong>. Your display currency only changes how prices are shown; it never changes an order.</p></fieldset>
      <fieldset className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2"><legend className="px-1 text-sm font-semibold text-primary">Your details</legend>
        {g.state.addresses.length > 0 && <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium" htmlFor="co-saved">Use a saved address</label><select id="co-saved" className={inputCls} defaultValue="" onChange={(e) => { const a = g.state.addresses.find((x) => x.id === e.target.value); if (a) setF((x) => ({ ...x, name: a.recipient, region: a.region, city: a.city, street: a.street, phone: a.phone ?? x.phone })); }}><option value="">Choose…</option>{g.state.addresses.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.street}, {a.city}</option>)}</select></div>}
        <Field label="Full name" required autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} /><Field label="Email address" type="email" required autoComplete="email" hint="Your confirmation is sent here." value={f.email} onChange={(e) => set("email", e.target.value)} />
        <Field label="Phone number" type="tel" required autoComplete="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        <div><label className="mb-1 block text-sm font-medium" htmlFor="co-region">Region</label><select id="co-region" className={inputCls} value={f.region} onChange={(e) => set("region", e.target.value)}><option value="">Choose…</option>{GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
        <Field label="City / town" required autoComplete="address-level2" value={f.city} onChange={(e) => set("city", e.target.value)} /><Field label="Delivery address" required autoComplete="street-address" value={f.street} onChange={(e) => set("street", e.target.value)} />
        <div className="sm:col-span-2"><Field label="Delivery instructions (optional)" maxLength={80} value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
      </fieldset>
      <fieldset className="rounded-2xl border border-border bg-card p-4"><legend className="px-1 text-sm font-semibold text-primary">Delivery method</legend>
        {zones.length === 0 ? <p className="text-sm text-muted-foreground">Delivery options haven't been set up yet. Please <button type="button" className="underline" onClick={() => go("contact")}>contact us</button> to arrange your order.</p>
          : !f.region ? <p className="text-sm text-muted-foreground">Choose your region to see delivery options.</p>
          : options.length === 0 ? <p className="text-sm text-muted-foreground">We don't have a {quoteCur} delivery option for {f.region} yet. Try another payment currency or <button type="button" className="underline" onClick={() => go("contact")}>contact us</button>.</p>
          : <div className="space-y-2">{options.map((z) => <label key={z.id} className="flex items-start gap-2 text-sm"><input type="radio" name="zone" className="mt-1" checked={f.zoneId === z.id} onChange={() => set("zoneId", z.id)} /><span><strong>{z.name}</strong> — {money(z.baseFee, z.currency)} base fee <span className="text-xs text-muted-foreground">· {z.estimate}</span></span></label>)}</div>}
      </fieldset>
      <div className="rounded-2xl border border-border bg-card p-4"><label className="mb-1 block text-sm font-medium" htmlFor="co-code">Promo code (optional)</label><input id="co-code" className={inputCls} value={f.code} onChange={(e) => set("code", e.target.value)} autoComplete="off" />{qErr.length > 0 && f.code && <p role="alert" className="mt-1 text-xs text-destructive">{qErr[0]}</p>}</div>
      <Summary quote={quote} errors={f.code ? [] : qErr} zoneChosen={!!zone} />
      <div className="space-y-2 text-sm">{quote?.hasPreorder && <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={f.pre} onChange={(e) => set("pre", e.target.checked)} />I understand some items are pre-orders and dates are estimates.</label>}
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={f.terms} onChange={(e) => set("terms", e.target.checked)} /><span>I accept the <Link to="/policies/$slug" params={{ slug: "terms" }} className="underline" target="_blank">terms</Link> and <Link to="/policies/$slug" params={{ slug: "returns" }} className="underline" target="_blank">returns policy</Link>.</span></label></div>
      <button className="btn-primary w-full" disabled={busy || !quote}>{busy ? "Placing your order…" : `Place order${quote ? ` · ${money(quote.total, quote.currency)}` : ""}`}</button>
      <p className="text-center text-xs text-muted-foreground">No account is needed. You'll choose how to pay on the next screen; card details are handled by our payment provider and never touch our servers.</p>
    </form>
  );
}
function Summary({ quote, errors, zoneChosen }: { quote: CartQuote | null; errors: string[]; zoneChosen: boolean }) {
  if (!quote) return errors.length ? <Errors errors={errors} /> : <p className="text-sm text-muted-foreground" role="status">Calculating…</p>;
  const c = quote.currency;
  return (
    <div className="rounded-2xl border border-border bg-card p-4" aria-live="polite"><h3 className="mb-2 text-sm font-semibold text-primary">Order summary ({c})</h3>
      <ul className="divide-y divide-border text-sm">{quote.lines.map((l) => <li key={l.variantId} className="flex justify-between gap-3 py-1.5"><span>{l.qty} × {l.name}{l.mode === "preorder" ? " (pre-order)" : ""}</span><span>{money(l.line, c)}</span></li>)}</ul>
      <dl className="mt-2 space-y-1 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money(quote.subtotal, c)}</dd></div>
        {quote.discount > 0 && <div className="flex justify-between text-primary"><dt>Discount{quote.appliedCode ? ` (${quote.appliedCode})` : ""}</dt><dd>−{money(quote.discount, c)}</dd></div>}
        <div className="flex justify-between"><dt>Delivery</dt><dd>{zoneChosen ? money(quote.shipping, c) : "Choose delivery to see this"}</dd></div>
        <div className="flex justify-between border-t border-border pt-1 text-base font-semibold"><dt>{zoneChosen ? "Total" : "Subtotal so far"}</dt><dd>{money(zoneChosen ? quote.total : quote.subtotal - quote.discount, c)}</dd></div></dl>
      <p className="mt-2 text-[11px] text-muted-foreground">No taxes or handling fees are configured for this store, so none are added.{quote.shippingEstimate ? ` Delivery estimate: ${quote.shippingEstimate}.` : ""}</p>
    </div>
  );
}

export function CartModule() {
  const g = useGuest(); const cart = useCart(); const { go } = useDash(); const { products, status } = useProducts();
  const [step, setStep] = useState<"cart" | "checkout">("cart"); const [cur, setCur] = useState<Currency>("GHS");
  const [quote, setQuote] = useState<CartQuote | null>(null); const [errs, setErrs] = useState<string[]>([]); const [code, setCode] = useState("");
  const lineKey = cart.lines.map((l) => `${l.variantId}:${l.qty}`).join("|");
  useEffect(() => {
    if (step !== "cart") return; if (!cart.lines.length) { setQuote(null); setErrs([]); return; } let live = true;
    const t = setTimeout(async () => { const r = await g.quote({ currency: cur, ...(code.trim() ? { discountCode: code.trim() } : {}) }); if (!live) return; if (r.ok) { setQuote(r.quote); setErrs([]); } else { setQuote(null); setErrs(r.errors); } }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [lineKey, cur, code, step]); // eslint-disable-line react-hooks/exhaustive-deps
  if (status === "loading") return <Skeletons n={3} />;
  if (step === "checkout") return <section aria-label="Checkout"><Heading title="Checkout" sub="No account or password needed." /><Checkout quoteCur={cur} setQuoteCur={setCur} onBack={() => setStep("cart")} /></section>;
  if (!cart.lines.length) return <section aria-label="My shopping cart"><Heading title="My Shopping Cart" /><Empty title="Your cart is empty" action={<button className="btn-primary" onClick={() => go("shop")}>Start shopping</button>}>Items you add are kept for you, even if you close this page.</Empty></section>;
  return (
    <section aria-label="My shopping cart"><Heading title="My Shopping Cart" sub="Prices are checked by our server every time — they can't be changed from your browser." />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <ul className="space-y-3">{cart.lines.map((l) => { const p = findByVariant(products, l.variantId);
          return (
            <li key={l.variantId} className="dash-fade flex gap-3 rounded-2xl border border-border bg-card p-3">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-secondary">{p && <ProductImage src={p.image} alt={p.imageAlt || p.name} className="h-full w-full object-contain" />}</div>
              <div className="min-w-0 flex-1">{p ? <><p className="line-clamp-2 font-medium">{p.name}</p><p className="text-[11px] text-muted-foreground">SKU {sku(p)}</p><Price p={p} size="sm" /></> : <p className="text-sm text-muted-foreground">This item is no longer available.</p>}
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" aria-label={`Decrease quantity of ${p?.name ?? "item"}`} className="grid h-8 w-8 place-items-center rounded-full border border-border hover:bg-secondary" onClick={() => g.setQty(l.variantId, l.qty - 1)}><Minus className="h-3.5 w-3.5" aria-hidden="true" /></button>
                  <span className="dash-pop w-8 text-center text-sm font-medium" key={l.qty} aria-live="polite">{l.qty}</span>
                  <button type="button" aria-label={`Increase quantity of ${p?.name ?? "item"}`} className="grid h-8 w-8 place-items-center rounded-full border border-border hover:bg-secondary" onClick={() => g.setQty(l.variantId, l.qty + 1)}><Plus className="h-3.5 w-3.5" aria-hidden="true" /></button>
                  <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline" onClick={() => g.setQty(l.variantId, 0)}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Remove</button></div></div>
            </li>); })}</ul>
        <aside className="space-y-3">
          <div className="rounded-2xl border border-border bg-card p-4"><label className="mb-1 block text-xs font-medium" htmlFor="cart-cur">Show totals in</label>
            <select id="cart-cur" className={inputCls} value={cur} onChange={(e) => setCur(e.target.value as Currency)}><option value="GHS">Ghanaian Cedi (GHS)</option><option value="USD">US Dollar (USD)</option></select>
            <label className="mb-1 mt-3 block text-xs font-medium" htmlFor="cart-code">Promo code</label><input id="cart-code" className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" placeholder="Optional" /></div>
          <Summary quote={quote} errors={errs} zoneChosen={false} />
          <button className="btn-primary w-full" disabled={!quote} onClick={() => setStep("checkout")}>Checkout as guest</button>
          <button className="w-full rounded-full border border-border px-5 py-2.5 text-sm hover:bg-secondary" onClick={() => go("shop")}>Continue shopping</button>
          {cart.lines.length > 0 && <button className="w-full text-xs text-muted-foreground underline" onClick={() => cart.clear()}>Empty cart</button>}
        </aside>
      </div>
    </section>
  );
}
