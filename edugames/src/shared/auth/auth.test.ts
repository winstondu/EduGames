import { afterEach, describe, expect, test } from 'bun:test'
import { HighScoreError } from '../highscores/client'
import type { ScoreSubmission } from '../highscores/types'
import { UNRECORDED_KEY } from '../unrecorded'
import { createAuth } from './createAuth'
import { NICKNAME_KEY, createGuestProvider } from './guest'
import { normalizeNickname } from './nickname'
import { AuthError, type AuthProvider, type PlayerIdentity, type ScoreRun, type ScoresTransport } from './types'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

function fakeScores() {
  const sent: { submission: ScoreSubmission; auth: unknown }[] = []
  const transport: ScoresTransport = {
    async submit(submission, { auth }) {
      sent.push({ submission, auth })
      return { entry: { id: 1, name: submission.name, score: submission.score, createdAt: '2026-01-01T00:00:00Z' }, rank: 3 }
    },
    async leaderboard(gameId, boardKey) {
      return { gameId, boardKey, entries: [] }
    },
  }
  return { sent, transport }
}

const RUN: ScoreRun = { gameId: 'space-shooter', generatorId: 'math', boardKey: 'math/mc/add', score: 120, durationMs: 30_000 }

describe('guest provider', () => {
  test('no login, no credentials, nickname from storage', async () => {
    const provider = createGuestProvider({ storage: memoryStorage({ [NICKNAME_KEY]: '  Ada  ' }) })
    expect(provider.requiresLogin).toBe(false)
    expect(provider.canLogin).toBe(false)
    expect(provider.current()).toEqual({ kind: 'guest', displayName: 'Ada' })
    expect(await provider.requestAuth()).toEqual({})
    const login = await provider.login()
    expect(login.ok).toBe(false)
  })

  test('ignores an invalid stored nickname', () => {
    const provider = createGuestProvider({ storage: memoryStorage({ [NICKNAME_KEY]: '<script>' }) })
    expect(provider.current()).toEqual({ kind: 'guest', displayName: null })
  })

  test('setNickname validates, persists and notifies; snapshot is stable between changes', () => {
    const storage = memoryStorage()
    const provider = createGuestProvider({ storage })
    const first = provider.current()
    expect(provider.current()).toBe(first)
    let calls = 0
    const off = provider.subscribe(() => calls++)
    expect(provider.setNickname('   ').ok).toBe(false)
    expect(provider.setNickname('Bob!').ok).toBe(false)
    expect(calls).toBe(0)
    expect(provider.setNickname(' Bob  the  Builder ')).toEqual({ ok: true, name: 'Bob the Builder' })
    expect(storage.data.get(NICKNAME_KEY)).toBe('Bob the Builder')
    expect(provider.current()).toEqual({ kind: 'guest', displayName: 'Bob the Builder' })
    expect(calls).toBe(1)
    provider.setNickname('Bob the Builder')
    expect(calls).toBe(1)
    off()
    provider.setNickname('Carol')
    expect(calls).toBe(1)
  })

  test('works without storage (blocked or harness)', () => {
    const provider = createGuestProvider({ storage: null })
    expect(provider.setNickname('Dee').ok).toBe(true)
    expect(provider.current().displayName).toBe('Dee')
    const throwing = {
      getItem(): string | null {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('denied')
      },
    }
    const blocked = createGuestProvider({ storage: throwing })
    expect(blocked.current().displayName).toBeNull()
    expect(blocked.setNickname('Eve').ok).toBe(true)
  })
})

describe('normalizeNickname', () => {
  test('matches the server rules', () => {
    expect(normalizeNickname('Zoë')).toEqual({ ok: true, name: 'Zoë' })
    expect(normalizeNickname('a'.repeat(17)).ok).toBe(false)
    expect(normalizeNickname('x_y-z 9')).toEqual({ ok: true, name: 'x_y-z 9' })
  })
})

describe('createAuth + guest', () => {
  test('submits under the guest nickname through the transport', async () => {
    const scores = fakeScores()
    const provider = createGuestProvider({ storage: memoryStorage({ [NICKNAME_KEY]: 'Ada' }) })
    const game = createAuth(provider, { scores: scores.transport, isUnrecorded: () => false }).forGame()
    expect(game.canRecord()).toBe(true)
    const res = await game.submitScore(RUN)
    expect(res.rank).toBe(3)
    expect(scores.sent).toEqual([{ submission: { ...RUN, name: 'Ada' }, auth: {} }])
  })

  test('asks for a nickname first', async () => {
    const scores = fakeScores()
    const game = createAuth(createGuestProvider({ storage: null }), { scores: scores.transport, isUnrecorded: () => false }).forGame()
    const sent = game.submitScore(RUN)
    await expect(sent).rejects.toBeInstanceOf(AuthError)
    await expect(sent).rejects.toMatchObject({ kind: 'needs-name' })
    game.setNickname('Ada')
    await game.submitScore(RUN)
    expect(scores.sent).toHaveLength(1)
  })

  test('unrecorded runs never reach the transport', async () => {
    const scores = fakeScores()
    const game = createAuth(createGuestProvider({ storage: memoryStorage({ [NICKNAME_KEY]: 'Bot' }) }), {
      scores: scores.transport,
      isUnrecorded: () => true,
    }).forGame()
    expect(game.canRecord()).toBe(false)
    const sent = game.submitScore(RUN)
    await expect(sent).rejects.toBeInstanceOf(HighScoreError)
    await expect(sent).rejects.toMatchObject({ kind: 'unrecorded' })
    expect(scores.sent).toHaveLength(0)
  })

  test('the guard holds for any provider, even one claiming an account', async () => {
    const scores = fakeScores()
    let asked = 0
    const account: PlayerIdentity = { kind: 'account', id: 'acc_1', displayName: 'Real' }
    const provider: AuthProvider = {
      id: 'fake-account',
      requiresLogin: true,
      canLogin: true,
      current: () => account,
      subscribe: () => () => {},
      login: async () => ({ ok: true, player: account }),
      logout: async () => {},
      setNickname: () => ({ ok: false, error: 'no' }),
      requestAuth: async () => {
        asked++
        return { credentials: 'include' }
      },
    }
    const auth = createAuth(provider, { scores: scores.transport, isUnrecorded: () => true })
    await expect(auth.submitScore(RUN)).rejects.toMatchObject({ kind: 'unrecorded' })
    expect(asked).toBe(0)
    expect(scores.sent).toHaveLength(0)

    const recorded = createAuth(provider, { scores: scores.transport, isUnrecorded: () => false })
    await recorded.submitScore(RUN)
    expect(scores.sent).toEqual([{ submission: { ...RUN, name: 'Real' }, auth: { credentials: 'include' } }])
  })

  test('login-required providers refuse guest submissions', async () => {
    const scores = fakeScores()
    const guest = createGuestProvider({ storage: memoryStorage({ [NICKNAME_KEY]: 'Ada' }) })
    const strict: AuthProvider = { ...guest, requiresLogin: true }
    const game = createAuth(strict, { scores: scores.transport, isUnrecorded: () => false }).forGame()
    await expect(game.submitScore(RUN)).rejects.toMatchObject({ kind: 'login-required' })
    expect(scores.sent).toHaveLength(0)
  })

  test('views are narrow', () => {
    const auth = createAuth(createGuestProvider({ storage: null }), { isUnrecorded: () => false })
    expect(Object.keys(auth.forGenerator()).sort()).toEqual(['player', 'subscribe'])
    expect(Object.keys(auth.forHost()).sort()).toEqual(['fetch', 'player', 'subscribe'])
    expect('logout' in auth.forGame()).toBe(false)
    expect('fetch' in auth.forGame()).toBe(false)
    expect(Object.isFrozen(auth.forGame())).toBe(true)
  })
})

describe('host fetch', () => {
  const account: PlayerIdentity = { kind: 'account', id: 'acc_1', displayName: 'Real' }
  function withSession(): AuthProvider {
    return {
      ...createGuestProvider({ storage: null }),
      current: () => account,
      requestAuth: async () => ({ headers: { authorization: 'Bearer s3cret' }, credentials: 'include' }),
    }
  }

  test('attaches the session only to the API origin', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const host = createAuth(withSession(), {
      apiOrigin: 'https://api.example.test',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response('{}')
      }) as unknown as typeof fetch,
    }).forHost()
    await host.fetch('https://api.example.test/v1/generators/kindermath/courses', { headers: { accept: 'application/json' } })
    await host.fetch('https://elsewhere.example.test/x')
    await host.fetch('/relative')
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe('Bearer s3cret')
    expect(headers.get('accept')).toBe('application/json')
    expect(calls[0].init.credentials).toBe('include')
    expect(new Headers(calls[1].init.headers).get('authorization')).toBeNull()
    expect(calls[1].init.credentials).toBeUndefined()
    expect(new Headers(calls[2].init.headers).get('authorization')).toBeNull()
  })
})

describe('default transport (highscores client)', () => {
  const g = globalThis as { localStorage?: unknown; fetch: typeof fetch }
  const realFetch = g.fetch
  afterEach(() => {
    delete g.localStorage
    g.fetch = realFetch
  })

  test('the real unrecorded flag stops a guest submission before fetch', async () => {
    const store = new Map([[UNRECORDED_KEY, '1']])
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem() {}, removeItem() {} }
    let calls = 0
    g.fetch = (async () => {
      calls++
      return new Response('{}')
    }) as unknown as typeof fetch
    const game = createAuth(createGuestProvider({ storage: memoryStorage({ [NICKNAME_KEY]: 'Ada' }) })).forGame()
    expect(game.canRecord()).toBe(false)
    await expect(game.submitScore(RUN)).rejects.toMatchObject({ kind: 'unrecorded' })
    expect(calls).toBe(0)
  })

  test('posts a guest score to /v1/scores', async () => {
    const bodies: unknown[] = []
    g.fetch = (async (url: string, init: RequestInit) => {
      expect(url).toEndWith('/v1/scores')
      bodies.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ entry: { id: 5, name: 'Ada', score: 120, createdAt: 'x' }, rank: 1 }), { status: 201 })
    }) as unknown as typeof fetch
    const game = createAuth(createGuestProvider({ storage: memoryStorage({ [NICKNAME_KEY]: 'Ada' }) }), {
      isUnrecorded: () => false,
    }).forGame()
    const res = await game.submitScore(RUN)
    expect(res.rank).toBe(1)
    expect(bodies).toEqual([{ ...RUN, name: 'Ada' }])
  })
})
