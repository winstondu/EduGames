import { describe, expect, test } from 'bun:test'
import { boardKey, describeOptions, parseOptions, serializeOptions, type MathOptions } from './options'

const parse = (qs: string) => parseOptions(new URLSearchParams(qs))

describe('parseOptions', () => {
  test('defaults: mc, all ops', () => {
    expect(parse('')).toEqual({ format: 'multiple-choice', ops: ['add', 'sub', 'mul', 'div'] })
  })

  test('reads format and ops, ignoring unknowns and order', () => {
    expect(parse('format=freeform&ops=sub,bogus,add,add')).toEqual({ format: 'freeform', ops: ['add', 'sub'] })
    expect(parse('format=mc&ops=div')).toEqual({ format: 'multiple-choice', ops: ['div'] })
  })

  test('garbage and empty values fall back to defaults', () => {
    expect(parse('format=nope&ops=')).toEqual(parse(''))
    expect(parse('ops=,,x,')).toEqual(parse(''))
  })
})

describe('serializeOptions', () => {
  const cases: MathOptions[] = [
    { format: 'freeform', ops: ['add'] },
    { format: 'multiple-choice', ops: ['add', 'sub'] },
    { format: 'freeform', ops: ['mul', 'div'] },
    { format: 'multiple-choice', ops: ['add', 'sub', 'mul', 'div'] },
  ]

  test('round trips through URL params', () => {
    for (const o of cases) {
      const params = new URLSearchParams(serializeOptions(o))
      expect(parseOptions(params)).toEqual(o)
    }
  })

  test('uses short URL values', () => {
    expect(serializeOptions({ format: 'multiple-choice', ops: ['sub', 'add'] })).toEqual({ format: 'mc', ops: 'add,sub' })
    expect(serializeOptions({ format: 'freeform', ops: [] })).toEqual({ format: 'freeform', ops: 'add,sub,mul,div' })
  })
})

describe('boardKey', () => {
  const pattern = /^[a-z0-9][a-z0-9/_-]{0,95}$/

  test('encodes format and canonical ops', () => {
    expect(boardKey({ format: 'multiple-choice', ops: ['sub', 'add'] })).toBe('math/mc/add-sub')
    expect(boardKey({ format: 'freeform', ops: ['div'] })).toBe('math/ff/div')
    expect(boardKey({ format: 'freeform', ops: [] })).toBe('math/ff/add-sub-mul-div')
  })

  test('always matches the leaderboard key pattern', () => {
    for (const qs of ['', 'format=freeform', 'ops=mul,div', 'format=mc&ops=add,sub,mul,div', 'ops=zzz']) {
      expect(boardKey(parse(qs))).toMatch(pattern)
    }
  })
})

test('describeOptions', () => {
  expect(describeOptions({ format: 'multiple-choice', ops: ['add', 'sub'] })).toBe('Math · + −')
  expect(describeOptions({ format: 'freeform', ops: [] })).toBe('Math · + − × ÷')
})
