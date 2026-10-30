/**
 * Transactional email. Pure templates + a thin provider adapter (Resend's HTTPS API; swap `send` for another provider
 * without touching templates). Secrets come from the environment only. Links are built from SITE_ORIGIN, never from request data.
 * Delivery failures are logged WITHOUT the token and never break the request that triggered them.
 */
import type { Deps } from "./api";

export type Template = Parameters<NonNullable<Deps["mail"]>>[1];
export interface MailEnv { SITE_ORIGIN: string; EMAIL_API_KEY?: string; EMAIL_FROM?: string }
export interface Message { to: string; subject: string; text: string; html: string }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PATH: Record<Template, { path: string; subject: string; intro: string; cta: string; expiry: string }> = {
  verify_email: { path: "/verify-email", subject: "Verify your email — Dera Darko Trade", intro: "Thanks for creating an account. Confirm your email address to activate it.", cta: "Verify email", expiry: "This link expires in 24 hours." },
  owner_verify: { path: "/verify-email", subject: "Verify the owner email — Dera Darko Trade", intro: "Confirm this email address to finish setting up the owner account.", cta: "Verify email", expiry: "This link expires in 24 hours." },
  password_reset: { path: "/reset-password", subject: "Reset your password — Dera Darko Trade", intro: "We received a request to reset your password. If this wasn't you, ignore this email and your password stays the same.", cta: "Choose a new password", expiry: "This link expires in 30 minutes and works once." },
  staff_invite: { path: "/accept-invite", subject: "You're invited to the Dera Darko Trade team", intro: "You've been invited to help run the shop. Set your password to activate your staff account.", cta: "Accept invitation", expiry: "This link expires in 72 hours and works once." },
};

export function buildMessage(env: Pick<MailEnv, "SITE_ORIGIN">, to: string, template: Template, token: string): Message {
  const t = PATH[template];
  const url = `${env.SITE_ORIGIN.replace(/\/+$/, "")}${t.path}?token=${encodeURIComponent(token)}`;
  return {
    to, subject: t.subject,
    text: `${t.intro}\n\n${t.cta}: ${url}\n\n${t.expiry}\n\nDera Darko Trade`,
    html: `<p>${esc(t.intro)}</p><p><a href="${esc(url)}">${esc(t.cta)}</a></p><p>${esc(t.expiry)}</p><p>Dera Darko Trade</p>`,
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
/** Returns a `deps.mail` implementation, or undefined when email isn't configured (callers then simply don't send). */
export function createMailer(env: MailEnv, fetchImpl: Fetch = (u, i) => fetch(u, i), log: (m: string) => void = console.error): Deps["mail"] | undefined {
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) return undefined;
  return async (to, template, data) => {
    const m = buildMessage(env, to, template, data.token);
    try {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
      });
      if (!res.ok) log(`mail:${template} failed with HTTP ${res.status}`);
    } catch { log(`mail:${template} failed (network)`); }
  };
}

const NOTICE: Record<import("./api").NoticeTemplate, { path: (ref: string) => string; subject: (ref: string, s?: string) => string; body: (ref: string, s?: string) => string; cta: string }> = {
  order_received: { path: () => "/track", subject: (r) => `We received your order ${r} — Dera Darko Trade`, body: (r) => `Thank you for your order ${r}. Payment is arranged with our team and we'll contact you. Keep the tracking code you were shown at checkout to follow your order.`, cta: "Track your order" },
  quote_ready: { path: () => "/quote-status", subject: (r) => `Your quote ${r} is ready — Dera Darko Trade`, body: (r) => `A written quote for your request ${r} is ready. Use your reference and the access code you saved to view, accept or decline it.`, cta: "View your quote" },
  ticket_reply: { path: () => "/account", subject: (_r, s) => `Reply to: ${s ?? "your message"} — Dera Darko Trade`, body: (_r, s) => `We've replied to your message${s ? ` "${s}"` : ""}. Sign in to read it under Account → Messages.`, cta: "Open your account" },
};
export function buildNotice(env: Pick<MailEnv, "SITE_ORIGIN">, to: string, template: import("./api").NoticeTemplate, data: { ref: string; subject?: string }): Message {
  const n = NOTICE[template]; const url = `${env.SITE_ORIGIN.replace(/\/+$/, "")}${n.path(data.ref)}`; const body = n.body(data.ref, data.subject);
  return { to, subject: n.subject(data.ref, data.subject).replace(/[\r\n]+/g, " "), text: `${body}\n\n${n.cta}: ${url}\n\nDera Darko Trade`, html: `<p>${esc(body)}</p><p><a href="${esc(url)}">${esc(n.cta)}</a></p><p>Dera Darko Trade</p>` };
}
export function createNotifier(env: MailEnv, fetchImpl: Fetch = (u, i) => fetch(u, i), log: (m: string) => void = console.error): Deps["notify"] | undefined {
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) return undefined;
  return async (to, template, data) => {
    const m = buildNotice(env, to, template, data);
    try {
      const res = await fetchImpl("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html }) });
      if (!res.ok) log(`notify:${template} failed with HTTP ${res.status}`);
    } catch { log(`notify:${template} failed (network)`); }
  };
}
