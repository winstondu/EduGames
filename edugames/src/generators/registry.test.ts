import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { API_BASE } from '../shared/apiBase'
import {
  createGeneratorContext,
  fetchManifest,
  loadGenerator,
  resetGeneratorRegistry,
} from './registry'
import type { GeneratorManifest, GeneratorManifestEntry, GeneratorPlugin } from './types'

const realFetch = globalThis.fetch
let calls: { url: string; init?: RequestInit }[] = []

function entry(id: string, url: string): GeneratorManifestEntry {
  return { id, name: id, description: '', kind: 'client', formats: ['freeform'], version: 'abc', entry: url }
}

function serve(manifest: GeneratorManifest | (() => Response)) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return typeof manifest === 'function' ? manifest() : Response.json(manifest)
  }) as typeof fetch
}

/** Register a fake plugin module at `url` (bun intercepts the dynamic import). */
function fakeModule(url: string, plugin: object) {
  mock.module(url, () => ({ default: plugin }))
}

const plugin = (id: string) => ({ id, create: async () => ({}) }) as unknown as GeneratorPlugin

beforeEach(() => {
  calls = []
  resetGeneratorRegistry()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('fetchManifest', () => {
  test('fetches <API_BASE>/v1/generators once and memoizes', async () => {
    serve({ generators: [] })
    const [a, b] = await Promise.all([fetchManifest(), fetchManifest()])
    expect(a).toBe(b)
    expect(calls.map((c) => c.url)).toEqual([`${API_BASE}/v1/generators`])
  })

  test('forgets failures so the next call retries', async () => {
    serve(() => new Response('nope', { status: 503 }))
    await expect(fetchManifest()).rejects.toThrow('HTTP 503')
    serve({ generators: [] })
    expect(await fetchManifest()).toEqual({ generators: [] })
    expect(calls).toHaveLength(2)
  })

  test('rejects a malformed manifest', async () => {
    serve(() => Response.json({ nope: true }))
    await expect(fetchManifest()).rejects.toThrow('Malformed')
  })
})

describe('loadGenerator', () => {
  test('imports an API-origin entry and returns its default export', async () => {
    const url = `${API_BASE}/plugins/alpha.1111.js`
    const alpha = plugin('alpha')
    fakeModule(url, alpha)
    serve({ generators: [entry('alpha', url)] })
    expect(await loadGenerator('alpha')).toBe(alpha)
    expect(await loadGenerator('alpha')).toBe(alpha)
    expect(calls).toHaveLength(1)
  })

  test('returns null for ids not in the manifest', async () => {
    serve({ generators: [] })
    expect(await loadGenerator('missing')).toBeNull()
  })

  test('refuses entries on a foreign origin', async () => {
    const url = 'https://evil.example.com/plugins/beta.2222.js'
    fakeModule(url, plugin('beta'))
    serve({ generators: [entry('beta', url)] })
    await expect(loadGenerator('beta')).rejects.toThrow('untrusted origin https://evil.example.com')
  })

  test('refuses a look-alike host and non-http schemes', async () => {
    serve({
      generators: [
        entry('gamma', `${API_BASE}.evil.example.com/plugins/gamma.js`),
        entry('delta', 'data:text/javascript,export default {id:"delta"}'),
        entry('eps', 'not a url'),
      ],
    })
    await expect(loadGenerator('gamma')).rejects.toThrow('untrusted origin')
    await expect(loadGenerator('delta')).rejects.toThrow('untrusted origin')
    await expect(loadGenerator('eps')).rejects.toThrow('invalid module URL')
  })

  test('refuses page-origin entries outside dev', async () => {
    const url = 'http://localhost:5173/src/generators/zeta/index.ts'
    fakeModule(url, plugin('zeta'))
    serve({ generators: [entry('zeta', url)] })
    await expect(loadGenerator('zeta')).rejects.toThrow('untrusted origin')
  })

  test('allows page-origin entries in dev', async () => {
    const url = 'http://localhost:5173/src/generators/eta/index.ts'
    const eta = plugin('eta')
    fakeModule(url, eta)
    serve({ generators: [entry('eta', url)] })
    const env = import.meta.env as Record<string, unknown>
    const g = globalThis as { location?: unknown }
    env.DEV = true
    g.location = { origin: 'http://localhost:5173' }
    try {
      expect(await loadGenerator('eta')).toBe(eta)
    } finally {
      delete env.DEV
      delete g.location
    }
  })

  test('rejects a module whose plugin id does not match', async () => {
    const url = `${API_BASE}/plugins/theta.3333.js`
    fakeModule(url, plugin('someone-else'))
    serve({ generators: [entry('theta', url)] })
    await expect(loadGenerator('theta')).rejects.toThrow('declares id "someone-else"')
  })

  test('rejects a module without a plugin default export', async () => {
    const url = `${API_BASE}/plugins/iota.4444.js`
    fakeModule(url, { id: 'iota' })
    serve({ generators: [entry('iota', url)] })
    await expect(loadGenerator('iota')).rejects.toThrow('no plugin default export')
  })
})

describe('createGeneratorContext', () => {
  test('scopes api() to the plugin server half with credentials and the session signal', async () => {
    serve(() => new Response('ok'))
    const controller = new AbortController()
    const ctx = createGeneratorContext('kindermath', 42, controller.signal)
    await ctx.api('lessons/abc/practice')
    await ctx.api('/auth/login', { method: 'POST', body: '{}' })
    expect(calls[0].url).toBe(`${API_BASE}/v1/generators/kindermath/lessons/abc/practice`)
    expect(calls[0].init?.credentials).toBe('include')
    expect(calls[0].init?.signal).toBe(controller.signal)
    expect(calls[1].url).toBe(`${API_BASE}/v1/generators/kindermath/auth/login`)
    expect(calls[1].init?.method).toBe('POST')
    expect(ctx.signal).toBe(controller.signal)
  })

  test('a plugin-supplied signal still aborts with the session', async () => {
    serve(() => new Response('ok'))
    const session = new AbortController()
    const ctx = createGeneratorContext('x', 1, session.signal)
    await ctx.api('p', { signal: new AbortController().signal })
    const signal = calls[0].init?.signal as AbortSignal
    expect(signal.aborted).toBe(false)
    session.abort()
    expect(signal.aborted).toBe(true)
  })

  test('rng is seeded', () => {
    const signal = new AbortController().signal
    const a = createGeneratorContext('x', 7, signal).rng
    const b = createGeneratorContext('x', 7, signal).rng
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})
