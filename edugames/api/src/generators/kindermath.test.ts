import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { kindermathServer, resetDemoSession } from './kindermath'
import type { GeneratorEnv } from './types'

// --- test doubles -----------------------------------------------------------

const env = {
  KINDERMATH_API_BASE: 'https://api.kindermath.org/v1',
  KINDERMATH_DEV_USER_EMAIL: 'teacher@demo-academy.test',
  KINDERMATH_DEMO_PASSWORD: 'test-password',
} as unknown as GeneratorEnv

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

interface FetchCall {
  url: string
  init?: RequestInit
}

let calls: FetchCall[] = []
type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>
let responder: Responder = () => new Response('{}', { status: 200 })
/** When true, demo logins are answered automatically and not recorded in `calls`. */
let autoLogin = true

const realFetch = globalThis.fetch
const realCaches = (globalThis as { caches?: unknown }).caches

beforeEach(() => {
  calls = []
  autoLogin = true
  resetDemoSession()
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (autoLogin && url.endsWith('/auth/login')) {
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'set-cookie': 'km_session=auto; Path=/' } }))
    }
    calls.push({ url, init })
    return Promise.resolve(responder(url, init))
  }) as typeof fetch
  // No-op edge cache so caching paths are exercised without a real Cache.
  ;(globalThis as unknown as { caches: unknown }).caches = {
    default: { match: async () => undefined, put: async () => {} },
  }
})

afterEach(() => {
  globalThis.fetch = realFetch
  ;(globalThis as unknown as { caches?: unknown }).caches = realCaches
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function call(method: string, subpath: string, body?: unknown): Promise<Response> {
  const req = new Request(`https://api.games.winstondu.com/v1/generators/kindermath/${subpath}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return kindermathServer.handle(req, subpath, env, ctx)
}

/** res.json() typed — workers-types returns `unknown`, which trips matcher inference. */
function readBody<T = Record<string, unknown>>(res: Response): Promise<T> {
  return res.json() as Promise<T>
}

// --- routing ----------------------------------------------------------------

describe('routing', () => {
  test('GET courses passes through', async () => {
    responder = () => jsonResponse([{ slug: 'intro-algebra-1' }])
    const res = await call('GET', 'courses')
    expect(res.status).toBe(200)
    expect(await readBody<{ slug: string }[]>(res)).toEqual([{ slug: 'intro-algebra-1' }])
    expect(calls[0].url).toBe('https://api.kindermath.org/v1/courses')
  })

  test('GET courses/:slug', async () => {
    responder = () => jsonResponse({ slug: 'intro-algebra-1', units: [] })
    const res = await call('GET', 'courses/intro-algebra-1')
    expect(res.status).toBe(200)
    expect(calls[0].url).toBe('https://api.kindermath.org/v1/courses/intro-algebra-1')
  })

  test('GET lessons/:id', async () => {
    const id = 'a6e6d424-ebc2-4607-99cf-c52808e3dd8f'
    responder = () => jsonResponse({ id, title: 'Variables & terms' })
    const res = await call('GET', `lessons/${id}`)
    expect(res.status).toBe(200)
    expect((await readBody<{ title: string }>(res)).title).toBe('Variables & terms')
  })

  test('unknown path → 404', async () => {
    const res = await call('GET', 'nope')
    expect(res.status).toBe(404)
  })

  test('wrong method on a known path → 405', async () => {
    const res = await call('DELETE', 'courses')
    expect(res.status).toBe(405)
  })
})

// --- validation -------------------------------------------------------------

describe('validation', () => {
  test('bad slug → 400, no upstream call', async () => {
    const res = await call('GET', 'courses/Bad_Slug!')
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test('bad lesson uuid → 400', async () => {
    const res = await call('GET', 'lessons/not-a-uuid')
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test('check rejects a non-uuid questionId', async () => {
    const res = await call('POST', 'check', { questionId: 'x', given: 'a' })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test('check rejects a missing given', async () => {
    const id = 'a6e6d424-ebc2-4607-99cf-c52808e3dd8f'
    const res = await call('POST', 'check', { questionId: id })
    expect(res.status).toBe(400)
  })

  test('oversized body → 400', async () => {
    const id = 'a6e6d424-ebc2-4607-99cf-c52808e3dd8f'
    const res = await call('POST', 'check', { questionId: id, given: 'x'.repeat(5000) })
    expect(res.status).toBe(400)
  })
})

// --- pool union -------------------------------------------------------------

describe('question pool', () => {
  test('unions random subsets by id across pulls', async () => {
    const id = 'a6e6d424-ebc2-4607-99cf-c52808e3dd8f'
    const batches = [
      [{ id: 'q1', kind: 'MCQ', prompt: 'a' }, { id: 'q2', kind: 'TYPED', prompt: 'b' }],
      [{ id: 'q2', kind: 'TYPED', prompt: 'b' }, { id: 'q3', kind: 'MCQ', prompt: 'c' }],
      [{ id: 'q3', kind: 'MCQ', prompt: 'c' }, { id: 'q4', kind: 'TYPED', prompt: 'd' }],
      [{ id: 'q1', kind: 'MCQ', prompt: 'a' }],
    ]
    let i = 0
    responder = () => jsonResponse(batches[i++] ?? [])
    const res = await call('GET', `lessons/${id}/questions`)
    expect(res.status).toBe(200)
    const pool = await readBody<{ id: string }[]>(res)
    expect(pool.map((q) => q.id).sort()).toEqual(['q1', 'q2', 'q3', 'q4'])
    expect(calls).toHaveLength(4)
    expect(calls[0].url).toBe(`https://api.kindermath.org/v1/lessons/${id}/practice`)
  })
})

// --- check path -------------------------------------------------------------

describe('check', () => {
  const id = 'a6e6d424-ebc2-4607-99cf-c52808e3dd8f'

  test('forwards to /attempts with PRACTICE context and trims the response', async () => {
    responder = (_url, init) => {
      const sent = JSON.parse(String(init?.body))
      expect(sent).toEqual({ questionId: id, given: 'b', context: 'PRACTICE' })
      return jsonResponse({ correct: true, explanation: 'nice', masteryLevel: 2, newBadges: [] })
    }
    const res = await call('POST', 'check', { questionId: id, given: 'b' })
    expect(res.status).toBe(200)
    expect(await readBody<{ correct: boolean; explanation?: string }>(res)).toEqual({
      correct: true,
      explanation: 'nice',
    })
    expect(calls[0].url).toBe('https://api.kindermath.org/v1/attempts')
    expect(calls[0].init?.method).toBe('POST')
  })

  test('coerces missing correct to false', async () => {
    responder = () => jsonResponse({ masteryLevel: 0 })
    const res = await call('POST', 'check', { questionId: id, given: 'b' })
    expect((await readBody<{ correct: boolean }>(res)).correct).toBe(false)
  })
})

// --- identity + error mapping ----------------------------------------------

describe('upstream identity and errors', () => {
  test('logs in as the demo account and sends only its session cookie upstream', async () => {
    autoLogin = false
    responder = (url) =>
      url.endsWith('/auth/login')
        ? new Response('{}', { status: 200, headers: { 'set-cookie': 'km_session=abc123; Path=/; HttpOnly; Secure' } })
        : jsonResponse([])
    const req = new Request(
      'https://api.games.winstondu.com/v1/generators/kindermath/courses',
      { headers: { cookie: 'session=secret', 'x-dev-user-email': 'attacker@evil.test' } },
    )
    const res = await kindermathServer.handle(req, 'courses', env, ctx)
    expect(calls[0].url).toBe('https://api.kindermath.org/v1/auth/login')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ email: 'teacher@demo-academy.test', password: 'test-password' })
    const headers = calls[1].init?.headers as Record<string, string>
    expect(headers['cookie']).toBe('km_session=abc123')
    expect(headers['x-dev-user-email']).toBeUndefined()
    expect(res.headers.get('set-cookie')).toBeNull()
    // Session is reused on the next request.
    await kindermathServer.handle(new Request(req.url), 'courses/intro-algebra-1', env, ctx)
    expect(calls.filter((c) => c.url.endsWith('/auth/login'))).toHaveLength(1)
  })

  test('re-logs in once on 401, then retries', async () => {
    autoLogin = false
    let logins = 0
    let lessonCalls = 0
    responder = (url) => {
      if (url.endsWith('/auth/login')) {
        logins++
        return new Response('{}', { status: 200, headers: { 'set-cookie': `km_session=s${logins}; Path=/` } })
      }
      lessonCalls++
      return lessonCalls === 1 ? new Response('unauth', { status: 401 }) : jsonResponse({ id: 'x', title: 'T' })
    }
    const res = await call('GET', 'lessons/a6e6d424-ebc2-4607-99cf-c52808e3dd8f')
    expect(res.status).toBe(200)
    expect(logins).toBe(2)
    const last = calls[calls.length - 1].init?.headers as Record<string, string>
    expect(last['cookie']).toBe('km_session=s2')
  })

  test('failed demo login → 502', async () => {
    autoLogin = false
    responder = (url) => (url.endsWith('/auth/login') ? new Response('bad creds', { status: 401 }) : jsonResponse([]))
    const res = await call('GET', 'courses')
    expect(res.status).toBe(502)
  })

  test('upstream non-2xx → 502', async () => {
    responder = () => new Response('nope', { status: 500 })
    const res = await call('GET', 'courses')
    expect(res.status).toBe(502)
  })

  test('upstream network failure → 502', async () => {
    responder = () => {
      throw new Error('boom')
    }
    const res = await call('GET', 'courses')
    expect(res.status).toBe(502)
  })

  test('session reports demo even when upstream /me is unauthorized', async () => {
    responder = () => new Response('unauth', { status: 401 })
    const res = await call('GET', 'session')
    expect(res.status).toBe(200)
    expect(await readBody<{ loggedIn: boolean; demo: boolean }>(res)).toEqual({
      loggedIn: false,
      demo: true,
    })
  })

  test('login is a demo stub', async () => {
    responder = () => new Response('unauth', { status: 401 })
    const res = await call('POST', 'login', { email: 'x@y.z', password: 'p' })
    const parsed = await readBody<{ demo: boolean; message: string }>(res)
    expect(parsed.demo).toBe(true)
    expect(parsed.message).toContain('demo')
  })
})
