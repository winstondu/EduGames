/**
 * Fixed-timestep accumulator ("fix your timestep"). Feed it real frame deltas;
 * it tells you how many whole simulation steps to run and how far the render
 * sits between the last two steps (for interpolation).
 */
export interface FixedStepper {
  /** Add a frame delta (seconds, clamped to maxFrameSeconds); returns the number of steps to run now. */
  advance(dtSeconds: number): number
  /** Leftover fraction of a step in [0, 1): 0 = exactly on the last step. */
  alpha(): number
  /** Drop any accumulated time (e.g. after pause/resume or a tab switch). */
  reset(): void
}

/** Float slack so e.g. 3 × (1/60) counts as three steps, not two. */
const EPSILON = 1e-9

export function createFixedStepper(stepSeconds: number, maxFrameSeconds = 0.25): FixedStepper {
  if (!(stepSeconds > 0)) throw new RangeError('stepSeconds must be > 0')
  let acc = 0
  return {
    advance(dtSeconds) {
      // NaN, negative or zero deltas (clock hiccups) run nothing.
      if (!(dtSeconds > 0)) return 0
      acc += Math.min(dtSeconds, maxFrameSeconds)
      const steps = Math.floor(acc / stepSeconds + EPSILON)
      acc = Math.max(0, acc - steps * stepSeconds)
      return steps
    },
    alpha: () => Math.min(acc / stepSeconds, 1 - EPSILON),
    reset() {
      acc = 0
    },
  }
}
