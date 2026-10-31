/**
 * Owner-approved exchange rate (GHS per 1 USD). The shop never invents or fetches a rate on its own: the owner types the rate, names its source and
 * gives the date it applies from. Rates are parsed from text into integer micro-units, so no floating-point arithmetic touches money.
 */
import type { ExchangeRate } from "./money";

export interface ApprovedRate extends ExchangeRate { approvedBy: string; approvedAt: number }
export const RATE_STALE_DAYS = 14;
const DAY = 86_400_000;

/** "15.5", "15.500000" → 15_500_000. Up to 6 decimals, digits only. Returns null when the text isn't a plain positive decimal. */
export function parseRateMicro(text: unknown): number | null {
  if (typeof text !== "string" && typeof text !== "number") return null;
  const s = String(text).trim();
  const m = /^(\d{1,5})(?:\.(\d{1,6}))?$/.exec(s); if (!m) return null;
  const micro = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
  return micro > 0 ? micro : null;
}
export const formatRate = (micro: number) => micro % 10_000 === 0 ? (micro / 1_000_000).toFixed(2) : (micro / 1_000_000).toFixed(6).replace(/0+$/, "");

export function cleanRate(input: Record<string, unknown>, now: number, approvedBy: string): { ok: true; rate: ApprovedRate } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const micro = parseRateMicro(input["ghsPerUsd"]);
  if (micro === null) errors.push("Enter the rate as a plain number of cedis per US dollar, for example 15.50.");
  else if (micro < 100_000 || micro > 99_999_000_000) errors.push("That rate looks wrong. Check the number and try again.");
  const source = typeof input["source"] === "string" ? input["source"].replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (!source) errors.push("Say where this rate comes from (for example, your bank or the Bank of Ghana).");
  const date = typeof input["effectiveDate"] === "string" ? input["effectiveDate"].trim() : "";
  const t = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) errors.push("Give the date this rate applies from, as YYYY-MM-DD.");
  else if (t > now + DAY) errors.push("The rate's date can't be in the future.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, rate: { ghsPerUsdMicro: micro!, source, effectiveDate: date, approvedBy, approvedAt: now } };
}

export function rateAgeDays(r: Pick<ExchangeRate, "effectiveDate">, now: number): number { return Math.max(0, Math.floor((now - Date.parse(`${r.effectiveDate}T00:00:00Z`)) / DAY)); }
export const isStale = (r: Pick<ExchangeRate, "effectiveDate">, now: number) => rateAgeDays(r, now) > RATE_STALE_DAYS;
