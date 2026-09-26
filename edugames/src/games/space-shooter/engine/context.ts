/**
 * Internal engine context shared by the engine modules. Not part of the
 * public contract: hosts only see `Engine` (engine/types.ts).
 */
import type { Rng } from '../../../shared/rng'
import { MAX_LANES, MIN_LANES, START_LIVES, type GameConfig, type GameEvent, type GameState } from './types'

/** A `checkRequested` awaiting its `resolveCheck`. */
export interface PendingCheck {
  checkId: number
  asteroidId: number
  given: string
  display: string
  /** Asteroid speed to restore if the shot is voided or wrong. */
  speed: number
  /** `state.time` when the check was requested (timeouts count play time only). */
  requestedAt: number
}

export interface EngineContext {
  config: GameConfig
  state: GameState
  rng: Rng
  /** Events produced by the command / step in progress. */
  events: GameEvent[]
  checks: Map<number, PendingCheck>
  nextEntityId: number
  nextCheckId: number
  /** Seconds until the next asteroid spawn attempt. */
  spawnTimer: number
  /** Seconds until the next powerup spawn attempt. */
  powerupTimer: number
}

export function clampLanes(lanes: number): number {
  const n = Math.round(Number.isFinite(lanes) ? lanes : MIN_LANES)
  return Math.min(MAX_LANES, Math.max(MIN_LANES, n))
}

export function createInitialState(config: GameConfig): GameState {
  const lanes = clampLanes(config.lanes)
  const lane = Math.floor(lanes / 2)
  return {
    status: 'playing',
    time: 0,
    score: 0,
    lives: START_LIVES,
    level: 1,
    streak: 0,
    bestStreak: 0,
    correct: 0,
    wrong: 0,
    lanes,
    ship: { lane, laneY: lane, invulnerable: 0 },
    asteroids: [],
    bolts: [],
    powerups: [],
    effects: [],
    shield: 0,
    targetId: null,
    inputMode: null,
    choices: [],
    quiver: '',
    input: config.defaultInput,
    revision: 0,
  }
}

export function emit(ctx: EngineContext, event: GameEvent): void {
  ctx.events.push(event)
}

/** Mark a HUD-relevant change. */
export function touch(ctx: EngineContext): void {
  ctx.state.revision++
}

export function newEntityId(ctx: EngineContext): number {
  return ctx.nextEntityId++
}

/** The lane the ship currently collides / fires in. */
export function collisionLane(state: GameState): number {
  return Math.min(state.lanes - 1, Math.max(0, Math.round(state.ship.laneY)))
}

export function hasEffect(state: GameState, kind: GameState['effects'][number]['kind']): boolean {
  return state.effects.some((e) => e.kind === kind)
}

/** Remove an asteroid (and drop any check still pointing at it). */
export function removeAsteroid(ctx: EngineContext, asteroidId: number): void {
  const i = ctx.state.asteroids.findIndex((a) => a.id === asteroidId)
  if (i >= 0) ctx.state.asteroids.splice(i, 1)
  for (const [checkId, check] of ctx.checks) if (check.asteroidId === asteroidId) ctx.checks.delete(checkId)
}
