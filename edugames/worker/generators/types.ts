/**
 * Server halves of hybrid generator plugins. Mounted by the Worker router at
 * `/api/generators/<id>/*`. Each half is a thin, allowlisted pass-through to
 * its upstream (so browsers never need upstream CORS and credentials stay here).
 */

/** Bindings/vars a generator server half may read (declared in wrangler.jsonc / .dev.vars). */
export interface GeneratorEnv {
  /** Static assets binding (serves built plugin modules + manifest). */
  ASSETS: Fetcher
  /** e.g. "https://api.kindermath.org/v1" */
  KINDERMATH_API_BASE?: string
  /** STUB auth: demo identity sent upstream as `x-dev-user-email` until real per-user login lands. */
  KINDERMATH_DEV_USER_EMAIL?: string
}

export interface GeneratorServer {
  /** Must equal the client plugin id. */
  id: string
  /**
   * Handle `/api/generators/<id>/<subpath>`. `subpath` has no leading slash
   * (e.g. "lessons/abc/practice"). Return 404 for anything not allowlisted.
   */
  handle(request: Request, subpath: string, env: GeneratorEnv, ctx: ExecutionContext): Promise<Response>
}
