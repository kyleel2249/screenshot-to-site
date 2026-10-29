/**
 * Typed browser client for src/server/api.ts. Same-origin fetch (cookies are HttpOnly and handled by the browser).
 * `fetchImpl` is injectable so the exact same code is tested against the real handler.
 */
import type { Availability, PromoLabel } from "./domain/status";
import type { Currency } from "./domain/money";

export interface ApiProduct {
  slug: string; name: string; categoryId: string; createdAt: string; shortDescription: string; image: string; imageAlt: string;
  availability: Availability; labels: PromoLabel[]; price: Partial<Record<Currency, number>>; salePrice: Partial<Record<Currency, number>> | null;
  variantId: string; remaining?: number; expectedWindow?: string | null;
}
export interface ApiOrder {
  id: string; ref: string; status: string; currency: Currency; subtotal: number; discount: number; shipping: number; total: number; hasPreorder: boolean; createdAt: number;
  items: { name: string; qty: number; unit: number; line: number; mode: string }[]; history: { to: string; at: number }[];
}
export interface ApiResult<T> { ok: boolean; status: number; data: T | null; errors: string[] }
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createClient(opts: { base?: string; fetchImpl?: Fetch; origin?: string } = {}) {
  const base = opts.base ?? "";
  const f: Fetch = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    try {
      const res = await f(base + path, {
        method, credentials: "same-origin",
        headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(opts.origin && method !== "GET" ? { Origin: opts.origin } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text(); let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
      const d = data as { error?: string; errors?: string[] } | null;
      const errors = res.ok ? [] : d?.errors ?? (d?.error ? [d.error] : ["Something went wrong. Please try again."]);
      return { ok: res.ok, status: res.status, data: res.ok ? (data as T) : null, errors };
    } catch { return { ok: false, status: 0, data: null, errors: ["Network error. Check your connection and try again."] }; }
  }
  const get = <T,>(p: string) => call<T>("GET", p);
  const post = <T,>(p: string, b: unknown = {}) => call<T>("POST", p, b);
  return {
    products: () => get<ApiProduct[]>("/api/products"),
    zones: () => get<{ id: string; name: string; regions: string[]; currency: Currency; baseFee: number; estimate: string }[]>("/api/shipping-zones"),
    support: (b: { email: string; subject: string; body: string }) => post<{ id: string }>("/api/support", b),
    register: (b: { email: string; password: string; firstName: string; lastName: string; acceptTerms: boolean; marketingConsent?: boolean }) => post<{ ok: true }>("/api/register", b),
    verifyEmail: (token: string) => post<{ ok: true }>("/api/verify-email", { token }),
    login: (email: string, password: string) => post<{ ok: true }>("/api/login", { email, password }),
    logout: () => post<{ ok: true }>("/api/logout"),
    forgot: (email: string) => post<{ ok: true }>("/api/password/forgot", { email }),
    reset: (token: string, password: string) => post<{ ok: true }>("/api/password/reset", { token, password }),
    me: () => get<{ email: string; firstName: string; lastName: string; emailVerified: boolean; preferredCurrency?: Currency }>("/api/me"),
    updateProfile: (b: { firstName?: string; lastName?: string; phone?: string; preferredCurrency?: Currency }) => post<{ ok: true }>("/api/account/profile", b),
    addresses: () => get<{ id: string; recipient: string; region: string; city: string; street: string; isDefault: boolean }[]>("/api/account/addresses"),
    addAddress: (b: { recipient: string; region: string; city: string; street: string; phone?: string; makeDefault?: boolean }) => post("/api/account/addresses", b),
    orders: () => get<ApiOrder[]>("/api/orders"),
    cancelOrder: (id: string) => post<{ ok: true }>(`/api/orders/${encodeURIComponent(id)}/cancel`),
    exportData: () => get<unknown>("/api/account/export"),
    deleteAccount: () => post<{ ok: true }>("/api/account/delete"),
    checkout: (b: { lines: { variantId: string; qty: number }[]; currency: Currency; region: string; zoneId: string; guestEmail?: string; address: { recipient: string; region: string; city: string; street: string; phone?: string }; discountCode?: string; idempotencyKey: string; acceptedTerms: boolean; preorderAcknowledged?: boolean }) =>
      post<{ order: ApiOrder; trackingSecret?: string; paymentRequired: boolean }>("/api/checkout", b),
    track: (ref: string, secret: string) => get<{ ref: string; status: string; history: { to: string; at: number }[]; hasPreorder: boolean }>(`/api/track?ref=${encodeURIComponent(ref)}&secret=${encodeURIComponent(secret)}`),
    admin: (portal: string) => ({
      enrol: (b: { reference: string; email: string; password: string }) => post<{ ok: true }>(`${portal}/api/enrol`, b),
      me: () => get<{ id: string; roles: string[] }>(`${portal}/api/me`),
      products: () => get<AdminProduct[]>(`${portal}/api/products`),
      createProduct: (b: Record<string, unknown>) => post<{ id: string; slug: string }>(`${portal}/api/products`, b),
      setStatus: (ids: string[], availability: Availability) => post(`${portal}/api/products/status`, { ids, availability }),
      publish: (productId: string, published: boolean) => post(`${portal}/api/products/publish`, { productId, published }),
      setPrices: (variantId: string, p: { ghs?: number; usd?: number; saleGhs?: number; saleUsd?: number }) => post(`${portal}/api/prices`, { variantId, ...p }),
      adjustStock: (variantId: string, delta: number, reason: string) => post(`${portal}/api/stock`, { variantId, delta, reason }),
      orders: () => get<AdminOrder[]>(`${portal}/api/orders`),
      setOrderStatus: (orderId: string, to: string, note?: string) => post(`${portal}/api/orders/status`, { orderId, to, ...(note ? { note } : {}) }),
      reauth: (password: string) => post(`${portal}/api/reauth`, { password }),
      refund: (orderId: string, amount: number) => post<{ amount: number; currency: string }>(`${portal}/api/refunds`, { orderId, amount }),
      zones: () => get<AdminZone[]>(`${portal}/api/zones`),
      saveZone: (b: Partial<AdminZone> & { name: string; regions: string[]; currency: Currency; baseFee: number; estimate: string }) => post<AdminZone>(`${portal}/api/zones`, b),
      deleteZone: (id: string) => post(`${portal}/api/zones/delete`, { id }),
      discounts: () => get<AdminDiscount[]>(`${portal}/api/discounts`),
      saveDiscount: (b: Partial<AdminDiscount> & { code: string; kind: AdminDiscount["kind"]; value: number }) => post<AdminDiscount>(`${portal}/api/discounts`, b),
      setDiscountActive: (code: string, active: boolean) => post(`${portal}/api/discounts/active`, { code, active }),
      audit: () => get<{ id: number; actor?: string; event: string; at: number }[]>(`${portal}/api/audit`),
    }),
  };
}
export interface AdminProduct { id: string; slug: string; name: string; archived: boolean; variantId: string | null; sku: string | null; availability: Availability | null; published: boolean; price: Partial<Record<Currency, number>>; salePrice: Partial<Record<Currency, number>> | null; onHand: number; reserved: number; preOrderEnabled: boolean }
export interface AdminZone { id: string; name: string; regions: string[]; currency: Currency; baseFee: number; perKgFee: number; freeOver?: number; estimate: string; quotationOnly?: boolean }
export interface AdminDiscount { code: string; kind: "percent" | "fixed" | "free_shipping"; value: number; currency?: Currency; startsAt?: string; endsAt?: string; minSubtotal?: number; maxRedemptions?: number; perCustomerLimit?: number; firstPurchaseOnly?: boolean; redeemed: number; active: boolean }
export interface AdminOrder extends ApiOrder { guestEmail: string | null; address: { recipient: string; region: string; city: string; street: string } }
export type Client = ReturnType<typeof createClient>;
