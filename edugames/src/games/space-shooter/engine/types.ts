/**
 * Engine contract for the space shooter.
 *
 * The engine is a pure, deterministic simulation: no DOM, no canvas, no React,
 * no timers. It only knows the ProblemSource interface, never a concrete
 * generator. Callers drive it with a fixed timestep (`STEP_SECONDS`).
 *
 * Coordinates are in a fixed logical world (WORLD.width × WORLD.height).
 * `x` is measured from the ship's ("leading") edge toward the far edge where
 * asteroids spawn, so the engine is direction-agnostic; the renderer mirrors
 * x for right-to-left play. Lanes are indexed 0..lanes-1 from top to bottom.
 */
import type { AnswerMode, Problem, ProblemSource } from '../../../generators/types'

export type Direction = 'ltr' | 'rtl'

export const STEP_SECONDS = 1 / 60

export const WORLD = {
  width: 1600,
  height: 900,
  /** Reserved band at the top for the HUD (score, lives, effects). */
  hudTop: 80,
  hudBottom: 24,
  /** Width of the choice strip hugging the leading edge (choice mode). */
  choiceStripWidth: 120,
  /** Ship centre, measured from the leading edge. */
  shipX: 220,
  /** Ship sprite half-extent along x, used for collisions. */
  shipHalfLength: 64,
} as const

export const MIN_LANES = 3
export const MAX_LANES = 5
export const MAX_LIVES = 5
export const START_LIVES = 3
export const SHIELD_HITS = 3
export const CHOICE_COUNT = 4

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
  | 'speedBoost' // 10 s: lasers ×2 speed, lane switching ×2
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
  answerMode: AnswerMode
  /** Max characters the typed quiver accepts (from the generator plugin). */
  maxAnswerLength: number
  problems: ProblemSource
  seed: number
}

export interface ShipState {
  /** Target lane (integer). */
  lane: number
  /** Visual lane position, eases toward `lane` (fractional during moves). */
  laneY: number
  /** Seconds of post-hit invulnerability remaining (renderer blinks the ship). */
  invulnerable: number
}

export interface AsteroidState {
  id: number
  lane: number
  x: number
  radius: number
  /** Speed in world units / s toward the leading edge. */
  speed: number
  problem: Problem
  /** Visual variety for the renderer: palette 0..3 and shape seed. */
  variant: number
  shapeSeed: number
  rotation: number
  /** Seconds since a wrong answer bounced off it (renderer shakes it); 0 = none. */
  wrongFlash: number
}

export interface LaserState {
  id: number
  lane: number
  x: number
  /** Normalized answer this shot carries (shown on the bolt). */
  answer: string
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
  answerMode: AnswerMode
  ship: ShipState
  asteroids: AsteroidState[]
  lasers: LaserState[]
  powerups: PowerupState[]
  effects: ActiveEffect[]
  /** Remaining shield hits (0 = no shield). */
  shield: number
  /** Answer loaded in the ship's quiver (typed mode: in-progress input). */
  quiver: string
  /** Nearest asteroid in the ship's lane, or null. Choice mode targets this. */
  targetId: number | null
  /** Choice mode: CHOICE_COUNT options for the target's problem ([] when no target). */
  choices: string[]
}

export type Command =
  | { type: 'moveUp' }
  | { type: 'moveDown' }
  | { type: 'moveToLane'; lane: number }
  /** Typed mode: append a character to the quiver (ignored past maxAnswerLength). */
  | { type: 'typeChar'; char: string }
  | { type: 'backspace' }
  | { type: 'clearQuiver' }
  /** Fire the quiver's answer down the ship's lane (typed mode). No-op if empty. */
  | { type: 'fire' }
  /** Choice mode: load choices[index] into the quiver and fire immediately. */
  | { type: 'choose'; index: number }
  | { type: 'pause' }
  | { type: 'resume' }

/** Emitted by `step` for the renderer (FX/sound) and UI. Positions are world coords. */
export type GameEvent =
  | { type: 'fired'; lane: number; answer: string }
  | { type: 'hit'; asteroidId: number; lane: number; x: number; points: number; bonus: boolean }
  | { type: 'wrongAnswer'; asteroidId: number; lane: number; x: number; answer: string; expected: string }
  | { type: 'shipHit'; lane: number; absorbedByShield: boolean }
  | { type: 'asteroidPassed'; asteroidId: number; lane: number; absorbedByShield: boolean }
  | { type: 'powerupCollected'; kind: Exclude<PowerupKind, 'random'>; lane: number; fromRandom: boolean }
  | { type: 'effectEnded'; kind: ActiveEffect['kind'] }
  | { type: 'levelUp'; level: number }
  | { type: 'gameOver'; score: number }

export interface Engine {
  readonly config: GameConfig
  /** Live state; treat as read-only outside the engine. */
  readonly state: GameState
  dispatch(command: Command): void
  /** Advance one fixed step of `STEP_SECONDS`. Returns events that occurred. */
  step(): GameEvent[]
}
