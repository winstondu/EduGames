import { afterEach, describe, expect, test } from 'bun:test'
import { UNRECORDED_KEY } from '../unrecorded'
import { HighScoreError, submitScore } from './client'

const g = globalThis as { localStorage?: unknown; fetch: typeof fetch }
const realFetch = g.fetch

afterEach(() => {
  delete g.localStorage
  g.fetch = realFetch
})

describe('submitScore', () => {
  test('refuses to send anything while the unrecorded flag is on', async () => {
    const store = new Map([[UNRECORDED_KEY, '1']])
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem() {}, removeItem() {} }
    let calls = 0
    g.fetch = (async () => {
      calls++
      return new Response('{}')
    }) as unknown as typeof fetch
    const sent = submitScore({
      gameId: 'space-shooter',
      generatorId: 'math',
      boardKey: 'math/mc/add',
      name: 'bot',
      score: 10,
      durationMs: 1000,
    })
    await expect(sent).rejects.toBeInstanceOf(HighScoreError)
    await expect(sent).rejects.toMatchObject({ kind: 'unrecorded' })
    expect(calls).toBe(0)
  })
})
