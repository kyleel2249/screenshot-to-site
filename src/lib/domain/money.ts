/**
 * Money handling. All amounts are INTEGER MINOR UNITS (pesewas / cents).
 * No floating-point arithmetic is used for financial values.
 */
export type Currency = "GHS" | "USD";
export type DisplayMode = "GHS" | "USD" | "DUAL";

export interface Money {
  amount: number; // integer minor units
  currency: Currency;
}

export const CURRENCY_META: Record<Currency, { symbol: string; label: string; locale: string }> = {
  GHS: { symbol: "GH₵", label: "Ghana Cedi", locale: "en-GH" },
  USD: { symbol: "US$", label: "US Dollar", locale: "en-US" },
};

export function money(amount: number, currency: Currency): Money {
  if (!Number.isInteger(amount)) throw new Error("Money amount must be an integer in minor units");
  return { amount, currency };
}

/** Convert a decimal major-unit string such as "12.50" to minor units without float maths. */
export function parseMajor(input: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) throw new Error(`Invalid amount: ${input}`);
  return parseInt(m[1] ?? "0", 10) * 100 + parseInt((m[2] ?? "").padEnd(2, "0") || "0", 10);
}

export function formatMoney(m: Money): string {
  const sign = m.amount < 0 ? "-" : "";
  const abs = Math.abs(m.amount);
  const major = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, "0");
  const grouped = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${CURRENCY_META[m.currency].symbol} ${grouped}.${minor}`;
}

export function add(a: Money, b: Money): Money {
  assertSame(a, b);
  return money(a.amount + b.amount, a.currency);
}
export function subtract(a: Money, b: Money): Money {
  assertSame(a, b);
  return money(a.amount - b.amount, a.currency);
}
export function multiply(a: Money, qty: number): Money {
  if (!Number.isInteger(qty)) throw new Error("Quantity must be an integer");
  return money(a.amount * qty, a.currency);
}
function assertSame(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
}

/** Percentage of an amount, in basis points (1% = 100 bps), rounded half-up. Integer maths only. */
export function percentOf(a: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) throw new Error("basisPoints must be a non-negative integer");
  return money(Math.floor((a.amount * basisPoints + 5000) / 10000), a.currency);
}

/**
 * Explicit exchange rate. Never invented: an admin must supply rate, source and effective date.
 * `rate` is expressed as GHS minor units per 1 USD (e.g. 15.50 GHS/USD => rateMicro 15_500_000).
 */
export interface ExchangeRate {
  ghsPerUsdMicro: number; // GHS per USD * 1_000_000 (integer)
  source: string;
  effectiveDate: string; // ISO date
}

export function convert(m: Money, to: Currency, rate: ExchangeRate): Money {
  if (m.currency === to) return m;
  if (!rate || !Number.isInteger(rate.ghsPerUsdMicro) || rate.ghsPerUsdMicro <= 0) throw new Error("A valid exchange rate is required");
  if (!rate.source || !rate.effectiveDate) throw new Error("Exchange rate must document its source and effective date");
  const r = BigInt(rate.ghsPerUsdMicro);
  const a = BigInt(m.amount);
  // USD -> GHS: a * r / 1e6 ; GHS -> USD: a * 1e6 / r   (round half-up)
  const out = m.currency === "USD" ? (a * r + 500000n) / 1000000n : (a * 1000000n + r / 2n) / r;
  return money(Number(out), to);
}

/** A product price may be set independently per currency; conversion is only a fallback and is labelled. */
export interface PriceSet {
  GHS?: number;
  USD?: number;
}

export interface DisplayPrice {
  money: Money;
  source: "set" | "converted";
}

export function resolvePrice(prices: PriceSet, currency: Currency, rate?: ExchangeRate): DisplayPrice | null {
  const direct = prices[currency];
  if (direct !== undefined) return { money: money(direct, currency), source: "set" };
  const other: Currency = currency === "GHS" ? "USD" : "GHS";
  const base = prices[other];
  if (base === undefined || !rate) return null;
  return { money: convert(money(base, other), currency, rate), source: "converted" };
}

/** Lines to show for a display mode. Dual mode labels whether each price is set or calculated. */
export function priceLabels(prices: PriceSet, mode: DisplayMode, rate?: ExchangeRate): { text: string; note?: string | undefined }[] {
  const currencies: Currency[] = mode === "DUAL" ? ["GHS", "USD"] : [mode];
  const out: { text: string; note?: string | undefined }[] = [];
  for (const c of currencies) {
    const p = resolvePrice(prices, c, rate);
    if (!p) continue;
    out.push({ text: formatMoney(p.money), note: p.source === "converted" ? `≈ at ${(rate!.ghsPerUsdMicro / 1e6).toFixed(2)} GHS/USD (${rate!.source})` : undefined });
  }
  return out;
}
