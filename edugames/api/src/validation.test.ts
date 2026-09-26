import { describe, expect, test } from 'bun:test'
import { NAME_MAX_LENGTH } from '../../src/shared/highscores/types'
import {
  maxPlausibleScore,
  MAX_DURATION_MS,
  MAX_SCORE,
  normalizeName,
  parseLeaderboardQuery,
  validateSubmission,
} from './validation'

const base = {
  gameId: 'space-shooter',
  generatorId: 'math',
  boardKey: 'math/add-sub',
  name: 'Ada',
  score: 1200,
  durationMs: 60_000,
  meta: { lanes: 4, direction: 'ltr', hard: false },
}

const errorOf = (body: unknown) => {
  const r = validateSubmission(body)
  return r.ok ? null : r.error
}

describe('validateSubmission', () => {
  test('accepts a well-formed submission', () => {
    const r = validateSubmission(base)
    expect(r).toEqual({ ok: true, value: { ...base } })
  })

  test('rejects non-objects', () => {
    for (const body of [null, 42, 'x', [base]]) expect(errorOf(body)).toBe('Invalid score submission.')
  })

  test('ids must be [a-z0-9-]{1,32}', () => {
    expect(errorOf({ ...base, gameId: 'Space' })).toBe('Unknown game.')
    expect(errorOf({ ...base, gameId: '' })).toBe('Unknown game.')
    expect(errorOf({ ...base, gameId: 'a'.repeat(33) })).toBe('Unknown game.')
    expect(errorOf({ ...base, gameId: 'a'.repeat(32) })).toBeNull()
    expect(errorOf({ ...base, generatorId: 'math/x' })).toBe('Unknown problem set.')
  })

  test('boardKey must match the pattern and start with generatorId', () => {
    expect(errorOf({ ...base, boardKey: 'kindermath/abc' })).toBe('Unknown leaderboard.')
    expect(errorOf({ ...base, boardKey: 'math/ADD' })).toBe('Unknown leaderboard.')
    expect(errorOf({ ...base, boardKey: `math/${'x'.repeat(91)}` })).toBeNull()
    expect(errorOf({ ...base, boardKey: `math/${'x'.repeat(92)}` })).toBe('Unknown leaderboard.')
    expect(errorOf({ ...base, boardKey: 'math' })).toBeNull()
  })

  test('score must be an integer in range and plausible for the duration', () => {
    expect(errorOf({ ...base, score: -1 })).toBe('Invalid score.')
    expect(errorOf({ ...base, score: 1.5 })).toBe('Invalid score.')
    expect(errorOf({ ...base, score: '100' })).toBe('Invalid score.')
    expect(errorOf({ ...base, score: MAX_SCORE + 1, durationMs: MAX_DURATION_MS })).toBe('Invalid score.')
    expect(errorOf({ ...base, score: maxPlausibleScore(MAX_DURATION_MS), durationMs: MAX_DURATION_MS })).toBeNull()
    expect(errorOf({ ...base, score: 0 })).toBeNull()
    // 60 s × 500/s + 200 grace = 30,200
    expect(maxPlausibleScore(60_000)).toBe(30_200)
    expect(errorOf({ ...base, score: 30_200 })).toBeNull()
    expect(errorOf({ ...base, score: 30_201 })).toBe('That score is not possible in the time played.')
  })

  test('duration must be 1 s .. 4 h', () => {
    expect(errorOf({ ...base, score: 0, durationMs: 999 })).toBe('Invalid run duration.')
    expect(errorOf({ ...base, score: 0, durationMs: 1_000 })).toBeNull()
    expect(errorOf({ ...base, durationMs: MAX_DURATION_MS + 1 })).toBe('Invalid run duration.')
    expect(errorOf({ ...base, durationMs: Number.NaN })).toBe('Invalid run duration.')
    const r = validateSubmission({ ...base, durationMs: 60_000.4 })
    expect(r.ok && r.value.durationMs).toBe(60_000)
  })

  test('meta: object of primitives, ≤ 1 KB, optional', () => {
    const { meta: _meta, ...noMeta } = base
    const r = validateSubmission(noMeta)
    expect(r.ok && r.value.meta).toBeNull()
    expect(errorOf({ ...base, meta: { nested: { a: 1 } } })).toBe('Invalid run details.')
    expect(errorOf({ ...base, meta: { list: [1] } })).toBe('Invalid run details.')
    expect(errorOf({ ...base, meta: { n: Number.POSITIVE_INFINITY } })).toBe('Invalid run details.')
    expect(errorOf({ ...base, meta: [1, 2] })).toBe('Invalid run details.')
    expect(errorOf({ ...base, meta: { title: 'x'.repeat(1_100) } })).toBe('Run details are too large.')
    const empty = validateSubmission({ ...base, meta: {} })
    expect(empty.ok && empty.value.meta).toBeNull()
  })
})

describe('normalizeName', () => {
  const ok = (raw: unknown) => {
    const r = normalizeName(raw)
    return r.ok ? r.value : null
  }

  test('trims and collapses whitespace', () => {
    expect(ok('  Ada   Lovelace \n')).toBe('Ada Lovelace')
    expect(ok('a\t\tb')).toBe('a b')
  })

  test('allows Unicode letters, digits, space, _ and -', () => {
    expect(ok('Zoë_2-B')).toBe('Zoë_2-B')
    expect(ok('小明')).toBe('小明')
    expect(ok('Ωmega')).toBe('Ωmega')
    // Combining mark is NFC-normalized to a single letter.
    expect(ok('Zoe\u0308')).toBe('Zo\u00eb')
  })

  test('rejects empty, too long and disallowed characters', () => {
    expect(ok('   ')).toBeNull()
    expect(ok(undefined)).toBeNull()
    expect(ok('x'.repeat(NAME_MAX_LENGTH))).toBe('x'.repeat(NAME_MAX_LENGTH))
    expect(ok('x'.repeat(NAME_MAX_LENGTH + 1))).toBeNull()
    for (const bad of ['<b>', 'a.b', 'robert;drop', 'hi!', '🚀rocket', 'a\u200bb']) expect(ok(bad)).toBeNull()
  })

  test('length counts code points, after collapsing', () => {
    expect(ok('小'.repeat(NAME_MAX_LENGTH))).not.toBeNull()
    expect(ok(`a${' '.repeat(40)}b`)).toBe('a b')
  })
})

describe('parseLeaderboardQuery', () => {
  const q = (s: string) => parseLeaderboardQuery(new URLSearchParams(s))

  test('defaults and clamps limit', () => {
    expect(q('game=space-shooter&board=math/add-sub')).toEqual({
      ok: true,
      value: { gameId: 'space-shooter', boardKey: 'math/add-sub', limit: 10 },
    })
    const high = q('game=g&board=b&limit=500')
    expect(high.ok && high.value.limit).toBe(50)
    const low = q('game=g&board=b&limit=0')
    expect(low.ok && low.value.limit).toBe(1)
  })

  test('rejects bad params', () => {
    expect(q('board=b')).toEqual({ ok: false, error: 'Unknown game.' })
    expect(q('game=g')).toEqual({ ok: false, error: 'Unknown leaderboard.' })
    expect(q('game=g&board=b&limit=abc')).toEqual({ ok: false, error: 'Invalid limit.' })
    expect(q('game=g&board=b&limit=-3')).toEqual({ ok: false, error: 'Invalid limit.' })
  })
})
