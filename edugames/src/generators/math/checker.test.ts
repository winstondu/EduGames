import { describe, expect, test } from 'bun:test'
import type { Problem } from '../types'
import { check, normalizeAnswer, parsePrompt } from './checker'

describe('normalizeAnswer', () => {
  test('trims, strips leading zeros and accepts unicode minus', () => {
    expect(normalizeAnswer(' 12 ')).toBe('12')
    expect(normalizeAnswer('007')).toBe('7')
    expect(normalizeAnswer('000')).toBe('0')
    expect(normalizeAnswer('+5')).toBe('5')
    expect(normalizeAnswer('−3')).toBe('-3')
    expect(normalizeAnswer('-03')).toBe('-3')
    expect(normalizeAnswer('-0')).toBe('0')
    expect(normalizeAnswer('1 2')).toBe('12')
  })

  test('rejects non-integers', () => {
    for (const s of ['', ' ', 'abc', '1.5', '1/2', '--1', '12a']) expect(normalizeAnswer(s)).toBeNull()
  })
})

test('parsePrompt reads our prompts only', () => {
  expect(parsePrompt('12 − 4')).toEqual({ a: 12, op: 'sub', b: 4, answer: 8 })
  expect(parsePrompt('18 ÷ 3')).toEqual({ a: 18, op: 'div', b: 3, answer: 6 })
  expect(parsePrompt('7 ÷ 2')).toBeNull()
  expect(parsePrompt('12 - 4')).toBeNull()
  expect(parsePrompt('what')).toBeNull()
})

describe('check', () => {
  const ff: Problem = { id: '1', prompt: '6 × 3', level: 3, format: 'freeform', input: { kind: 'numeric', maxLength: 3 } }
  const mc: Problem = {
    id: '2',
    prompt: '7 + 5',
    level: 2,
    format: 'multiple-choice',
    choices: [
      { id: 'a', text: '11' },
      { id: 'b', text: '12' },
      { id: 'c', text: '13' },
      { id: 'd', text: '2' },
    ],
  }

  test('freeform compares normalized input', () => {
    expect(check(ff, '18')).toEqual({ correct: true, expected: '18', explanation: '6 × 3 = 18' })
    expect(check(ff, ' 018 ').correct).toBe(true)
    expect(check(ff, '17')).toMatchObject({ correct: false, expected: '18' })
    expect(check(ff, '').correct).toBe(false)
  })

  test('multiple-choice compares the chosen id', () => {
    expect(check(mc, 'b')).toMatchObject({ correct: true, expected: '12' })
    expect(check(mc, 'a')).toMatchObject({ correct: false, expected: '12' })
    expect(check(mc, '12').correct).toBe(false)
    expect(check(mc, 'z').correct).toBe(false)
  })
})
