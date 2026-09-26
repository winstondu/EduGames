import { describe, expect, test } from 'bun:test'
import type { AnswerInputSpec, Problem } from '../../../generators/types'
import { createKeymap, type Keymap } from '../../../shared/kit/input/keymap'
import { WORLD, laneCenterY, type Command, type GameEvent } from '../engine/types'
import { SHOOTER_ACTIONS } from '../input/actions'
import { accuracyPercent, dragLane, keypadChars, numericPadLayout, keyToAction, laneAtY, needsBanner, type KeyAction, type KeyContext, type KeyEventLike } from './controls'
import { cueFor, playCues } from './cues'

const numeric: AnswerInputSpec = { kind: 'numeric', maxLength: 3 }
const text: AnswerInputSpec = { kind: 'text', maxLength: 12, allow: '-./x^' }
const freeform = (input: AnswerInputSpec = numeric): KeyContext => ({ inputMode: 'freeform', input })
const mc: KeyContext = { inputMode: 'multiple-choice', input: numeric }
const none: KeyContext = { inputMode: null, input: numeric }

/** A key event from `key` (layout character) and `code` (physical key). */
function ev(key: string, code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return { key, code, ...mods }
}
const DIGIT = (d: string) => ev(d, `Digit${d}`)
const LETTER = (l: string) => ev(l, `Key${l.toUpperCase()}`)
const ENTER = ev('Enter', 'Enter')
const SPACE = ev(' ', 'Space')

describe('keyToAction', () => {
  const both = createKeymap(SHOOTER_ACTIONS)
  const arrows = createKeymap(SHOOTER_ACTIONS, { version: 1, preset: 'arrows', custom: {} })
  const key = (e: KeyEventLike, ctx: KeyContext, keymap: Keymap = both) => keyToAction(keymap, e, ctx)
  const command = (c: Command): KeyAction => ({ type: 'command', command: c })

  test('arrows and Escape work in every mode', () => {
    for (const ctx of [freeform(), freeform(text), mc, none]) {
      expect(key(ev('ArrowUp', 'ArrowUp'), ctx)).toEqual(command({ type: 'moveUp' }))
      expect(key(ev('ArrowDown', 'ArrowDown'), ctx)).toEqual(command({ type: 'moveDown' }))
      expect(key(ev('Escape', 'Escape'), ctx)).toEqual({ type: 'togglePause' })
    }
  })

  test('freeform numeric: digits type, Enter/Space fire, W/S/P still work', () => {
    expect(key(DIGIT('7'), freeform())).toEqual(command({ type: 'typeChar', char: '7' }))
    expect(key(ENTER, freeform())).toEqual(command({ type: 'fire' }))
    expect(key(SPACE, freeform())).toEqual(command({ type: 'fire' }))
    expect(key(ev('Backspace', 'Backspace'), freeform())).toEqual(command({ type: 'backspace' }))
    expect(key(ev('Delete', 'Delete'), freeform())).toEqual(command({ type: 'clearQuiver' }))
    expect(key(LETTER('w'), freeform())).toEqual(command({ type: 'moveUp' }))
    expect(key(ev('S', 'KeyS'), freeform())).toEqual(command({ type: 'moveDown' }))
    expect(key(LETTER('p'), freeform())).toEqual({ type: 'togglePause' })
    expect(key(LETTER('x'), freeform())).toBeNull()
  })

  test('freeform numeric honours `allow`', () => {
    const signed = freeform({ kind: 'numeric', maxLength: 4, allow: '-' })
    expect(key(ev('-', 'Minus'), signed)).toEqual(command({ type: 'typeChar', char: '-' }))
    expect(key(ev('-', 'Minus'), freeform())).toBeNull()
  })

  test('freeform text: letters type (even W/S/P)', () => {
    expect(key(LETTER('w'), freeform(text))).toEqual(command({ type: 'typeChar', char: 'w' }))
    expect(key(ev('P', 'KeyP'), freeform(text))).toEqual(command({ type: 'typeChar', char: 'P' }))
    expect(key(ev('^', 'Digit6'), freeform(text))).toEqual(command({ type: 'typeChar', char: '^' }))
    expect(key(ev('Shift', 'ShiftLeft'), freeform(text))).toBeNull()
  })

  test('multiple choice: digits (and numpad in arrows/both) choose; letters never do', () => {
    expect(key(DIGIT('1'), mc)).toEqual(command({ type: 'choose', index: 0 }))
    expect(key(DIGIT('4'), mc)).toEqual(command({ type: 'choose', index: 3 }))
    expect(key(ev('2', 'Numpad2'), mc, arrows)).toEqual(command({ type: 'choose', index: 1 }))
    expect(key(LETTER('b'), mc)).toBeNull()
    expect(key(LETTER('d'), mc)).toBeNull()
    expect(key(DIGIT('5'), mc)).toBeNull()
    expect(key(ENTER, mc)).toBeNull()
    expect(key(LETTER('s'), mc)).toEqual(command({ type: 'moveDown' }))
  })

  test('no target: typing and choosing do nothing', () => {
    expect(key(DIGIT('3'), none)).toBeNull()
    expect(key(LETTER('a'), none)).toBeNull()
    expect(key(ENTER, none)).toBeNull()
  })

  test('presets and rebinding: arrows-only ignores W; a rebound key moves', () => {
    expect(key(LETTER('w'), mc, arrows)).toBeNull()
    const custom = createKeymap(SHOOTER_ACTIONS, { version: 1, preset: 'arrows', custom: { moveUp: ['KeyI'] } })
    expect(key(LETTER('i'), mc, custom)).toEqual(command({ type: 'moveUp' }))
    expect(key(ev('ArrowUp', 'ArrowUp'), mc, custom)).toBeNull()
    // A rebound printable key still yields to typing when the answer accepts it.
    expect(key(LETTER('i'), freeform(text), custom)).toEqual(command({ type: 'typeChar', char: 'i' }))
  })

  test('NumLock off: numpad 8/2 follow the arrow bindings', () => {
    expect(key(ev('ArrowUp', 'Numpad8'), mc)).toEqual(command({ type: 'moveUp' }))
    expect(key(ev('ArrowDown', 'Numpad2'), freeform())).toEqual(command({ type: 'moveDown' }))
    // With NumLock on the same key types or chooses as usual.
    expect(key(ev('2', 'Numpad2'), mc, arrows)).toEqual(command({ type: 'choose', index: 1 }))
  })

  test('modifier chords are never ours', () => {
    expect(key(DIGIT('1'), mc)).not.toBeNull()
    expect(key(ev('1', 'Digit1', { ctrlKey: true }), mc)).toBeNull()
    expect(key(ev('7', 'Digit7', { metaKey: true }), freeform())).toBeNull()
  })
})

describe('laneAtY', () => {
  test('lane centres map to their lane', () => {
    for (const lanes of [3, 4, 5]) {
      for (let lane = 0; lane < lanes; lane++) expect(laneAtY(laneCenterY(lane, lanes), lanes)).toBe(lane)
    }
  })
  test('outside the lane band clamps', () => {
    expect(laneAtY(0, 4)).toBe(0)
    expect(laneAtY(WORLD.height + 50, 4)).toBe(3)
    expect(laneAtY(-100, 3)).toBe(0)
  })
})

describe('dragLane', () => {
  const lanes = 4
  const at = (laneUnits: number) => WORLD.hudTop + (laneUnits + 0.5) * ((laneCenterY(1, lanes) - laneCenterY(0, lanes)))

  test('stays put near the current lane, including just past a boundary', () => {
    expect(dragLane(at(1), lanes, 1)).toBe(1)
    expect(dragLane(at(1.6), lanes, 1)).toBe(1)
    expect(dragLane(at(0.4), lanes, 1)).toBe(1)
  })

  test('switches once clearly into the next lane, and jumps on fast drags', () => {
    expect(dragLane(at(1.7), lanes, 1)).toBe(2)
    expect(dragLane(at(0.3), lanes, 1)).toBe(0)
    expect(dragLane(at(3), lanes, 0)).toBe(3)
  })

  test('clamps outside the lane band', () => {
    expect(dragLane(-500, lanes, 2)).toBe(0)
    expect(dragLane(WORLD.height + 500, lanes, 1)).toBe(lanes - 1)
  })

  test('hysteresis both ways: back across the line needs the same margin', () => {
    // From lane 2, a pointer at 1.4 (0.1 past the 1|2 line) keeps lane 2; 1.3 switches.
    expect(dragLane(at(1.4), lanes, 2)).toBe(2)
    expect(dragLane(at(1.3), lanes, 2)).toBe(1)
  })
})

describe('numericPadLayout', () => {
  const label = (k: ReturnType<typeof numericPadLayout>[number]) => (k === null ? '_' : k.kind === 'char' ? k.char : k.kind)

  test('dial pad: 1–9 then ⌫ 0 FIRE', () => {
    expect(numericPadLayout({ kind: 'numeric', maxLength: 3 }).map(label).join(' ')).toBe('1 2 3 4 5 6 7 8 9 backspace 0 fire')
  })

  test('extras get their own padded row, keeping ⌫ 0 FIRE aligned at the bottom', () => {
    const keys = numericPadLayout({ kind: 'numeric', maxLength: 5, allow: '-/' }).map(label)
    expect(keys.join(' ')).toBe('1 2 3 4 5 6 7 8 9 - / _ backspace 0 fire')
    expect(keys.length % 3).toBe(0)
  })
})

describe('keypadChars', () => {
  test('numeric: digits plus allowed extras', () => {
    expect(keypadChars(numeric)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
    expect(keypadChars({ kind: 'numeric', maxLength: 5, allow: '-./' })).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '.', '/',
    ])
  })
  test('text: letters, digits, extras without duplicates', () => {
    const keys = keypadChars(text)
    expect(keys.slice(0, 3)).toEqual(['a', 'b', 'c'])
    expect(keys).toContain('0')
    expect(keys.slice(-4)).toEqual(['-', '.', '/', '^'])
    expect(keys.filter((k) => k === 'x').length).toBe(1)
  })
})

describe('needsBanner', () => {
  const base: Problem = { id: '1', prompt: '6 + 7', level: 1, format: 'freeform' }
  test('short freeform prompts stay on the asteroid', () => {
    expect(needsBanner(base)).toBe(false)
    expect(needsBanner({ ...base, prompt: '12 × 7', label: '12×7' })).toBe(false)
  })
  test('long prompts, informative labels and multiple choice get the banner', () => {
    expect(needsBanner({ ...base, prompt: 'What is 125 + 250?' })).toBe(true)
    expect(needsBanner({ ...base, prompt: 'Combine like terms: $4x + 6x$', label: '4x + 6x' })).toBe(true)
    expect(needsBanner({ ...base, format: 'multiple-choice', choices: [{ id: 'a', text: '13' }] })).toBe(true)
  })
})

describe('accuracyPercent', () => {
  test('rounds and handles zero', () => {
    expect(accuracyPercent(0, 0)).toBe(0)
    expect(accuracyPercent(2, 1)).toBe(67)
    expect(accuracyPercent(5, 0)).toBe(100)
  })
})

describe('cues', () => {
  test('maps events to sounds and music', () => {
    expect(cueFor({ type: 'hit', asteroidId: 1, lane: 0, x: 0, points: 10, bonus: false })?.sfx).toBe('zap')
    expect(cueFor({ type: 'wrongAnswer', asteroidId: 1, lane: 0, x: 0, display: '3' })?.sfx).toBe('boing')
    expect(cueFor({ type: 'shipHit', lane: 0, absorbedByShield: false })?.sfx).toBe('crunch')
    expect(cueFor({ type: 'shipHit', lane: 0, absorbedByShield: true })?.sfx).toBe('clang')
    expect(cueFor({ type: 'powerupCollected', kind: 'shield', lane: 0, fromRandom: false })?.sfx).toBe('powerup')
    expect(cueFor({ type: 'levelUp', level: 2 })).toEqual({ sfx: 'levelUp' })
    expect(cueFor({ type: 'levelUp', level: 5 })).toEqual({ sfx: 'levelUp', music: 'intense' })
    expect(cueFor({ type: 'gameOver', score: 10 })).toEqual({ sfx: 'gameOver', music: null })
    expect(cueFor({ type: 'targetChanged', targetId: null })).toBeNull()
  })

  test('playCues plays each sound once per batch and switches music', () => {
    const calls: string[] = []
    const audio = {
      sfx: (name: string) => void calls.push(`sfx:${name}`),
      music: (name: string | null) => void calls.push(`music:${name}`),
    }
    const hit: GameEvent = { type: 'hit', asteroidId: 1, lane: 0, x: 0, points: 10, bonus: false }
    playCues(audio, [hit, { ...hit, asteroidId: 2 }, { type: 'levelUp', level: 6 }, { type: 'gameOver', score: 1 }])
    expect(calls).toEqual(['sfx:zap', 'sfx:levelUp', 'music:intense', 'sfx:gameOver', 'music:null'])
  })
})
