import { describe, expect, test } from 'bun:test'
import type { AnswerInputSpec, Problem } from '../../../generators/types'
import { WORLD, laneCenterY, type GameEvent } from '../engine/types'
import { accuracyPercent, keypadChars, keyToAction, laneAtY, needsBanner, type KeyContext } from './controls'
import { cueFor, playCues } from './cues'

const numeric: AnswerInputSpec = { kind: 'numeric', maxLength: 3 }
const text: AnswerInputSpec = { kind: 'text', maxLength: 12, allow: '-./x^' }
const freeform = (input: AnswerInputSpec = numeric): KeyContext => ({ inputMode: 'freeform', input })
const mc: KeyContext = { inputMode: 'multiple-choice', input: numeric }
const none: KeyContext = { inputMode: null, input: numeric }

describe('keyToAction', () => {
  test('arrows and Escape work in every mode', () => {
    for (const ctx of [freeform(), freeform(text), mc, none]) {
      expect(keyToAction('ArrowUp', ctx)).toEqual({ type: 'command', command: { type: 'moveUp' } })
      expect(keyToAction('ArrowDown', ctx)).toEqual({ type: 'command', command: { type: 'moveDown' } })
      expect(keyToAction('Escape', ctx)).toEqual({ type: 'togglePause' })
    }
  })

  test('freeform numeric: digits type, Enter/Space fire, W/S/P still work', () => {
    expect(keyToAction('7', freeform())).toEqual({ type: 'command', command: { type: 'typeChar', char: '7' } })
    expect(keyToAction('Enter', freeform())).toEqual({ type: 'command', command: { type: 'fire' } })
    expect(keyToAction(' ', freeform())).toEqual({ type: 'command', command: { type: 'fire' } })
    expect(keyToAction('Backspace', freeform())).toEqual({ type: 'command', command: { type: 'backspace' } })
    expect(keyToAction('Delete', freeform())).toEqual({ type: 'command', command: { type: 'clearQuiver' } })
    expect(keyToAction('w', freeform())).toEqual({ type: 'command', command: { type: 'moveUp' } })
    expect(keyToAction('S', freeform())).toEqual({ type: 'command', command: { type: 'moveDown' } })
    expect(keyToAction('p', freeform())).toEqual({ type: 'togglePause' })
    expect(keyToAction('x', freeform())).toBeNull()
  })

  test('freeform numeric honours `allow`', () => {
    const signed = freeform({ kind: 'numeric', maxLength: 4, allow: '-' })
    expect(keyToAction('-', signed)).toEqual({ type: 'command', command: { type: 'typeChar', char: '-' } })
    expect(keyToAction('-', freeform())).toBeNull()
  })

  test('freeform text: letters type (even W/S/P)', () => {
    expect(keyToAction('w', freeform(text))).toEqual({ type: 'command', command: { type: 'typeChar', char: 'w' } })
    expect(keyToAction('P', freeform(text))).toEqual({ type: 'command', command: { type: 'typeChar', char: 'P' } })
    expect(keyToAction('^', freeform(text))).toEqual({ type: 'command', command: { type: 'typeChar', char: '^' } })
    expect(keyToAction('Shift', freeform(text))).toBeNull()
  })

  test('multiple choice: 1–4 and A–D choose', () => {
    expect(keyToAction('1', mc)).toEqual({ type: 'command', command: { type: 'choose', index: 0 } })
    expect(keyToAction('4', mc)).toEqual({ type: 'command', command: { type: 'choose', index: 3 } })
    expect(keyToAction('b', mc)).toEqual({ type: 'command', command: { type: 'choose', index: 1 } })
    expect(keyToAction('D', mc)).toEqual({ type: 'command', command: { type: 'choose', index: 3 } })
    expect(keyToAction('5', mc)).toBeNull()
    expect(keyToAction('Enter', mc)).toBeNull()
    expect(keyToAction('s', mc)).toEqual({ type: 'command', command: { type: 'moveDown' } })
  })

  test('no target: typing and choosing do nothing', () => {
    expect(keyToAction('3', none)).toBeNull()
    expect(keyToAction('a', none)).toBeNull()
    expect(keyToAction('Enter', none)).toBeNull()
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
