/** Help & settings modules: Notifications, Customer Support, FAQ, Delivery, About, Contact, Shopping Preferences. */
import { Bell, Mail, MessageCircle, Phone, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { waLink } from "@/lib/business";
import { DEFAULT_PAGES, type PageContent, type PageSlug } from "@/lib/content";
import { type Currency, formatMoney, money } from "@/lib/domain/money";
import { GHANA_REGIONS } from "@/lib/domain/regions";
import { useGuest } from "@/lib/guest";
import { ENQUIRY_CATEGORIES, type EnquiryView, type GuestNotification, type GuestPrefs } from "@/lib/guest-types";
import { useSite } from "@/lib/site";
import { Empty, Heading, useDash } from "./shared";

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const Label = ({ children, htmlFor }: { children: ReactNode; htmlFor: string }) => <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted-foreground">{children}</label>;

/* ---------------- Notifications ---------------- */
export function Notifications() {
  const g = useGuest(), { go, quickView } = useDash();
  const [items, setItems] = useState<GuestNotification[] | null>(null);
  useEffect(() => { let live = true; void g.notifications().then(async (n) => { if (!live) return; setItems(n); if (g.state.unreadNotifications > 0) await g.call("POST", "/notifications/read"); }); return () => { live = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return (
    <div>
      <Heading title="Notifications" sub="Updates about your orders, enquiries and saved items. Price and availability alerts are off until you switch them on in Shopping Preferences." right={<Button variant="outline" size="sm" onClick={() => go("preferences")}>Notification settings</Button>} />
      {items === null ? <div className="dash-skeleton h-24 rounded-2xl" aria-busy="true" /> : items.length === 0 ? (
        <Empty title="You're all caught up">Order, delivery and support updates will appear here as they happen.</Empty>
      ) : (
        <ul className="space-y-3">
          {items.map((n) => (
            <li key={n.id} className="dash-fade flex gap-3 rounded-2xl border border-border bg-card p-4">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"><Bell className="h-4 w-4" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-primary">{n.title}</p>
                <p className="mt-0.5 text-sm text-foreground/80">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{n.standing ? "Current status" : when(n.at)}</p>
                <div className="mt-2 flex gap-3 text-sm">
                  {n.orderRef && <button className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => go("track", { ref: n.orderRef! })}>Track {n.orderRef}</button>}
                  {n.slug && <button className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => quickView(n.slug!)}>View product</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
/* ---------------- Customer Support ---------------- */
export function Support({ presetOrder }: { presetOrder?: string }) {
  const g = useGuest(), site = useSite();
  const [list, setList] = useState<EnquiryView[] | null>(null);
  const [busy, setBusy] = useState(false), [errors, setErrors] = useState<string[]>([]), [sent, setSent] = useState("");
  const [f, setF] = useState({ category: "order", name: g.state.prefs.preferredName, email: g.state.prefs.email, subject: "", message: "", orderRef: presetOrder ?? "" });
  const load = () => g.enquiries().then(setList);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErrors([]);
    const r = await g.call<{ ref: string }>("POST", "/enquiries", f);
    setBusy(false);
    if (!r.ok || !r.data) { setErrors(r.errors); return; }
    setSent(r.data.ref); setF((s) => ({ ...s, subject: "", message: "" })); toast.success(`Enquiry ${r.data.ref} sent`); void load();
  }
  return (
    <div>
      <Heading title="Customer Support" sub="Ask about an order, a product, delivery, payment or returns. A member of our team replies by email; replies also show below." />
      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-card p-5 lg:col-span-3" aria-label="Send an enquiry">
          {sent && <p role="status" className="rounded-md bg-secondary p-3 text-sm text-primary">Thank you. Your enquiry reference is <strong>{sent}</strong>. We'll reply by email.</p>}
          {errors.length > 0 && <ul role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="sp-cat">About</Label>
              <select id="sp-cat" className={field} value={f.category} onChange={set("category")}>{ENQUIRY_CATEGORIES.map((c) => <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>)}</select></div>
            <div><Label htmlFor="sp-order">Order reference (optional)</Label><Input id="sp-order" value={f.orderRef} onChange={set("orderRef")} maxLength={24} placeholder="e.g. DDT-…" /></div>
            <div><Label htmlFor="sp-name">Your name</Label><Input id="sp-name" value={f.name} onChange={set("name")} maxLength={80} autoComplete="name" /></div>
            <div><Label htmlFor="sp-email">Email for our reply</Label><Input id="sp-email" type="email" required value={f.email} onChange={set("email")} maxLength={254} autoComplete="email" /></div>
          </div>
          <div><Label htmlFor="sp-sub">Subject</Label><Input id="sp-sub" required value={f.subject} onChange={set("subject")} maxLength={120} /></div>
          <div><Label htmlFor="sp-msg">Message</Label><Textarea id="sp-msg" required rows={5} value={f.message} onChange={set("message")} maxLength={2000} /></div>
          <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send enquiry"}</Button>
        </form>
        <aside className="space-y-4 lg:col-span-2">
          <ContactCard site={site} />
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-display text-base font-semibold text-primary">My enquiries</h3>
            {list === null ? <div className="dash-skeleton mt-3 h-16 rounded-xl" /> : list.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No enquiries yet from this device.</p> : (
              <ul className="mt-3 space-y-3">
                {list.map((q) => (
                  <li key={q.ref} className="rounded-xl border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-primary">{q.subject}</span><span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-primary">{q.status}</span></div>
                    <p className="text-xs text-muted-foreground">{q.ref} · {when(q.createdAt)}</p>
                    {q.messages.filter((m) => m.fromStaff).map((m, i) => <p key={i} className="mt-2 rounded-md bg-secondary p-2 text-foreground/80"><strong className="text-primary">Dera Darko Trade:</strong> {m.body}</p>)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ContactCard({ site }: { site: ReturnType<typeof useSite> }) {
  const any = site.email || site.phone || site.whatsapp || site.address || site.hours;
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-display text-base font-semibold text-primary">Reach us directly</h3>
      {!any ? <p className="mt-2 text-sm text-muted-foreground">Our contact details are being added. Please use the enquiry form.</p> : (
        <ul className="mt-3 space-y-2 text-sm">
          {site.phone && <li className="flex items-center gap-2"><Phone className="h-4 w-4 text-primary" aria-hidden /><a className="hover:underline" href={`tel:${site.phone.replace(/[^+\d]/g, "")}`}>{site.phone}</a></li>}
          {site.whatsapp && <li className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-primary" aria-hidden /><a className="hover:underline" href={waLink(site.whatsapp)} target="_blank" rel="noopener noreferrer">WhatsApp {site.whatsapp}</a></li>}
          {site.email && <li className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" aria-hidden /><a className="break-all hover:underline" href={`mailto:${site.email}`}>{site.email}</a></li>}
          {site.address && <li className="whitespace-pre-line text-foreground/80">{site.address}{site.city ? `\n${site.city}` : ""}</li>}
          {site.hours && <li className="whitespace-pre-line text-muted-foreground">{site.hours}</li>}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Owner-editable content pages (FAQ, About, Delivery policy) ---------------- */
function PageBody({ slug }: { slug: PageSlug }) {
  const [page, setPage] = useState<PageContent>(DEFAULT_PAGES[slug]);
  useEffect(() => { setPage(DEFAULT_PAGES[slug]); void api.page(slug).then((r) => { if (r.ok && r.data) setPage(r.data); }); }, [slug]);
  return (
    <div>
      <Heading title={page.title} />
      {slug === "faq" ? (
        <div className="divide-y divide-border rounded-2xl border border-border bg-card px-5">
          {page.sections.map((s, i) => <details key={i} className="group py-4"><summary className="cursor-pointer font-medium text-primary">{s.heading}</summary><p className="mt-2 whitespace-pre-line text-sm text-foreground/80">{s.body}</p></details>)}
        </div>
      ) : (
        <div className="space-y-5 rounded-2xl border border-border bg-card p-5">
          {page.sections.map((s, i) => <section key={i}>{s.heading && <h3 className="font-display text-lg font-semibold text-primary">{s.heading}</h3>}<p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground/80">{s.body}</p></section>)}
        </div>
      )}
    </div>
  );
}
export const Faq = () => <PageBody slug="faq" />;

export function About() {
  const site = useSite();
  return (
    <div className="space-y-5">
      <PageBody slug="about" />
      {(site.registrationNumber || site.tin) && (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm" aria-label="Business details">
          <h3 className="font-display text-base font-semibold text-primary">Business details</h3>
          <ul className="mt-2 space-y-1 text-foreground/80">{site.registrationNumber && <li>Registration number: {site.registrationNumber}</li>}{site.tin && <li>TIN: {site.tin}</li>}</ul>
        </div>
      )}
    </div>
  );
}

/** Delivery: the owner's policy text plus the real shipping zones, regions, fees and lead times. Nothing is shown that the owner hasn't configured. */
export function Delivery() {
  const [zones, setZones] = useState<{ id: string; name: string; regions: string[]; currency: Currency; baseFee: number; estimate: string }[] | null>(null);
  useEffect(() => { void api.zones().then((r) => setZones(r.ok && r.data ? r.data : [])); }, []);
  return (
    <div className="space-y-6">
      <PageBody slug="shipping" />
      <div>
        <h3 className="mb-3 font-display text-lg font-semibold text-primary">Where we deliver</h3>
        {zones === null ? <div className="dash-skeleton h-24 rounded-2xl" /> : zones.length === 0 ? (
          <Empty title="Delivery areas are being set up">Our delivery zones and fees haven't been published yet. Please contact us to arrange delivery for your order.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {zones.map((z) => (
              <div key={z.id} className="rounded-2xl border border-border bg-card p-4 text-sm">
                <p className="font-display text-base font-semibold text-primary">{z.name}</p>
                <p className="mt-1 text-foreground/80">Fee from <strong>{formatMoney(money(z.baseFee, z.currency))}</strong> · {z.estimate}</p>
                <p className="mt-2 text-xs text-muted-foreground">{z.regions.join(", ")}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Contact() {
  const site = useSite(), { go } = useDash();
  return (
    <div className="space-y-5">
      <Heading title="Contact Us" sub="We're happy to help with orders, products and delivery." />
      <div className="grid gap-4 md:grid-cols-2">
        <ContactCard site={site} />
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-display text-base font-semibold text-primary">Prefer to write?</h3>
          <p className="mt-2 text-sm text-foreground/80">Send an enquiry and keep every reply in one place on this device.</p>
          <Button className="mt-4" onClick={() => go("support")}>Open Customer Support</Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Shopping Preferences & privacy ---------------- */
export function Preferences() {
  const g = useGuest(), p = g.state.prefs;
  const [d, setD] = useState<GuestPrefs>(p), [interests, setInterests] = useState(p.interests.join(", "));
  const [busy, setBusy] = useState(false), [errors, setErrors] = useState<string[]>([]), [confirmForget, setConfirmForget] = useState(false);
  useEffect(() => { setD(p); setInterests(p.interests.join(", ")); }, [p]);
  const toggle = (k: "notifyOrderUpdates" | "notifyBackInStock" | "notifyPriceAlerts" | "notifyMarketing") => (v: boolean) => setD((s) => ({ ...s, [k]: v }));
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErrors([]);
    const r = await g.savePrefs({ ...d, interests: interests.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10) });
    setBusy(false);
    if (!r.ok) { setErrors(r.errors); return; }
    toast.success("Preferences saved"); void g.refreshRecs();
  }
  async function clearActivity() { const r = await g.call("POST", "/activity/clear"); if (r.ok) { toast.success("Browsing activity cleared"); void g.refreshRecs(); } else toast.error(r.errors[0] ?? "Couldn't clear activity."); }
  async function forget() { const r = await g.call("DELETE", "/data"); setConfirmForget(false); if (r.ok) { toast.success("Your saved data was deleted from this device's session."); void g.refreshRecs(); } else toast.error(r.errors[0] ?? "Couldn't delete your data."); }
  const Row = ({ id, label, hint, checked, on }: { id: string; label: string; hint: string; checked: boolean; on: (v: boolean) => void }) => (
    <div className="flex items-start justify-between gap-4 py-3"><div><label htmlFor={id} className="text-sm font-medium text-primary">{label}</label><p className="text-xs text-muted-foreground">{hint}</p></div><Switch id={id} checked={checked} onCheckedChange={on} /></div>
  );
  return (
    <div>
      <Heading title="Shopping Preferences" sub="Optional. Everything here is kept for this browser's guest session only. You never need an account." />
      <form onSubmit={save} className="space-y-5">
        {errors.length > 0 && <ul role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
        <section className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-display text-base font-semibold text-primary">About you</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="pf-name">Preferred name</Label><Input id="pf-name" value={d.preferredName} maxLength={60} onChange={(e) => setD({ ...d, preferredName: e.target.value })} autoComplete="given-name" /></div>
            <div><Label htmlFor="pf-email">Email (for order updates)</Label><Input id="pf-email" type="email" value={d.email} maxLength={254} onChange={(e) => setD({ ...d, email: e.target.value })} autoComplete="email" /></div>
            <div><Label htmlFor="pf-phone">Phone</Label><Input id="pf-phone" value={d.phone} maxLength={30} onChange={(e) => setD({ ...d, phone: e.target.value })} autoComplete="tel" /></div>
            <div><Label htmlFor="pf-region">Delivery region</Label>
              <select id="pf-region" className={field} value={d.region} onChange={(e) => setD({ ...d, region: e.target.value })}><option value="">Not set</option>{GHANA_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
            <div><Label htmlFor="pf-cur">Show prices in</Label>
              <select id="pf-cur" className={field} value={d.currency} onChange={(e) => setD({ ...d, currency: e.target.value as GuestPrefs["currency"] })}><option value="DUAL">GHS and USD</option><option value="GHS">GHS only</option><option value="USD">USD only</option></select></div>
            <div><Label htmlFor="pf-int">Interests (comma-separated)</Label><Input id="pf-int" value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="e.g. tools, lighting" /></div>
          </div>
        </section>
        <section className="divide-y divide-border rounded-2xl border border-border bg-card px-5 py-2">
          <h3 className="py-3 font-display text-base font-semibold text-primary">Notifications</h3>
          <Row id="n1" label="Order updates" hint="Payment, dispatch and delivery progress." checked={d.notifyOrderUpdates} on={toggle("notifyOrderUpdates")} />
          <Row id="n2" label="Back in stock" hint="Tell me when a saved item is available again." checked={d.notifyBackInStock} on={toggle("notifyBackInStock")} />
          <Row id="n3" label="Price-change alerts" hint="Off by default. Tell me when a saved item's price changes." checked={d.notifyPriceAlerts} on={toggle("notifyPriceAlerts")} />
          <Row id="n4" label="Offers and news" hint="Off by default. Only if you want promotional messages." checked={d.notifyMarketing} on={toggle("notifyMarketing")} />
        </section>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save preferences"}</Button>
      </form>

      <section className="mt-8 rounded-2xl border border-border bg-card p-5" aria-labelledby="privacy-h">
        <h3 id="privacy-h" className="flex items-center gap-2 font-display text-base font-semibold text-primary"><ShieldCheck className="h-4 w-4" aria-hidden /> Privacy controls</h3>
        <p className="mt-2 text-sm text-foreground/80">Your guest session is identified by a signed, random cookie and expires after 30 days of inactivity. Orders you've placed stay on record with the business, as required for delivery and accounts.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="outline" onClick={clearActivity}>Clear browsing activity</Button>
          {!confirmForget ? <Button variant="outline" onClick={() => setConfirmForget(true)}><Trash2 className="mr-2 h-4 w-4" aria-hidden />Delete my saved data</Button> : (
            <span className="flex flex-wrap items-center gap-2 text-sm"><span>Delete wishlist, comparison, addresses and preferences?</span><Button size="sm" onClick={forget}>Yes, delete</Button><Button size="sm" variant="ghost" onClick={() => setConfirmForget(false)}>Cancel</Button></span>
          )}
        </div>
      </section>
    </div>
  );
}
