/**
 * Engine contract for the space shooter.
 *
 * The engine is a pure, deterministic simulation: no DOM, no canvas, no
 * Excalibur, no React, no timers, no Promises. It pulls problems from
 * `ProblemSource.next()` but NEVER checks answers itself: when a bolt reaches
 * an asteroid it emits `checkRequested`, freezes that asteroid as `pending`,
 * and waits for a `resolveCheck` command. The host (session layer) calls
 * `ProblemSource.check()` — sync or async — and dispatches the result, so
 * server-checked answers (hybrid plugins) and local ones share one path.
 *
 * Coordinates are in a fixed logical world (WORLD.width × WORLD.height).
 * `x` is measured from the ship's ("leading") edge toward the far edge where
 * asteroids spawn, so the engine is direction-agnostic; the view mirrors x
 * for right-to-left play. Lanes are indexed 0..lanes-1 from top to bottom.
 * The ship collides in lane `Math.round(ship.laneY)`.
 */
import type { AnswerInputSpec, CheckResult, Choice, Problem, ProblemFormat, ProblemSource } from '../../../generators/types'

export type Direction = 'ltr' | 'rtl'

export const STEP_SECONDS = 1 / 60

export const WORLD = {
  width: 1600,
  height: 900,
  /** Reserved band at the top for the HUD / question banner. */
  hudTop: 96,
  hudBottom: 24,
  /** Width of the choice strip hugging the leading edge ('multiple-choice' problems). */
  choiceStripWidth: 150,
  /** Ship centre, measured from the leading edge (just inside the choice strip). */
  shipX: 250,
  /** Ship sprite half-extent along x, used for collisions. */
  shipHalfLength: 64,
} as const

export const MIN_LANES = 3
export const MAX_LANES = 5
export const MAX_LIVES = 5
export const START_LIVES = 3
export const SHIELD_HITS = 3
/** Seconds a pending (server-checked) shot may wait before it is voided without penalty. */
export const CHECK_TIMEOUT_SECONDS = 4

export function laneHeight(lanes: number): number {
  return (WORLD.height - WORLD.hudTop - WORLD.hudBottom) / lanes
}

/** World y of a (possibly fractional) lane centre. */
export function laneCenterY(lane: number, lanes: number): number {
  return WORLD.hudTop + (lane + 0.5) * laneHeight(lanes)
}

export function asteroidRadius(lanes: number): number {
  return Math.min(laneHeight(lanes) * 0.42, 95)
}

export type PowerupKind =
  | 'extraLife' // +1 life (max MAX_LIVES)
  | 'scoreBoost' // ×2 points for 15 s
  | 'doubleShots' // 15 s: a correct hit also destroys the next asteroid in that lane
  | 'shield' // absorbs SHIELD_HITS asteroid impacts
  | 'speedBoost' // 10 s: bolts ×2 speed, lane switching ×2
  | 'random' // resolves to one of the above on pickup

export const POWERUP_KINDS: readonly PowerupKind[] = [
  'extraLife',
  'scoreBoost',
  'doubleShots',
  'shield',
  'speedBoost',
  'random',
]

export interface GameConfig {
  lanes: number // MIN_LANES..MAX_LANES
  problems: ProblemSource
  /** Input spec for freeform problems that don't carry their own. */
  defaultInput: AnswerInputSpec
  maxLevel: number
  seed: number
}

export interface ShipState {
  /** Target lane (integer). */
  lane: number
  /** Visual lane position, eases toward `lane` (fractional during moves). */
  laneY: number
  /** Seconds of post-hit invulnerability remaining (view blinks the ship). */
  invulnerable: number
}

export interface AsteroidState {
  id: number
  lane: number
  x: number
  radius: number
  /** Speed in world units / s toward the leading edge (0 while pending). */
  speed: number
  problem: Problem
  /** Visual variety for the view: palette 0..3 and shape seed. */
  variant: number
  shapeSeed: number
  rotation: number
  /** A check for this asteroid is in flight; it is frozen and immune to further bolts. */
  pending: boolean
  /** Seconds since a wrong answer bounced off it (view shakes it); 0 = none. */
  wrongFlash: number
}

export interface BoltState {
  id: number
  lane: number
  x: number
  /** What gets checked: choice id ('multiple-choice') or entered text ('freeform'). */
  given: string
  /** What the bolt displays: choice text or typed text (may contain $…$). */
  display: string
  /**
   * The asteroid this answer was aimed at (the target when fired). The bolt
   * strikes only that asteroid and flies through any other, so a second quick
   * shot can't land one problem's answer on the next rock. null = first rock hit.
   */
  targetId: number | null
}

export interface PowerupState {
  id: number
  lane: number
  x: number
  kind: PowerupKind
}

export interface ActiveEffect {
  kind: 'scoreBoost' | 'doubleShots' | 'speedBoost'
  /** Seconds remaining. */
  remaining: number
  duration: number
}

export type GameStatus = 'playing' | 'paused' | 'over'

export interface GameState {
  status: GameStatus
  /** Seconds of unpaused play. */
  time: number
  score: number
  lives: number
  level: number
  streak: number
  bestStreak: number
  correct: number
  wrong: number
  lanes: number
  ship: ShipState
  asteroids: AsteroidState[]
  bolts: BoltState[]
  powerups: PowerupState[]
  effects: ActiveEffect[]
  /** Remaining shield hits (0 = no shield). */
  shield: number
  /** Nearest non-pending asteroid in the ship's lane, or null. */
  targetId: number | null
  /** Format of the current target's problem; null without target. */
  inputMode: ProblemFormat | null
  /** Choices of the target's problem ([] unless inputMode === 'multiple-choice'). */
  choices: Choice[]
  /** Freeform answer being composed in the quiver bubble (cleared on fire / retarget). */
  quiver: string
  /** Input spec in force for the quiver (target's, else config.defaultInput). */
  input: AnswerInputSpec
  /** Increments whenever any HUD-relevant field changes (cheap change detection). */
  revision: number
}

export type Command =
  | { type: 'moveUp' }
  | { type: 'moveDown' }
  | { type: 'moveToLane'; lane: number }
  /** Freeform: append a character to the quiver (filtered by `state.input`). */
  | { type: 'typeChar'; char: string }
  | { type: 'backspace' }
  | { type: 'clearQuiver' }
  /** Fire the quiver's freeform answer down the ship's lane. No-op if empty. */
  | { type: 'fire' }
  /** Multiple-choice: fire choices[index] down the ship's lane. */
  | { type: 'choose'; index: number }
  /** Result of a `checkRequested`; `null` result = check failed (network) → void the shot, no penalty. */
  | { type: 'resolveCheck'; checkId: number; result: CheckResult | null }
  | { type: 'pause' }
  | { type: 'resume' }

/** Emitted by `step` (and `dispatch` where noted). Positions are world coords. */
export type GameEvent =
  | { type: 'asteroidSpawned'; asteroidId: number; lane: number }
  | { type: 'targetChanged'; targetId: number | null }
  | { type: 'fired'; boltId: number; lane: number; display: string }
  /** Host must call ProblemSource.check(problem, given) and dispatch resolveCheck. */
  | { type: 'checkRequested'; checkId: number; asteroidId: number; problem: Problem; given: string }
  | { type: 'hit'; asteroidId: number; lane: number; x: number; points: number; bonus: boolean; explanation?: string }
  | { type: 'wrongAnswer'; asteroidId: number; lane: number; x: number; display: string; expected?: string; explanation?: string }
  /** A pending check timed out or failed; the asteroid resumes, no penalty. */
  | { type: 'checkVoided'; checkId: number; asteroidId: number }
  | { type: 'shipHit'; lane: number; absorbedByShield: boolean }
  | { type: 'asteroidPassed'; asteroidId: number; lane: number; absorbedByShield: boolean }
  | { type: 'lifeLost'; lives: number }
  | { type: 'powerupCollected'; kind: Exclude<PowerupKind, 'random'>; lane: number; fromRandom: boolean }
  | { type: 'effectEnded'; kind: ActiveEffect['kind'] }
  | { type: 'levelUp'; level: number }
  | { type: 'gameOver'; score: number }

export interface Engine {
  readonly config: GameConfig
  /** Live state; treat as read-only outside the engine. */
  readonly state: GameState
  /** Apply a command. Returns events it caused immediately (e.g. 'fired', 'hit' from resolveCheck). */
  dispatch(command: Command): GameEvent[]
  /** Advance one fixed step of `STEP_SECONDS`. Returns events that occurred. */
  step(): GameEvent[]
}

/** Implemented in engine/index.ts. */
export type CreateEngine = (config: GameConfig) => Engine
