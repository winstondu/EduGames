import { describe, expect, test } from 'bun:test'
import { RATE_LIMITED_MESSAGE, rateLimit, type RateLimiter } from './ratelimit'

/** In-memory stand-in for the Workers RateLimit binding: `max` hits per key, forever. */
function fakeLimiter(max: number): RateLimiter & { keys: string[] } {
  const counts = new Map<string, number>()
  const keys: string[] = []
  return {
    keys,
    async limit({ key }) {
      keys.push(key)
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      return { success: n <= max }
    },
  }
}

function req(ip?: string): Request {
  return new Request('https://api.example.test/v1/x', {
    method: 'POST',
    headers: ip ? { 'CF-Connecting-IP': ip } : {},
  })
}

describe('rateLimit', () => {
  test('no binding → always allowed', async () => {
    for (let i = 0; i < 100; i++) expect(await rateLimit(undefined, req('1.2.3.4'), 's')).toBeNull()
  })

  test('over the limit → 429 with a friendly JSON error and Retry-After', async () => {
    const limiter = fakeLimiter(2)
    expect(await rateLimit(limiter, req('1.2.3.4'), 's')).toBeNull()
    expect(await rateLimit(limiter, req('1.2.3.4'), 's')).toBeNull()
    const res = await rateLimit(limiter, req('1.2.3.4'), 's')
    expect(res?.status).toBe(429)
    expect(res?.headers.get('retry-after')).toBe('60')
    expect((await res?.json()) as unknown).toEqual({ error: RATE_LIMITED_MESSAGE })
  })

  test('counts per client and per scope; keys never contain the raw IP', async () => {
    const limiter = fakeLimiter(1)
    expect(await rateLimit(limiter, req('1.2.3.4'), 'a')).toBeNull()
    expect(await rateLimit(limiter, req('5.6.7.8'), 'a')).toBeNull()
    expect(await rateLimit(limiter, req('1.2.3.4'), 'b')).toBeNull()
    expect((await rateLimit(limiter, req('1.2.3.4'), 'a'))?.status).toBe(429)
    expect(limiter.keys.some((k) => k.includes('1.2.3.4'))).toBe(false)
    expect(limiter.keys[0]).toMatch(/^a:[0-9a-f]{32}$/)
  })

  test('salt changes the key', async () => {
    const a = fakeLimiter(5)
    await rateLimit(a, req('1.2.3.4'), 's', 'salt-1')
    await rateLimit(a, req('1.2.3.4'), 's', 'salt-2')
    expect(a.keys[0]).not.toBe(a.keys[1])
  })

  test('a failing binding fails open', async () => {
    const broken: RateLimiter = {
      limit: () => Promise.reject(new Error('binding down')),
    }
    const origError = console.error
    console.error = () => {}
    try {
      expect(await rateLimit(broken, req('1.2.3.4'), 's')).toBeNull()
    } finally {
      console.error = origError
    }
  })
})
