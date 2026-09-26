# Auth layer — design (phase 1: contract + guest stub, not wired in)

Status 2026-09-26. Code: `src/shared/auth/` (core, DOM/React-free) + `src/shared/auth/ui/` (React),
server stub `api/src/auth/` (nothing imports it yet). Tests: `src/shared/auth/*.test.ts`.
User decisions in `docs/HANDOFF.md` still hold (unrecorded never submits, all server code in the
API Worker, secrets never reach the browser, kindermath server half holds upstream credentials).

## Layers and dependency direction

```
 composition root (main.tsx / launcher)   createAuth(createGuestProvider())  ← picks the provider
        │ holds Auth, hands out views
        ├──► games (GameOver …)        GameAuth           login?, player name, submitScore, leaderboard
        ├──► launcher (badge)          GameAuth + ui/PlayerBadge
        ├──► generators/registry       HostAuth           fetch() that attaches the session to ctx.api
        └──► generator plugins         GeneratorAuthView  read-only player (type-only import)

 shared/auth ──► shared/highscores, shared/unrecorded, shared/apiBase   (nothing else; enforced by deps.test.ts)
 shared/auth/ui ──► shared/auth, React
 Never: auth → games | generators | launcher.   Games never import shared/highscores/client.
```

Browser → API Worker: `/v1/scores` and `/v1/generators/<id>/*` carry the player's session
(recommended: HttpOnly cookie on the API origin, so JS never holds a token). The Worker resolves
it once per request into an `Identity` and hands that to scores and generator server halves.

## Interfaces (`src/shared/auth/types.ts`)

```ts
type PlayerIdentity =
  | { kind: 'guest'; displayName: string | null }            // local nickname, may be unset
  | { kind: 'account'; id: string; displayName: string }     // verified by the Worker

interface AuthProvider {                 // implemented by guest.ts now, a real provider later
  readonly id: string
  readonly requiresLogin: boolean        // must sign in before saving scores
  readonly canLogin: boolean             // show a "Sign in" button at all
  current(): PlayerIdentity              // stable object until it changes
  subscribe(listener: () => void): () => void
  login(): Promise<LoginResult>          // provider-owned flow; games never see credentials
  logout(): Promise<void>
  setNickname(name: string): NicknameResult
  requestAuth(): Promise<RequestAuth>    // { headers?, credentials? } for OUR API only
}

type ScoreRun = Omit<ScoreSubmission, 'name'>   // the name comes from auth, not the game

interface PlayerView { player(): PlayerIdentity; subscribe(l: () => void): () => void }

interface GameAuth extends PlayerView {
  readonly requiresLogin: boolean
  readonly canLogin: boolean
  login(): Promise<LoginResult>
  setNickname(name: string): NicknameResult
  canRecord(): boolean                   // false under the unrecorded flag → hide name prompt
  submitScore(run: ScoreRun, o?: { signal?: AbortSignal }): Promise<SubmitScoreResponse>
  leaderboard(gameId: string, boardKey: string, limit?: number, o?: { signal?: AbortSignal }): Promise<LeaderboardResponse>
}
type GeneratorAuthView = PlayerView                            // read-only
interface HostAuth extends PlayerView { fetch(url: string, init?: RequestInit): Promise<Response> }

interface Auth extends GameAuth, HostAuth {                    // createAuth(provider, options?)
  readonly providerId: string
  logout(): Promise<void>
  forGame(): GameAuth; forGenerator(): GeneratorAuthView; forHost(): HostAuth   // frozen, narrow objects
}
class AuthError extends Error { kind: 'needs-name' | 'login-required' }
```

`createAuth(provider, { scores?, isUnrecorded?, apiOrigin?, fetch? })` — every option defaults to
the real module, so tests and the DEV harness inject fakes without mocking globals.

Rules owned by the facade (so no provider can get them wrong):
- **Unrecorded guard first**: `submitScore` rejects with `HighScoreError('unrecorded')` before asking
  the provider for anything, and re-checks before sending. The highscores client keeps its own
  guard (defense in depth).
- **Name on the score** = `player().displayName`. Guests without one → `AuthError('needs-name')`;
  `requiresLogin` providers refuse guests → `AuthError('login-required')`.
- **Session only to our API**: `HostAuth.fetch` adds `requestAuth()` only when the URL's origin is
  the API Worker's; other/relative URLs go out untouched.

**Why the host attaches the session (not the plugin):** plugins are remotely loaded modules; they
get only `player()` for display and never touch tokens. Their server half learns who is playing
from the `Identity` the Worker resolves from the same request. One mechanism for every generator,
and `GeneratorAuth` (fields/login/logout/status) disappears from the plugin contract.

## Stub behavior (`createGuestProvider({ storage? })`)

- `requiresLogin: false`, `canLogin: false`; `login()` → `{ ok: false, error: 'Sign-in is not available yet — play as a guest.' }`; `logout()` no-op.
- Nickname in localStorage `edugames.nickname` (same key the shooter uses today); invalid stored
  values read as `null`; `setNickname` applies the server's rules (`normalizeNickname`), persists,
  notifies. Pass `storage: null` (or an in-memory store) for tests and the harness.
- `requestAuth()` → `{}`; scores go to the existing `POST /v1/scores` via `highscores/client.ts`
  (`scores.ts` transport, which refuses non-empty credentials until the client can forward them).
- UI: `ui/PlayerBadge.tsx` (`PlayerBadge`: "Playing as Ada (guest)", Sign in only if `canLogin`;
  `NicknameForm`) and `ui/usePlayer.ts` (`useSyncExternalStore`). No credential fields anywhere.

## Server seam (`api/src/auth/`, stub only)

```ts
type Identity = { kind: 'guest' } | { kind: 'account'; accountId: string; displayName: string }
interface IdentityVerifier { identify(request: Request): Promise<Identity> }   // never throws; bad session → guest
export const guestVerifier: IdentityVerifier                                   // today: everyone is a guest
```

Wiring later (router, `api/src/index.ts`): `const identity = await verifier.identify(request)` once,
then `handleScores(request, env, identity)` and `server.handle(request, subpath, env, ctx, identity)`.
A real verifier reads an HttpOnly `Secure; SameSite=Lax` session cookie set by the Worker
(`games.` and `api.games.` are same-site, so `credentials: 'include'` sends it; localhost dev too),
looks the session up in D1 (`sessions`, `accounts` tables), and returns the account.

`/v1/scores`:
- Migration `0002_accounts.sql`: `ALTER TABLE scores ADD COLUMN account_id TEXT` (NULL = guest) + index.
- Guest: unchanged (client nickname, validated, per-IP rate limit).
- Account: `name` = server `displayName` (the client's `name` is ignored), `account_id` stored, rate
  limit per account. `ScoreEntry` gains `account?: true` so boards can badge verified entries.

kindermath pass-through:
- Today (unchanged): every identity → the demo session (`KINDERMATH_DEV_USER_EMAIL` +
  `KINDERMATH_DEMO_PASSWORD`). Stub `login`/`logout` routes go away with `GeneratorAuth`; `session`
  stays as info (demo account name).
- Later: `upstreamSessionFor(identity)` → an account with a linked kindermath login uses its own
  upstream cookie, kept server-side only (D1/KV, encrypted with a Worker secret, keyed by
  `accountId`); guests (and unlinked accounts) keep the demo session. The user's kindermath
  password is exchanged upstream once and never stored or returned.

## Migration plan (phase 2, after the user approves the interface)

1. **Composition root** — new `src/app/auth.ts`: `export const auth = createAuth(createGuestProvider())`
   (provider chosen here only; later by env). Launcher and game routes pass views down as props.
2. **highscores client** — add `headers`/`credentials` to `RequestOptions` and forward them; drop
   the refusal in `auth/scores.ts`. Only `shared/auth` imports `highscores/client`; games keep
   importing `highscores/types` (constants, `ScoreEntry`).
3. **GameOver.tsx** — prop `auth: GameAuth`; `unrecorded` → `!auth.canRecord()`; `submitScore(...)`
   → `auth.submitScore(run)` (no `name`); `fetchLeaderboard` → `auth.leaderboard`; nickname form →
   `<NicknameForm auth>` when `player().kind === 'guest'`, else "Saving as <name>"; show
   `Sign in` only if `auth.canLogin`. Delete `loadNickname/saveNickname` from `ui/hooks.ts` and
   `NAME_PATTERN` from GameOver. Move `.auth*` rules from `launcher/launcher.css` to
   `shared/auth/ui/auth.css`.
4. **Generators** — `GeneratorContext` gains `auth: GeneratorAuthView`;
   `createGeneratorContext(pluginId, seed, signal, auth: HostAuth)` builds `ctx.api` on
   `auth.fetch` (keeps `credentials: 'include'`, abort merging). Remove `GeneratorAuth`,
   `AuthField`, `AuthStatus` and `plugin.auth`; add an optional `account?: 'none' | 'optional' |
   'required'` so the launcher (not the plugin) asks for sign-in before Play. kindermath: delete
   `auth`, `getSession/postLogin/postLogout` from `client.ts`; its server half drops `login`/`logout`.
   Conformance: assert plugins never read `document.cookie`/storage for auth (optional).
5. **Launcher** — replace `AuthBadge` (which collects a real email/password and discards it —
   audit finding) with `<PlayerBadge auth>`; kindermath gets a static "Uses a shared demo
   account" note from plugin metadata. No credential inputs while only the demo exists.
6. **API** — pass `Identity` through the router (step above); scores migration; generator
   `handle(..., identity)`; add the `check` rate limit from the audit while there.
7. **Harness / MetaPanel** — DEV `open()` stays unrecorded (facade refuses submits anyway); the
   harness uses `createAuth(createGuestProvider({ storage: null }))` so bot runs never read or
   overwrite the player's nickname. MetaPanel shows `providerId` + player kind. `bun run sim` /
   MCP tools submit nothing — no change.
8. **Docs** — shooter README dependency rule: add "`ui` → `shared/auth` (+`auth/ui`), never
   `shared/highscores/client`; generators → `shared/auth/types` only (type import); `shared/auth`
   → `shared/{highscores,unrecorded,apiBase}` only"; also list `shared/rng` (audit). HANDOFF:
   link this file.
9. **Tests** — GameOver with a fake `GameAuth` (guest, account, unrecorded, needs-name); registry
   test that `ctx.api` goes through `HostAuth.fetch`; api scores test for guest vs account rows.

## Open questions (recommended default in bold)

1. Identity source for real accounts? **Worker-issued platform accounts with "Sign in with
   KinderMath" as the first (only) method**: the Worker verifies upstream, stores the upstream
   session server-side, sets an HttpOnly cookie — which also gives per-user kindermath for free.
   Alternatives: email magic link, Google/OAuth via the Worker.
2. Session transport? **HttpOnly cookie on the API origin** (no token in JS). Bearer token in
   memory only if a future host isn't same-site.
3. Can a guest use a nickname equal to an account's display name? **Yes, but account entries get
   a ✓ badge**; no name reservation.
4. Should `requiresLogin` ever be true platform-wide? **No — guests always allowed**; individual
   generators may declare `account: 'required'` later.
5. Where does login UI live? **A Worker-served login page / redirect (`login()` navigates)**, so the
   SPA never renders a password field; alternative is an in-app form in `auth/ui/` posting only to
   `/v1/auth/login`.
6. Guest kindermath checks keep posting to the demo account? **Yes, with the audit's rate limit**
   until per-user sessions exist.
