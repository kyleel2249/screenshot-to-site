/**
 * Cloudflare Worker / Pages Function adapter.
 *   - Bind a D1 database as `DB` and set the secrets listed in .env.example.
 *   - Route /api/* and `${ADMIN_PORTAL_PATH}/api/*` to this handler.
 * Not yet wired into the TanStack Start build (that needs a local `npm run build` to verify) — see docs/DEPLOYMENT.md.
 */
import { handle, type Deps, type Env } from "./api";
import { D1Persistence, type D1Like } from "./persistence/sql";

export interface WorkerEnv extends Env { DB: D1Like }

export function createFetchHandler(deps: Deps = {}) {
  return (req: Request, env: WorkerEnv): Promise<Response> => handle(req, env, new D1Persistence(env.DB), deps);
}
