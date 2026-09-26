/**
 * Time control over the fixed stepper: a real-time scale (player slow-motion,
 * harness speed), lockstep (frozen until steps are requested) and queued
 * manual steps. Only pacing changes — every step is still one fixed step of
 * the deterministic sim, so replays are identical at any speed.
 *
 *   const time = createTimeController({ stepSeconds: STEP_SECONDS })
 *   time.setScale(settings.speed)
 *   for (let i = time.advance(frameDt); i > 0; i--) handle(engine.step())
 */
import { createFixedStepper, type FixedStepper } from './fixedStepper'

/** Player-facing game speed (per-game player setting). */
export type GameSpeed = 1 | 0.75 | 0.5 | 0.25

export const GAME_SPEEDS: readonly GameSpeed[] = [1, 0.75, 0.5, 0.25]

export const GAME_SPEED_LABELS: Record<GameSpeed, string> = {
  1: 'Normal',
  0.75: 'Relaxed',
  0.5: 'Slow 🐢',
  0.25: 'Super slow 🐌',
}

/** Coerce a stored value to a GameSpeed (default 1). */
export function sanitizeGameSpeed(value: unknown): GameSpeed {
  const n = Number(value)
  return GAME_SPEEDS.find((s) => s === n) ?? 1
}

export const MIN_TIME_SCALE = 0.1
export const MAX_TIME_SCALE = 2

export interface TimeControllerOptions {
  stepSeconds: number
  /** Longest real frame delta honoured (spiral-of-death guard, default 0.25 s). */
  maxFrameSeconds?: number
  /** Initial scale (default 1). */
  scale?: number
}

export interface TimeController extends FixedStepper {
  /** Real-time multiplier in [MIN_TIME_SCALE, MAX_TIME_SCALE]. */
  readonly scale: number
  /** Frozen: real time is ignored; only requested steps run. */
  readonly lockstep: boolean
  /** Manual steps queued for the next advance(). */
  readonly queued: number
  /** Clamped to [MIN_TIME_SCALE, MAX_TIME_SCALE]; non-finite values are ignored. */
  setScale(scale: number): void
  /** Entering lockstep drops the partial step so the view sits exactly on a step. */
  setLockstep(on: boolean): void
  /** Queue n whole steps, consumed by the next advance() (also in lockstep). */
  requestSteps(n: number): void
  /**
   * Real frame delta (seconds) → steps to run now: queued manual steps plus
   * the scaled accumulator (which contributes 0 in lockstep).
   */
  advance(realDtSeconds: number): number
}

function clampScale(scale: number): number {
  return Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, scale))
}

export function createTimeController(options: TimeControllerOptions): TimeController {
  const maxFrameSeconds = options.maxFrameSeconds ?? 0.25
  // The inner stepper sees scaled time; real deltas are clamped before scaling.
  const stepper = createFixedStepper(options.stepSeconds, maxFrameSeconds * MAX_TIME_SCALE)
  let scale = Number.isFinite(options.scale) ? clampScale(options.scale!) : 1
  let lockstep = false
  let queued = 0

  return {
    get scale() {
      return scale
    },
    get lockstep() {
      return lockstep
    },
    get queued() {
      return queued
    },
    setScale(next) {
      if (Number.isFinite(next)) scale = clampScale(next)
    },
    setLockstep(on) {
      if (on && !lockstep) stepper.reset()
      lockstep = on
    },
    requestSteps(n) {
      if (Number.isFinite(n) && n > 0) queued += Math.floor(n)
    },
    advance(realDtSeconds) {
      const manual = queued
      queued = 0
      if (lockstep || !(realDtSeconds > 0)) return manual
      return manual + stepper.advance(Math.min(realDtSeconds, maxFrameSeconds) * scale)
    },
    alpha: () => stepper.alpha(),
    reset() {
      stepper.reset()
    },
  }
}
