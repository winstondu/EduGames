/** Scoring and life bookkeeping. */
import type { EngineContext } from './context'
import { emit, touch } from './context'
import type { GameEvent } from './types'
import { levelForCorrect } from './difficulty'

/** Points for a correct hit: 10 × level + 2 × min(streak, 10), doubled by scoreBoost. */
export function hitPoints(level: number, streak: number, scoreBoost: boolean): number {
  const base = 10 * level + 2 * Math.min(Math.max(0, streak), 10)
  return scoreBoost ? base * 2 : base
}

/** Points for a doubleShots bonus kill (no streak bonus). */
export function bonusPoints(level: number, scoreBoost: boolean): number {
  return hitPoints(level, 0, scoreBoost)
}

/** Record a correct answer: streak, counters, level-up. */
export function recordCorrect(ctx: EngineContext): void {
  const s = ctx.state
  s.streak++
  s.bestStreak = Math.max(s.bestStreak, s.streak)
  s.correct++
  const level = levelForCorrect(s.correct, ctx.config.maxLevel)
  if (level > s.level) {
    s.level = level
    emit(ctx, { type: 'levelUp', level })
  }
  touch(ctx)
}

export function recordWrong(ctx: EngineContext): void {
  ctx.state.streak = 0
  ctx.state.wrong++
  touch(ctx)
}

/**
 * An asteroid got through (ship hit or passed). The shield absorbs it,
 * otherwise a life is lost. Emits `cause(absorbedByShield)` then, if a life
 * was lost, `lifeLost`. Game over is settled by `checkGameOver`.
 */
export function takeDamage(ctx: EngineContext, cause: (absorbedByShield: boolean) => GameEvent): void {
  const s = ctx.state
  const absorbed = s.shield > 0
  if (absorbed) s.shield--
  else s.lives = Math.max(0, s.lives - 1)
  touch(ctx)
  emit(ctx, cause(absorbed))
  if (!absorbed) emit(ctx, { type: 'lifeLost', lives: s.lives })
}

/** Ends the game once lives reach 0 (idempotent). */
export function checkGameOver(ctx: EngineContext): void {
  const s = ctx.state
  if (s.status === 'over' || s.lives > 0) return
  s.status = 'over'
  touch(ctx)
  emit(ctx, { type: 'gameOver', score: s.score })
}
