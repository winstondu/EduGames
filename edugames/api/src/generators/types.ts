/**
 * Server halves of hybrid generator plugins. Mounted by the API Worker
 * (https://api.games.winstondu.com) at `/v1/generators/<id>/*`. Each half is a thin, allowlisted pass-through to
 * its upstream (so browsers never need upstream CORS and credentials stay here).
 */

import type { RateLimiter } from '../ratelimit'

/** Bindings/vars a generator server half may read (declared in wrangler.jsonc / .dev.vars). */
export interface GeneratorEnv {
  /**
   * Rate limit for answer checks (each one reaches the upstream uncached, possibly posting an attempt).
   * Workers Rate Limiting binding; absent in unit tests → no limit (see ../ratelimit.ts).
   */
  GENERATOR_CHECK_LIMITER?: RateLimiter
  /** Rate limit for session / login / logout pass-throughs (uncached upstream calls). */
  GENERATOR_SESSION_LIMITER?: RateLimiter
  /** Optional secret salt for hashing client IPs (rate-limit keys, score abuse guard). */
  IP_HASH_SALT?: string
  /** API Worker static assets (built plugin modules under /plugins/, plus plugins/manifest.json). */
  ASSETS: Fetcher
  /** Dev only: Vite dev-server origin (e.g. "http://localhost:5173"); when set, the manifest points entries at /src/generators/<id>/index.ts there. */
  GENERATORS_DEV_ORIGIN?: string
  /** e.g. "https://api.kindermath.org/v1" */
  KINDERMATH_API_BASE?: string
  /** STUB auth: demo account email; the server half logs in upstream as this user until per-user login lands. */
  KINDERMATH_DEV_USER_EMAIL?: string
  /** STUB auth: demo account password — a secret (`wrangler secret put` / api/.dev.vars), never in wrangler.jsonc. */
  KINDERMATH_DEMO_PASSWORD?: string
}

export interface GeneratorServer {
  /** Must equal the client plugin id. */
  id: string
  /**
   * Handle `/v1/generators/<id>/<subpath>` (CORS is applied by the router). `subpath` has no leading slash
   * (e.g. "lessons/abc/practice"). Return 404 for anything not allowlisted.
   */
  handle(request: Request, subpath: string, env: GeneratorEnv, ctx: ExecutionContext): Promise<Response>
}
