/**
 * Problem-generator plugin contract.
 *
 * Games never bundle or import a concrete generator. The URL carries a
 * generator id (`/space-shooter?gen=kindermath&lesson=<uuid>`); the registry
 * fetches the manifest from our server (`GET /api/generators`) and dynamically
 * imports the plugin module it names. A plugin is either:
 *  - 'client': all logic runs in the browser (e.g. `math`), or
 *  - 'hybrid': the browser half talks to its own server half through
 *    `ctx.api(...)` → `/api/generators/<id>/...` on our Worker, which passes
 *    through to upstream services (e.g. api.kindermath.org) — same-origin, so
 *    no CORS is needed upstream and credentials stay server-side.
 *
 * Everything here is string-based and DOM-free; plugin modules must not import
 * game, engine, render, or React code.
 */
import type { Rng } from '../shared/rng'

/** How the player supplies an answer for one problem. */
export type AnswerMode = 'typed' | 'choice'

export interface Choice {
  /** Opaque id sent back as `given` in check(). */
  id: string
  /** Display text; may contain inline math ($…$). */
  text: string
}

export interface AnswerInputSpec {
  /** 'numeric' → digit keypad (plus '-', '.', '/' if `allow` says so); 'text' → letters/digits. */
  kind: 'numeric' | 'text'
  /** Max characters the quiver accepts. */
  maxLength: number
  /** Extra characters accepted beyond the kind's default set, e.g. "-./x". */
  allow?: string
}

export interface Problem {
  /** Unique within a ProblemSource instance. */
  id: string
  /**
   * Question text. May contain inline math between `$…$` using a small TeX
   * subset: + - = < > ( ) ^{} _{} \times \div \cdot \frac{a}{b} \sqrt{x} \le \ge.
   * Short prompts ("6+7") are drawn on the asteroid; long ones in a banner.
   */
  prompt: string
  /** Optional ≤ 8-char asteroid label for long prompts (renderer falls back to "?"). */
  label?: string
  /** Difficulty level the problem belongs to (1 = easiest). */
  level: number
  /** Present → multiple choice: the player picks one and its `id` is checked. Absent → typed. */
  choices?: Choice[]
  /** Typed problems: input spec (defaults to the plugin's `defaultInput`). */
  input?: AnswerInputSpec
  /** Optional hint the UI may reveal. */
  hint?: string
}

export interface CheckResult {
  correct: boolean
  /** Shown as feedback after answering (may contain $…$ math). */
  explanation?: string
  /** Expected answer display text, when the plugin knows it (client plugins usually do). */
  expected?: string
}

/** A live source of problems for one play session. */
export interface ProblemSource {
  /**
   * Next problem at `level` (clamped to 1..plugin.maxLevel). Synchronous:
   * hybrid plugins preload a pool in create() and refill it in the background,
   * recycling (reshuffled) problems if the pool runs dry.
   */
  next(level: number): Problem
  /**
   * Check an answer. `given` is a choice id for multiple-choice problems, or
   * the raw typed text otherwise. Hybrid plugins may return a Promise
   * (server-side checking); the game treats the shot as pending until it settles.
   */
  check(problem: Problem, given: string): CheckResult | Promise<CheckResult>
  /** Release timers / abort in-flight requests. */
  dispose?(): void
}

/** Services the host gives a plugin. */
export interface GeneratorContext {
  /** Seeded RNG for this session (use instead of Math.random). */
  rng: Rng
  /**
   * fetch() scoped to this plugin's server half, same-origin with cookies:
   * `ctx.api('lessons/abc/practice')` → `GET /api/generators/<id>/lessons/abc/practice`.
   * Client-only plugins never call it.
   */
  api(path: string, init?: RequestInit): Promise<Response>
  /** Aborted when the game session ends. */
  signal: AbortSignal
}

export interface AuthField {
  name: string
  label: string
  type: 'text' | 'email' | 'password'
}

export interface AuthStatus {
  loggedIn: boolean
  displayName?: string
  /** True while the server half is using a stub/demo identity. */
  demo?: boolean
}

/**
 * Optional sign-in for hybrid plugins whose upstream needs a user session.
 * Credentials go only to the plugin's own server half (`ctx.api`), never upstream directly.
 */
export interface GeneratorAuth {
  fields: AuthField[]
  status(ctx: GeneratorContext): Promise<AuthStatus>
  login(ctx: GeneratorContext, credentials: Record<string, string>): Promise<AuthStatus & { error?: string }>
  logout(ctx: GeneratorContext): Promise<void>
}

/** A pre-configured instance (e.g. one kindermath lesson) for pickers. */
export interface GeneratorVariant {
  /** URL params that select this variant, merged with `gen=<id>`. */
  params: Record<string, string>
  label: string
  /** Grouping for the picker, e.g. "5th Grade › Fractions". */
  group?: string
  description?: string
}

export interface GeneratorPlugin<Options = unknown> {
  /** URL id, e.g. "math". Lowercase [a-z0-9-]. Must match the manifest entry. */
  id: string
  name: string
  description: string
  kind: 'client' | 'hybrid'
  maxLevel: number
  /** Default input spec for typed problems. */
  defaultInput: AnswerInputSpec
  /**
   * Answer modes the player may choose between via the `mode` URL param
   * (e.g. math: ['choice','typed']). Omit when the source fixes it per problem.
   */
  answerModes?: readonly AnswerMode[]
  /** Read options from the URL; must tolerate missing/garbage params. Returns null if required params are missing. */
  parseOptions(params: URLSearchParams): Options | null
  /** Inverse of parseOptions (without `gen`). */
  serializeOptions(options: Options): Record<string, string>
  /**
   * Leaderboard key for these options — one board per configured generator:
   * `[a-z0-9/_-]{1,96}`, prefixed by the plugin id, e.g. "math/add-sub", "kindermath/<lessonId>".
   */
  boardKey(options: Options): string
  /** Human title for the configured instance, e.g. "Variables & terms". */
  describe(options: Options, ctx: GeneratorContext): Promise<string>
  /** Enumerate variants for a picker (e.g. kindermath courses → lessons). */
  listVariants?(ctx: GeneratorContext): Promise<GeneratorVariant[]>
  auth?: GeneratorAuth
  /** Build a ProblemSource (hybrid plugins fetch their bank here). Reject with an Error whose message is user-presentable. */
  create(options: Options, ctx: GeneratorContext): Promise<ProblemSource>
}

/** `GET /api/generators` response. */
export interface GeneratorManifest {
  generators: GeneratorManifestEntry[]
}

export interface GeneratorManifestEntry {
  id: string
  name: string
  description: string
  kind: 'client' | 'hybrid'
  version: string
  /** Module URL to `import()`; its default export is a GeneratorPlugin. Same-origin only. */
  entry: string
}
