import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import type { GeneratorManifest } from '../../../src/generators/types'
import { handleGeneratorRequest } from './index'
import { kindermathServer } from './kindermath'
import type { GeneratorEnv } from './types'

// Stub the kindermath server half so these tests cover only the hosting layer. spyOn (not
// mock.module, which leaks across test files in one bun process) and restore afterwards.
const seen: { subpath: string; method: string }[] = []
const handleSpy = spyOn(kindermathServer, 'handle').mockImplementation(async (request, subpath) => {
  seen.push({ subpath, method: request.method })
  return Response.json({ ok: true, subpath })
})
afterAll(() => handleSpy.mockRestore())
type BuiltManifest = import('./index').BuiltManifest

const built: BuiltManifest = {
  generators: [
    {
      id: 'math',
      name: 'Math',
      description: 'Arithmetic',
      kind: 'client',
      formats: ['freeform', 'multiple-choice'],
      version: 'aaaa111111',
      module: 'plugins/math.aaaa111111.js',
      source: 'src/generators/math/index.ts',
    },
    {
      id: 'kindermath',
      name: 'KinderMath',
      description: 'Lessons',
      kind: 'hybrid',
      formats: ['multiple-choice'],
      version: 'bbbb222222',
      module: 'plugins/kindermath.bbbb222222.js',
      source: 'src/generators/kindermath/index.ts',
    },
  ],
}

const assetRequests: string[] = []
function env(extra: Partial<GeneratorEnv> = {}, manifest: BuiltManifest | null = built): GeneratorEnv {
  return {
    ASSETS: {
      async fetch(input: Request | string | URL) {
        const url = new URL(input instanceof Request ? input.url : String(input))
        assetRequests.push(url.pathname)
        if (url.pathname === '/plugins/manifest.json' && manifest) return Response.json(manifest)
        return new Response('not found', { status: 404 })
      },
      connect() {
        throw new Error('unused')
      },
    } as unknown as Fetcher,
    ...extra,
  }
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext
const API = 'https://api.games.winstondu.com'
/** Response body as plain JSON (sidesteps bun vs workers-types json() typings). */
const body = async (res: Response): Promise<unknown> => res.json()
const call = (path: string, e = env(), init?: RequestInit) => handleGeneratorRequest(new Request(API + path, init), e, ctx)

describe('GET /v1/generators', () => {
  test('prod: entries are absolute bundle URLs on the request origin', async () => {
    const res = await call('/v1/generators')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    const manifest = (await body(res)) as GeneratorManifest
    expect(manifest.generators).toEqual([
      {
        id: 'math',
        name: 'Math',
        description: 'Arithmetic',
        kind: 'client',
        formats: ['freeform', 'multiple-choice'],
        version: 'aaaa111111',
        entry: `${API}/plugins/math.aaaa111111.js`,
      },
      {
        id: 'kindermath',
        name: 'KinderMath',
        description: 'Lessons',
        kind: 'hybrid',
        formats: ['multiple-choice'],
        version: 'bbbb222222',
        entry: `${API}/plugins/kindermath.bbbb222222.js`,
      },
    ])
    expect(assetRequests.at(-1)).toBe('/plugins/manifest.json')
  })

  test('local wrangler dev: entries follow the request origin', async () => {
    const res = await handleGeneratorRequest(new Request('http://localhost:8788/v1/generators/'), env(), ctx)
    const manifest = (await body(res)) as GeneratorManifest
    expect(manifest.generators[0].entry).toBe('http://localhost:8788/plugins/math.aaaa111111.js')
  })

  test('dev: entries point at the Vite dev server sources', async () => {
    const res = await call('/v1/generators', env({ GENERATORS_DEV_ORIGIN: 'http://localhost:5173/' }))
    expect(res.headers.get('cache-control')).toBe('no-store')
    const manifest = (await body(res)) as GeneratorManifest
    expect(manifest.generators.map((g) => g.entry)).toEqual([
      'http://localhost:5173/src/generators/math/index.ts',
      'http://localhost:5173/src/generators/kindermath/index.ts',
    ])
    expect(manifest.generators[0]).not.toHaveProperty('module')
    expect(manifest.generators[0]).not.toHaveProperty('source')
  })

  test('503 when the manifest has not been built', async () => {
    const res = await call('/v1/generators', env({}, null))
    expect(res.status).toBe(503)
    expect(((await body(res)) as { error: string }).error).toContain('generators:build')
  })

  test('405 for non-GET', async () => {
    const res = await call('/v1/generators', env(), { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })
})

describe('/v1/generators/<id>/<subpath>', () => {
  test('dispatches to the server half with the subpath', async () => {
    const res = await call('/v1/generators/kindermath/lessons/abc/practice?n=5')
    expect(res.status).toBe(200)
    expect(await body(res)).toEqual({ ok: true, subpath: 'lessons/abc/practice' })
    const res2 = await call('/v1/generators/kindermath/auth/login', env(), { method: 'POST', body: '{}' })
    expect(await body(res2)).toEqual({ ok: true, subpath: 'auth/login' })
    expect(seen.at(-1)).toEqual({ subpath: 'auth/login', method: 'POST' })
  })

  test('bare /v1/generators/<id> dispatches with an empty subpath', async () => {
    const res = await call('/v1/generators/kindermath')
    expect(await body(res)).toEqual({ ok: true, subpath: '' })
  })

  test('404 JSON for unknown ids, client-only plugins and prototype keys', async () => {
    for (const path of [
      '/v1/generators/nope/x',
      '/v1/generators/math/anything',
      '/v1/generators/constructor/x',
      '/v1/generators/Kindermath/x',
      '/v1/other',
    ]) {
      const res = await call(path)
      expect(res.status).toBe(404)
      expect(await body(res)).toEqual({ error: 'unknown generator' })
    }
  })
})
