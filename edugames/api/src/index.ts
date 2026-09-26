/**
 * EduGames API Worker → https://api.games.winstondu.com. Game-agnostic: every game and generator
 * plugin shares these routes.
 *   GET  /v1/health
 *   GET  /v1/scores, POST /v1/scores    → scores.ts (D1)
 *   *    /v1/generators, /v1/generators/* → generators/index.ts (manifest + hybrid pass-throughs)
 *   GET  /plugins/*                     → built plugin modules: served as static assets (public/_headers sets
 *                                         CORS + cache); this Worker only sees asset misses (404 + CORS)
 * CORS: the request Origin is reflected (with credentials) only if listed in ALLOWED_ORIGINS.
 */
import { handleGeneratorRequest } from './generators/index'
import type { GeneratorEnv } from './generators/types'
import { errorResponse, handleScores, jsonResponse } from './scores'

export interface Env extends GeneratorEnv {
  DB: D1Database
  /** Comma-separated browser origins allowed by CORS, e.g. "https://games.winstondu.com". */
  ALLOWED_ORIGINS: string
  /** Optional secret salt for hashing client IPs (rate limiting). */
  IP_HASH_SALT?: string
}

const ALLOWED_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'
/** Methods a disallowed Origin may still use (no side effects). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function allowedOrigins(env: Pick<Env, 'ALLOWED_ORIGINS'>): Set<string> {
  return new Set((env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean))
}

/** Copy `res` with CORS headers for `origin` (null → none, but still `Vary: Origin`). */
function withCors(res: Response, origin: string | null): Response {
  const out = new Response(res.body, res)
  out.headers.append('Vary', 'Origin')
  if (origin) {
    out.headers.set('Access-Control-Allow-Origin', origin)
    out.headers.set('Access-Control-Allow-Credentials', 'true')
    out.headers.set('Access-Control-Expose-Headers', 'Retry-After')
  }
  return out
}

function preflight(request: Request, origin: string | null): Response {
  if (!origin) return withCors(errorResponse('Origin not allowed.', 403), null)
  const headers = new Headers({
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') ?? 'Content-Type',
    'Access-Control-Max-Age': '86400',
  })
  return withCors(new Response(null, { status: 204, headers }), origin)
}

async function route(request: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  if (path === '/v1/health') {
    return request.method === 'GET' || request.method === 'HEAD'
      ? jsonResponse({ ok: true })
      : errorResponse('Method not allowed.', 405, { Allow: 'GET, HEAD' })
  }
  if (path === '/v1/scores') return handleScores(request, env)
  if (path === '/v1/generators' || path.startsWith('/v1/generators/')) {
    return handleGeneratorRequest(request, env, ctx)
  }
  return errorResponse('Not found.', 404)
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const requestOrigin = request.headers.get('Origin')
    const origin = requestOrigin && allowedOrigins(env).has(requestOrigin) ? requestOrigin : null

    if (path.startsWith('/plugins/')) {
      if (!SAFE_METHODS.has(request.method)) return errorResponse('Method not allowed.', 405)
      if (request.method === 'OPTIONS') return preflight(request, origin)
      return withCors(await env.ASSETS.fetch(request), origin)
    }
    if (path !== '/v1' && !path.startsWith('/v1/')) return errorResponse('Not found.', 404)

    if (request.method === 'OPTIONS') return preflight(request, origin)
    // Browsers send Origin on cross-origin writes; refuse them from origins we don't serve.
    if (requestOrigin && !origin && !SAFE_METHODS.has(request.method)) {
      return withCors(errorResponse('Origin not allowed.', 403), null)
    }

    let res: Response
    try {
      res = await route(request, env, ctx, path)
    } catch (err) {
      console.error('Unhandled API error', path, err)
      res = errorResponse('Something went wrong. Please try again.', 500)
    }
    return withCors(res, origin)
  },
} satisfies ExportedHandler<Env>
