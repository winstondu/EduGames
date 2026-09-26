import { describe, expect, test } from 'bun:test'
import { buildPlayUrl, launcherUrl, parseRoute } from './urls'
import type { GeneratorVariant } from '../generators/types'
import { groupVariants, matchesQuery, variantKey } from './variants'

describe('parseRoute', () => {
  test('root is the launcher', () => {
    expect(parseRoute('/')).toEqual({ kind: 'launcher' })
    expect(parseRoute('')).toEqual({ kind: 'launcher' })
  })
  test('single segment is a game id', () => {
    expect(parseRoute('/space-shooter')).toEqual({ kind: 'game', gameId: 'space-shooter' })
    expect(parseRoute('/space-shooter/')).toEqual({ kind: 'game', gameId: 'space-shooter' })
  })
  test('garbage becomes an unknown game', () => {
    expect(parseRoute('/a/b')).toEqual({ kind: 'game', gameId: '' })
    expect(parseRoute('/%E0%A4%A')).toEqual({ kind: 'game', gameId: '' })
    expect(parseRoute('/Bad_Id')).toEqual({ kind: 'game', gameId: '' })
  })
})

describe('buildPlayUrl', () => {
  test('gen first, then variant params, then format', () => {
    expect(buildPlayUrl('space-shooter', 'math', { ops: 'add,sub' }, 'multiple-choice')).toBe(
      '/space-shooter?gen=math&ops=add%2Csub&format=mc',
    )
    expect(buildPlayUrl('space-shooter', 'math', { ops: 'mul' }, 'freeform')).toBe(
      '/space-shooter?gen=math&ops=mul&format=freeform',
    )
  })
  test('variants cannot override gen; explicit format wins', () => {
    expect(buildPlayUrl('g', 'math', { gen: 'evil', format: 'freeform' }, 'multiple-choice')).toBe('/g?gen=math&format=mc')
  })
  test('no format for non-selectable generators', () => {
    const url = buildPlayUrl('space-shooter', 'kindermath', { course: 'algebra-1', lesson: 'abc' })
    expect(url).toBe('/space-shooter?gen=kindermath&course=algebra-1&lesson=abc')
    const params = new URL(url, 'http://x').searchParams
    expect(params.get('lesson')).toBe('abc')
  })
})

describe('launcherUrl', () => {
  test('preselects game and generator', () => {
    expect(launcherUrl()).toBe('/')
    expect(launcherUrl('space-shooter')).toBe('/?game=space-shooter')
    expect(launcherUrl('space-shooter', 'math')).toBe('/?game=space-shooter&gen=math')
    expect(launcherUrl(undefined, 'math')).toBe('/')
  })
})

describe('variants', () => {
  const variants: GeneratorVariant[] = [
    { label: 'Fractions intro', params: { lesson: '1', course: 'g5' }, group: '5th Grade › Fractions' },
    { label: 'Adding fractions', params: { lesson: '2', course: 'g5' }, group: '5th Grade › Fractions' },
    { label: 'Place value', params: { lesson: '3', course: 'g5' }, group: '5th Grade › Numbers', description: 'Déjà vu digits' },
    { label: 'Mixed', params: { ops: 'add' } },
  ]

  test('groups in first-seen order and splits the course › unit label', () => {
    const groups = groupVariants(variants)
    expect(groups.map((g) => [g.parent, g.title, g.items.length])).toEqual([
      ['5th Grade', 'Fractions', 2],
      ['5th Grade', 'Numbers', 1],
      ['', '', 1],
    ])
  })

  test('search matches every word across label, group and description, ignoring accents', () => {
    expect(groupVariants(variants, 'adding').flatMap((g) => g.items.map((v) => v.label))).toEqual(['Adding fractions'])
    expect(groupVariants(variants, 'fractions 5th').flatMap((g) => g.items).length).toBe(2)
    expect(matchesQuery(variants[2], 'deja')).toBe(true)
    expect(groupVariants(variants, 'nope')).toEqual([])
  })

  test('variantKey is order-independent', () => {
    expect(variantKey({ label: 'a', params: { b: '2', a: '1' } })).toBe(variantKey({ label: 'b', params: { a: '1', b: '2' } }))
  })
})
