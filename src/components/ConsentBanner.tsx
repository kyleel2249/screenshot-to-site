import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { campaignFrom, CONSENT_EVENT, eventKindFor, isMeasurable, OPEN_CONSENT_EVENT, readConsent, writeConsent, type Consent } from "@/lib/analytics-client";

/** Asks once, never pre-ticked, equal prominence for both choices. Sends page events only after "Accept". */
export function ConsentBanner() {
  const [consent, setConsent] = useState<Consent>(null);
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const c = readConsent(); setConsent(c); setOpen(c === null);
    const onChange = () => { setConsent(readConsent()); setOpen(false); };
    const onOpen = () => setOpen(true);
    window.addEventListener(CONSENT_EVENT, onChange); window.addEventListener(OPEN_CONSENT_EVENT, onOpen);
    return () => { window.removeEventListener(CONSENT_EVENT, onChange); window.removeEventListener(OPEN_CONSENT_EVENT, onOpen); };
  }, []);

  useEffect(() => {
    if (consent !== "granted") return;
    if (!isMeasurable(pathname)) return;
    void api.event({ consent: true, kind: eventKindFor(pathname), path: pathname, ...campaignFrom(window.location.search) });
  }, [consent, pathname]);

  if (!open) return null;
  return (
    <section aria-label="Analytics choice" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-xl border border-border bg-background p-4 shadow-xl">
      <p className="text-sm">May we count visits to improve the shop? We use anonymous, daily-rotating identifiers and never store your IP address or track you across sites. See our <a className="underline" href="/policies/privacy">privacy policy</a>.</p>
      <div className="mt-3 flex gap-3">
        <button className="btn-primary" onClick={() => writeConsent("granted")}>Accept</button>
        <button className="rounded-full border border-border px-6 py-3 text-sm font-semibold" onClick={() => writeConsent("denied")}>Decline</button>
      </div>
    </section>
  );
}
export function ConsentLink({ className }: { className?: string }) {
  return <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}>Analytics choices</button>;
}
