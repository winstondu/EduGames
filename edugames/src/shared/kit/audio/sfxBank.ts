/**
 * Named ZzFX sound effects. Each entry is a ZzFX parameter list:
 * [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve,
 *  slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation,
 *  bitCrush, delay, sustainVolume, decay, tremolo, filter]
 * Shapes: 0 sin, 1 triangle, 2 saw, 3 tan, 4 noise, 5 square (shapeCurve = duty × 2).
 * Names describe the sound, not a game event, so every game can share them.
 */
export type SfxName = 'zap' | 'boing' | 'crunch' | 'clang' | 'powerup' | 'levelUp' | 'gameOver' | 'click' | 'blip'

export type ZzfxParams = readonly (number | undefined)[]

export const SFX_BANK: Record<SfxName, ZzfxParams> = {
  /** Short laser: bright saw sweeping down. */
  zap: [0.45, 0.05, 920, 0, 0.02, 0.12, 2, 1.4, -28, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.02],
  /** Wrong-answer bounce: wobbling triangle rising in pitch. */
  boing: [0.8, 0, 150, 0.01, 0.1, 0.3, 1, 1, 7, 0, 0, 0, 0, 0, 12, 0, 0, 1, 0.05],
  /** Rock breaking up: crushed noise burst. */
  crunch: [1, 0.1, 90, 0.005, 0.12, 0.4, 4, 1, -2, 0, 0, 0, 0, 1.5, 0, 0.2, 0, 0.6, 0.05],
  /** Metallic hit: modulated tan wave with an echo. */
  clang: [0.5, 0.05, 520, 0, 0.04, 0.45, 3, 1, 0, 0, 0, 0, 0, 0, 35, 0, 0.12, 0.7, 0.02, 0.3],
  /** Pickup: square staircase climbing quickly. */
  powerup: [0.45, 0, 330, 0.01, 0.25, 0.15, 5, 1, 0, 0, 220, 0.05, 0.1, 0, 0, 0, 0, 0.8],
  /** Fanfare-ish staircase with an echo. */
  levelUp: [0.5, 0, 262, 0.01, 0.45, 0.2, 5, 1, 0, 0, 131, 0.06, 0.12, 0, 0, 0, 0.1, 0.8],
  /** Descending staircase. */
  gameOver: [0.6, 0, 392, 0.02, 0.6, 0.4, 5, 1, -0.3, 0, -65, 0.12, 0.2, 0, 0, 0, 0.1, 0.7],
  /** UI button tick. */
  click: [0.35, 0, 1200, 0, 0.005, 0.03, 5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  /** Soft select/typing blip: two quick notes. */
  blip: [0.3, 0, 760, 0, 0.02, 0.05, 5, 1, 0, 0, 380, 0.02, 0, 0, 0, 0, 0, 1],
}

export const SFX_NAMES = Object.keys(SFX_BANK) as SfxName[]
