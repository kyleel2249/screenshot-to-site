/**
 * HTTP entry for /api/*. Two layers:
 *  1. `handleGuest` (./guest) – the anonymous customer dashboard under /api/guest/*; returns null for any other path.
 *  2. `handleFull` (./api-full-impl) – the storefront, checkout, payments and the open owner console (unchanged).
 * Everything the rest of the code imported from "./api" is re-exported here so existing imports keep working.
 */
import { handle as handleFull, type Deps, type Env } from "./api-full-impl";
import { handleGuest } from "./guest";
import type { Persistence } from "./persistence/transact";

export * from "./api-full-impl";

export async function handle(req: Request, env: Env, p: Persistence, deps: Deps = {}): Promise<Response> {
  const guest = await handleGuest(req, env, p, deps);
  return guest ?? handleFull(req, env, p, deps);
}
