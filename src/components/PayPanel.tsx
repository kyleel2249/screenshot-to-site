import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PAY_METHOD_LABELS, type BankTransferInstructions, type PayMethod } from "@/lib/api-client";
import { formatMoney } from "@/lib/domain/money";
import { Errors } from "@/components/Form";

const BLURB: Record<PayMethod, string> = {
  card: "Visa or Mastercard, on our payment partner's secure page.",
  mobile_money: "Approve the payment on your phone (MTN, Telecel or AirtelTigo). Ghana cedi orders only.",
  bank_transfer: "Pay from your bank to our account. We confirm once the money arrives, then process your order.",
};

/**
 * Lets a customer pay for an order that is waiting for payment — right after checkout, from the Track page, or from their account.
 * Which methods appear comes from the server for this order's currency; the amount is never sent from here (the server reads its own order).
 */
export function PayPanel({ orderRef, trackingSecret, total, currency, payBy, methods: given }: { orderRef: string; trackingSecret?: string | undefined; total: number; currency: "GHS" | "USD"; payBy?: number | null | undefined; methods?: PayMethod[] | undefined }) {
  const [methods, setMethods] = useState<PayMethod[] | null>(given ?? null);
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [errors, setErrors] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [bank, setBank] = useState<BankTransferInstructions | null>(null);
  useEffect(() => { if (given) { setMethods(given); return; } void api.paymentConfig().then((r) => setMethods(r.ok && r.data ? r.data.methods[currency] : [])); }, [given, currency]);
  if (methods === null) return <p role="status" className="text-sm text-muted-foreground">Loading payment options…</p>;
  if (methods.length === 0) return <p className="text-sm text-muted-foreground">Online payment isn't available yet. We'll contact you to arrange payment.</p>;
  const chosen = method ?? methods[0]!;
  const pay = async () => {
    setBusy(true); setErrors([]);
    if (chosen === "bank_transfer") { const r = await api.startBankTransfer(orderRef, trackingSecret); setBusy(false); if (r.ok && r.data) setBank(r.data); else setErrors(r.errors); return; }
    const r = await api.startPayment(orderRef, trackingSecret, chosen);
    if (r.ok && r.data) window.location.assign(r.data.redirectUrl); else { setBusy(false); setErrors(r.errors); }
  };
  return (
    <div className="space-y-3">
      <Errors errors={errors} />
      {payBy ? <p className="text-sm text-muted-foreground">Your items are held until {new Date(payBy).toLocaleString()}.</p> : null}
      <fieldset className="space-y-2"><legend className="text-sm font-semibold">How would you like to pay?</legend>
        {methods.map((m) => (
          <label key={m} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-primary">
            <input type="radio" name={`pay-method-${orderRef}`} className="mt-1" checked={chosen === m} onChange={() => setMethod(m)} />
            <span><span className="font-medium">{PAY_METHOD_LABELS[m]}</span><span className="block text-muted-foreground">{BLURB[m]}</span></span>
          </label>))}
      </fieldset>
      <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void pay()}>{busy ? "Please wait…" : chosen === "bank_transfer" ? "Show bank details" : `Pay ${formatMoney({ amount: total, currency })} now`}</button>
      <p className="text-xs text-muted-foreground">Card and Mobile Money payments happen on our payment partner's secure page. We never see or store your card details or Mobile Money PIN.</p>
      {bank && (
        <div className="rounded-md border border-border p-4 text-sm" role="status">
          <p className="font-semibold">Pay {formatMoney({ amount: bank.amount, currency: bank.currency })} by bank transfer</p>
          <pre className="mt-2 whitespace-pre-wrap rounded bg-secondary p-2 font-sans">{bank.instructions}</pre>
          <p className="mt-2">Use <strong>{bank.reference}</strong> as the payment reference so we can match it. Your items are held until {new Date(bank.holdUntil).toLocaleString()}.</p>
        </div>)}
    </div>
  );
}
