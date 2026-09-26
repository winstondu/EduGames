/**
 * /v1/scores on D1 — implements src/shared/highscores/types.ts.
 *   GET  ?game=&board=&limit=  → LeaderboardResponse (score desc, oldest first on ties)
 *   POST ScoreSubmission       → SubmitScoreResponse (rank = 1 + strictly higher scores)
 * Game-agnostic: any gameId/boardKey that passes validation gets its own board.
 */
import type {
  ApiError,
  LeaderboardResponse,
  ScoreEntry,
  SubmitScoreResponse,
} from '../../src/shared/highscores/types'
import type { Env } from './index'
import {
  byteLength,
  MAX_BODY_BYTES,
  parseLeaderboardQuery,
  RATE_LIMIT_PER_MINUTE,
  validateSubmission,
  type Meta,
} from './validation'

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  const res = new Response(JSON.stringify(body), { status, headers })
  res.headers.set('Content-Type', 'application/json; charset=utf-8')
  if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'no-store')
  return res
}

export function errorResponse(error: string, status: number, headers?: HeadersInit): Response {
  return jsonResponse({ error } satisfies ApiError, status, headers)
}

export async function handleScores(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET' || request.method === 'HEAD') return getLeaderboard(request, env)
  if (request.method === 'POST') return submitScore(request, env)
  return errorResponse('Method not allowed.', 405, { Allow: 'GET, HEAD, POST, OPTIONS' })
}

interface ScoreRow {
  id: number
  name: string
  score: number
  meta: string | null
  created_at: string
}

async function getLeaderboard(request: Request, env: Env): Promise<Response> {
  const query = parseLeaderboardQuery(new URL(request.url).searchParams)
  if (!query.ok) return errorResponse(query.error, 400)
  const { gameId, boardKey, limit } = query.value
  const { results } = await env.DB.prepare(
    `SELECT id, name, score, meta, created_at FROM scores
     WHERE game_id = ?1 AND board_key = ?2
     ORDER BY score DESC, created_at ASC, id ASC
     LIMIT ?3`,
  )
    .bind(gameId, boardKey, limit)
    .all<ScoreRow>()
  const body: LeaderboardResponse = { gameId, boardKey, entries: results.map(toEntry) }
  return jsonResponse(body)
}

async function submitScore(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!/^application\/json\b/i.test(contentType)) return errorResponse('Expected a JSON body.', 415)
  const declared = Number(request.headers.get('Content-Length') ?? 0)
  if (declared > MAX_BODY_BYTES) return errorResponse('Submission is too large.', 413)
  const text = await request.text()
  if (byteLength(text) > MAX_BODY_BYTES) return errorResponse('Submission is too large.', 413)

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return errorResponse('Invalid score submission.', 400)
  }
  const parsed = validateSubmission(payload)
  if (!parsed.ok) return errorResponse(parsed.error, 400)
  const s = parsed.value

  const ipHash = await hashIp(request.headers.get('CF-Connecting-IP') ?? 'unknown', env.IP_HASH_SALT ?? '')
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM scores WHERE ip_hash = ?1 AND created_at > datetime('now', '-60 seconds')`,
  )
    .bind(ipHash)
    .first<number>('n')
  if ((recent ?? 0) >= RATE_LIMIT_PER_MINUTE) {
    return errorResponse('Too many scores submitted. Please wait a minute and try again.', 429, {
      'Retry-After': '60',
    })
  }

  const row = await env.DB.prepare(
    `INSERT INTO scores (game_id, generator_id, board_key, name, score, duration_ms, meta, ip_hash)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     RETURNING id, name, score, meta, created_at`,
  )
    .bind(s.gameId, s.generatorId, s.boardKey, s.name, s.score, s.durationMs, s.meta ? JSON.stringify(s.meta) : null, ipHash)
    .first<ScoreRow>()
  if (!row) return errorResponse('Could not save your score. Please try again.', 500)

  const higher = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM scores WHERE game_id = ?1 AND board_key = ?2 AND score > ?3',
  )
    .bind(s.gameId, s.boardKey, s.score)
    .first<number>('n')

  const body: SubmitScoreResponse = { entry: toEntry(row), rank: 1 + (higher ?? 0) }
  return jsonResponse(body, 201)
}

function toEntry(row: ScoreRow): ScoreEntry {
  const entry: ScoreEntry = { id: row.id, name: row.name, score: row.score, createdAt: toIsoUtc(row.created_at) }
  const meta = parseMeta(row.meta)
  if (meta) entry.meta = meta
  return entry
}

/** SQLite CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC) → ISO-8601 with Z. */
export function toIsoUtc(sqlite: string): string {
  return /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(sqlite) ? `${sqlite.replace(' ', 'T')}Z` : sqlite
}

function parseMeta(raw: string | null): Meta | undefined {
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Meta) : undefined
  } catch {
    return undefined
  }
}

/** Salted SHA-256 of the client IP, truncated — never store raw IPs. */
async function hashIp(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`))
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
}
