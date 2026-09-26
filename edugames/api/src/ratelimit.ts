/**
 * Per-client rate limiting for routes that reach an upstream uncached (answer checks, session probes).
 *
 * Backed by the Workers Rate Limiting binding (`ratelimits` in api/wrangler.jsonc; also simulated
 * locally by `wrangler dev`). Counters live in Cloudflare, not in D1, so a limited request costs no
 * database write. The binding is approximate and per-location, which is fine for an abuse guard.
 *
 * Graceful fallback: when the binding is absent (unit tests, an env without `ratelimits`) or the
 * call throws, the request is allowed — the guard must never take a route down on its own.
 */

/** Minimal shape of the Workers `RateLimit` binding (kept local so tests can pass a fake). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export const RATE_LIMITED_MESSAGE = 'Too many requests. Please slow down and try again in a minute.'

/** Salted SHA-256 of the client IP, truncated — raw IPs are never stored or used as keys. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`))
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Client identity for rate limiting: the Cloudflare-provided connecting IP ('unknown' locally). */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

/**
 * Count one request for (`scope`, client) against `limiter`. Returns a 429 JSON response when the
 * client is over the limit, or null to proceed.
 */
export async function rateLimit(
  limiter: RateLimiter | undefined,
  request: Request,
  scope: string,
  salt = '',
): Promise<Response | null> {
  if (!limiter) return null
  try {
    const key = `${scope}:${await hashIp(clientIp(request), salt)}`
    const { success } = await limiter.limit({ key })
    if (success) return null
  } catch (err) {
    console.error('rate limiter failed; allowing request', scope, err)
    return null
  }
  return new Response(JSON.stringify({ error: RATE_LIMITED_MESSAGE }), {
    status: 429,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '60',
    },
  })
}
