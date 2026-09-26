/** Powerups: spawning, drift, pickup and timed effects. */
import { pick } from '../../../shared/rng'
import type { EngineContext } from './context'
import { collisionLane, emit, newEntityId, touch } from './context'
import { asteroidSpeed } from './difficulty'
import { freeLanes, spawnX } from './spawner'
import {
  MAX_LIVES,
  POWERUP_KINDS,
  SHIELD_HITS,
  WORLD,
  asteroidRadius,
  type ActiveEffect,
  type PowerupKind,
  type PowerupState,
} from './types'

export const POWERUP_MIN_INTERVAL = 12
export const POWERUP_MAX_INTERVAL = 18
export const MAX_POWERUPS_ALIVE = 1
/** Pickup radius (world units) around a powerup's centre. */
export const POWERUP_RADIUS = 40
/** Powerups drift at this fraction of the current asteroid speed. */
const POWERUP_SPEED_FACTOR = 0.6

export const EFFECT_SECONDS: Record<ActiveEffect['kind'], number> = {
  scoreBoost: 15,
  doubleShots: 15,
  speedBoost: 10,
}

type ConcreteKind = Exclude<PowerupKind, 'random'>

const CONCRETE_KINDS = POWERUP_KINDS.filter((k): k is ConcreteKind => k !== 'random')

export function nextPowerupInterval(ctx: EngineContext): number {
  return POWERUP_MIN_INTERVAL + (POWERUP_MAX_INTERVAL - POWERUP_MIN_INTERVAL) * ctx.rng()
}

export function powerupSpeed(level: number): number {
  return asteroidSpeed(level) * POWERUP_SPEED_FACTOR
}

/** Spawn one powerup if under the cap; returns it or null. */
export function spawnPowerup(ctx: EngineContext): PowerupState | null {
  const s = ctx.state
  if (s.powerups.length >= MAX_POWERUPS_ALIVE) return null
  const x = spawnX(POWERUP_RADIUS)
  // Prefer lanes clear of asteroids near the spawn point; fall back to any lane.
  const clear = freeLanes(ctx, x, 3 * asteroidRadius(s.lanes))
  const lanes = clear.length ? clear : Array.from({ length: s.lanes }, (_, i) => i)
  const lane = pick(ctx.rng, lanes)
  const kinds = s.lives >= MAX_LIVES ? POWERUP_KINDS.filter((k) => k !== 'extraLife') : POWERUP_KINDS
  const powerup: PowerupState = { id: newEntityId(ctx), lane, x, kind: pick(ctx.rng, kinds) }
  s.powerups.push(powerup)
  return powerup
}

/** Apply a collected powerup's effect. */
export function applyPowerup(ctx: EngineContext, kind: PowerupKind, lane: number): void {
  const s = ctx.state
  const fromRandom = kind === 'random'
  const effective: ConcreteKind = kind === 'random' ? pick(ctx.rng, CONCRETE_KINDS) : kind
  switch (effective) {
    case 'extraLife':
      s.lives = Math.min(MAX_LIVES, s.lives + 1)
      break
    case 'shield':
      s.shield = SHIELD_HITS
      break
    case 'scoreBoost':
    case 'doubleShots':
    case 'speedBoost': {
      const duration = EFFECT_SECONDS[effective]
      const existing = s.effects.find((e) => e.kind === effective)
      if (existing) {
        existing.remaining = duration
        existing.duration = duration
      } else {
        s.effects.push({ kind: effective, remaining: duration, duration })
      }
      break
    }
  }
  touch(ctx)
  emit(ctx, { type: 'powerupCollected', kind: effective, lane, fromRandom })
}

/** Move powerups; collect those reaching the ship in its lane, drop missed ones. */
export function tickPowerups(ctx: EngineContext, dt: number): void {
  const s = ctx.state
  const speed = powerupSpeed(s.level)
  const lane = collisionLane(s)
  const front = WORLD.shipX + WORLD.shipHalfLength
  const back = WORLD.shipX - WORLD.shipHalfLength
  const kept: PowerupState[] = []
  const collected: PowerupState[] = []
  for (const p of s.powerups) {
    p.x -= speed * dt
    if (p.lane === lane && p.x - POWERUP_RADIUS <= front && p.x + POWERUP_RADIUS >= back) collected.push(p)
    else if (p.x <= back) continue
    else kept.push(p)
  }
  s.powerups = kept
  for (const p of collected) applyPowerup(ctx, p.kind, p.lane)

  ctx.powerupTimer -= dt
  if (ctx.powerupTimer <= 0) {
    spawnPowerup(ctx)
    ctx.powerupTimer = nextPowerupInterval(ctx)
  }
}

/** Count down timed effects; emit effectEnded on expiry. */
export function tickEffects(ctx: EngineContext, dt: number): void {
  const s = ctx.state
  if (!s.effects.length) return
  const kept: ActiveEffect[] = []
  for (const e of s.effects) {
    const before = Math.ceil(e.remaining)
    e.remaining = Math.max(0, e.remaining - dt)
    if (e.remaining <= 0) {
      touch(ctx)
      emit(ctx, { type: 'effectEnded', kind: e.kind })
      continue
    }
    // HUD shows whole seconds; bump revision only when that changes.
    if (Math.ceil(e.remaining) !== before) touch(ctx)
    kept.push(e)
  }
  s.effects = kept
}
