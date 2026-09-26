import { describe, expect, test } from 'bun:test'
import { createRng } from '../../shared/rng'
import type { GeneratorContext, Problem, ProblemFormat, ProblemSource } from '../types'
import plugin, { FIXTURE_SETS, type FixtureSetName } from './index'
import { FLAKY_EVERY, parseAnswer } from './sets'

function ctx(seed = 1): GeneratorContext {
  return { rng: createRng(seed), signal: new AbortController().signal, api: () => Promise.reject(new Error('offline')) }
}

const BOTH: readonly ProblemFormat[] = ['freeform', 'multiple-choice']

function create(set: FixtureSetName, seed = 1, formats = BOTH): Promise<ProblemSource> {
  return plugin.create({ set }, ctx(seed), { formats })
}

function draw(source: ProblemSource, n: number): Problem[] {
  return Array.from({ length: n }, (_, i) => source.next(1 + (i % 3)))
}

describe('fixture plugin', () => {
  test('metadata: hidden client plugin, both formats, not format-selectable', () => {
    expect(plugin.id).toBe('fixture')
    expect(plugin.kind).toBe('client')
    expect(plugin.hidden).toBe(true)
    expect([...plugin.formats].sort()).toEqual([...BOTH].sort())
    expect(plugin.formatSelectable).toBe(false)
  })

  test('options: set param, default mixed, board key', () => {
    expect(plugin.parseOptions(new URLSearchParams(''))).toEqual({ set: 'mixed' })
    expect(plugin.parseOptions(new URLSearchParams('set=LONG'))).toEqual({ set: 'long' })
    expect(plugin.parseOptions(new URLSearchParams('set=nope'))).toEqual({ set: 'mixed' })
    expect(plugin.serializeOptions({ set: 'flaky' })).toEqual({ set: 'flaky' })
    for (const set of FIXTURE_SETS) expect(plugin.boardKey({ set })).toMatch(/^fixture\/[a-z]+$/)
  })

  test('deterministic per seed', async () => {
    const a = draw(await create('mixed', 5), 40)
    const b = draw(await create('mixed', 5), 40)
    const c = draw(await create('mixed', 6), 40)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  test('mixed covers short, MC, long $…$ prompts, fractions and exponents', async () => {
    const problems = draw(await create('mixed'), 200)
    expect(problems.some((p) => p.format === 'freeform' && p.prompt.length < 10 && !p.prompt.includes('$'))).toBe(true)
    expect(problems.some((p) => p.format === 'multiple-choice')).toBe(true)
    expect(problems.some((p) => p.prompt.length > 80 && p.prompt.includes('$'))).toBe(true)
    expect(problems.some((p) => p.prompt.includes('\\frac'))).toBe(true)
    expect(problems.some((p) => p.prompt.includes('^{'))).toBe(true)
    expect(new Set(problems.map((p) => p.id)).size).toBe(200)
  })

  test('sets honor their shape and the requirements', async () => {
    expect(draw(await create('long'), 50).every((p) => p.prompt.length > 80)).toBe(true)
    expect(draw(await create('mc'), 50).every((p) => p.format === 'multiple-choice' && p.choices?.length === 4)).toBe(true)
    expect(draw(await create('freeform'), 50).every((p) => p.format === 'freeform')).toBe(true)
    expect(draw(await create('mixed', 1, ['multiple-choice']), 50).every((p) => p.format === 'multiple-choice')).toBe(true)
    await expect(create('freeform', 1, ['multiple-choice'])).rejects.toMatchObject({ name: 'IncompatibleGeneratorError' })
  })

  test('checks: exactly one correct choice; freeform accepts equivalent fractions and reports expected', async () => {
    const source = await create('mixed')
    for (const p of draw(source, 100)) {
      if (p.format === 'multiple-choice') {
        const verdicts = p.choices!.map((c) => (source.check(p, c.id) as { correct: boolean }).correct)
        expect(verdicts.filter(Boolean).length).toBe(1)
        expect(new Set(p.choices!.map((c) => c.text)).size).toBe(4)
      } else {
        const wrong = source.check(p, 'nope') as { correct: boolean; expected?: string }
        expect(wrong.correct).toBe(false)
        expect((source.check(p, wrong.expected!) as { correct: boolean }).correct).toBe(true)
        const a = parseAnswer(wrong.expected!)!
        if (a.den > 1) expect((source.check(p, `${a.num * 2}/${a.den * 2}`) as { correct: boolean }).correct).toBe(true)
      }
    }
  })

  test('slow set resolves via a Promise after ~1.5 s', async () => {
    const source = await create('slow')
    const p = source.next(1)
    const started = performance.now()
    const result = await source.check(p, 'nope')
    expect(performance.now() - started).toBeGreaterThan(1400)
    expect(result.correct).toBe(false)
    source.dispose?.()
  }, 5_000)

  test(`flaky set rejects every ${FLAKY_EVERY}rd check`, async () => {
    const source = await create('flaky')
    const p = source.next(1)
    const outcomes: string[] = []
    for (let i = 0; i < 6; i++) {
      await Promise.resolve(source.check(p, 'nope')).then(() => outcomes.push('ok'), () => outcomes.push('rejected'))
    }
    expect(outcomes).toEqual(['ok', 'ok', 'rejected', 'ok', 'ok', 'rejected'])
  })
})
