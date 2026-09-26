/**
 * Pure input mapping for the space shooter screen: keyboard (via the
 * player's keymap) → engine commands, tap position → lane, keypad layouts. No DOM access.
 */
import type { AnswerInputSpec, Problem, ProblemFormat } from '../../../generators/types'
import type { KeyLike, Keymap } from '../../../shared/kit/input/keymap'
import { mathTextToPlain } from '../../../shared/mathtext/parse'
import { acceptsChar } from '../engine/input'
import { WORLD, laneHeight, type Command } from '../engine/types'
import { mapActionToCommand } from '../input/actions'

export interface KeyContext {
  inputMode: ProblemFormat | null
  input: AnswerInputSpec
}

export type KeyAction = { type: 'command'; command: Command } | { type: 'togglePause' }

const cmd = (command: Command): KeyAction => ({ type: 'command', command })

/** The subset of KeyboardEvent the mapping reads. */
export type KeyEventLike = KeyLike & { key: string }

/** Actions that auto-repeat while a key is held. */
export const REPEATING_ACTIONS: ReadonlySet<string> = new Set(['moveUp', 'moveDown', 'backspace'])

/**
 * Map a key event to an action through the player's keymap, or null if the
 * key isn't ours. Typing wins over bindings: a character the current freeform
 * answer accepts types (so W types into a text answer but still moves the
 * ship while the answer is numeric). Unbound: Delete clears the quiver.
 */
export function keyToAction(keymap: Keymap, event: KeyEventLike, ctx: KeyContext): KeyAction | null {
  // NumLock off: Numpad8/2 report ArrowUp/ArrowDown keys with their own codes; treat them as the arrows.
  if (event.code.startsWith('Numpad') && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) event = { ...event, code: event.key }
  const freeform = ctx.inputMode === 'freeform'
  const typing = freeform && [...event.key].length === 1 && acceptsChar(ctx.input, event.key)
  const id = keymap.match(event, { textEntry: typing })
  if (id === 'pause') return { type: 'togglePause' }
  if (id) {
    if (/^choose/.test(id) && ctx.inputMode !== 'multiple-choice') return null
    if ((id === 'fire' || id === 'backspace') && !freeform) return null
    const command = mapActionToCommand(id)
    return command ? cmd(command) : null
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (typing) return cmd({ type: 'typeChar', char: event.key })
  if (freeform && event.code === 'Delete') return cmd({ type: 'clearQuiver' })
  return null
}

/** Lane under a world-space y (taps above/below the lanes snap to the nearest one). */
export function laneAtY(worldY: number, lanes: number): number {
  const lane = Math.floor((worldY - WORLD.hudTop) / laneHeight(lanes))
  return Math.min(lanes - 1, Math.max(0, lane))
}

/** Fraction of a lane the pointer must pass a boundary by before a drag switches lanes. */
export const DRAG_HYSTERESIS = 0.15

/**
 * Lane for a drag at world y, snapping with hysteresis: the ship leaves
 * `current` only once the pointer is DRAG_HYSTERESIS of a lane past the
 * boundary, so a finger resting on a lane line doesn't jitter.
 */
export function dragLane(worldY: number, lanes: number, current: number, hysteresis = DRAG_HYSTERESIS): number {
  // Pointer position in lane units, 0 = centre of the top lane.
  const u = (worldY - WORLD.hudTop) / laneHeight(lanes) - 0.5
  if (Math.abs(u - current) <= 0.5 + hysteresis) return current
  return Math.min(lanes - 1, Math.max(0, Math.round(u)))
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

/**
 * Phone-style dial pad for numeric answers (3 columns): 1–9, then a row of
 * the spec's extra characters (e.g. "-", "/", padded with null spacers), then
 * ⌫ 0 FIRE — so FIRE sits in the pad and the deck fits small phones.
 */
export function numericPadLayout(input: AnswerInputSpec): (KeypadKey | null)[] {
  const chars = keypadChars(input)
  const digits = '123456789'.split('').filter((d) => chars.includes(d))
  const extras = chars.filter((c) => !/[0-9]/.test(c))
  const char = (c: string): KeypadKey => ({ kind: 'char', char: c })
  const extraRows = extras.map(char) as (KeypadKey | null)[]
  while (extraRows.length % 3) extraRows.push(null)
  return [...digits.map(char), ...extraRows, { kind: 'backspace' }, chars.includes('0') ? char('0') : null, { kind: 'fire' }]
}

export interface AnswerFieldContext {
  /** Portrait (stacked) layout. */
  stacked: boolean
  /** Primary pointer is coarse (touch device, likely without a physical keyboard). */
  coarse: boolean
  input: AnswerInputSpec
}

/**
 * Whether a freeform answer is typed into a real text field with the device's
 * system keyboard instead of the in-game keypad: text answers in the stacked
 * touch layout. Numeric answers keep the dial pad; wide layouts and fine
 * pointers (desktop, typing on a physical keyboard) keep the game's own input.
 */
export function usesSystemKeyboard(ctx: AnswerFieldContext): boolean {
  return ctx.stacked && ctx.coarse && ctx.input.kind === 'text'
}

/** Look-alike characters a system keyboard's autocorrect may substitute (smart dashes, minus sign). */
const LOOKALIKES: Readonly<Record<string, string>> = { '−': '-', '–': '-', '—': '-' }

export interface QuiverEdit {
  /** Engine commands that turn the quiver into the accepted part of the field's value. */
  commands: Command[]
  /** Characters the answer spec refuses (never reach the quiver). */
  rejected: string[]
}

/**
 * Diff a text field's new value against the engine's quiver: remove what
 * differs after the common prefix (backspaces, or one clearQuiver when nothing
 * is kept — e.g. autocorrect replacing the word), then type the rest. Rejected
 * characters are skipped and reported; typing stops at the spec's maxLength.
 */
export function quiverEdits(quiver: string, value: string, input: AnswerInputSpec): QuiverEdit {
  const have = [...quiver]
  const want = [...value].map((c) => {
    const plain = LOOKALIKES[c]
    return plain && !acceptsChar(input, c) && acceptsChar(input, plain) ? plain : c
  })
  let keep = 0
  while (keep < have.length && keep < want.length && have[keep] === want[keep]) keep++
  const commands: Command[] = []
  const drop = have.length - keep
  if (drop > 0 && keep === 0) commands.push({ type: 'clearQuiver' })
  else for (let i = 0; i < drop; i++) commands.push({ type: 'backspace' })
  const rejected: string[] = []
  let length = keep
  for (const char of want.slice(keep)) {
    if (!acceptsChar(input, char)) rejected.push(char)
    else if (length < input.maxLength) {
      commands.push({ type: 'typeChar', char })
      length++
    }
  }
  return { commands, rejected }
}

/** What an answer spec lets the player type, for the text field's help line (e.g. "letters, numbers, spaces and - . /"). */
export function allowedCharsHint(input: AnswerInputSpec): string {
  const base = input.kind === 'text' ? ['letters', 'numbers', 'spaces'] : ['numbers']
  const plain: AnswerInputSpec = { kind: input.kind, maxLength: input.maxLength }
  const extras = [...new Set(input.allow ?? '')].filter((c) => !acceptsChar(plain, c))
  const space = extras.includes(' ')
  const symbols = extras.filter((c) => c !== ' ')
  const parts = [...base, ...(space ? ['spaces'] : [])]
  if (symbols.length) parts.push(symbols.join(' '))
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
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

/** Leaderboard entries played below normal speed (meta.speed < 1) show a 🐢. */
export function isSlowMotion(meta: Record<string, unknown> | undefined): boolean {
  const speed = Number(meta?.speed)
  return Number.isFinite(speed) && speed < 1
}
