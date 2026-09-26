/**
 * Pure input mapping for the space shooter screen: keyboard → engine
 * commands, tap position → lane, keypad layouts. No DOM access.
 */
import type { AnswerInputSpec, Problem, ProblemFormat } from '../../../generators/types'
import { mathTextToPlain } from '../../../shared/mathtext/parse'
import { acceptsChar } from '../engine/input'
import { WORLD, laneHeight, type Command } from '../engine/types'

export interface KeyContext {
  inputMode: ProblemFormat | null
  input: AnswerInputSpec
}

export type KeyAction = { type: 'command'; command: Command } | { type: 'togglePause' }

const cmd = (command: Command): KeyAction => ({ type: 'command', command })

const CHOICE_DIGITS = '1234'
const CHOICE_LETTERS = 'abcd'

/**
 * Map a `KeyboardEvent.key` to an action, or null if the key isn't ours.
 * Typing wins over shortcuts: with a text quiver, W/S/P are letters.
 */
export function keyToAction(key: string, ctx: KeyContext): KeyAction | null {
  if (key === 'Escape') return { type: 'togglePause' }
  if (key === 'ArrowUp') return cmd({ type: 'moveUp' })
  if (key === 'ArrowDown') return cmd({ type: 'moveDown' })

  if (ctx.inputMode === 'freeform') {
    if (key === 'Enter' || key === ' ') return cmd({ type: 'fire' })
    if (key === 'Backspace') return cmd({ type: 'backspace' })
    if (key === 'Delete') return cmd({ type: 'clearQuiver' })
    if (acceptsChar(ctx.input, key)) return cmd({ type: 'typeChar', char: key })
  } else if (ctx.inputMode === 'multiple-choice') {
    const index = key.length === 1 ? Math.max(CHOICE_DIGITS.indexOf(key), CHOICE_LETTERS.indexOf(key.toLowerCase())) : -1
    if (index >= 0) return cmd({ type: 'choose', index })
  }

  switch (key.length === 1 ? key.toLowerCase() : '') {
    case 'w':
      return cmd({ type: 'moveUp' })
    case 's':
      return cmd({ type: 'moveDown' })
    case 'p':
      return { type: 'togglePause' }
  }
  return null
}

/** Lane under a world-space y (taps above/below the lanes snap to the nearest one). */
export function laneAtY(worldY: number, lanes: number): number {
  const lane = Math.floor((worldY - WORLD.hudTop) / laneHeight(lanes))
  return Math.min(lanes - 1, Math.max(0, lane))
}

export type KeypadKey = { kind: 'char'; char: string } | { kind: 'backspace' } | { kind: 'fire' }

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

/**
 * On-screen keypad for a freeform input spec: digits (numeric) or letters then
 * digits (text), followed by any extra `allow` characters. Only characters the
 * spec accepts are offered.
 */
export function keypadChars(input: AnswerInputSpec): string[] {
  const base = input.kind === 'numeric' ? DIGITS : [...LETTERS, ...DIGITS]
  const extras = [...(input.allow ?? '')].filter((c) => !base.includes(c) && c.trim() !== '')
  return [...base, ...extras].filter((c, i, all) => all.indexOf(c) === i && acceptsChar(input, c))
}

/** Longest plain-text prompt an asteroid is expected to show in full. */
export const ASTEROID_PROMPT_MAX = 8

/**
 * Whether the question banner should show this problem's full prompt: always
 * for multiple choice, and whenever the asteroid can only show a short label
 * (or "?") because the prompt is long.
 */
export function needsBanner(problem: Problem): boolean {
  if (problem.format === 'multiple-choice') return true
  const plain = squash(mathTextToPlain(problem.prompt))
  if (problem.label !== undefined && squash(problem.label) !== plain) return true
  return [...plain].length > ASTEROID_PROMPT_MAX
}

const squash = (s: string) => s.replace(/\s+/g, '')

/** Accuracy as a whole percentage (0 when nothing was answered). */
export function accuracyPercent(correct: number, wrong: number): number {
  const total = correct + wrong
  return total > 0 ? Math.round((correct / total) * 100) : 0
}
