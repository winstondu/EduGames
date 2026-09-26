/**
 * High-score API contract, shared by the API Worker (api/, served at
 * https://api.games.winstondu.com) and the browser client
 * (src/shared/highscores/client.ts, which prefixes API_BASE). One leaderboard per
 * (game, board) where `boardKey` comes from GeneratorPlugin.boardKey() —
 * e.g. "math/add-sub" or "kindermath/<lessonId>" (one board per lesson).
 *
 *   GET  /v1/scores?game=<gameId>&board=<boardKey>&limit=<1..50>  → LeaderboardResponse
 *   POST /v1/scores   body: ScoreSubmission                          → SubmitScoreResponse
 *
 * Errors: non-2xx with ApiError JSON. Nickname only — no accounts.
 */

export interface ScoreSubmission {
  /** e.g. "space-shooter". [a-z0-9-], ≤ 32 chars. */
  gameId: string
  /** Generator plugin id, e.g. "kindermath". [a-z0-9-], ≤ 32 chars. */
  generatorId: string
  /** [a-z0-9/_-], 1..96 chars, must start with `${generatorId}`. */
  boardKey: string
  /** Nickname: trimmed, 1..NAME_MAX_LENGTH chars of letters, digits, space, _ or -. */
  name: string
  score: number
  /** Wall-clock duration of the run in ms (used for plausibility checks). */
  durationMs: number
  /** Free-form run details (lanes, direction, level, board title). ≤ 1 KB JSON. */
  meta?: Record<string, string | number | boolean>
}

export interface ScoreEntry {
  id: number
  name: string
  score: number
  /** ISO-8601 UTC. */
  createdAt: string
  meta?: Record<string, string | number | boolean>
}

export interface LeaderboardResponse {
  gameId: string
  boardKey: string
  entries: ScoreEntry[]
}

export interface SubmitScoreResponse {
  entry: ScoreEntry
  /** 1-based rank on this game+board. */
  rank: number
}

export interface ApiError {
  error: string
}

export const NAME_MAX_LENGTH = 16
export const BOARD_KEY_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,95}$/
export const LEADERBOARD_DEFAULT_LIMIT = 10
export const LEADERBOARD_MAX_LIMIT = 50
/** Plausibility cap: score must be ≤ this × seconds played (+ a small grace). */
export const MAX_POINTS_PER_SECOND = 500
