/**
 * Payment provider boundary. A provider only does two things: (1) create a hosted-payment session for an amount the SERVER
 * read from its own order, and (2) authenticate + translate its webhook into our neutral event. It never decides what an
 * order costs and never marks anything paid by itself — `handleVerifiedPayment` re-checks amount and currency.
 */
import { hmacHex } from "./webhook";
import { timingSafeEqual } from "../security/crypto";

export type PaymentMethod = "card" | "mobile_money" | "bank_transfer";
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["card", "mobile_money", "bank_transfer"];
export const METHOD_LABELS: Record<PaymentMethod, string> = { card: "Card", mobile_money: "Mobile Money", bank_transfer: "Bank transfer" };
export const isMethod = (v: unknown): v is PaymentMethod => typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
export interface PaymentInit { orderRef: string; amount: number; currency: "GHS" | "USD"; email: string; callbackUrl: string; method?: "card" | "mobile_money" }
export type InitResult = { ok: true; redirectUrl: string } | { ok: false; error: string };
export interface PaymentEvent { eventId: string; orderRef: string; amount: number; currency: "GHS" | "USD"; status: "success" | "failed"; channel?: string }
export interface PaymentProvider {
  name: string;
  /** Online methods this provider can take in the given currency (bank transfer is handled separately, by staff confirmation). */
  methods(currency: "GHS" | "USD"): PaymentMethod[];
  initialize(i: PaymentInit): Promise<InitResult>;
  /** Returns the event if the signature is valid and it is one we act on; "ignored" for valid-but-irrelevant events; null if unauthentic. */
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | "ignored" | null>;
}
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Paystack adapter (https://paystack.com/docs/api). Amounts are minor units (pesewas/cents), matching ours. UNVERIFIED against the live service until keys exist. */
export function paystack(secretKey: string, fetchImpl: Fetch = (u, i) => fetch(u, i)): PaymentProvider {
  return {
    name: "paystack",
    // Paystack Ghana: card in GHS and USD; Mobile Money is GHS only.
    methods: (currency) => (currency === "GHS" ? ["card", "mobile_money"] : ["card"]),
    async initialize(i) {
      if (i.method && !this.methods(i.currency).includes(i.method)) return { ok: false, error: `${METHOD_LABELS[i.method]} isn't available for ${i.currency} payments.` };
      // A fresh reference per attempt (Paystack rejects reused references); the order ref is the part before the dot.
      const reference = `${i.orderRef}.${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
      try {
        const res = await fetchImpl("https://api.paystack.co/transaction/initialize", {
          method: "POST", headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ email: i.email, amount: i.amount, currency: i.currency, reference, callback_url: i.callbackUrl, ...(i.method === "card" ? { channels: ["card"] } : i.method === "mobile_money" ? { channels: ["mobile_money"] } : {}) }),
        });
        const j = (await res.json().catch(() => null)) as { status?: boolean; data?: { authorization_url?: string } } | null;
        const url = j?.data?.authorization_url;
        if (!res.ok || !j?.status || !url || !/^https:\/\//.test(url)) return { ok: false, error: "The payment service couldn't start this payment. Please try again." };
        return { ok: true, redirectUrl: url };
      } catch { return { ok: false, error: "The payment service is unreachable. Please try again." }; }
    },
    async parseWebhook(raw, headers) {
      const sig = headers.get("x-paystack-signature");
      if (!sig || !timingSafeEqual(await hmacHex(secretKey, raw, "SHA-512"), sig.trim().toLowerCase())) return null; // HMAC-SHA512 of the raw body
      let ev: { event?: string; data?: { id?: number | string; reference?: string; amount?: number; currency?: string; status?: string; channel?: string } };
      try { ev = JSON.parse(raw); } catch { return null; }
      if (ev.event !== "charge.success" || ev.data?.status !== "success") return "ignored";
      const d = ev.data, orderRef = (d.reference ?? "").split(".")[0] ?? "";
      if (!orderRef || typeof d.amount !== "number" || (d.currency !== "GHS" && d.currency !== "USD") || d.id === undefined) return "ignored";
      return { eventId: `paystack:${d.id}`, orderRef, amount: d.amount, currency: d.currency, status: "success", ...(d.channel ? { channel: d.channel } : {}) };
    },
  };
}

/** Chooses the configured provider; undefined means online payment is not available (checkout then says so honestly). */
export function providerFromEnv(env: { PAYMENT_PROVIDER?: string; PAYMENT_SECRET_KEY?: string }, fetchImpl?: Fetch): PaymentProvider | undefined {
  if (!env.PAYMENT_SECRET_KEY) return undefined;
  if (env.PAYMENT_PROVIDER === "paystack") return paystack(env.PAYMENT_SECRET_KEY, fetchImpl);
  return undefined; // other providers: add an adapter implementing PaymentProvider
}

/** Maps a provider's channel name to our method; unknown channels return undefined rather than guessing. */
export function methodFromChannel(channel: string | undefined): PaymentMethod | undefined {
  if (channel === "card") return "card";
  if (channel === "mobile_money") return "mobile_money";
  if (channel === "bank" || channel === "bank_transfer" || channel === "eft") return "bank_transfer";
  return undefined;
}
