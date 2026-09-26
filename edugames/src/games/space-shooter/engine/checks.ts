/**
 * Answer checks. The engine never judges answers: a bolt reaching an asteroid
 * freezes it and emits `checkRequested`; the host dispatches `resolveCheck`.
 */
import type { CheckResult } from '../../../generators/types'
import type { EngineContext, PendingCheck } from './context'
import { emit, hasEffect, removeAsteroid, touch } from './context'
import { bonusPoints, hitPoints, recordCorrect, recordWrong } from './scoring'
import { CHECK_TIMEOUT_SECONDS, type AsteroidState, type BoltState } from './types'

/** Seconds the view shakes an asteroid after a wrong answer. */
export const WRONG_FLASH_SECONDS = 0.6
/** Non-zero start value for `wrongFlash` (0 means "no flash"). */
const WRONG_FLASH_START = 1e-3

/** Freeze `asteroid` and ask the host to check `bolt`'s answer. */
export function requestCheck(ctx: EngineContext, asteroid: AsteroidState, bolt: BoltState): void {
  const checkId = ctx.nextCheckId++
  ctx.checks.set(checkId, {
    checkId,
    asteroidId: asteroid.id,
    given: bolt.given,
    display: bolt.display,
    speed: asteroid.speed,
    requestedAt: ctx.state.time,
  })
  asteroid.pending = true
  asteroid.speed = 0
  emit(ctx, { type: 'checkRequested', checkId, asteroidId: asteroid.id, problem: asteroid.problem, given: bolt.given })
}

function unpend(asteroid: AsteroidState, check: PendingCheck): void {
  asteroid.pending = false
  asteroid.speed = check.speed
}

function voidCheck(ctx: EngineContext, check: PendingCheck, asteroid: AsteroidState | undefined): void {
  ctx.checks.delete(check.checkId)
  if (asteroid) unpend(asteroid, check)
  emit(ctx, { type: 'checkVoided', checkId: check.checkId, asteroidId: check.asteroidId })
}

/** Apply a check verdict. Unknown / stale ids are ignored. */
export function resolveCheck(ctx: EngineContext, checkId: number, result: CheckResult | null): void {
  const check = ctx.checks.get(checkId)
  if (!check) return
  const s = ctx.state
  const asteroid = s.asteroids.find((a) => a.id === check.asteroidId)
  if (!asteroid) {
    ctx.checks.delete(checkId)
    return
  }
  if (!result || s.time - check.requestedAt >= CHECK_TIMEOUT_SECONDS) {
    voidCheck(ctx, check, asteroid)
    return
  }
  ctx.checks.delete(checkId)
  if (result.correct) {
    const boosted = hasEffect(s, 'scoreBoost')
    const points = hitPoints(s.level, s.streak, boosted)
    s.score += points
    removeAsteroid(ctx, asteroid.id)
    emit(ctx, { type: 'hit', asteroidId: asteroid.id, lane: asteroid.lane, x: asteroid.x, points, bonus: false, explanation: result.explanation })
    if (hasEffect(s, 'doubleShots')) destroyBonus(ctx, asteroid.lane, boosted)
    recordCorrect(ctx)
  } else {
    unpend(asteroid, check)
    asteroid.wrongFlash = WRONG_FLASH_START
    recordWrong(ctx)
    emit(ctx, {
      type: 'wrongAnswer',
      asteroidId: asteroid.id,
      lane: asteroid.lane,
      x: asteroid.x,
      display: check.display,
      expected: result.expected,
      explanation: result.explanation,
    })
  }
}

/** doubleShots: also destroy the nearest non-pending asteroid in `lane`. */
function destroyBonus(ctx: EngineContext, lane: number, boosted: boolean): void {
  let next: AsteroidState | undefined
  for (const a of ctx.state.asteroids) {
    if (a.lane === lane && !a.pending && (!next || a.x < next.x)) next = a
  }
  if (!next) return
  const points = bonusPoints(ctx.state.level, boosted)
  ctx.state.score += points
  removeAsteroid(ctx, next.id)
  touch(ctx)
  emit(ctx, { type: 'hit', asteroidId: next.id, lane, x: next.x, points, bonus: true })
}

/** Void checks that have waited CHECK_TIMEOUT_SECONDS of play time. */
export function tickChecks(ctx: EngineContext): void {
  for (const check of [...ctx.checks.values()]) {
    if (ctx.state.time - check.requestedAt < CHECK_TIMEOUT_SECONDS) continue
    voidCheck(ctx, check, ctx.state.asteroids.find((a) => a.id === check.asteroidId))
  }
}
