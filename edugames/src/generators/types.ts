/**
 * Problem-generator plugin contract — shared by ALL games (m games + n
 * generators, not m × n). Nothing here may be game-specific.
 *
 * Games never bundle or import a concrete generator. The URL carries a
 * generator id (`/<game>?gen=kindermath&lesson=<uuid>`); the registry
 * fetches the manifest from our API Worker (`GET <API_BASE>/v1/generators`,
 * API_BASE = https://api.games.winstondu.com in prod) and dynamically imports
 * the plugin module it names. A plugin is either:
 *  - 'client': all logic runs in the browser (e.g. `math`), or
 *  - 'hybrid': the browser half talks to its own server half through
 *    `ctx.api(...)` → `<API_BASE>/v1/generators/<id>/...`, which passes
 *    through to upstream services (e.g. api.kindermath.org). Our API allows
 *    CORS from our game origins, so upstreams never need to, and credentials
 *    stay server-side.
 *
 * Compatibility: every Problem has a `format`. Plugins declare the formats
 * they can emit; games declare the formats they support (src/games/types.ts)
 * and pass them as `requirements` to create().
 *
 * Everything here is string-based and DOM-free; plugin modules must not import
 * game, engine, render, or React code.
 */
import type { Rng } from '../shared/rng'

/**
 * How a problem is answered:
 *  - 'freeform': the player enters an answer (typed/keypad); `input` applies.
 *  - 'multiple-choice': the player picks one of `choices`.
 * New formats (ordering, matching, …) get added here; games opt in explicitly.
 */
export type ProblemFormat = 'freeform' | 'multiple-choice'

export const PROBLEM_FORMATS: readonly ProblemFormat[] = ['freeform', 'multiple-choice']

/** What a game can present; passed to create() so the plugin only emits usable problems. */
export interface ProblemRequirements {
  formats: readonly ProblemFormat[]
  /**
   * Most choices the game can show for one multiple-choice problem. Plugins must never exceed it:
   * emit fewer choices (always keeping the correct one), or drop problems they can't shrink (e.g.
   * server-checked ones whose correct choice the plugin doesn't know). Below MIN_CHOICES,
   * multiple-choice can't be presented at all. Absent → no limit.
   */
  maxChoices?: number
}

/** A multiple-choice problem needs at least this many choices. */
export const MIN_CHOICES = 2

/** How many choices a plugin may emit: min(`natural`, requirements.maxChoices). */
export function choiceLimit(requirements: ProblemRequirements, natural = Number.POSITIVE_INFINITY): number {
  const max = requirements.maxChoices
  return typeof max === 'number' && Number.isFinite(max) ? Math.min(natural, Math.floor(max)) : natural
}

/**
 * The formats of `requirements` a plugin can actually use: drops 'multiple-choice' when
 * maxChoices < MIN_CHOICES.
 */
export function usableFormats(requirements: ProblemRequirements): ProblemFormat[] {
  const mcOk = choiceLimit(requirements) >= MIN_CHOICES
  return requirements.formats.filter((f) => f !== 'multiple-choice' || mcOk)
}

/**
 * Reject create() with this when requirements can't be met (e.g. an all-freeform
 * lesson in an MC-only game). Plugins bundle their own copy, so hosts must test
 * `err.name === 'IncompatibleGeneratorError'`, not `instanceof`.
 */
export class IncompatibleGeneratorError extends Error {
  override name = 'IncompatibleGeneratorError'
}

export interface Choice {
  /** Opaque id sent back as `given` in check(). */
  id: string
  /** Display text; may contain inline math ($…$). */
  text: string
}

export interface AnswerInputSpec {
  /** 'numeric' → digit keypad (plus '-', '.', '/' if `allow` says so); 'text' → letters/digits. */
  kind: 'numeric' | 'text'
  /** Max characters the answer field accepts. */
  maxLength: number
  /** Extra characters accepted beyond the kind's default set, e.g. "-./x". */
  allow?: string
}

export interface Problem {
  /** Identifies the problem within a ProblemSource: one id is one problem (recycled problems keep their id). */
  id: string
  /**
   * Question text. May contain inline math between `$…$` using a small TeX
   * subset: + - = < > ( ) ^{} _{} \times \div \cdot \frac{a}{b} \sqrt{x} \le \ge.
   * Games may draw short prompts ("6+7") inline and show long ones in a banner.
   */
  prompt: string
  /** Optional ≤ 8-char short label for games with little room (falls back to "?" when prompt is long). */
  label?: string
  /** Difficulty level the problem belongs to (1 = easiest). */
  level: number
  format: ProblemFormat
  /** Required iff format === 'multiple-choice'; the chosen `id` is what gets checked. */
  choices?: Choice[]
  /** Freeform problems: input spec (defaults to the plugin's `defaultInput`). */
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
   * the raw entered text for freeform ones. Hybrid plugins may return a Promise
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
   * fetch() scoped to this plugin's server half (credentials included):
   * `ctx.api('lessons/abc/practice')` → `GET <API_BASE>/v1/generators/<id>/lessons/abc/practice`.
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
  /** Test-only generators (e.g. `fixture`): listed in the manifest but hidden from launchers outside the dev harness. */
  hidden?: boolean
  maxLevel: number
  /** Default input spec for freeform problems. */
  defaultInput: AnswerInputSpec
  /** Every format this plugin can emit. Launchers hide game/generator pairs with no overlap. */
  formats: readonly ProblemFormat[]
  /**
   * true → the player may pick one format via the `format` URL param (e.g. math);
   * false → the source decides per problem (e.g. kindermath lessons mix both).
   * Either way create() must honor `requirements`.
   */
  formatSelectable: boolean
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
  /**
   * Build a ProblemSource (hybrid plugins fetch their bank here). Only emit
   * problems whose format is in `usableFormats(requirements)`, with at most
   * `requirements.maxChoices` choices; reject with IncompatibleGeneratorError
   * if that leaves nothing. Other rejections must
   * carry a user-presentable message.
   */
  create(options: Options, ctx: GeneratorContext, requirements: ProblemRequirements): Promise<ProblemSource>
}

/** `GET <API_BASE>/v1/generators` response. */
export interface GeneratorManifest {
  generators: GeneratorManifestEntry[]
}

export interface GeneratorManifestEntry {
  id: string
  name: string
  description: string
  kind: 'client' | 'hybrid'
  formats: ProblemFormat[]
  hidden?: boolean
  version: string
  /** Absolute module URL to `import()` (our API origin, or the Vite dev server in dev); default export is a GeneratorPlugin. */
  entry: string
}
