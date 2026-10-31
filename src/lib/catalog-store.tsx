import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { SEED_CATEGORIES, type CategoryNode } from "./domain/categories";
import type { StoreProduct } from "./storefront";

type Status = "loading" | "ready" | "error";
interface Ctx { products: StoreProduct[]; categories: CategoryNode[]; status: Status; reload: () => Promise<void> }
const C = createContext<Ctx | null>(null);

/** Loads the live public catalogue once per page load; `reload` lets screens refresh after a failed attempt. */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  // Until the live tree arrives (or if it fails) the standard tree keeps navigation usable.
  const [categories, setCategories] = useState<CategoryNode[]>(SEED_CATEGORIES);
  const [status, setStatus] = useState<Status>("loading");
  const reload = useCallback(async () => {
    const [r, c] = await Promise.all([api.products(), api.categories()]);
    if (c.ok && c.data && c.data.length) setCategories(c.data);
    if (r.ok && r.data) { setProducts(r.data); setStatus("ready"); } else setStatus("error");
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const value = useMemo(() => ({ products, categories, status, reload }), [products, categories, status, reload]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useCatalog() {
  const c = useContext(C);
  if (!c) throw new Error("useCatalog outside CatalogProvider");
  return c;
}
