import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { STAFF_OPEN_ACCESS } from "./lib/security/open-access";
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

function apiConfigured(env: unknown): env is WorkerEnv {
  const e = env as Partial<WorkerEnv> | null | undefined;
  return !!e && !!e.DB && !!e.SESSION_SECRET && !!e.SITE_ORIGIN;
}

/** Shared in-memory store for open-access mode (survives within one Worker isolate). */
const memoryPersistence = new MemoryPersistence();

function openAccessEnv(request: Request, env: unknown): WorkerEnv {
  const e = (env ?? {}) as Partial<WorkerEnv> & Record<string, unknown>;
  const origin = (typeof e.SITE_ORIGIN === "string" && e.SITE_ORIGIN) || new URL(request.url).origin;
  return {
    ...e,
    DB: e.DB as WorkerEnv["DB"],
    SESSION_SECRET: (typeof e.SESSION_SECRET === "string" && e.SESSION_SECRET) || "dev-open-access-session-secret-change-me",
    SITE_ORIGIN: origin,
  } as WorkerEnv;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    if (apiConfigured(env)) {
      return route(request, env, new D1Persistence(env.DB), (r) => renderApp(r, env, ctx), {
        mail: createMailer(env),
        notify: createNotifier(env),
      });
    }
    // TEMP open access: API runs without Cloudflare secrets/D1 so enrol + login work during setup.
    if (STAFF_OPEN_ACCESS) {
      const openEnv = openAccessEnv(request, env);
      const persistence = openEnv.DB ? new D1Persistence(openEnv.DB) : memoryPersistence;
      return route(request, openEnv, persistence, (r) => renderApp(r, openEnv, ctx), {
        mail: createMailer(openEnv),
        notify: createNotifier(openEnv),
      });
    }
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/") || path.includes("/api/")) {
      return new Response(JSON.stringify({ error: "Service not configured" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return renderApp(request, env, ctx);
  },
  async scheduled(_event: unknown, env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }) {
    if (!apiConfigured(env)) return;
    ctx.waitUntil(
      runMaintenance(new D1Persistence(env.DB)).catch((e) => {
        console.error("maintenance failed", e);
      }),
    );
  },
};
