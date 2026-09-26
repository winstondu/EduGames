/** Player answer input: quiver editing and firing bolts. */
import type { AnswerInputSpec } from '../../../generators/types'
import type { EngineContext } from './context'
import { collisionLane, emit, newEntityId, touch } from './context'
import { WORLD } from './types'

const DIGIT = /^[0-9]$/
const TEXT = /^[\p{L}\p{N} ]$/u

/** Whether `char` (one character) may be typed under `input`. */
export function acceptsChar(input: AnswerInputSpec, char: string): boolean {
  if ([...char].length !== 1) return false
  if (input.allow?.includes(char)) return true
  return input.kind === 'numeric' ? DIGIT.test(char) : TEXT.test(char)
}

export function typeChar(ctx: EngineContext, char: string): void {
  const s = ctx.state
  if (s.inputMode !== 'freeform') return
  if (!acceptsChar(s.input, char)) return
  if ([...s.quiver].length >= s.input.maxLength) return
  s.quiver += char
  touch(ctx)
}

export function backspace(ctx: EngineContext): void {
  const s = ctx.state
  if (!s.quiver) return
  s.quiver = [...s.quiver].slice(0, -1).join('')
  touch(ctx)
}

export function clearQuiver(ctx: EngineContext): void {
  if (!ctx.state.quiver) return
  ctx.state.quiver = ''
  touch(ctx)
}

function launch(ctx: EngineContext, given: string, display: string): void {
  const lane = collisionLane(ctx.state)
  const boltId = newEntityId(ctx)
  ctx.state.bolts.push({ id: boltId, lane, x: WORLD.shipX + WORLD.shipHalfLength, given, display })
  emit(ctx, { type: 'fired', boltId, lane, display })
}

/** Freeform: fire the quiver's contents. No-op when empty. */
export function fire(ctx: EngineContext): void {
  const s = ctx.state
  if (s.inputMode !== 'freeform') return
  const text = s.quiver.trim()
  if (!text) return
  s.quiver = ''
  touch(ctx)
  launch(ctx, text, text)
}

/** Multiple-choice: fire choices[index]. */
export function choose(ctx: EngineContext, index: number): void {
  const s = ctx.state
  if (s.inputMode !== 'multiple-choice') return
  const choice = Number.isInteger(index) ? s.choices[index] : undefined
  if (!choice) return
  launch(ctx, choice.id, choice.text)
}
