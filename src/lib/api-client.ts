/**
 * Typed browser client for src/server/api.ts. Same-origin fetch (cookies are HttpOnly and handled by the browser).
 * `fetchImpl` is injectable so the exact same code is tested against the real handler.
 */
import type { BusinessInfo } from "./business";
import type { Availability, PromoLabel } from "./domain/status";
import type { Currency } from "./domain/money";
import type { PageContent, Section } from "./content";
import type { CategoryNode, FilterProfile } from "./domain/categories";

export interface ApiProduct {
  slug: string; name: string; categoryId: string; createdAt: string; shortDescription: string; image: string; imageAlt: string;
  rating?: { count: number; average: number };
  availability: Availability; labels: PromoLabel[]; price: Partial<Record<Currency, number>>; salePrice: Partial<Record<Currency, number>> | null;
  variantId: string; remaining?: number; expectedWindow?: string | null; attributes: Record<string, string>;
}
export interface ApiOrder {
  id: string; ref: string; status: string; currency: Currency; subtotal: number; discount: number; shipping: number; total: number; hasPreorder: boolean; createdAt: number; payBy: number | null; paymentMethod: PayMethod | null;
  items: { name: string; qty: number; unit: number; line: number; mode: string }[]; history: { to: string; at: number }[];
}
export interface TrackResult { ref: string; status: string; history: { to: string; at: number }[]; hasPreorder: boolean; currency: Currency; total: number; paymentMethod: PayMethod | null; payBy: number | null }
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
  const put = <T,>(p: string, b: unknown = {}) => call<T>("PUT", p, b);
  return {
    products: () => get<ApiProduct[]>("/api/products"),
    categories: () => get<CategoryNode[]>("/api/categories"),
    reviews: (slug: string) => get<ReviewList>(`/api/reviews?slug=${encodeURIComponent(slug)}`),
    submitReview: (slug: string, b: { rating: number; title: string; body: string }) => post("/api/reviews", { slug, ...b }),
    page: (slug: string) => get<PageContent>(`/api/pages/${encodeURIComponent(slug)}`),
    event: (b: { consent: boolean; kind: string; path?: string; source?: string; campaign?: string }) => post<{ recorded: boolean }>("/api/events", b),
    myTickets: () => get<Ticket[]>("/api/account/tickets"),
    zones: () => get<{ id: string; name: string; regions: string[]; currency: Currency; baseFee: number; estimate: string }[]>("/api/shipping-zones"),
    support: (b: { email: string; subject: string; body: string }) => post<{ id: string }>("/api/support", b),
    register: (b: { email: string; password: string; firstName: string; lastName: string; acceptTerms: boolean; marketingConsent?: boolean }) => post<{ ok: true }>("/api/register", b),
    requestQuote: (b: { business?: string; contactName: string; email: string; phone?: string; region: string; notes?: string; items: { description: string; qty: number }[] }) => post<{ ref: string; secret: string }>("/api/quotes", b),
    quoteStatus: (ref: string, secret: string) => get<QuoteView>(`/api/quotes/status?ref=${encodeURIComponent(ref)}&secret=${encodeURIComponent(secret)}`),
    respondToQuote: (ref: string, secret: string, accept: boolean) => post<QuoteView>("/api/quotes/respond", { ref, secret, accept }),
    acceptInvite: (token: string, password: string) => post<{ ok: true }>("/api/staff/accept-invite", { token, password }),
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
      post<{ order: ApiOrder; trackingSecret?: string; paymentRequired: boolean; paymentAvailable: boolean; paymentMethods: PayMethod[] }>("/api/checkout", b),
    site: () => get<BusinessInfo>("/api/site"),
    cart: () => get<{ variantId: string; qty: number }[]>("/api/account/cart"),
    saveCart: (lines: { variantId: string; qty: number }[]) => put<{ variantId: string; qty: number }[]>("/api/account/cart", { lines }),
    wishlist: () => get<string[]>("/api/account/wishlist"),
    setWishlist: (slug: string, on: boolean) => post<{ count: number }>("/api/account/wishlist", { slug, on }),
    paymentConfig: () => get<{ enabled: boolean; provider?: string; methods: Record<"GHS" | "USD", PayMethod[]> }>("/api/payments/config"),
    startPayment: (orderRef: string, trackingSecret?: string, method?: PayMethod) => post<{ redirectUrl: string }>("/api/payments/start", { orderRef, ...(trackingSecret ? { trackingSecret } : {}), ...(method ? { method } : {}) }),
    startBankTransfer: (orderRef: string, trackingSecret?: string) => post<BankTransferInstructions>("/api/payments/bank-transfer", { orderRef, ...(trackingSecret ? { trackingSecret } : {}) }),
    track: (ref: string, secret: string) => get<TrackResult>(`/api/track?ref=${encodeURIComponent(ref)}&secret=${encodeURIComponent(secret)}`),
    admin: (portal: string) => ({
      enrol: (b: { reference: string; email: string; password: string }) => post<{ ok: true }>(`${portal}/api/enrol`, b),
      me: () => get<{ id: string; roles: string[]; mfa: "setup_required" | "code_required" | "verified" }>(`${portal}/api/me`),
      mfaSetup: () => post<{ secret: string; otpauth: string }>(`${portal}/api/mfa/setup`),
      mfaConfirm: (code: string) => post<{ recoveryCodes: string[] }>(`${portal}/api/mfa/confirm`, { code }),
      mfaVerify: (code: string) => post<{ ok: true }>(`${portal}/api/mfa/verify`, { code }),
      resetStaffMfa: (userId: string) => post(`${portal}/api/staff/mfa-reset`, { userId }),
      products: () => get<AdminProduct[]>(`${portal}/api/products`),
      createProduct: (b: Record<string, unknown>) => post<{ id: string; slug: string }>(`${portal}/api/products`, b),
      setStatus: (ids: string[], availability: Availability) => post(`${portal}/api/products/status`, { ids, availability }),
      importProducts: (csv: string, dryRun: boolean) => post<{ dryRun: boolean; count: number; created: { row: number; name: string; sku: string }[] }>(`${portal}/api/products/import`, { csv, dryRun }),
      setAttributes: (productId: string, attributes: Record<string, string>) => post<{ attributes: Record<string, string> }>(`${portal}/api/products/attributes`, { productId, attributes }),
      publish: (productId: string, published: boolean) => post(`${portal}/api/products/publish`, { productId, published }),
      setPrices: (variantId: string, p: { ghs?: number; usd?: number; saleGhs?: number; saleUsd?: number }) => post(`${portal}/api/prices`, { variantId, ...p }),
      adjustStock: (variantId: string, delta: number, reason: string) => post(`${portal}/api/stock`, { variantId, delta, reason }),
      orders: () => get<AdminOrder[]>(`${portal}/api/orders`),
      setOrderStatus: (orderId: string, to: string, note?: string) => post(`${portal}/api/orders/status`, { orderId, to, ...(note ? { note } : {}) }),
      reauth: (password: string) => post(`${portal}/api/reauth`, { password }),
      refund: (orderId: string, amount: number) => post<{ amount: number; currency: string }>(`${portal}/api/refunds`, { orderId, amount }),
      categories: () => get<CategoryNode[]>(`${portal}/api/categories`),
      addCategory: (name: string, parentId: string | null, filterProfile?: FilterProfile) => post(`${portal}/api/categories`, { name, ...(parentId ? { parentId } : {}), ...(filterProfile ? { filterProfile } : {}) }),
      renameCategory: (id: string, name: string) => post(`${portal}/api/categories/rename`, { id, name }),
      setCategoryHidden: (id: string, hidden: boolean) => post(`${portal}/api/categories/visibility`, { id, hidden }),
      moveCategory: (id: string, position: number) => post(`${portal}/api/categories/move`, { id, position }),
      /** CSV (needs recent re-authentication). Returns text, not JSON. */
      exportOrdersCsv: async (): Promise<ApiResult<string>> => {
        try {
          const res = await f(`${base}${portal}/api/export/orders.csv`, { method: "GET", credentials: "same-origin" });
          const text = await res.text();
          if (res.ok) return { ok: true, status: res.status, data: text, errors: [] };
          let msg = "Export failed."; try { const j = JSON.parse(text) as { error?: string }; if (j.error) msg = j.error; } catch { /* keep default */ }
          return { ok: false, status: res.status, data: null, errors: [msg] };
        } catch { return { ok: false, status: 0, data: null, errors: ["Network error. Check your connection and try again."] }; }
      },
      suppliers: () => get<Supplier[]>(`${portal}/api/suppliers`),
      saveSupplier: (b: Partial<Supplier> & { name: string }) => post<Supplier>(`${portal}/api/suppliers`, b),
      purchaseOrders: () => get<PurchaseOrder[]>(`${portal}/api/purchase-orders`),
      createPurchaseOrder: (b: { supplierId: string; currency: string; lines: { variantId: string; qty: number; unitCost: number }[]; expectedAt?: string; notes?: string }) => post<{ id: string; ref: string }>(`${portal}/api/purchase-orders`, b),
      setPurchaseOrderStatus: (id: string, to: "ordered" | "cancelled") => post(`${portal}/api/purchase-orders/status`, { id, to }),
      receivePurchaseOrder: (id: string, lines: { variantId: string; qty: number }[]) => post(`${portal}/api/purchase-orders/receive`, { id, lines }),
      preorderQueue: () => get<PreorderQueueItem[]>(`${portal}/api/preorder-queue`),
      allocatePreorder: (orderId: string) => post(`${portal}/api/orders/allocate-preorder`, { orderId }),
      uploadImage: async (file: Blob): Promise<ApiResult<{ url: string }>> => {
        try {
          const res = await f(`${base}${portal}/api/media`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream", ...(opts.origin ? { Origin: opts.origin } : {}) }, body: file });
          const text = await res.text(); let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
          const d = data as { errors?: string[]; error?: string; url?: string } | null;
          return res.ok && d?.url ? { ok: true, status: res.status, data: { url: d.url }, errors: [] } : { ok: false, status: res.status, data: null, errors: d?.errors ?? (d?.error ? [d.error] : ["The upload failed. Please try again."]) };
        } catch { return { ok: false, status: 0, data: null, errors: ["Network error. Check your connection and try again."] }; }
      },
      overview: () => get<Overview>(`${portal}/api/overview`),
      business: () => get<BusinessInfo>(`${portal}/api/business`),
      saveBusiness: (b: BusinessInfo) => post<{ business: BusinessInfo }>(`${portal}/api/business`, b),
      confirmBankTransfer: (orderId: string, amount: number, reference: string) => post<{ result: string }>(`${portal}/api/orders/confirm-bank-transfer`, { orderId, amount, reference }),
      reviews: () => get<AdminReview[]>(`${portal}/api/reviews`),
      moderateReview: (id: string, action: "publish" | "reject") => post(`${portal}/api/reviews/moderate`, { id, action }),
      pages: () => get<(PageContent & { customised: boolean; legal: boolean; updatedAt: number | null })[]>(`${portal}/api/pages`),
      savePage: (slug: string, b: { title: string; sections: Section[]; reviewed?: boolean }) => post(`${portal}/api/pages`, { slug, ...b }),
      resetPage: (slug: string) => post(`${portal}/api/pages/reset`, { slug }),
      quotes: () => get<AdminQuote[]>(`${portal}/api/quotes`),
      sendQuote: (id: string, b: { currency: Currency; total: number; validDays: number; message?: string }) => post(`${portal}/api/quotes/send`, { id, ...b }),
      staff: () => get<StaffMember[]>(`${portal}/api/staff`),
      inviteStaff: (email: string, roles: string[]) => post(`${portal}/api/staff/invite`, { email, roles }),
      setStaffRoles: (userId: string, roles: string[]) => post(`${portal}/api/staff/roles`, { userId, roles }),
      setStaffActive: (userId: string, active: boolean) => post(`${portal}/api/staff/active`, { userId, active }),
      tickets: () => get<Ticket[]>(`${portal}/api/tickets`),
      replyTicket: (ticketId: string, body: string, internal = false) => post(`${portal}/api/tickets/reply`, { ticketId, body, internal }),
      setTicketStatus: (ticketId: string, status: Ticket["status"]) => post(`${portal}/api/tickets/status`, { ticketId, status }),
      analytics: (days = 30) => get<Analytics>(`${portal}/api/analytics?days=${days}`),
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
export interface AdminProduct { categoryId: string; attributes: Record<string, string>; id: string; slug: string; name: string; archived: boolean; variantId: string | null; sku: string | null; availability: Availability | null; published: boolean; price: Partial<Record<Currency, number>>; salePrice: Partial<Record<Currency, number>> | null; onHand: number; reserved: number; preOrderEnabled: boolean }
export interface QuoteView { ref: string; status: "new" | "quoted" | "accepted" | "declined" | "expired"; items: { description: string; qty: number }[]; createdAt: number; quote?: { currency: Currency; total: number; validUntil: number; message: string } }
export interface AdminQuote { id: string; ref: string; business: string; contactName: string; email: string; phone: string | null; region: string; notes: string; items: { description: string; qty: number }[]; status: QuoteView["status"]; quote: (QuoteView["quote"] & { quotedAt: number }) | null; createdAt: number }
export interface ReviewList { summary: { count: number; average: number }; reviews: { rating: number; title: string; body: string; author: string; at: number }[]; canReview: boolean; myReview: { status: string } | null }
export interface AdminReview { id: string; product: string; rating: number; title: string; body: string; author: string; status: "pending" | "published" | "rejected"; createdAt: number }
export type PayMethod = "card" | "mobile_money" | "bank_transfer";
export const PAY_METHOD_LABELS: Record<PayMethod, string> = { card: "Card", mobile_money: "Mobile Money", bank_transfer: "Bank transfer" };
export interface BankTransferInstructions { instructions: string; reference: string; amount: number; currency: "GHS" | "USD"; holdUntil: number }
export interface PreorderQueueItem { orderId: string; ref: string; paidAt: number; items: { variantId: string; name: string; qty: number }[]; canAllocate: boolean }
export interface Overview {
  orders?: { toFulfil: number; awaitingPayment: number; bankTransfersToConfirm: number; paymentsUnderReview: number; cancellationRequests: number; refundsPending: number; preordersWaiting: number; newQuotes: number };
  stock?: { outOfStock: number; low: { variantId: string; name: string; available: number }[]; threshold: number; incomingUnits: number };
  reviewsToModerate?: number; openTickets?: number;
  sales?: { last7Days: Record<string, { orders: number; revenue: number }>; last30Days: Record<string, { orders: number; revenue: number }> };
}
export interface Supplier { id: string; name: string; contact: string; email: string; phone: string; country: string; notes: string; active: boolean }
export interface PurchaseOrder { id: string; ref: string; supplierId: string; supplier: string; status: "draft" | "ordered" | "partially_received" | "received" | "cancelled"; currency: string; lines: { variantId: string; name: string; qty: number; unitCost: number; received: number }[]; expectedAt?: string; notes: string; createdAt: number; receipts: { at: number; by: string; lines: { variantId: string; qty: number }[] }[] }
export interface StaffMember { id: string; email: string; roles: string[]; state: "active" | "invited" | "suspended"; createdAt: number }
export interface Ticket { id: string; email: string; subject: string; status: "open" | "pending" | "resolved"; priority: string; messages: { author: string; internal: boolean; body: string; at: number }[]; createdAt: number }
export interface Analytics { days: number; funnel: { productViews: number; addToCart: number; checkoutStarts: number; paidOrders: number }; revenue: Record<string, { gross: number; refunds: number; net: number; orders: number }> }
export interface AdminZone { id: string; name: string; regions: string[]; currency: Currency; baseFee: number; perKgFee: number; freeOver?: number; estimate: string; quotationOnly?: boolean }
export interface AdminDiscount { code: string; kind: "percent" | "fixed" | "free_shipping"; value: number; currency?: Currency; startsAt?: string; endsAt?: string; minSubtotal?: number; maxRedemptions?: number; perCustomerLimit?: number; firstPurchaseOnly?: boolean; redeemed: number; active: boolean }
export interface AdminOrder extends ApiOrder { paymentMethod: PayMethod | null; guestEmail: string | null; address: { recipient: string; region: string; city: string; street: string } }
export type Client = ReturnType<typeof createClient>;
