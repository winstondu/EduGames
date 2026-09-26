import { describe, expect, test } from 'bun:test'
import { PRESET_IDS, createKeymap } from '../../../shared/kit/input/keymap'
import { SHOOTER_ACTIONS, mapActionToCommand } from './actions'

const PLAY = { textEntry: false }
const TYPING = { textEntry: true }
const key = (code: string) => ({ code })

describe('SHOOTER_ACTIONS', () => {
  test('declares the expected actions with every preset', () => {
    expect(SHOOTER_ACTIONS.map((a) => a.id)).toEqual(['moveUp', 'moveDown', 'fire', 'backspace', 'choose1', 'choose2', 'choose3', 'choose4', 'pause'])
    for (const a of SHOOTER_ACTIONS) for (const p of PRESET_IDS) expect(a.defaults[p].length).toBeGreaterThan(0)
  })

  test('no preset has conflicts', () => {
    for (const p of PRESET_IDS) {
      const k = createKeymap(SHOOTER_ACTIONS, { preset: p })
      expect(k.conflicts()).toEqual([])
    }
  })

  test('"both" is the union of arrows and WASD', () => {
    for (const a of SHOOTER_ACTIONS) {
      expect(new Set(a.defaults.both)).toEqual(new Set([...a.defaults.arrows, ...a.defaults.wasd]))
    }
  })

  test('A/D are never bound; choices are digits/numpad only', () => {
    for (const a of SHOOTER_ACTIONS) {
      for (const p of PRESET_IDS) {
        expect(a.defaults[p]).not.toContain('KeyA')
        expect(a.defaults[p]).not.toContain('KeyD')
        if (a.id.startsWith('choose')) for (const c of a.defaults[p]) expect(c).toMatch(/^(Digit|Numpad)[1-4]$/)
      }
    }
    expect(createKeymap(SHOOTER_ACTIONS, { preset: 'wasd' }).match(key('KeyA'), PLAY)).toBeNull()
  })

  test('presets route the expected keys', () => {
    const arrows = createKeymap(SHOOTER_ACTIONS, { preset: 'arrows' })
    expect(arrows.match(key('ArrowUp'), PLAY)).toBe('moveUp')
    expect(arrows.match(key('KeyW'), PLAY)).toBeNull()
    expect(arrows.match(key('Numpad3'), PLAY)).toBe('choose3')
    expect(arrows.match(key('KeyP'), PLAY)).toBe('pause')
    const wasd = createKeymap(SHOOTER_ACTIONS, { preset: 'wasd' })
    expect(wasd.match(key('KeyS'), PLAY)).toBe('moveDown')
    expect(wasd.match(key('ArrowDown'), PLAY)).toBeNull()
    expect(wasd.match(key('Digit2'), PLAY)).toBe('choose2')
    expect(wasd.match(key('Enter'), PLAY)).toBe('fire')
    expect(wasd.match(key('Escape'), PLAY)).toBe('pause')
  })

  test('typing an answer suspends letters/digits; arrows, fire, backspace, pause keep working', () => {
    const k = createKeymap(SHOOTER_ACTIONS)
    expect(k.match(key('KeyW'), TYPING)).toBeNull()
    expect(k.match(key('KeyS'), TYPING)).toBeNull()
    expect(k.match(key('KeyP'), TYPING)).toBeNull()
    expect(k.match(key('Digit1'), TYPING)).toBeNull()
    expect(k.match(key('Numpad1'), TYPING)).toBeNull()
    expect(k.match(key('ArrowUp'), TYPING)).toBe('moveUp')
    expect(k.match(key('Space'), TYPING)).toBe('fire')
    expect(k.match(key('Enter'), TYPING)).toBe('fire')
    expect(k.match(key('Backspace'), TYPING)).toBe('backspace')
    expect(k.match(key('Escape'), TYPING)).toBe('pause')
  })
})

describe('mapActionToCommand', () => {
  test('maps every action to an engine command', () => {
    expect(mapActionToCommand('moveUp')).toEqual({ type: 'moveUp' })
    expect(mapActionToCommand('moveDown')).toEqual({ type: 'moveDown' })
    expect(mapActionToCommand('fire')).toEqual({ type: 'fire' })
    expect(mapActionToCommand('backspace')).toEqual({ type: 'backspace' })
    expect(mapActionToCommand('choose1')).toEqual({ type: 'choose', index: 0 })
    expect(mapActionToCommand('choose4')).toEqual({ type: 'choose', index: 3 })
    for (const a of SHOOTER_ACTIONS) expect(mapActionToCommand(a.id)).not.toBeNull()
  })

  test('pause toggles with status; unknown ids → null', () => {
    expect(mapActionToCommand('pause')).toEqual({ type: 'pause' })
    expect(mapActionToCommand('pause', 'playing')).toEqual({ type: 'pause' })
    expect(mapActionToCommand('pause', 'paused')).toEqual({ type: 'resume' })
    expect(mapActionToCommand('choose5')).toBeNull()
    expect(mapActionToCommand('jump')).toBeNull()
  })
})
