/**
 * Browser client for the high-score API (contract: ./types.ts). Game-agnostic.
 * Failures reject with a HighScoreError whose `message` can be shown to players
 * (aborts via `signal` reject with the usual AbortError instead).
 */
import { API_BASE } from '../apiBase'
import { isUnrecorded } from '../unrecorded'
import type {
  ApiError,
  LeaderboardResponse,
  ScoreSubmission,
  SubmitScoreResponse,
} from './types'

export type HighScoreErrorKind =
  /** Couldn't reach the server (offline, DNS, CORS, aborted). */
  | 'network'
  /** The server rejected the request (validation); message comes from the server. */
  | 'invalid'
  /** Too many submissions; retry after a minute. */
  | 'rate-limited'
  /** 5xx or an unreadable response. */
  | 'server'
  /** The hidden unrecorded flag is on (harness / automated play); nothing was sent. */
  | 'unrecorded'

export class HighScoreError extends Error {
  override name = 'HighScoreError'
  readonly kind: HighScoreErrorKind
  /** HTTP status, when a response arrived. */
  readonly status?: number

  constructor(kind: HighScoreErrorKind, message: string, status?: number) {
    super(message)
    this.kind = kind
    this.status = status
  }
}

export interface RequestOptions {
  signal?: AbortSignal
}

/** Top scores for one game + board (default 10, max 50), best first. */
export function fetchLeaderboard(
  gameId: string,
  boardKey: string,
  limit?: number,
  options: RequestOptions = {},
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams({ game: gameId, board: boardKey })
  if (limit !== undefined) params.set('limit', String(limit))
  return request<LeaderboardResponse>(`/v1/scores?${params}`, { method: 'GET', signal: options.signal })
}

/** Submit a finished run; resolves with the saved entry and its 1-based rank. */
export function submitScore(submission: ScoreSubmission, options: RequestOptions = {}): Promise<SubmitScoreResponse> {
  // Last line of defense: games hide the prompt too, but never let an unrecorded run reach a board.
  if (isUnrecorded()) return Promise.reject(new HighScoreError('unrecorded', "This run isn't recorded."))
  return request<SubmitScoreResponse>('/v1/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission),
    signal: options.signal,
  })
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new HighScoreError('network', "Couldn't reach the high-score server. Check your connection and try again.")
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Non-JSON (e.g. a proxy error page); handled below.
  }

  if (res.ok && body !== null) return body as T

  const serverMessage =
    body && typeof body === 'object' && typeof (body as ApiError).error === 'string' ? (body as ApiError).error : null
  if (res.status === 429) {
    throw new HighScoreError(
      'rate-limited',
      serverMessage ?? 'Too many scores submitted. Please wait a minute and try again.',
      res.status,
    )
  }
  if (res.status >= 400 && res.status < 500) {
    throw new HighScoreError('invalid', serverMessage ?? 'The high-score server rejected that request.', res.status)
  }
  throw new HighScoreError('server', 'The high-score server is having trouble. Please try again later.', res.status)
}
