import { describe, expect, test } from 'bun:test'
import { createRng } from '../../shared/rng'
import type { GeneratorContext } from '../types'
import plugin from './index'

const lesson = '11111111-2222-4333-8444-555555555555'
const ctx = (api: GeneratorContext['api']): GeneratorContext => ({ rng: createRng(1), signal: new AbortController().signal, api })
const create = (api: GeneratorContext['api']) => plugin.create({ lesson }, ctx(api), { formats: ['freeform', 'multiple-choice'] })

describe('kindermath create() failures are player-presentable', () => {
  test('unknown lesson', async () => {
    await expect(create(async () => new Response('nope', { status: 404 }))).rejects.toThrow("We couldn't find that KinderMath lesson.")
  })

  test('upstream down or offline', async () => {
    await expect(create(async () => new Response('bad gateway', { status: 502 }))).rejects.toThrow("We couldn't reach KinderMath right now.")
    await expect(create(() => Promise.reject(new TypeError('Failed to fetch')))).rejects.toThrow("We couldn't reach KinderMath right now.")
  })

  test('the technical cause is kept', async () => {
    const err = (await create(async () => new Response('', { status: 502 })).then(
      () => null,
      (e: unknown) => e,
    )) as Error
    expect(String((err.cause as Error).message)).toContain('HTTP 502')
  })
})
