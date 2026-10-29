/** Security headers. CSP is strict: no unsafe-inline scripts — callers pass a per-response nonce for inline JSON-LD/bootstrap scripts. */
export interface HeaderOpts { nonce: string; payment?: { scriptHosts?: string[]; frameHosts?: string[]; connectHosts?: string[] }; reportUri?: string }

export function buildCsp(o: HeaderOpts): string {
  const p = o.payment ?? {};
  const list = (a?: string[]) => (a ?? []).join(" ");
  const d: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${o.nonce}' ${list(p.scriptHosts)}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // inline styles are required by the component library; scripts stay strict
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    `connect-src 'self' ${list(p.connectHosts)}`.trim(),
    `frame-src ${list(p.frameHosts) || "'none'"}`,
    "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "upgrade-insecure-requests",
  ];
  if (o.reportUri) d.push(`report-uri ${o.reportUri}`);
  return d.join("; ");
}

export function securityHeaders(o: HeaderOpts): Record<string, string> {
  return {
    "Content-Security-Policy": buildCsp(o),
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}
/** Authenticated, checkout and admin responses must never be cached by shared caches/CDNs. */
export const NO_STORE = { "Cache-Control": "private, no-store" } as const;
