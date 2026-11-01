import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { createMailer, createNotifier } from "./server/mailer";
import { route } from "./server/edge";
import { runMaintenance } from "./server/maintenance";
import { MemoryPersistence } from "./server/persistence/transact";
import { D1Persistence } from "./server/persistence/sql";
import type { WorkerEnv } from "./server/worker-entry";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;
function getServerEntry(): Promise<ServerEntry> {
  return (serverEntryPromise ??= import("@tanstack/react-start/server-entry").then((m) => m.default as ServerEntry));
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;
  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;
  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function renderApp(request: Request, env: unknown, ctx: unknown): Promise<Response> {
  try {
    const handler = await getServerEntry();
    const response = await handler.fetch(request, env, ctx);
    return await normalizeCatastrophicSsrResponse(response);
  } catch (error) {
    console.error(error);
    return new Response(renderErrorPage(), { status: 500, headers: { "content-type": "text/html; charset=utf-8" } });
  }
}

/** Shared in-memory store used when no D1 database is bound (survives within one Worker isolate only). */
const memoryPersistence = new MemoryPersistence();

function apiEnvFor(request: Request, env: unknown): WorkerEnv {
  const e = (env ?? {}) as Partial<WorkerEnv> & Record<string, unknown>;
  const origin = (typeof e.SITE_ORIGIN === "string" && e.SITE_ORIGIN) || new URL(request.url).origin;
  return {
    ...e,
    DB: e.DB as WorkerEnv["DB"],
    // Without a configured secret, sessions are signed with a per-isolate random value (never a published constant).
    SESSION_SECRET: (typeof e.SESSION_SECRET === "string" && e.SESSION_SECRET) || fallbackSecret(),
    SITE_ORIGIN: origin,
  } as WorkerEnv;
}

let generatedSecret: string | undefined;
function fallbackSecret(): string {
  if (!generatedSecret) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    generatedSecret = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  return generatedSecret;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // The API always runs: on Cloudflare D1 when a `DB` binding exists, otherwise on in-memory storage (data is lost on restart).
    const apiEnv = apiEnvFor(request, env);
    const persistence = apiEnv.DB ? new D1Persistence(apiEnv.DB) : memoryPersistence;
    return route(request, apiEnv, persistence, (r) => renderApp(r, env, ctx), {
      mail: createMailer(apiEnv),
      notify: createNotifier(apiEnv),
    });
  },
  async scheduled(_event: unknown, env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const e = env as Partial<WorkerEnv> | null | undefined;
    if (!e?.DB) return;
    ctx.waitUntil(
      runMaintenance(new D1Persistence(e.DB)).catch((err) => {
        console.error("maintenance failed", err);
      }),
    );
  },
};
