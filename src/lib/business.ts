/** Public business details, entered by the owner in the portal. Nothing here is ever invented: a field the owner hasn't filled in is simply not shown. */
export interface BusinessInfo { email?: string; phone?: string; whatsapp?: string; address?: string; city?: string; hours?: string; registrationNumber?: string; tin?: string }
export const BUSINESS_FIELDS: { key: keyof BusinessInfo; label: string; hint: string; multiline?: boolean }[] = [
  { key: "email", label: "Public email", hint: "Where customers can write to you" },
  { key: "phone", label: "Phone", hint: "e.g. +233 24 000 0000" },
  { key: "whatsapp", label: "WhatsApp number", hint: "Optional; digits with country code" },
  { key: "address", label: "Street address", hint: "Shown in the footer and contact page", multiline: true },
  { key: "city", label: "Town / city", hint: "e.g. Accra" },
  { key: "hours", label: "Opening hours", hint: "e.g. Mon–Sat 9am–6pm", multiline: true },
  { key: "registrationNumber", label: "Business registration number", hint: "Shown on the About page" },
  { key: "tin", label: "Tax identification number (TIN)", hint: "Optional; shown on the About page" },
];
const LIMITS: Record<keyof BusinessInfo, number> = { email: 200, phone: 30, whatsapp: 20, address: 300, city: 80, hours: 200, registrationNumber: 60, tin: 40 };

export function cleanBusiness(raw: unknown): { ok: true; info: BusinessInfo } | { ok: false; errors: string[] } {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const info: BusinessInfo = {}, errors: string[] = [];
  for (const f of BUSINESS_FIELDS) {
    const v = src[f.key]; if (v === undefined || v === null) continue;
    if (typeof v !== "string") { errors.push(`${f.label} must be text.`); continue; }
    const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim(); if (!t) continue;
    if (t.length > LIMITS[f.key]) { errors.push(`${f.label} is too long (max ${LIMITS[f.key]} characters).`); continue; }
    if (f.key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) { errors.push("Public email looks invalid."); continue; }
    if ((f.key === "phone" || f.key === "whatsapp") && !/^\+?[0-9][0-9 ()-]{5,}$/.test(t)) { errors.push(`${f.label} should contain only digits, spaces, + ( ) -.`); continue; }
    info[f.key] = f.multiline ? t : t.replace(/\s+/g, " ");
  }
  return errors.length ? { ok: false, errors } : { ok: true, info };
}
/** Digits only, for wa.me links. */
export const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, "")}`;
