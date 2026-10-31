/** Ghana's 16 administrative regions. Shipping zones may only reference these, so typos can't silently break checkout. */
export const GHANA_REGIONS = [
  "Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra", "North East",
  "Northern", "Oti", "Savannah", "Upper East", "Upper West", "Volta", "Western", "Western North",
] as const;
export type GhanaRegion = (typeof GHANA_REGIONS)[number];
