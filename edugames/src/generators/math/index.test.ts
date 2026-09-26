import { describe, expect, test } from 'bun:test'
import type { GeneratorContext, ProblemFormat } from '../types'
import { createRng } from '../../shared/rng'
import plugin from './index'

function ctx(seed = 1): GeneratorContext {
  return {
    rng: createRng(seed),
    api: () => Promise.reject(new Error('math never calls the API')),
    signal: new AbortController().signal,
  }
}

const both: ProblemFormat[] = ['freeform', 'multiple-choice']

describe('plugin metadata', () => {
  test('declares a client plugin with both formats', () => {
    expect(plugin.id).toBe('math')
    expect(plugin.kind).toBe('client')
    expect(plugin.maxLevel).toBe(10)
    expect(plugin.formats).toEqual(both)
    expect(plugin.formatSelectable).toBe(true)
    expect(plugin.defaultInput).toEqual({ kind: 'numeric', maxLength: 3 })
  })

  test('parseOptions never returns null', () => {
    expect(plugin.parseOptions(new URLSearchParams('garbage=1&format=%%'))).not.toBeNull()
  })

  test('describe and listVariants need no network', async () => {
    expect(await plugin.describe({ format: 'freeform', ops: ['add', 'sub'] }, ctx())).toBe('Math · + −')
    const variants = await plugin.listVariants!(ctx())
    expect(variants.map((v) => v.label)).toEqual(['Addition', 'Add & Subtract', 'Times Tables', 'Division', 'Mixed'])
    for (const v of variants) {
      const opts = plugin.parseOptions(new URLSearchParams(v.params))!
      expect(plugin.boardKey(opts)).toMatch(/^math\/mc\/[a-z-]+$/)
    }
  })
})

describe('create', () => {
  test('uses the requested format when supported', async () => {
    const src = await plugin.create({ format: 'freeform', ops: [] }, ctx(), { formats: both })
    const p = src.next(3)
    expect(p.format).toBe('freeform')
    expect(p.input).toEqual({ kind: 'numeric', maxLength: 3 })
  })

  test('falls back to the other format the game allows', async () => {
    const mc = await plugin.create({ format: 'freeform', ops: [] }, ctx(), { formats: ['multiple-choice'] })
    expect(mc.next(1).format).toBe('multiple-choice')
    const ff = await plugin.create({ format: 'multiple-choice', ops: [] }, ctx(), { formats: ['freeform'] })
    expect(ff.next(1).format).toBe('freeform')
  })

  test('rejects with IncompatibleGeneratorError when no format is allowed', async () => {
    const err = await plugin.create({ format: 'multiple-choice', ops: [] }, ctx(), { formats: [] }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('IncompatibleGeneratorError')
  })

  test('problems check correctly end to end, with unique ids and clamped levels', async () => {
    for (const format of both) {
      const src = await plugin.create({ format, ops: [] }, ctx(42), { formats: both })
      const ids = new Set<string>()
      for (let i = 0; i < 300; i++) {
        const p = src.next((i % 12) - 1)
        expect(p.level).toBeGreaterThanOrEqual(1)
        expect(p.level).toBeLessThanOrEqual(10)
        ids.add(p.id)
        const { expected } = src.check(p, '') as { expected: string }
        if (format === 'multiple-choice') {
          const right = p.choices!.find((c) => c.text === expected)!
          expect(src.check(p, right.id)).toMatchObject({ correct: true })
          for (const c of p.choices!) if (c !== right) expect(src.check(p, c.id)).toMatchObject({ correct: false })
        } else {
          expect(src.check(p, expected)).toMatchObject({ correct: true })
          expect(src.check(p, ` 0${expected} `)).toMatchObject({ correct: true })
          expect(src.check(p, String(Number(expected) + 1))).toMatchObject({ correct: false })
        }
      }
      expect(ids.size).toBe(300)
    }
  })

  test('is deterministic for a given seed', async () => {
    const run = async (seed: number) => {
      const src = await plugin.create({ format: 'multiple-choice', ops: [] }, ctx(seed), { formats: both })
      return Array.from({ length: 50 }, (_, i) => src.next(1 + (i % 10)))
    }
    expect(await run(9)).toEqual(await run(9))
    expect(await run(9)).not.toEqual(await run(10))
  })
})
