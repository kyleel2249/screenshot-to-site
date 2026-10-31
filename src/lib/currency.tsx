import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { DisplayMode, ExchangeRate } from "@/lib/domain/money";

/**
 * Display-currency preference. The owner sets the site default (both currencies unless they choose otherwise) and the approved exchange rate;
 * a shopper may override the display choice. Display currency never changes what is charged — checkout re-prices on the server, and a price
 * converted with the owner's rate is always labelled as approximate.
 */
export const SITE_DEFAULT_MODE: DisplayMode = "DUAL";
const KEY = "ddt-display-mode";

interface Ctx { mode: DisplayMode; setMode: (m: DisplayMode) => void; rate: ExchangeRate | undefined }
const C = createContext<Ctx | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DisplayMode>(SITE_DEFAULT_MODE);
  const [rate, setRate] = useState<ExchangeRate | undefined>(undefined);
  useEffect(() => {
    let chosen = false;
    try { const v = localStorage.getItem(KEY); if (v === "GHS" || v === "USD" || v === "DUAL") { setModeState(v); chosen = true; } } catch { /* storage unavailable */ }
    void api.rates().then((r) => { if (!r.ok || !r.data) return; if (!chosen) setModeState(r.data.displayMode); if (r.data.rate) setRate(r.data.rate); });
  }, []);
  const setMode = (m: DisplayMode) => { setModeState(m); try { localStorage.setItem(KEY, m); } catch { /* ignore */ } };
  return <C.Provider value={{ mode, setMode, rate }}>{children}</C.Provider>;
}
export function useCurrency() {
  const c = useContext(C);
  if (!c) throw new Error("useCurrency outside CurrencyProvider");
  return c;
}
