/** Asteroid spawning: timing, lane choice, per-asteroid variety. */
import { randInt } from '../../../shared/rng'
import type { EngineContext } from './context'
import { emit, newEntityId } from './context'
import { asteroidSpeed, maxAsteroids, spawnInterval } from './difficulty'
import { WORLD, asteroidRadius, type AsteroidState } from './types'

/** Delay before the first asteroid. */
export const FIRST_SPAWN_SECONDS = 1
/** Retry delay when no lane is free or the cap is reached. */
const RETRY_SECONDS = 0.25
/** A new asteroid keeps this many diameters from others in its lane. */
const LANE_GAP_DIAMETERS = 1.5
/** Per-asteroid speed jitter (±). */
const SPEED_JITTER = 0.08
/** Max spin, radians / s. */
const MAX_SPIN = 0.9

export function spawnX(radius: number): number {
  return WORLD.width + radius
}

/** Lanes where a new object at `x` keeps `gap` from every asteroid in that lane. */
export function freeLanes(ctx: EngineContext, x: number, gap: number): number[] {
  const out: number[] = []
  for (let lane = 0; lane < ctx.state.lanes; lane++) {
    if (!ctx.state.asteroids.some((a) => a.lane === lane && Math.abs(a.x - x) < gap)) out.push(lane)
  }
  return out
}

/** Spin (rad/s) derived from the asteroid's shape seed, so the view can stay stateless. */
export function spinRate(shapeSeed: number): number {
  return ((shapeSeed % 1000) / 1000 - 0.5) * 2 * MAX_SPIN
}

function nextInterval(ctx: EngineContext): number {
  return spawnInterval(ctx.state.level, ctx.state.lanes) * (0.8 + 0.4 * ctx.rng())
}

/** Try to spawn one asteroid now. Returns it, or null if capped / no free lane. */
export function spawnAsteroid(ctx: EngineContext): AsteroidState | null {
  const s = ctx.state
  if (s.asteroids.length >= maxAsteroids(s.lanes)) return null
  const radius = asteroidRadius(s.lanes)
  const x = spawnX(radius)
  const lanes = freeLanes(ctx, x, LANE_GAP_DIAMETERS * 2 * radius)
  if (lanes.length === 0) return null
  const lane = lanes[Math.floor(ctx.rng() * lanes.length)]
  const speed = asteroidSpeed(s.level) * (1 - SPEED_JITTER + 2 * SPEED_JITTER * ctx.rng())
  const variant = randInt(ctx.rng, 0, 3)
  const shapeSeed = randInt(ctx.rng, 0, 0x7fffffff)
  const rotation = ctx.rng() * Math.PI * 2
  const asteroid: AsteroidState = {
    id: newEntityId(ctx),
    lane,
    x,
    radius,
    speed,
    problem: ctx.config.problems.next(s.level),
    variant,
    shapeSeed,
    rotation,
    pending: false,
    wrongFlash: 0,
  }
  s.asteroids.push(asteroid)
  emit(ctx, { type: 'asteroidSpawned', asteroidId: asteroid.id, lane })
  return asteroid
}

/** Advance the spawn timer by `dt`; spawns when due. */
export function tickSpawner(ctx: EngineContext, dt: number): void {
  ctx.spawnTimer -= dt
  if (ctx.spawnTimer > 0) return
  ctx.spawnTimer = spawnAsteroid(ctx) ? nextInterval(ctx) : RETRY_SECONDS
}
