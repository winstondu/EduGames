/** Movement and collisions for bolts and asteroids. */
import type { EngineContext } from './context'
import { collisionLane, hasEffect, removeAsteroid } from './context'
import { WRONG_FLASH_SECONDS, requestCheck } from './checks'
import { takeDamage } from './scoring'
import { spinRate } from './spawner'
import { WORLD, type AsteroidState, type BoltState } from './types'

export const BOLT_SPEED = 1400
/** Post-hit invulnerability, seconds. */
export const INVULNERABLE_SECONDS = 1.5

/** Drift, spin and flash timers for every asteroid. */
export function moveAsteroids(ctx: EngineContext, dt: number): void {
  for (const a of ctx.state.asteroids) {
    a.x -= a.speed * dt
    a.rotation = (a.rotation + spinRate(a.shapeSeed) * dt) % (Math.PI * 2)
    if (a.wrongFlash > 0) {
      a.wrongFlash += dt
      if (a.wrongFlash >= WRONG_FLASH_SECONDS) a.wrongFlash = 0
    }
  }
}

/**
 * The first non-pending asteroid a bolt sweeping [fromX, toX] in its lane
 * touches. A bolt aimed at a target only ever strikes that target.
 */
function boltVictim(asteroids: AsteroidState[], bolt: BoltState, fromX: number, toX: number): AsteroidState | null {
  let best: AsteroidState | null = null
  for (const a of asteroids) {
    if (a.lane !== bolt.lane || a.pending) continue
    if (bolt.targetId !== null && a.id !== bolt.targetId) continue
    if (a.x - a.radius > toX || a.x + a.radius < fromX) continue
    if (!best || a.x < best.x) best = a
  }
  return best
}

/** Move bolts; a bolt reaching an asteroid is consumed and requests a check. */
export function moveBolts(ctx: EngineContext, dt: number): void {
  const s = ctx.state
  const speed = BOLT_SPEED * (hasEffect(s, 'speedBoost') ? 2 : 1)
  const kept: BoltState[] = []
  for (const bolt of s.bolts) {
    const fromX = bolt.x
    bolt.x += speed * dt
    const victim = boltVictim(s.asteroids, bolt, fromX, bolt.x)
    if (victim) requestCheck(ctx, victim, bolt)
    else if (bolt.x <= WORLD.width + 200) kept.push(bolt)
  }
  s.bolts = kept
}

/**
 * Asteroids reaching the ship in its lane hit it (unless invulnerable);
 * asteroids passing the ship in other lanes get through. Pending ones are
 * frozen and harmless.
 */
export function collideShip(ctx: EngineContext): void {
  const s = ctx.state
  const lane = collisionLane(s)
  const front = WORLD.shipX + WORLD.shipHalfLength
  const back = WORLD.shipX - WORLD.shipHalfLength
  for (const a of [...s.asteroids]) {
    if (a.pending) continue
    if (a.lane === lane) {
      if (s.ship.invulnerable > 0) {
        // Drifts harmlessly through the blinking ship.
        if (a.x <= back) removeAsteroid(ctx, a.id)
        continue
      }
      if (a.x - a.radius > front) continue
      removeAsteroid(ctx, a.id)
      s.ship.invulnerable = INVULNERABLE_SECONDS
      takeDamage(ctx, (absorbedByShield) => ({ type: 'shipHit', lane, absorbedByShield }))
    } else if (a.x <= back) {
      removeAsteroid(ctx, a.id)
      takeDamage(ctx, (absorbedByShield) => ({ type: 'asteroidPassed', asteroidId: a.id, lane: a.lane, absorbedByShield }))
    }
  }
}
