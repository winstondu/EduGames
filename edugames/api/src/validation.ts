/**
 * Pure validation for the high-score API (no Workers/D1 APIs, so it runs under `bun test`).
 * Error strings are user-presentable; the client shows them as-is.
 */
import {
  BOARD_KEY_PATTERN,
  LEADERBOARD_DEFAULT_LIMIT,
  LEADERBOARD_MAX_LIMIT,
  MAX_POINTS_PER_SECOND,
  NAME_MAX_LENGTH,
} from '../../src/shared/highscores/types'

export const ID_PATTERN = /^[a-z0-9-]{1,32}$/
/** Letters (any script, incl. combining marks), digits, space, _ and -. */
const NAME_PATTERN = /^[\p{L}\p{M}\p{N} _-]+$/u
export const MAX_SCORE = 10_000_000
/** Score allowance on top of MAX_POINTS_PER_SECOND × seconds. */
export const SCORE_GRACE = 200
export const MIN_DURATION_MS = 1_000
export const MAX_DURATION_MS = 4 * 60 * 60 * 1_000
export const MAX_META_BYTES = 1_024
export const MAX_BODY_BYTES = 4_096
/** Accepted submissions per IP per rolling minute. */
export const RATE_LIMIT_PER_MINUTE = 10

export type Meta = Record<string, string | number | boolean>

/** A submission that passed validation, normalized for storage. */
export interface ValidSubmission {
  gameId: string
  generatorId: string
  boardKey: string
  name: string
  score: number
  durationMs: number
  meta: Meta | null
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Trim, NFC-normalize and collapse internal whitespace, then check the nickname rules. */
export function normalizeName(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return fail('Please enter a name.')
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim()
  const length = Array.from(name).length
  if (length === 0) return fail('Please enter a name.')
  if (length > NAME_MAX_LENGTH) return fail(`Names can be at most ${NAME_MAX_LENGTH} characters.`)
  if (!NAME_PATTERN.test(name)) return fail('Names can only use letters, numbers, spaces, _ and -.')
  return { ok: true, value: name }
}

function validateMeta(raw: unknown): Result<Meta | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) return fail('Invalid run details.')
  const meta: Meta = {}
  for (const [key, value] of Object.entries(raw)) {
    const t = typeof value
    if (t === 'string' || t === 'boolean' || (t === 'number' && Number.isFinite(value))) {
      meta[key] = value as string | number | boolean
    } else {
      return fail('Invalid run details.')
    }
  }
  if (Object.keys(meta).length === 0) return { ok: true, value: null }
  if (byteLength(JSON.stringify(meta)) > MAX_META_BYTES) return fail('Run details are too large.')
  return { ok: true, value: meta }
}

/** Validate a parsed POST /v1/scores body (ScoreSubmission). */
export function validateSubmission(body: unknown): Result<ValidSubmission> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail('Invalid score submission.')
  const b = body as Record<string, unknown>

  const { gameId, generatorId, boardKey, score, durationMs } = b
  if (typeof gameId !== 'string' || !ID_PATTERN.test(gameId)) return fail('Unknown game.')
  if (typeof generatorId !== 'string' || !ID_PATTERN.test(generatorId)) return fail('Unknown problem set.')
  if (typeof boardKey !== 'string' || !BOARD_KEY_PATTERN.test(boardKey) || !boardKey.startsWith(generatorId)) {
    return fail('Unknown leaderboard.')
  }

  const name = normalizeName(b.name)
  if (!name.ok) return name

  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return fail('Invalid run duration.')
  const duration = Math.round(durationMs)
  if (duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) return fail('Invalid run duration.')

  if (typeof score !== 'number' || !Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE) {
    return fail('Invalid score.')
  }
  if (score > maxPlausibleScore(duration)) return fail('That score is not possible in the time played.')

  const meta = validateMeta(b.meta)
  if (!meta.ok) return meta

  return {
    ok: true,
    value: { gameId, generatorId, boardKey, name: name.value, score, durationMs: duration, meta: meta.value },
  }
}

export function maxPlausibleScore(durationMs: number): number {
  return Math.floor((MAX_POINTS_PER_SECOND * durationMs) / 1000) + SCORE_GRACE
}

export interface LeaderboardQuery {
  gameId: string
  boardKey: string
  limit: number
}

/** Parse GET /v1/scores?game=&board=&limit= (limit defaults to 10, clamped to 1..50). */
export function parseLeaderboardQuery(params: URLSearchParams): Result<LeaderboardQuery> {
  const gameId = params.get('game') ?? ''
  const boardKey = params.get('board') ?? ''
  if (!ID_PATTERN.test(gameId)) return fail('Unknown game.')
  if (!BOARD_KEY_PATTERN.test(boardKey)) return fail('Unknown leaderboard.')
  const rawLimit = params.get('limit')
  let limit = LEADERBOARD_DEFAULT_LIMIT
  if (rawLimit !== null && rawLimit !== '') {
    if (!/^\d{1,4}$/.test(rawLimit)) return fail('Invalid limit.')
    limit = Math.min(LEADERBOARD_MAX_LIMIT, Math.max(1, Number(rawLimit)))
  }
  return { ok: true, value: { gameId, boardKey, limit } }
}
