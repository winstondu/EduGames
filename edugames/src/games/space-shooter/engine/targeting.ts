/** Target selection and the input mode that follows from it. */
import type { EngineContext } from './context'
import { collisionLane, emit, touch } from './context'
import { WORLD, type AsteroidState, type GameState } from './types'

/** Nearest non-pending asteroid ahead of the ship in its collision lane. */
export function findTarget(state: GameState): AsteroidState | null {
  const lane = collisionLane(state)
  let best: AsteroidState | null = null
  for (const a of state.asteroids) {
    if (a.lane !== lane || a.pending || a.x <= WORLD.shipX) continue
    if (!best || a.x < best.x) best = a
  }
  return best
}

/** Recompute the target; on change emit targetChanged and reset the quiver / input mode. */
export function updateTarget(ctx: EngineContext): void {
  const s = ctx.state
  const target = findTarget(s)
  const targetId = target ? target.id : null
  if (targetId === s.targetId) return
  s.targetId = targetId
  s.quiver = ''
  if (target) {
    const p = target.problem
    s.inputMode = p.format
    s.choices = p.format === 'multiple-choice' ? (p.choices ?? []).slice() : []
    s.input = p.input ?? ctx.config.defaultInput
  } else {
    s.inputMode = null
    s.choices = []
    s.input = ctx.config.defaultInput
  }
  touch(ctx)
  emit(ctx, { type: 'targetChanged', targetId })
}
