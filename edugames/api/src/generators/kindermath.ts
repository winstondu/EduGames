/**
 * kindermath server half — an allowlisted pass-through to api.kindermath.org.
 * Mounted by the API Worker at `/v1/generators/kindermath/*`. The browser never
 * talks to the upstream directly (no CORS there, and credentials stay here).
 *
 * Auth is STUBBED with the demo account for now: the Worker logs in upstream
 * once (`POST /auth/login` with KINDERMATH_DEV_USER_EMAIL + the
 * KINDERMATH_DEMO_PASSWORD secret), keeps the returned session cookie in
 * isolate memory, and re-logs in once on a 401. That cookie is only ever sent
 * upstream — client cookies/headers are never forwarded, and upstream
 * cookies/auth headers are never returned to the browser.
 */
import { rateLimit } from '../ratelimit'
import type { GeneratorEnv, GeneratorServer } from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9-]{1,64}$/
const UPSTREAM_TIMEOUT_MS = 8000
const MAX_BODY_BYTES = 4096
/** How many practice pulls to union — each returns a random subset of the lesson. */
const POOL_PULLS = 4
/** Re-login proactively after this long even without a 401. */
const SESSION_TTL_MS = 30 * 60 * 1000

const HOUR = 3600
const TEN_MIN = 600

function json(body: unknown, status = 200, cacheSeconds = 0): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' }
  if (cacheSeconds > 0) headers['cache-control'] = `public, max-age=${cacheSeconds}`
  return new Response(JSON.stringify(body), { status, headers })
}

function errorJson(status: number, message: string): Response {
  return json({ error: message }, status)
}

function base(env: GeneratorEnv): string | null {
  const b = env.KINDERMATH_API_BASE
  return b ? b.replace(/\/$/, '') : null
}

/** One fetch with timeout; Workers only supports redirect 'follow' | 'manual', so refuse redirects here. */
async function rawFetch(url: string, init: { method: string; headers: Record<string, string>; body?: BodyInit | null }): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) throw new UpstreamError(`${url}: unexpected redirect`)
    return res
  } catch (err) {
    if (err instanceof UpstreamError) throw err
    throw new UpstreamError(err instanceof Error ? err.message : 'upstream fetch failed')
  } finally {
    clearTimeout(timer)
  }
}

// --- demo session (stub auth) ----------------------------------------------

let demoSession: { cookie: string; expires: number } | null = null
let loginInFlight: Promise<string | null> | null = null

/** Test hook: forget the cached demo session. */
export function resetDemoSession(): void {
  demoSession = null
  loginInFlight = null
}

/** Session cookie for the demo account, logging in if needed; null when no demo credentials are configured. */
async function demoCookie(env: GeneratorEnv, root: string, force = false): Promise<string | null> {
  if (!env.KINDERMATH_DEV_USER_EMAIL || !env.KINDERMATH_DEMO_PASSWORD) return null
  if (!force && demoSession && demoSession.expires > Date.now()) return demoSession.cookie
  loginInFlight ??= loginDemo(env, root).finally(() => {
    loginInFlight = null
  })
  return loginInFlight
}

async function loginDemo(env: GeneratorEnv, root: string): Promise<string> {
  demoSession = null
  const res = await rawFetch(`${root}/auth/login`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ email: env.KINDERMATH_DEV_USER_EMAIL, password: env.KINDERMATH_DEMO_PASSWORD }),
  })
  if (!res.ok) throw new UpstreamError(`demo login failed: HTTP ${res.status}`)
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? ''].filter(Boolean)
  const cookie = setCookies.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ')
  if (!cookie) throw new UpstreamError('demo login returned no session cookie')
  demoSession = { cookie, expires: Date.now() + SESSION_TTL_MS }
  return cookie
}

/** Fetch upstream as the demo account (re-login once on 401). Never forwards client input. */
async function upstream(
  env: GeneratorEnv,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const root = base(env)
  if (!root) throw new UpstreamError('kindermath upstream not configured')
  const send = async (cookie: string | null) => {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (cookie) headers['cookie'] = cookie
    if (init?.body) headers['content-type'] = 'application/json'
    return rawFetch(`${root}/${path}`, { method: init?.method ?? 'GET', headers, body: init?.body })
  }
  const res = await send(await demoCookie(env, root))
  if (res.status !== 401) return res
  const fresh = await demoCookie(env, root, true)
  return fresh ? send(fresh) : res
}

class UpstreamError extends Error {}

/** Read upstream JSON, mapping non-2xx and parse failures to a thrown UpstreamError. */
async function upstreamJson<T>(env: GeneratorEnv, path: string, init?: RequestInit): Promise<T> {
  const res = await upstream(env, path, init)
  if (!res.ok) throw new UpstreamError(`upstream ${path}: HTTP ${res.status}`)
  try {
    return (await res.json()) as T
  } catch {
    throw new UpstreamError(`upstream ${path}: invalid JSON`)
  }
}

/**
 * Cache a computed JSON response at the edge, keyed by origin + pathname only: no route reads the query
 * string, so `?x=1` must not mint a fresh key (that would let anyone bypass the cache and hit upstream).
 */
async function cached(
  request: Request,
  ctx: ExecutionContext,
  seconds: number,
  build: () => Promise<Response>,
): Promise<Response> {
  const cache = caches.default
  const { origin, pathname } = new URL(request.url)
  const key = new Request(`${origin}${pathname}`, { method: 'GET' })
  const hit = await cache.match(key)
  if (hit) return hit
  const res = await build()
  if (res.ok && seconds > 0) {
    ctx.waitUntil(cache.put(key, res.clone()))
  }
  return res
}

async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) throw new BadRequest('request body too large')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new BadRequest('invalid JSON body')
  }
}

class BadRequest extends Error {}

/** Upstream practice question; passed through as-is (unknown fields included, e.g. an `answer` kind hint). */
interface KinderQuestion {
  id: string
  kind: string
  prompt: string
  choices?: { id: string; text: string }[]
  hint?: string
  difficulty?: number
  /** Optional answer-kind hint for TYPED questions ('number' | 'expression' | 'text'); the browser half maps it. */
  answer?: string
}

/** Pull practice several times (in parallel) and union by question id (each pull is a random subset). */
async function buildPool(env: GeneratorEnv, id: string): Promise<KinderQuestion[]> {
  const byId = new Map<string, KinderQuestion>()
  const batches = await Promise.all(
    Array.from({ length: POOL_PULLS }, () => upstreamJson<KinderQuestion[]>(env, `lessons/${id}/practice`)),
  )
  for (const batch of batches) {
    if (!Array.isArray(batch)) continue
    for (const q of batch) {
      if (q && typeof q.id === 'string' && !byId.has(q.id)) byId.set(q.id, q)
    }
  }
  return [...byId.values()]
}

export const kindermathServer: GeneratorServer = {
  id: 'kindermath',

  async handle(request, subpath, env, ctx): Promise<Response> {
    const method = request.method.toUpperCase()
    const parts = subpath.split('/').filter(Boolean)

    try {
      // GET courses
      if (parts.length === 1 && parts[0] === 'courses') {
        if (method !== 'GET') return errorJson(405, 'method not allowed')
        return await cached(request, ctx, HOUR, async () =>
          json(await upstreamJson(env, 'courses'), 200, HOUR),
        )
      }

      // GET courses/:slug
      if (parts.length === 2 && parts[0] === 'courses') {
        if (method !== 'GET') return errorJson(405, 'method not allowed')
        if (!SLUG.test(parts[1])) return errorJson(400, 'invalid course slug')
        return await cached(request, ctx, HOUR, async () =>
          json(await upstreamJson(env, `courses/${parts[1]}`), 200, HOUR),
        )
      }

      // GET lessons/:id
      if (parts.length === 2 && parts[0] === 'lessons') {
        if (method !== 'GET') return errorJson(405, 'method not allowed')
        if (!UUID.test(parts[1])) return errorJson(400, 'invalid lesson id')
        return await cached(request, ctx, TEN_MIN, async () =>
          json(await upstreamJson(env, `lessons/${parts[1]}`), 200, TEN_MIN),
        )
      }

      // GET lessons/:id/questions
      if (parts.length === 3 && parts[0] === 'lessons' && parts[2] === 'questions') {
        if (method !== 'GET') return errorJson(405, 'method not allowed')
        if (!UUID.test(parts[1])) return errorJson(400, 'invalid lesson id')
        return await cached(request, ctx, TEN_MIN, async () =>
          json(await buildPool(env, parts[1]), 200, TEN_MIN),
        )
      }

      // POST check {questionId, given}
      if (parts.length === 1 && parts[0] === 'check') {
        if (method !== 'POST') return errorJson(405, 'method not allowed')
        const limited = await rateLimit(env.GENERATOR_CHECK_LIMITER, request, 'kindermath:check', env.IP_HASH_SALT)
        if (limited) return limited
        const body = (await readJsonBody(request)) as { questionId?: unknown; given?: unknown }
        const questionId = body.questionId
        const given = body.given
        if (typeof questionId !== 'string' || !UUID.test(questionId)) {
          return errorJson(400, 'invalid questionId')
        }
        if (typeof given !== 'string' || given.length > 256) {
          return errorJson(400, 'invalid given')
        }
        const result = await upstreamJson<{ correct?: boolean; explanation?: string }>(
          env,
          'attempts',
          { method: 'POST', body: JSON.stringify({ questionId, given, context: 'PRACTICE' }) },
        )
        return json({ correct: result.correct === true, explanation: result.explanation })
      }

      // GET session
      if (parts.length === 1 && parts[0] === 'session') {
        if (method !== 'GET') return errorJson(405, 'method not allowed')
        const limited = await rateLimit(env.GENERATOR_SESSION_LIMITER, request, 'kindermath:session', env.IP_HASH_SALT)
        if (limited) return limited
        return json(await sessionStatus(env))
      }

      // POST login / POST logout — stub placeholders
      if (parts.length === 1 && (parts[0] === 'login' || parts[0] === 'logout')) {
        if (method !== 'POST') return errorJson(405, 'method not allowed')
        const limited = await rateLimit(env.GENERATOR_SESSION_LIMITER, request, 'kindermath:session', env.IP_HASH_SALT)
        if (limited) return limited
        if (parts[0] === 'login') await readJsonBody(request) // validate size/shape, ignore creds
        const status = await sessionStatus(env)
        return json({
          ...status,
          demo: true,
          message: 'Per-user login is not enabled yet — using the demo account.',
        })
      }

      return errorJson(404, 'not found')
    } catch (err) {
      if (err instanceof BadRequest) return errorJson(400, err.message)
      if (err instanceof UpstreamError) return errorJson(502, 'upstream error')
      return errorJson(502, 'upstream error')
    }
  },
}

async function sessionStatus(
  env: GeneratorEnv,
): Promise<{ loggedIn: boolean; displayName?: string; demo: boolean }> {
  try {
    const me = await upstreamJson<{ name?: string; displayName?: string; email?: string }>(
      env,
      'me',
    )
    return { loggedIn: true, displayName: me.displayName ?? me.name ?? me.email, demo: true }
  } catch {
    return { loggedIn: false, demo: true }
  }
}
