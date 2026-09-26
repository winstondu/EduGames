import { describe, expect, test } from 'bun:test'
import { createRng } from '../../shared/rng'
import {
  createPicker,
  extractLabel,
  mapPool,
  toLevel,
  toProblem,
  type KinderQuestion,
} from './mapping'

const mcq: KinderQuestion = {
  id: 'q-mcq',
  kind: 'MCQ',
  prompt: 'Combine like terms: $4x + 6x$.',
  choices: [
    { id: 'a', text: '2x' },
    { id: 'b', text: '10x' },
  ],
  hint: 'Add the coefficients.',
  difficulty: 2,
}

const typed: KinderQuestion = {
  id: 'q-typed',
  kind: 'TYPED',
  prompt: 'Evaluate $4x + 1$ when $x = 4$.',
  difficulty: 3,
}

describe('extractLabel', () => {
  test('single short segment becomes the label', () => {
    expect(extractLabel('Combine like terms: $4x + 6x$.')).toBe('4x + 6x')
  })
  test('two segments → no label', () => {
    expect(extractLabel('Evaluate $4x + 1$ when $x = 4$.')).toBeUndefined()
  })
  test('segment longer than 8 chars → no label', () => {
    expect(extractLabel('Solve $2x + 3y - 7 = 0$.')).toBeUndefined()
  })
  test('no math → no label', () => {
    expect(extractLabel('What is a variable?')).toBeUndefined()
  })
})

describe('toLevel', () => {
  test('clamps to 1..5', () => {
    expect(toLevel(0)).toBe(1)
    expect(toLevel(3)).toBe(3)
    expect(toLevel(9)).toBe(5)
    expect(toLevel(undefined)).toBe(1)
  })
})

describe('toProblem', () => {
  test('maps MCQ with choices and label', () => {
    const p = toProblem(mcq)!
    expect(p.format).toBe('multiple-choice')
    expect(p.choices).toEqual([
      { id: 'a', text: '2x' },
      { id: 'b', text: '10x' },
    ])
    expect(p.level).toBe(2)
    expect(p.label).toBe('4x + 6x')
    expect(p.hint).toBe('Add the coefficients.')
  })
  test('maps TYPED to freeform with the extended input spec', () => {
    const p = toProblem(typed)!
    expect(p.format).toBe('freeform')
    expect(p.input).toEqual({ kind: 'text', maxLength: 12, allow: '-./x^' })
    expect(p.label).toBeUndefined()
  })
  test('rejects MCQ without choices', () => {
    expect(toProblem({ id: 'x', kind: 'MCQ', prompt: '$1$' })).toBeNull()
  })
  test('rejects unknown kind and malformed', () => {
    expect(toProblem({ id: 'x', kind: 'ESSAY' as never, prompt: 'hi' })).toBeNull()
    expect(toProblem({ id: '', kind: 'TYPED', prompt: '' } as KinderQuestion)).not.toBeNull()
  })
})

describe('mapPool', () => {
  test('filters to accepted formats', () => {
    const only = mapPool([mcq, typed], { formats: ['freeform'] })
    expect(only.map((p) => p.id)).toEqual(['q-typed'])
    const both = mapPool([mcq, typed], { formats: ['freeform', 'multiple-choice'] })
    expect(both).toHaveLength(2)
  })
  test('drops malformed entries', () => {
    const bad = { id: 'b', kind: 'MCQ', prompt: 'x' } as KinderQuestion
    expect(mapPool([bad, typed], { formats: ['freeform', 'multiple-choice'] })).toHaveLength(1)
  })
  test('drops (never truncates) MCQs with more choices than maxChoices', () => {
    const five: KinderQuestion = {
      id: 'q-five',
      kind: 'MCQ',
      prompt: 'Pick one',
      choices: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, text: id.toUpperCase() })),
    }
    const both = { formats: ['freeform', 'multiple-choice'] as const }
    expect(mapPool([five, mcq, typed], { ...both, maxChoices: 4 }).map((p) => p.id).sort()).toEqual(['q-mcq', 'q-typed'])
    expect(mapPool([five, mcq, typed], { ...both, maxChoices: 5 })).toHaveLength(3)
    expect(mapPool([five, mcq, typed], both)).toHaveLength(3)
    // Below two choices multiple-choice can't be shown at all.
    expect(mapPool([five, mcq, typed], { ...both, maxChoices: 1 }).map((p) => p.id)).toEqual(['q-typed'])
  })
  test('sorts by id so seeded runs reproduce whatever order upstream returned', () => {
    const qs: KinderQuestion[] = ['q3', 'q10', 'q1', 'q2', 'Q0'].map((id, i) => ({ id, kind: 'TYPED', prompt: `p${id}`, difficulty: 1 + (i % 2) }))
    const reqs = { formats: ['freeform'] as const }
    const a = mapPool(qs, reqs)
    const b = mapPool([...qs].reverse(), reqs)
    expect(a.map((p) => p.id)).toEqual(['Q0', 'q1', 'q10', 'q2', 'q3'])
    expect(b).toEqual(a)
    const run = (pool: typeof a) => {
      const picker = createPicker(pool, createRng(7))
      return Array.from({ length: 12 }, (_, i) => picker.next(1 + (i % 2)).id)
    }
    expect(run(b)).toEqual(run(a))
  })
})

describe('createPicker', () => {
  const pool = [
    { id: 'l1', prompt: 'a', level: 1, format: 'freeform' as const },
    { id: 'l2', prompt: 'b', level: 2, format: 'freeform' as const },
    { id: 'l3', prompt: 'c', level: 3, format: 'freeform' as const },
    { id: 'l5', prompt: 'e', level: 5, format: 'freeform' as const },
  ]

  test('prefers the nearest level', () => {
    const p = createPicker(pool, createRng(1))
    expect(p.next(3).id).toBe('l3')
    // level 4 has no exact match; l3 and l5 are equidistant, one of them.
    expect(['l3', 'l5']).toContain(p.next(4).id)
  })

  test('avoids immediate repeats and recycles the full pool', () => {
    const p = createPicker(pool, createRng(7))
    const seen: string[] = []
    for (let i = 0; i < 12; i++) seen.push(p.next(3).id)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1])
    // Over two full cycles every problem appears.
    expect(new Set(seen).size).toBe(pool.length)
  })

  test('single-problem pool returns that problem', () => {
    const p = createPicker([pool[0]], createRng(3))
    expect(p.next(5).id).toBe('l1')
    expect(p.next(5).id).toBe('l1')
  })

  test('empty pool throws', () => {
    expect(() => createPicker([], createRng(1))).toThrow()
  })
})
