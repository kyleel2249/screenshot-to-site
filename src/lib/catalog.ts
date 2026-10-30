import { findBySlug, descendantIds } from "@/lib/domain/categories";

/**
 * Static reference data only. Products are NOT defined here: the storefront reads the live catalogue the owner
 * manages in the dashboard (GET /api/products) through `useCatalog()` in `catalog-store.tsx`.
 */
export { findBySlug, descendantIds };

/** Only the trading name lives in code. Contact, address and registration details are entered by the owner in the portal (see src/lib/site.ts). */
export const business = { name: "Dera Darko Trade" };
