/**
 * Harness command language for the space shooter (DEV ONLY). Text commands
 * are forgiving ("choose 2", "c2", "Lane 0", "t 12") and map onto engine
 * Commands; structured commands use the engine's own shapes (0-based
 * `choose.index`). `resolveCheck` is host-only and never accepted here.
 */
import type { CommandSpec } from '../../../shared/harness/types'
import { acceptsChar } from '../engine/input'
import type { Command, GameState } from '../engine/types'

export const COMMANDS: CommandSpec[] = [
  { name: 'up', usage: 'up', description: 'Move the ship one lane up.' },
  { name: 'down', usage: 'down', description: 'Move the ship one lane down.' },
  { name: 'lane', usage: 'lane <n>', description: 'Move the ship to lane n (0 = top).' },
  { name: 'type', usage: 'type <text>', description: 'Freeform: append text to the quiver (filtered by `input`).' },
  { name: 'backspace', usage: 'backspace', description: 'Freeform: delete the last quiver character.' },
  { name: 'clear', usage: 'clear', description: 'Freeform: empty the quiver.' },
  { name: 'fire', usage: 'fire', description: 'Freeform: fire the quiver down the ship lane.' },
  { name: 'answer', usage: 'answer <text>', description: 'Freeform shortcut: clear + type <text> + fire.' },
  { name: 'choose', usage: 'choose <1-4>', description: 'Multiple choice: fire choice n (1-based, as listed in `choices`).' },
  { name: 'pause', usage: 'pause', description: 'Pause the game.' },
  { name: 'resume', usage: 'resume', description: 'Resume a paused game.' },
  { name: 'wait', usage: 'wait', description: 'Do nothing (just let time advance).' },
]

/** Engine commands a harness user may send (everything but resolveCheck). */
export type PlayerCommand = Exclude<Command, { type: 'resolveCheck' }>

/** Commands to dispatch in order (empty for `wait`), or why the input was rejected. */
export type ParseResult = { commands: PlayerCommand[] } | { error: string }

const ALIASES: Record<string, string> = {
  u: 'up', k: 'up', up: 'up', moveup: 'up',
  d: 'down', j: 'down', down: 'down', movedown: 'down',
  l: 'lane', lane: 'lane', move: 'lane', movetolane: 'lane', goto: 'lane',
  t: 'type', type: 'type', typechar: 'type', input: 'type',
  bs: 'backspace', backspace: 'backspace', del: 'backspace', delete: 'backspace',
  clear: 'clear', cl: 'clear', clearquiver: 'clear',
  f: 'fire', fire: 'fire', shoot: 'fire', enter: 'fire', space: 'fire',
  a: 'answer', answer: 'answer', ans: 'answer',
  c: 'choose', choose: 'choose', choice: 'choose', pick: 'choose', select: 'choose',
  p: 'pause', pause: 'pause',
  r: 'resume', resume: 'resume', unpause: 'resume', play: 'resume',
  w: 'wait', wait: 'wait', noop: 'wait', none: 'wait', idle: 'wait', '': 'wait',
}

const MAX_CHOICE = 4

function typeText(text: string): PlayerCommand[] {
  return [...text].map((char) => ({ type: 'typeChar', char }))
}

function integer(raw: string): number | null {
  if (!/^[+-]?\d+$/.test(raw)) return null
  return Number(raw)
}

function fromVerb(verb: string, arg: string, raw: string): ParseResult {
  switch (verb) {
    case 'up':
      return { commands: [{ type: 'moveUp' }] }
    case 'down':
      return { commands: [{ type: 'moveDown' }] }
    case 'lane': {
      const lane = integer(arg)
      if (lane === null || lane < 0) return { error: `"${raw}": expected "lane <n>" with n ≥ 0` }
      return { commands: [{ type: 'moveToLane', lane }] }
    }
    case 'type':
      if (!arg) return { error: `"${raw}": expected "type <text>"` }
      return { commands: typeText(arg) }
    case 'answer':
      if (!arg) return { error: `"${raw}": expected "answer <text>"` }
      return { commands: [{ type: 'clearQuiver' }, ...typeText(arg), { type: 'fire' }] }
    case 'backspace':
      return { commands: [{ type: 'backspace' }] }
    case 'clear':
      return { commands: [{ type: 'clearQuiver' }] }
    case 'fire':
      return { commands: [{ type: 'fire' }] }
    case 'choose': {
      const n = integer(arg)
      if (n === null || n < 1 || n > MAX_CHOICE) return { error: `"${raw}": expected "choose <1-${MAX_CHOICE}>"` }
      return { commands: [{ type: 'choose', index: n - 1 }] }
    }
    case 'pause':
      return { commands: [{ type: 'pause' }] }
    case 'resume':
      return { commands: [{ type: 'resume' }] }
    case 'wait':
      return { commands: [] }
  }
  return { error: `unknown command "${raw}"` }
}

function parseText(text: string): ParseResult {
  const raw = text.trim()
  // Verb is the leading letters; "c2" / "lane3" split without a space.
  const m = /^([a-z]*)\s*(.*)$/is.exec(raw)!
  const word = m[1].toLowerCase()
  const verb = ALIASES[word]
  if (verb === undefined) return { error: `unknown command "${raw}" (try: ${COMMANDS.map((c) => c.name).join(', ')})` }
  if (!word && m[2]) return { error: `"${raw}": missing verb (e.g. "choose ${m[2]}" or "type ${m[2]}")` }
  // `type` keeps its argument verbatim (after one separating space); others are trimmed.
  const arg = verb === 'type' || verb === 'answer' ? raw.slice(word.length).replace(/^\s/, '') : m[2].trim()
  return fromVerb(verb, arg, raw)
}

function parseObject(value: Record<string, unknown>): ParseResult {
  const type = typeof value.type === 'string' ? value.type : typeof value.cmd === 'string' ? value.cmd : ''
  switch (type) {
    case 'moveUp':
    case 'moveDown':
    case 'backspace':
    case 'clearQuiver':
    case 'fire':
    case 'pause':
    case 'resume':
      return { commands: [{ type }] }
    case 'moveToLane':
      if (!Number.isInteger(value.lane) || (value.lane as number) < 0) return { error: 'moveToLane: `lane` must be an integer ≥ 0' }
      return { commands: [{ type, lane: value.lane as number }] }
    case 'typeChar':
      if (typeof value.char !== 'string' || [...value.char].length !== 1) return { error: 'typeChar: `char` must be one character' }
      return { commands: [{ type, char: value.char }] }
    case 'choose':
      if (Number.isInteger(value.index) && (value.index as number) >= 0) return { commands: [{ type, index: value.index as number }] }
      if (Number.isInteger(value.n)) return fromVerb('choose', String(value.n), `choose ${value.n}`)
      return { error: 'choose: `index` must be an integer ≥ 0 (or `n` 1-based)' }
    case 'resolveCheck':
      return { error: 'resolveCheck is host-only' }
  }
  // Verb objects: { type: 'lane', lane: 2 }, { cmd: 'type', text: '12' }, { type: 'wait' }.
  const verb = ALIASES[type.toLowerCase()]
  if (verb === undefined) return { error: `unknown command type "${type}"` }
  const arg = value.text ?? value.arg ?? value.lane ?? value.n ?? ''
  return fromVerb(verb, String(arg), JSON.stringify(value))
}

/** Parse a text or structured harness command. */
export function parseCommand(input: string | object): ParseResult {
  if (typeof input === 'string') return parseText(input)
  if (input && typeof input === 'object' && !Array.isArray(input)) return parseObject(input as Record<string, unknown>)
  return { error: 'command must be a string or an object' }
}

function describeInput(s: GameState): string {
  const kind = s.input.kind === 'numeric' ? 'digits' : 'letters/digits'
  return `${kind}${s.input.allow ? ` and "${s.input.allow}"` : ''}, max ${s.input.maxLength}`
}

/**
 * Why `commands` would do nothing in state `s` (so the harness can say so
 * instead of silently ignoring them), or null if they apply.
 */
export function validateCommands(commands: readonly PlayerCommand[], s: GameState): string | null {
  let quiver = [...s.quiver].length
  for (const c of commands) {
    if (c.type === 'pause' || c.type === 'resume') continue
    if (s.status !== 'playing') return `game is ${s.status}${s.status === 'paused' ? ' (send "resume")' : ''}`
    switch (c.type) {
      case 'choose':
        if (s.inputMode !== 'multiple-choice') return s.targetId === null ? 'no target in this lane' : 'target is freeform: use "answer <text>" (or type + fire)'
        if (c.index >= s.choices.length) return `only ${s.choices.length} choices`
        break
      case 'typeChar':
        if (s.inputMode !== 'freeform') return s.targetId === null ? 'no target in this lane' : 'target is multiple choice: use "choose <n>"'
        if (!acceptsChar(s.input, c.char)) return `"${c.char}" not accepted (input: ${describeInput(s)})`
        if (++quiver > s.input.maxLength) return `answer too long (input: ${describeInput(s)})`
        break
      case 'clearQuiver':
        quiver = 0
        break
      case 'fire':
        if (s.inputMode !== 'freeform') return s.targetId === null ? 'no target in this lane' : 'target is multiple choice: use "choose <n>"'
        if (quiver === 0) return 'quiver is empty: "type <text>" first'
        quiver = 0
        break
    }
  }
  return null
}
