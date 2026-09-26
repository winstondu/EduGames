/**
 * Per-step engine invariants for soak tests and the simulator (DEV ONLY).
 * Feed it every (events, state) pair — e.g. via `harness.subscribe` or
 * runReplay's `onTick`.
 */
import { CHECK_TIMEOUT_SECONDS, MAX_LIVES, STEP_SECONDS, type GameEvent, type GameState } from '../engine/types'

/** Slack on the check timeout (a verdict may land on the step after the deadline). */
const PENDING_SLACK_SECONDS = 3 * STEP_SECONDS
/** Distinct violation messages kept (the total is still counted). */
const MAX_KEPT = 20

export interface InvariantChecker {
  observe(events: GameEvent[], state: GameState): void
  /** Violation messages (first MAX_KEPT). */
  readonly violations: string[]
  readonly count: number
  /** Record an externally detected violation (e.g. a check that never settled). */
  fail(message: string): void
}

export function createInvariantChecker(): InvariantChecker {
  const violations: string[] = []
  let count = 0
  let lastScore = 0
  /** asteroid id → [time it went pending, x at that moment]. */
  const pendingSince = new Map<number, { time: number; x: number; reported: boolean }>()

  function fail(message: string): void {
    count++
    if (violations.length < MAX_KEPT) violations.push(message)
  }

  function finite(value: number, what: string, t: number): void {
    if (!Number.isFinite(value)) fail(`t=${t.toFixed(2)}: ${what} is ${value}`)
  }

  return {
    get violations() {
      return violations
    },
    get count() {
      return count
    },
    fail,
    observe(_events, s) {
      const t = s.time
      if (!Number.isInteger(s.lives) || s.lives < 0 || s.lives > MAX_LIVES) fail(`t=${t.toFixed(2)}: lives ${s.lives} outside 0..${MAX_LIVES}`)
      if (s.score < lastScore) fail(`t=${t.toFixed(2)}: score decreased ${lastScore} → ${s.score}`)
      lastScore = s.score
      finite(t, 'time', t)
      finite(s.ship.laneY, 'ship.laneY', t)
      for (const b of s.bolts) finite(b.x, `bolt ${b.id} x`, t)
      for (const p of s.powerups) finite(p.x, `powerup ${p.id} x`, t)
      const seen = new Set<number>()
      for (const a of s.asteroids) {
        finite(a.x, `asteroid ${a.id} x`, t)
        finite(a.speed, `asteroid ${a.id} speed`, t)
        if (!a.pending) continue
        seen.add(a.id)
        if (a.speed !== 0) fail(`t=${t.toFixed(2)}: asteroid ${a.id} pending with speed ${a.speed}`)
        const since = pendingSince.get(a.id)
        if (!since) {
          pendingSince.set(a.id, { time: t, x: a.x, reported: false })
          continue
        }
        if (a.x !== since.x) fail(`t=${t.toFixed(2)}: asteroid ${a.id} moved while pending`)
        if (!since.reported && t - since.time > CHECK_TIMEOUT_SECONDS + PENDING_SLACK_SECONDS) {
          since.reported = true
          fail(`t=${t.toFixed(2)}: asteroid ${a.id} pending for ${(t - since.time).toFixed(2)} s`)
        }
      }
      for (const id of pendingSince.keys()) if (!seen.has(id)) pendingSince.delete(id)
    },
  }
}
