/**
 * High-score API contract, shared by the Worker (worker/) and the browser
 * client (src/shared/highscores/client.ts).
 *
 *   GET  /api/scores?game=<gameId>&gen=<generatorId>&limit=<1..50>  → LeaderboardResponse
 *   POST /api/scores  body: ScoreSubmission                          → SubmitScoreResponse
 *
 * Errors: non-2xx with ApiError JSON.
 */

export interface ScoreSubmission {
  /** e.g. "space-shooter". [a-z0-9-], ≤ 32 chars. */
  gameId: string
  /** Generator plugin id, e.g. "math". [a-z0-9-], ≤ 32 chars. */
  generatorId: string
  /** Nickname: trimmed, 1..NAME_MAX_LENGTH chars of letters, digits, space, _ or -. */
  name: string
  score: number
  /** Wall-clock duration of the run in ms (used for plausibility checks). */
  durationMs: number
  /** Free-form run details (lanes, direction, answerMode, level, generator options). ≤ 1 KB JSON. */
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
  generatorId: string
  entries: ScoreEntry[]
}

export interface SubmitScoreResponse {
  entry: ScoreEntry
  /** 1-based rank on this game+generator board. */
  rank: number
}

export interface ApiError {
  error: string
}

export const NAME_MAX_LENGTH = 16
export const LEADERBOARD_DEFAULT_LIMIT = 10
export const LEADERBOARD_MAX_LIMIT = 50
/** Plausibility cap: score must be ≤ this × seconds played (+ a small grace). */
export const MAX_POINTS_PER_SECOND = 500
