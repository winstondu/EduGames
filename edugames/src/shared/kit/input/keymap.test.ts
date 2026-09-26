import { afterEach, describe, expect, test } from 'bun:test'
import { createKeymap, isPrintableCode, keyLabel, loadKeymap, saveKeymap, type ActionDef } from './keymap'

const ACTIONS: ActionDef[] = [
  { id: 'up', label: 'Up', defaults: { arrows: ['ArrowUp'], wasd: ['KeyW'], both: ['ArrowUp', 'KeyW'] } },
  { id: 'down', label: 'Down', defaults: { arrows: ['ArrowDown'], wasd: ['KeyS'], both: ['ArrowDown', 'KeyS'] } },
  { id: 'fire', label: 'Fire', alwaysActive: true, defaults: { arrows: ['Space'], wasd: ['Space'], both: ['Space'] } },
  { id: 'pause', label: 'Pause', defaults: { arrows: ['Escape', 'KeyP'], wasd: ['Escape'], both: ['Escape', 'KeyP'] } },
  { id: 'choose1', label: 'Choice 1', defaults: { arrows: ['Digit1'], wasd: ['Digit1'], both: ['Digit1'] } },
]

const key = (code: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({ code, ...mods })
const PLAY = { textEntry: false }
const TYPING = { textEntry: true }

describe('createKeymap', () => {
  test('defaults to the "both" preset', () => {
    const k = createKeymap(ACTIONS)
    expect(k.preset).toBe('both')
    expect(k.match(key('ArrowUp'))).toBe('up')
    expect(k.match(key('KeyW'))).toBe('up')
    expect(k.match(key('KeyA'))).toBeNull()
    expect(k.customized).toBe(false)
  })

  test('presets switch bindings and drop customisations', () => {
    const k = createKeymap(ACTIONS)
    k.rebind('fire', 'Enter')
    k.setPreset('arrows')
    expect(k.match(key('KeyW'), PLAY)).toBeNull()
    expect(k.match(key('ArrowUp'), PLAY)).toBe('up')
    expect(k.bindings.fire).toEqual(['Space'])
    k.setPreset('wasd')
    expect(k.match(key('ArrowUp'), PLAY)).toBeNull()
    expect(k.match(key('KeyS'), PLAY)).toBe('down')
    expect(k.match(key('KeyP'), PLAY)).toBeNull()
  })

  test('physical codes: AZERTY Z key sends KeyW, so it moves up', () => {
    const k = createKeymap(ACTIONS, { preset: 'wasd' })
    // On AZERTY the key labelled Z sits where W is on QWERTY: event.key 'z', event.code 'KeyW'.
    expect(k.match({ code: 'KeyW', key: 'z' } as { code: string })).toBe('up')
    // The key labelled W on AZERTY is code 'KeyZ' → unbound.
    expect(k.match(key('KeyZ'))).toBeNull()
  })

  test('modifier chords never match', () => {
    const k = createKeymap(ACTIONS)
    expect(k.match(key('KeyW', { ctrlKey: true }))).toBeNull()
    expect(k.match(key('KeyW', { metaKey: true }))).toBeNull()
    expect(k.match(key('Space', { altKey: true }))).toBeNull()
  })

  test('rebind replaces, appends, clears and dedupes slots', () => {
    const k = createKeymap(ACTIONS)
    let notified = 0
    const off = k.subscribe(() => notified++)
    k.rebind('fire', 'Enter', 5)
    expect(k.bindings.fire).toEqual(['Space', 'Enter'])
    k.rebind('fire', 'KeyF', 0)
    expect(k.bindings.fire).toEqual(['KeyF', 'Enter'])
    k.rebind('fire', 'Enter', 0)
    expect(k.bindings.fire).toEqual(['Enter'])
    k.rebind('fire', null, 0)
    expect(k.bindings.fire).toEqual([])
    expect(k.customized).toBe(true)
    const before = k.revision
    k.rebind('nope', 'KeyX')
    k.rebind('fire', 'bad code!')
    k.rebind('fire', null, 3)
    expect(k.revision).toBe(before)
    expect(notified).toBe(4)
    off()
    k.reset()
    expect(notified).toBe(4)
    expect(k.bindings.fire).toEqual(['Space'])
    expect(k.customized).toBe(false)
  })

  test('conflicts list codes bound to several actions', () => {
    const k = createKeymap(ACTIONS)
    expect(k.conflicts()).toEqual([])
    k.rebind('fire', 'KeyW', 1)
    expect(k.conflicts()).toEqual([{ code: 'KeyW', actions: ['up', 'fire'] }])
    // First declared action wins the key.
    expect(k.match(key('KeyW'))).toBe('up')
  })

  test('text entry suspends printable bindings unless alwaysActive', () => {
    const k = createKeymap(ACTIONS)
    expect(k.match(key('KeyW'), TYPING)).toBeNull()
    expect(k.match(key('KeyP'), TYPING)).toBeNull()
    expect(k.match(key('Digit1'), TYPING)).toBeNull()
    expect(k.match(key('ArrowUp'), TYPING)).toBe('up')
    expect(k.match(key('Escape'), TYPING)).toBe('pause')
    expect(k.match(key('Space'), TYPING)).toBe('fire')
    k.rebind('fire', 'KeyF', 1)
    expect(k.match(key('KeyF'), TYPING)).toBe('fire')
    expect(k.match(key('Digit1'), PLAY)).toBe('choose1')
  })

  test('serialize round-trips and stores only customised actions', () => {
    const k = createKeymap(ACTIONS)
    k.setPreset('arrows')
    k.rebind('up', 'KeyI')
    const state = k.serialize()
    expect(state).toEqual({ version: 1, preset: 'arrows', custom: { up: ['KeyI'] } })
    const again = createKeymap(ACTIONS, JSON.parse(JSON.stringify(state)))
    expect(again.preset).toBe('arrows')
    expect(again.bindings.up).toEqual(['KeyI'])
    expect(again.bindings.down).toEqual(['ArrowDown'])
  })

  test('bad stored state falls back safely', () => {
    const k = createKeymap(ACTIONS, { preset: 'dvorak', custom: { up: 'KeyI', down: [1, 'KeyK', 'KeyK', '<x>'], ghost: ['KeyG'] } })
    expect(k.preset).toBe('both')
    expect(k.bindings.up).toEqual(['ArrowUp', 'KeyW'])
    expect(k.bindings.down).toEqual(['KeyK'])
    expect(k.bindings).not.toHaveProperty('ghost')
    expect(createKeymap(ACTIONS, 'garbage').preset).toBe('both')
  })
})

describe('isPrintableCode', () => {
  test('letters, digits, numpad digits and punctuation; not Space or named keys', () => {
    for (const c of ['KeyA', 'Digit0', 'Numpad7', 'Minus', 'Period', 'NumpadDecimal']) expect(isPrintableCode(c)).toBe(true)
    for (const c of ['Space', 'Enter', 'ArrowUp', 'Escape', 'Backspace', 'ShiftLeft', 'F1']) expect(isPrintableCode(c)).toBe(false)
  })
})

describe('keyLabel', () => {
  test('readable labels', () => {
    expect(keyLabel('KeyW')).toBe('W')
    expect(keyLabel('ArrowUp')).toBe('↑')
    expect(keyLabel('Space')).toBe('Space')
    expect(keyLabel('Digit3')).toBe('3')
    expect(keyLabel('Numpad3')).toBe('Num 3')
    expect(keyLabel('Escape')).toBe('Esc')
    expect(keyLabel('F5')).toBe('F5')
  })

  test('a layout map shows the player’s own key caps (AZERTY)', () => {
    const azerty = new Map([
      ['KeyW', 'z'],
      ['KeyA', 'q'],
      ['Digit1', '&'],
      ['Numpad1', '1'],
    ])
    expect(keyLabel('KeyW', azerty)).toBe('Z')
    expect(keyLabel('KeyA', azerty)).toBe('Q')
    expect(keyLabel('Digit1', azerty)).toBe('&')
    expect(keyLabel('Numpad1', azerty)).toBe('Num 1')
    expect(keyLabel('ArrowUp', azerty)).toBe('↑')
  })
})

describe('loadKeymap / saveKeymap', () => {
  const g = globalThis as { localStorage?: unknown }
  afterEach(() => {
    delete g.localStorage
  })

  test('persist per game in localStorage', () => {
    const data = new Map<string, string>()
    g.localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) }
    expect(loadKeymap('demo')).toBeUndefined()
    saveKeymap('demo', { version: 1, preset: 'wasd', custom: {} })
    expect(data.has('edugames.demo.keymap')).toBe(true)
    expect(createKeymap(ACTIONS, loadKeymap('demo')).preset).toBe('wasd')
  })

  test('storage failures are swallowed', () => {
    g.localStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadKeymap('demo')).toBeUndefined()
    expect(() => saveKeymap('demo', { version: 1, preset: 'both', custom: {} })).not.toThrow()
    delete g.localStorage
    expect(loadKeymap('demo')).toBeUndefined()
  })
})
