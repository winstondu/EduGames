/** Difficulty curves: pure functions of level (and lane count). */
import { WORLD } from './types'

/** Level at which the curves bottom out. */
export const CURVE_MAX_LEVEL = 10
/** Correct answers per level. */
export const CORRECT_PER_LEVEL = 8

/** 0 at level 1 → 1 at CURVE_MAX_LEVEL and beyond. */
function progress(level: number): number {
  return Math.min(1, Math.max(0, (level - 1) / (CURVE_MAX_LEVEL - 1)))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Seconds for an asteroid to cross the world: ~13 s at level 1 → ~6 s at level 10. */
export function crossingSeconds(level: number): number {
  return lerp(13, 6, progress(level))
}

/** Base asteroid speed (world units / s) before per-asteroid jitter. */
export function asteroidSpeed(level: number): number {
  return WORLD.width / crossingSeconds(level)
}

/** Mean seconds between asteroid spawns; more lanes → a little denser. */
export function spawnInterval(level: number, lanes: number): number {
  return lerp(3.2, 1.4, progress(level)) * (6 / (lanes + 3))
}

/** Max asteroids alive at once. */
export function maxAsteroids(lanes: number): number {
  return lanes + 1
}

/** Level reached after `correct` correct answers. */
export function levelForCorrect(correct: number, maxLevel: number): number {
  return Math.max(1, Math.min(Math.max(1, maxLevel), 1 + Math.floor(correct / CORRECT_PER_LEVEL)))
}
