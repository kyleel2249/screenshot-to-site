import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { StoreProduct } from "./storefront";

type Status = "loading" | "ready" | "error";
interface Ctx { products: StoreProduct[]; status: Status; reload: () => Promise<void> }
const C = createContext<Ctx | null>(null);

/** Loads the live public catalogue once per page load; `reload` lets screens refresh after a failed attempt. */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const reload = useCallback(async () => {
    const r = await api.products();
    if (r.ok && r.data) { setProducts(r.data); setStatus("ready"); } else setStatus("error");
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const value = useMemo(() => ({ products, status, reload }), [products, status, reload]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useCatalog() {
  const c = useContext(C);
  if (!c) throw new Error("useCatalog outside CatalogProvider");
  return c;
}
