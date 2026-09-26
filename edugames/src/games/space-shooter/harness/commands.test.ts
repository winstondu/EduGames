import { describe, expect, test } from 'bun:test'
import { TYPED_INPUT, TYPED_NUMBER_INPUT } from '../../../generators/kindermath/mapping'
import { describeInput, parseCommand, validateCommands, type PlayerCommand } from './commands'
import type { GameState } from '../engine/types'

function commands(input: string | object): PlayerCommand[] {
  const r = parseCommand(input)
  if ('error' in r) throw new Error(r.error)
  return r.commands
}

describe('parseCommand', () => {
  test('verbs and forgiving aliases', () => {
    expect(commands('up')).toEqual([{ type: 'moveUp' }])
    expect(commands('D')).toEqual([{ type: 'moveDown' }])
    expect(commands('lane 0')).toEqual([{ type: 'moveToLane', lane: 0 }])
    expect(commands('Lane3')).toEqual([{ type: 'moveToLane', lane: 3 }])
    expect(commands('l 2')).toEqual([{ type: 'moveToLane', lane: 2 }])
    expect(commands('choose 2')).toEqual([{ type: 'choose', index: 1 }])
    expect(commands('c2')).toEqual([{ type: 'choose', index: 1 }])
    expect(commands('  PICK 4 ')).toEqual([{ type: 'choose', index: 3 }])
    expect(commands('fire')).toEqual([{ type: 'fire' }])
    expect(commands('backspace')).toEqual([{ type: 'backspace' }])
    expect(commands('clear')).toEqual([{ type: 'clearQuiver' }])
    expect(commands('pause')).toEqual([{ type: 'pause' }])
    expect(commands('resume')).toEqual([{ type: 'resume' }])
    expect(commands('wait')).toEqual([])
    expect(commands('')).toEqual([])
  })

  test('type keeps its text verbatim; answer clears, types and fires', () => {
    expect(commands('type -12')).toEqual([{ type: 'typeChar', char: '-' }, { type: 'typeChar', char: '1' }, { type: 'typeChar', char: '2' }])
    expect(commands('t 3/4').map((c) => (c as { char: string }).char).join('')).toBe('3/4')
    expect(commands('type New York').length).toBe(8)
    expect(commands('answer 7')).toEqual([{ type: 'clearQuiver' }, { type: 'typeChar', char: '7' }, { type: 'fire' }])
  })

  test('errors', () => {
    for (const bad of ['choose 0', 'choose 5', 'c', 'lane -1', 'lane x', 'type', 'jump', '12', 'answer']) {
      expect('error' in parseCommand(bad)).toBe(true)
    }
    expect('error' in parseCommand({ type: 'resolveCheck', checkId: 1, result: null })).toBe(true)
    expect('error' in parseCommand([] as unknown as object)).toBe(true)
  })

  test('structured commands use engine shapes (0-based choose) or verb objects', () => {
    expect(commands({ type: 'choose', index: 0 })).toEqual([{ type: 'choose', index: 0 }])
    expect(commands({ type: 'choose', n: 1 })).toEqual([{ type: 'choose', index: 0 }])
    expect(commands({ type: 'moveToLane', lane: 1 })).toEqual([{ type: 'moveToLane', lane: 1 }])
    expect(commands({ type: 'typeChar', char: '5' })).toEqual([{ type: 'typeChar', char: '5' }])
    expect(commands({ type: 'lane', lane: 2 })).toEqual([{ type: 'moveToLane', lane: 2 }])
    expect(commands({ cmd: 'type', text: '12' }).length).toBe(2)
    expect(commands({ type: 'wait' })).toEqual([])
  })
})

describe('validateCommands', () => {
  const base = {
    status: 'playing',
    inputMode: 'freeform',
    targetId: 1,
    quiver: '',
    choices: [],
    input: { kind: 'numeric', maxLength: 2 },
  } as unknown as GameState

  test('flags no-ops with a reason', () => {
    expect(validateCommands(commands('answer 12'), base)).toBeNull()
    expect(validateCommands(commands('answer 123'), base)).toMatch(/too long/)
    expect(validateCommands(commands('type x'), base)).toMatch(/not accepted/)
    expect(validateCommands(commands('fire'), base)).toMatch(/empty/)
    expect(validateCommands(commands('choose 1'), base)).toMatch(/freeform/)
    expect(validateCommands(commands('choose 1'), { ...base, inputMode: null, targetId: null })).toMatch(/no target/)
    expect(validateCommands(commands('up'), { ...base, status: 'paused' })).toMatch(/resume/)
    expect(validateCommands(commands('resume'), { ...base, status: 'paused' })).toBeNull()
    const mc = { ...base, inputMode: 'multiple-choice', choices: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }] } as GameState
    expect(validateCommands(commands('choose 2'), mc)).toBeNull()
    expect(validateCommands(commands('choose 3'), mc)).toMatch(/only 2/)
  })
})

describe('typed expression input', () => {
  const freeform = (input: GameState['input']) =>
    ({ status: 'playing', inputMode: 'freeform', targetId: 1, quiver: '', choices: [], input }) as unknown as GameState

  test('expressions with =, +, (), ^ and spaces can be typed', () => {
    const s = freeform({ ...TYPED_INPUT })
    for (const answer of ['x = 3', '2(x+1)', 'x^2 - 1/2', '-4.5']) {
      expect(validateCommands(commands(`answer ${answer}`), s)).toBeNull()
    }
    expect(validateCommands(commands('type 12345678901234567'), s)).toMatch(/too long/)
  })

  test('number hint: digits with - . / only', () => {
    const s = freeform({ ...TYPED_NUMBER_INPUT })
    expect(validateCommands(commands('answer -3/4'), s)).toBeNull()
    expect(validateCommands(commands('answer 0.5'), s)).toBeNull()
    expect(validateCommands(commands('type x'), s)).toMatch(/not accepted/)
    expect(validateCommands(commands('type 1 2'), s)).toMatch(/" " not accepted/)
  })

  test('describeInput spells out the character set', () => {
    expect(describeInput(TYPED_INPUT)).toBe('letters/digits/space and "-./x^=+()", max 16')
    expect(describeInput(TYPED_NUMBER_INPUT)).toBe('digits and "-./", max 8')
    expect(describeInput({ kind: 'numeric', maxLength: 4, allow: '- ' })).toBe('digits and "-" and space, max 4')
  })
})
