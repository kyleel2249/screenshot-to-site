import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { DisplayMode } from "@/lib/domain/money";

/**
 * Display-currency preference. The site default is set by the administrator (GHS here until settings are persisted);
 * a shopper may override it. Display currency never changes what is charged — checkout re-prices on the server.
 */
export const SITE_DEFAULT_MODE: DisplayMode = "GHS";
const KEY = "ddt-display-mode";

interface Ctx { mode: DisplayMode; setMode: (m: DisplayMode) => void }
const C = createContext<Ctx | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DisplayMode>(SITE_DEFAULT_MODE);
  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (v === "GHS" || v === "USD" || v === "DUAL") setModeState(v); } catch { /* storage unavailable */ }
  }, []);
  const setMode = (m: DisplayMode) => { setModeState(m); try { localStorage.setItem(KEY, m); } catch { /* ignore */ } };
  return <C.Provider value={{ mode, setMode }}>{children}</C.Provider>;
}
export function useCurrency() {
  const c = useContext(C);
  if (!c) throw new Error("useCurrency outside CurrencyProvider");
  return c;
}
