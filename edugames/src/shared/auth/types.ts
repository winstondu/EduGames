/**
 * Platform auth contract (design: docs/AUTH.md). DOM- and React-free.
 *
 * Layers and dependency direction:
 *   games / launcher ──► shared/auth (GameAuth, ui/)
 *   generators       ──► shared/auth/types (GeneratorAuthView, type-only)
 *   generators/registry ► shared/auth (HostAuth: attaches the player's session to ctx.api)
 *   shared/auth      ──► shared/highscores, shared/unrecorded, shared/apiBase — never games,
 *                        generators, launcher, React (except ui/) or the DOM.
 *
 * One AuthProvider is chosen at the composition root (`createAuth(provider)`); everything
 * else sees a narrow view of the facade, so tests and the DEV harness can swap in a stub.
 * Secrets never live here: a real provider holds at most an opaque session handle, ideally
 * an HttpOnly cookie on the API origin that JS never reads.
 */
import type {
  LeaderboardResponse,
  ScoreSubmission,
  SubmitScoreResponse,
} from '../highscores/types'

// --- identity ---------------------------------------------------------------

/** Who is playing. Guests have an optional local nickname; accounts are verified by the API Worker. */
export type PlayerIdentity =
  | {
      kind: 'guest'
      /** Nickname kept on this device; null until the player picks one. */
      displayName: string | null
    }
  | {
      kind: 'account'
      /** Opaque, stable account id issued by the API Worker (not an email). */
      id: string
      displayName: string
    }

export type PlayerKind = PlayerIdentity['kind']

export type LoginResult = { ok: true; player: PlayerIdentity } | { ok: false; error: string }

export type NicknameResult = { ok: true; name: string } | { ok: false; error: string }

/**
 * What a provider adds to requests to OUR API Worker (never to upstreams): e.g.
 * `{ credentials: 'include' }` for an HttpOnly session cookie. Guests add nothing.
 */
export interface RequestAuth {
  headers?: Record<string, string>
  credentials?: RequestCredentials
}

// --- provider contract (implemented by guest.ts; later a real provider) ------

export interface AuthProvider {
  /** e.g. 'guest'. Shown in DEV tooling only. */
  readonly id: string
  /** Players must sign in before scores can be saved (a guest provider says false). */
  readonly requiresLogin: boolean
  /** The provider offers sign-in at all (drives whether a "Sign in" button is shown). */
  readonly canLogin: boolean
  /** Current identity. Must return the same object until it changes (useSyncExternalStore). */
  current(): PlayerIdentity
  subscribe(listener: () => void): () => void
  /**
   * Start sign-in. The provider owns the flow (e.g. redirect to a Worker-served page); games
   * and generators never see credentials. Guest providers resolve `{ ok: false }`.
   */
  login(): Promise<LoginResult>
  logout(): Promise<void>
  /** Set the guest nickname (validated). Account providers may refuse or rename server-side. */
  setNickname(name: string): NicknameResult
  /** Credentials to attach to API Worker requests for this player. */
  requestAuth(): Promise<RequestAuth>
}

// --- score transport (default: src/shared/highscores/client.ts) --------------

export interface ScoresTransport {
  submit(submission: ScoreSubmission, options: { signal?: AbortSignal; auth: RequestAuth }): Promise<SubmitScoreResponse>
  leaderboard(
    gameId: string,
    boardKey: string,
    limit: number | undefined,
    options: { signal?: AbortSignal },
  ): Promise<LeaderboardResponse>
}

// --- views ---------------------------------------------------------------------

/** A finished run as the game describes it; the player's name comes from auth. */
export type ScoreRun = Omit<ScoreSubmission, 'name'>

/** Read-only player info shared by every view. */
export interface PlayerView {
  player(): PlayerIdentity
  subscribe(listener: () => void): () => void
}

/**
 * Everything a game needs: login (only if the provider offers it), the display name,
 * and scores. Games never import the highscores client directly.
 */
export interface GameAuth extends PlayerView {
  readonly requiresLogin: boolean
  readonly canLogin: boolean
  login(): Promise<LoginResult>
  setNickname(name: string): NicknameResult
  /** False while the hidden unrecorded flag is on: hide name prompts, never submit. */
  canRecord(): boolean
  /**
   * Save a run under the current player. Rejects with HighScoreError('unrecorded') when the
   * run is unrecorded (regardless of provider), AuthError('needs-name' | 'login-required')
   * when there is no usable identity, or HighScoreError for server/network failures.
   */
  submitScore(run: ScoreRun, options?: { signal?: AbortSignal }): Promise<SubmitScoreResponse>
  leaderboard(gameId: string, boardKey: string, limit?: number, options?: { signal?: AbortSignal }): Promise<LeaderboardResponse>
}

/**
 * What a generator plugin may know about the player (via GeneratorContext.auth): read-only.
 * Plugins can't log in, log out or read session material; their server half learns the
 * player from the session the host attaches to every `ctx.api` request.
 */
export type GeneratorAuthView = PlayerView

/** Host-only view (generators/registry, launcher): fetch our API with the player's session. */
export interface HostAuth extends PlayerView {
  fetch(url: string, init?: RequestInit): Promise<Response>
}

/** The facade returned by createAuth(); only the composition root holds it. */
export interface Auth extends GameAuth, HostAuth {
  readonly providerId: string
  logout(): Promise<void>
  forGame(): GameAuth
  forGenerator(): GeneratorAuthView
  forHost(): HostAuth
}

export type AuthErrorKind =
  /** Guest without a nickname: ask for one, then retry. */
  | 'needs-name'
  /** The provider requires sign-in before saving. */
  | 'login-required'

export class AuthError extends Error {
  override name = 'AuthError'
  readonly kind: AuthErrorKind
  constructor(kind: AuthErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}
