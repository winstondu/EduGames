import { describe, expect, test } from 'bun:test'
import { createRng } from '../../shared/rng'
import { parsePrompt } from './checker'
import { distractors, makeChoices } from './choices'
import { MAX_LEVEL, clampLevel, makeQuestion, opsForLevel, toProblem } from './generator'
import { OPS, type Op } from './options'

const OP_SETS: Op[][] = [['add'], ['sub'], ['mul'], ['div'], ['add', 'sub'], ['mul', 'div'], OPS.slice()]

describe('makeQuestion', () => {
  test('answers are correct non-negative integers across seeds, levels and ops', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createRng(seed)
      for (let level = 1; level <= MAX_LEVEL; level++) {
        for (const ops of OP_SETS) {
          for (let i = 0; i < 10; i++) {
            const q = makeQuestion(rng, level, ops)
            expect(ops).toContain(q.op)
            expect(Number.isInteger(q.answer)).toBe(true)
            expect(q.answer).toBeGreaterThanOrEqual(0)
            expect(q.answer).toBeLessThanOrEqual(999)
            const expected = { add: q.a + q.b, sub: q.a - q.b, mul: q.a * q.b, div: q.a / q.b }[q.op]
            expect(q.answer).toBe(expected)
            if (q.op === 'div') expect(q.b).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  test('gentle curve: level 1 sums within 10, level 10 reaches two digits and tables to 12', () => {
    const rng = createRng(7)
    for (let i = 0; i < 500; i++) {
      const q = makeQuestion(rng, 1, OPS)
      expect(q.op).toBe('add')
      expect(q.answer).toBeLessThanOrEqual(10)
    }
    let maxDivisor = 0
    let maxTable = 0
    for (let i = 0; i < 2000; i++) {
      const add = makeQuestion(rng, 10, ['add'])
      expect(add.a).toBeGreaterThanOrEqual(10)
      expect(add.a).toBeLessThanOrEqual(99)
      expect(add.b).toBeGreaterThanOrEqual(10)
      expect(add.b).toBeLessThanOrEqual(99)
      const sub = makeQuestion(rng, 10, ['sub'])
      expect(sub.a).toBeLessThanOrEqual(99)
      expect(sub.b).toBeGreaterThanOrEqual(10)
      const mul = makeQuestion(rng, 10, ['mul'])
      maxTable = Math.max(maxTable, Math.min(mul.a, mul.b))
      expect(Math.max(mul.a, mul.b)).toBeLessThanOrEqual(12)
      const div = makeQuestion(rng, 10, ['div'])
      maxDivisor = Math.max(maxDivisor, div.b)
      expect(div.b).toBeLessThanOrEqual(12)
    }
    expect(maxTable).toBe(12)
    expect(maxDivisor).toBe(12)
  })

  test('level 2 is +/− within 20, level 3 adds times tables to 5', () => {
    const rng = createRng(3)
    for (let i = 0; i < 500; i++) {
      const q2 = makeQuestion(rng, 2, OPS)
      expect(['add', 'sub']).toContain(q2.op)
      expect(Math.max(q2.a, q2.b, q2.answer)).toBeLessThanOrEqual(20)
      const q3 = makeQuestion(rng, 3, ['mul'])
      expect(Math.min(q3.a, q3.b)).toBeLessThanOrEqual(5)
    }
  })

  test('ops not yet introduced are used when nothing else is enabled', () => {
    expect(opsForLevel(1, ['div'])).toEqual(['div'])
    expect(opsForLevel(1, ['add', 'div'])).toEqual(['add'])
    expect(opsForLevel(4, OPS)).toEqual(OPS)
  })

  test('clampLevel', () => {
    expect(clampLevel(0)).toBe(1)
    expect(clampLevel(99)).toBe(MAX_LEVEL)
    expect(clampLevel(2.6)).toBe(3)
    expect(clampLevel(NaN)).toBe(1)
  })
})

describe('choices', () => {
  test('four distinct non-negative choices with the answer exactly once', () => {
    const positions = new Set<string>()
    for (let seed = 1; seed <= 30; seed++) {
      const rng = createRng(seed)
      for (let level = 1; level <= MAX_LEVEL; level++) {
        for (const ops of OP_SETS) {
          const q = makeQuestion(rng, level, ops)
          const choices = makeChoices(rng, q)
          expect(choices.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
          const values = choices.map((c) => Number(c.text))
          expect(new Set(values).size).toBe(4)
          for (const v of values) {
            expect(Number.isInteger(v)).toBe(true)
            expect(v).toBeGreaterThanOrEqual(0)
          }
          expect(values.filter((v) => v === q.answer)).toHaveLength(1)
          for (const v of values) expect(v).toBeLessThanOrEqual(3 * Math.max(q.a, q.b, q.answer, 3))
          positions.add(choices.find((c) => Number(c.text) === q.answer)!.id)
        }
      }
    }
    expect(positions).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  test('tiny answers still get three distractors, one of them a near miss', () => {
    const rng = createRng(1)
    for (const q of [
      { a: 0, op: 'add' as const, b: 0, answer: 0 },
      { a: 1, op: 'sub' as const, b: 1, answer: 0 },
      { a: 0, op: 'div' as const, b: 1, answer: 0 },
    ]) {
      const d = distractors(rng, q)
      expect(d).toHaveLength(3)
      expect(d).not.toContain(0)
      expect(d.some((n) => Math.abs(n - q.answer) <= 2)).toBe(true)
    }
  })
})

describe('toProblem', () => {
  test('prompts use unicode operators and parse back', () => {
    const rng = createRng(11)
    const q = { a: 12, op: 'sub' as const, b: 4, answer: 8 }
    const p = toProblem(rng, q, 2, 'freeform', 'x')
    expect(p).toMatchObject({ id: 'x', prompt: '12 − 4', label: '12−4', level: 2, format: 'freeform', input: { kind: 'numeric', maxLength: 3 } })
    expect(p.choices).toBeUndefined()
    expect(parsePrompt(p.prompt)).toEqual(q)
    const mc = toProblem(rng, { a: 18, op: 'div', b: 3, answer: 6 }, 5, 'multiple-choice', 'y')
    expect(mc.prompt).toBe('18 ÷ 3')
    expect(mc.choices).toHaveLength(4)
    expect(mc.input).toBeUndefined()
    expect(toProblem(rng, { a: 6, op: 'mul', b: 3, answer: 18 }, 3, 'freeform', 'z').prompt).toBe('6 × 3')
    expect(toProblem(rng, { a: 7, op: 'add', b: 5, answer: 12 }, 1, 'freeform', 'w').prompt).toBe('7 + 5')
  })

  test('labels fit in 8 characters', () => {
    const rng = createRng(5)
    for (let i = 0; i < 2000; i++) {
      const p = toProblem(rng, makeQuestion(rng, 10, OPS), 10, 'freeform', String(i))
      expect(p.label!.length).toBeLessThanOrEqual(8)
    }
  })
})
