/**
 * createAuth(provider): the one facade over an AuthProvider. It owns the rules every provider
 * shares — the unrecorded guard, "who is the name on this score", and attaching the player's
 * session only to our own API origin — so a provider can't get them wrong.
 */
import { API_BASE } from '../apiBase'
import { HighScoreError } from '../highscores/client'
import { isUnrecorded as defaultIsUnrecorded } from '../unrecorded'
import { highscoresTransport } from './scores'
import {
  AuthError,
  type Auth,
  type AuthProvider,
  type GameAuth,
  type GeneratorAuthView,
  type HostAuth,
  type ScoresTransport,
} from './types'

export interface CreateAuthOptions {
  /** Score API; defaults to src/shared/highscores/client.ts. */
  scores?: ScoresTransport
  /** Hidden unrecorded flag; defaults to src/shared/unrecorded.ts. */
  isUnrecorded?: () => boolean
  /** Origin that may receive the player's session (default: the API Worker's). */
  apiOrigin?: string
  fetch?: typeof fetch
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null // relative / malformed: never ours
  }
}

export function createAuth(provider: AuthProvider, options: CreateAuthOptions = {}): Auth {
  const scores = options.scores ?? highscoresTransport
  const unrecorded = options.isUnrecorded ?? (() => defaultIsUnrecorded())
  const apiOrigin = options.apiOrigin ?? new URL(API_BASE).origin
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))

  const player = () => provider.current()
  const subscribe = (listener: () => void) => provider.subscribe(listener)

  const game: GameAuth = Object.freeze({
    requiresLogin: provider.requiresLogin,
    canLogin: provider.canLogin,
    player,
    subscribe,
    login: () => provider.login(),
    setNickname: (name: string) => provider.setNickname(name),
    canRecord: () => !unrecorded(),
    async submitScore(run, opts = {}) {
      // Checked here, before any provider code runs, so no provider can record an unrecorded run.
      if (unrecorded()) throw new HighScoreError('unrecorded', "This run isn't recorded.")
      const who = provider.current()
      if (provider.requiresLogin && who.kind !== 'account') {
        throw new AuthError('login-required', 'Sign in to save your score.')
      }
      if (!who.displayName) throw new AuthError('needs-name', 'Pick a nickname to save your score.')
      const auth = who.kind === 'account' ? await provider.requestAuth() : {}
      if (unrecorded()) throw new HighScoreError('unrecorded', "This run isn't recorded.")
      return scores.submit({ ...run, name: who.displayName }, { signal: opts.signal, auth })
    },
    leaderboard: (gameId, boardKey, limit, opts = {}) => scores.leaderboard(gameId, boardKey, limit, { signal: opts.signal }),
  } satisfies GameAuth)

  const host: HostAuth = Object.freeze({
    player,
    subscribe,
    async fetch(url: string, init: RequestInit = {}) {
      // Never hand the player's session to another origin, whatever a caller passes.
      if (originOf(url) !== apiOrigin) return doFetch(url, init)
      const auth = await provider.requestAuth()
      const headers = new Headers(init.headers)
      for (const [k, v] of Object.entries(auth.headers ?? {})) headers.set(k, v)
      return doFetch(url, { ...init, headers, ...(auth.credentials ? { credentials: auth.credentials } : {}) })
    },
  } satisfies HostAuth)

  const generator: GeneratorAuthView = Object.freeze({ player, subscribe })

  return Object.freeze({
    ...game,
    fetch: host.fetch,
    providerId: provider.id,
    logout: () => provider.logout(),
    forGame: () => game,
    forGenerator: () => generator,
    forHost: () => host,
  } satisfies Auth)
}
