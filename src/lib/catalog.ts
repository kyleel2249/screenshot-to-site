import { findBySlug, descendantIds } from "@/lib/domain/categories";

/**
 * Static reference data only. Products are NOT defined here: the storefront reads the live catalogue the owner
 * manages in the dashboard (GET /api/products) through `useCatalog()` in `catalog-store.tsx`.
 */
export { findBySlug, descendantIds };

// Placeholder contact details — to be supplied and verified by the business. Never invented.
export const business = {
  name: "Dera Darko Trade",
  email: "To be provided by the owner",
  phone: "To be provided by the owner",
  location: "Ghana",
};
