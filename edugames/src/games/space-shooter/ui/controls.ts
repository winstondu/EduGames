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

/** One grid cell of a keypad (null = spacer); `span` columns wide (default 1). */
export type PadCell = (KeypadKey & { span?: number }) | null

/** A keypad grid: `cells` fill `columns`-wide rows in order (spans included). */
export interface PadLayout {
  columns: number
  cells: PadCell[]
}

const char = (c: string): KeypadKey => ({ kind: 'char', char: c })

/**
 * Phone-style dial pad for numeric answers. Without extras: 3 columns, 1–9
 * then ⌫ 0 FIRE. With the spec's extra characters (e.g. "-", ".", "/"): a 4th
 * column holds them beside the digit rows (overflow gets rows of its own) and
 * FIRE spans 2 — FIRE stays in the pad so the deck fits small phones.
 */
export function numericPadLayout(input: AnswerInputSpec): PadLayout {
  const chars = keypadChars(input)
  const digit = (d: string): PadCell => (chars.includes(d) ? char(d) : null)
  const extras = chars.filter((c) => !/[0-9]/.test(c))
  const rows = ['123', '456', '789'].map((row) => [...row].map(digit))
  const bottom: PadCell[] = [{ kind: 'backspace' }, digit('0')]
  if (!extras.length) return { columns: 3, cells: [...rows.flat(), ...bottom, { kind: 'fire' }] }
  const side: PadCell[] = extras.map(char)
  const cells = rows.flatMap((row) => [...row, side.shift() ?? null])
  while (side.length) cells.push(...[0, 1, 2, 3].map(() => side.shift() ?? null))
  return { columns: 4, cells: [...cells, ...bottom, { kind: 'fire', span: 2 }] }
}

const TEXT_COLUMNS = 6

/**
 * Text keypad sized for the narrow side deck (6 columns, fits a landscape
 * phone without scrolling): a–z, space, ⌫ and the spec's extra characters,
 * then the digits on rows of their own with FIRE spanning the rest of the
 * last row (bottom-right, as on the dial pad).
 */
export function textPadLayout(input: AnswerInputSpec): PadLayout {
  const chars = keypadChars(input)
  const cells: PadCell[] = []
  let col = 0 // column of the next cell in the current row
  const put = (cell: PadCell, span = 1) => {
    cells.push(cell && span > 1 ? { ...cell, span } : cell)
    col = (col + span) % TEXT_COLUMNS
  }
  const endRow = () => {
    while (col) put(null)
  }
  const isDigit = (c: string) => /^[0-9]$/.test(c)
  chars.filter((c) => LETTERS.includes(c)).forEach((c) => put(char(c)))
  if (acceptsChar(input, ' ')) put(char(' '))
  put({ kind: 'backspace' })
  chars.filter((c) => !LETTERS.includes(c) && !isDigit(c)).forEach((c) => put(char(c)))
  endRow()
  chars.filter(isDigit).forEach((c) => put(char(c)))
  // FIRE takes the rest of the last row (a full row when fewer than 2 columns are left).
  if (col > TEXT_COLUMNS - 2) endRow()
  put({ kind: 'fire' }, TEXT_COLUMNS - col)
  return { columns: TEXT_COLUMNS, cells }
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
