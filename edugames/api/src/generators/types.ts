/**
 * Server halves of hybrid generator plugins. Mounted by the API Worker
 * (https://api.games.winstondu.com) at `/v1/generators/<id>/*`. Each half is a thin, allowlisted pass-through to
 * its upstream (so browsers never need upstream CORS and credentials stay here).
 */

/** Bindings/vars a generator server half may read (declared in wrangler.jsonc / .dev.vars). */
export interface GeneratorEnv {
  /** API Worker static assets (built plugin modules under /plugins/, plus plugins/manifest.json). */
  ASSETS: Fetcher
  /** Dev only: Vite dev-server origin (e.g. "http://localhost:5173"); when set, the manifest points entries at /src/generators/<id>/index.ts there. */
  GENERATORS_DEV_ORIGIN?: string
  /** e.g. "https://api.kindermath.org/v1" */
  KINDERMATH_API_BASE?: string
  /** STUB auth: demo identity sent upstream as `x-dev-user-email` until real per-user login lands. */
  KINDERMATH_DEV_USER_EMAIL?: string
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
