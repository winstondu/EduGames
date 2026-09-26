/**
 * Generator conformance suite (Layer 1 of the verification plan): checks any
 * GeneratorPlugin against the contract in ./types.ts, without a game or a
 * browser. Pure and framework-free: `conformance.test.ts` runs it for every
 * plugin, and tools (sim CLI, LLM harness) can run it on demand.
 *
 *   const report = await checkConformance(plugin, { cases: [{ params: { ops: 'add' } }] })
 *   report.issues  // [] when the plugin conforms
 *
 * Rules (each issue names one):
 *   meta.*           id, name, formats, maxLevel, defaultInput
 *   options.garbage  parseOptions never throws on junk params
 *   options.roundtrip parse(serialize(o)) ≡ o, serialize is stable
 *   board.*          boardKey pattern, `${id}` prefix, stable per options
 *   requirements.*   formats honored; no overlap ⇒ IncompatibleGeneratorError (by name)
 *   problem.*        shape, levels within 1..maxLevel, choices, input spec, label, prompt math
 *   problem.id       one id ⇒ one problem (recycled problems keep their id)
 *   determinism      same seed ⇒ same problems and verdicts
 *   check.*          verdict shape; MC: exactly one correct choice, unknown ids are wrong;
 *                    freeform: junk is wrong, `expected` (and padded) is accepted
 */
import { BOARD_KEY_PATTERN } from '../shared/highscores/types'
import { mathTextToPlain, unknownMathCommands } from '../shared/mathtext/parse'
import { createRng } from '../shared/rng'
import {
  PROBLEM_FORMATS,
  type AnswerInputSpec,
  type CheckResult,
  type GeneratorContext,
  type GeneratorPlugin,
  type Problem,
  type ProblemFormat,
  type ProblemSource,
} from './types'

export interface ConformanceCase {
  /** URL params for one configured instance (without `gen`). */
  params: Record<string, string>
  /** Label in reports (default: the params as a query string). */
  name?: string
  /** This instance's checks may fail on purpose (e.g. fixture `set=flaky`): skip check rules. */
  unreliableChecks?: boolean
}

export interface ConformanceOptions {
  cases: readonly ConformanceCase[]
  /** `ctx.api` for hybrid plugins (a fake server half); default rejects (offline). */
  api?: GeneratorContext['api']
  /** Problems drawn per source (default 60). */
  draws?: number
  /** Seeds for the determinism rule (default [1, 2]). */
  seeds?: readonly number[]
  /** Problems whose answers get checked per source (default 12). */
  checks?: number
  /** Budget per async call (default 5000 ms). */
  timeoutMs?: number
}

export interface ConformanceIssue {
  rule: string
  message: string
  /** Case label, when the issue belongs to one. */
  case?: string
}

export interface ConformanceReport {
  plugin: string
  /** Rules evaluated (for "N rules, M issues" summaries). */
  checked: number
  issues: ConformanceIssue[]
}

const FORMAT_SETS: readonly (readonly ProblemFormat[])[] = [['freeform'], ['multiple-choice'], ['freeform', 'multiple-choice']]
const ID = /^[a-z0-9-]{1,32}$/
const LABEL_MAX = 8
const MAX_CHOICES = 4
const GARBAGE: readonly string[] = ['', 'format=%%%', 'level=-1&ops=\u0000', 'lesson=../../etc&set=__proto__', 'a=1&a=2&b', `x=${'9'.repeat(400)}`]

function offline(): Promise<Response> {
  return Promise.reject(new Error('offline (conformance)'))
}

function withTimeout<T>(value: T | PromiseLike<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: no answer after ${ms} ms`)), ms)
    Promise.resolve(value).then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

/** Stable JSON (sorted keys) for deep comparisons of plain data. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

function inputIssue(input: AnswerInputSpec | undefined): string | null {
  if (!input || typeof input !== 'object') return 'missing'
  if (input.kind !== 'numeric' && input.kind !== 'text') return `kind "${String(input.kind)}"`
  if (!Number.isInteger(input.maxLength) || input.maxLength < 1) return `maxLength ${input.maxLength}`
  if (input.allow !== undefined && typeof input.allow !== 'string') return 'allow must be a string'
  return null
}

export async function checkConformance(plugin: GeneratorPlugin<unknown>, options: ConformanceOptions): Promise<ConformanceReport> {
  const issues: ConformanceIssue[] = []
  let checked = 0
  const draws = options.draws ?? 60
  const seeds = options.seeds ?? [1, 2]
  const checkCount = options.checks ?? 12
  const timeoutMs = options.timeoutMs ?? 5000
  const api = options.api ?? offline

  /** Evaluate one rule: anything but `true` records an issue (a string is the reason). */
  function rule(name: string, ok: boolean | string, message: string, label?: string): boolean {
    checked++
    if (ok === true) return true
    issues.push({ rule: name, message: typeof ok === 'string' ? `${message}: ${ok}` : message, ...(label ? { case: label } : {}) })
    return false
  }

  function context(seed: number): { ctx: GeneratorContext; abort: AbortController } {
    const abort = new AbortController()
    return { ctx: { rng: createRng(seed), signal: abort.signal, api }, abort }
  }

  // ── Metadata ──────────────────────────────────────────────────────────
  rule('meta.id', ID.test(plugin.id), `id "${plugin.id}" must match ${ID}`)
  rule('meta.name', typeof plugin.name === 'string' && plugin.name.trim().length > 0, 'name must be non-empty')
  rule(
    'meta.formats',
    plugin.formats.length > 0 && plugin.formats.every((f) => PROBLEM_FORMATS.includes(f)) && new Set(plugin.formats).size === plugin.formats.length,
    `formats ${JSON.stringify(plugin.formats)} must be a non-empty set of ${PROBLEM_FORMATS.join('/')}`,
  )
  rule('meta.maxLevel', Number.isInteger(plugin.maxLevel) && plugin.maxLevel >= 1, `maxLevel ${plugin.maxLevel} must be an integer ≥ 1`)
  rule('meta.defaultInput', inputIssue(plugin.defaultInput) ?? true, 'defaultInput is invalid')
  rule('meta.kind', plugin.kind === 'client' || plugin.kind === 'hybrid', `kind "${plugin.kind}"`)

  // ── Options ───────────────────────────────────────────────────────────
  for (const raw of GARBAGE) {
    let outcome: string | true = true
    try {
      plugin.parseOptions(new URLSearchParams(raw))
    } catch (err) {
      outcome = errorText(err)
    }
    rule('options.garbage', outcome, `parseOptions threw on "${raw.slice(0, 40)}"`)
  }

  for (const c of options.cases) {
    const label = c.name ?? (new URLSearchParams(c.params).toString() || '(defaults)')
    let parsed: unknown
    try {
      parsed = plugin.parseOptions(new URLSearchParams(c.params))
    } catch (err) {
      rule('options.roundtrip', errorText(err), 'parseOptions threw', label)
      continue
    }
    if (!rule('options.roundtrip', parsed !== null, 'parseOptions returned null for a conformance case', label)) continue
    const serialized = plugin.serializeOptions(parsed)
    const reparsed = plugin.parseOptions(new URLSearchParams(serialized))
    rule('options.roundtrip', canon(reparsed) === canon(parsed), `parse(serialize(o)) ≠ o: ${canon(parsed)} → ${canon(reparsed)}`, label)
    rule(
      'options.roundtrip',
      reparsed !== null && canon(plugin.serializeOptions(reparsed)) === canon(serialized),
      'serializeOptions is not stable across a round trip',
      label,
    )
    rule(
      'options.roundtrip',
      Object.entries(serialized).every(([k, v]) => typeof v === 'string' && k !== 'gen'),
      'serializeOptions must return string values and never `gen`',
      label,
    )

    // ── Board key ───────────────────────────────────────────────────────
    const key = plugin.boardKey(parsed)
    rule('board.pattern', BOARD_KEY_PATTERN.test(key), `boardKey "${key}" must match ${BOARD_KEY_PATTERN}`, label)
    rule('board.prefix', key === plugin.id || key.startsWith(`${plugin.id}/`), `boardKey "${key}" must start with "${plugin.id}"`, label)
    rule('board.stable', reparsed !== null && plugin.boardKey(reparsed) === key, 'boardKey differs after an options round trip', label)

    // ── Requirements + problems ─────────────────────────────────────────
    for (const formats of FORMAT_SETS) {
      const overlap = formats.some((f) => plugin.formats.includes(f))
      const tag = `${label} [${formats.join('+')}]`
      const { ctx, abort } = context(seeds[0])
      let source: ProblemSource | null = null
      try {
        source = await withTimeout(plugin.create(parsed, ctx, { formats }), timeoutMs, 'create()')
      } catch (err) {
        const incompatible = err instanceof Error && err.name === 'IncompatibleGeneratorError'
        if (!overlap) rule('requirements.reject', incompatible || errorText(err), 'no format overlap must reject with IncompatibleGeneratorError', tag)
        else rule('requirements.create', incompatible || errorText(err), 'create() rejected', tag)
        abort.abort()
        continue
      }
      try {
        if (!overlap) {
          rule('requirements.reject', false, 'create() resolved although no requested format is supported', tag)
          continue
        }
        const problems = drawProblems(source, plugin.maxLevel, draws)
        if (typeof problems === 'string') {
          rule('problem.next', problems, 'next() threw', tag)
          continue
        }
        const wrongFormat = problems.find((p) => !formats.includes(p.format))
        rule('requirements.formats', !wrongFormat, `emitted a ${wrongFormat?.format} problem`, tag)
        checkProblems(problems, tag)
        checkLevels(source, tag)
        if (formats.length === PROBLEM_FORMATS.length && !c.unreliableChecks) await checkVerdicts(source, problems, tag)
      } finally {
        source.dispose?.()
        abort.abort()
      }
    }

    // ── Determinism ─────────────────────────────────────────────────────
    const runs: string[] = []
    for (let i = 0; i < 2; i++) {
      const { ctx, abort } = context(seeds[0])
      try {
        const source = await withTimeout(plugin.create(parsed, ctx, { formats: plugin.formats }), timeoutMs, 'create()')
        const problems = drawProblems(source, plugin.maxLevel, draws)
        const verdicts: unknown[] = []
        if (typeof problems !== 'string' && !c.unreliableChecks && plugin.kind === 'client') {
          for (const p of problems.slice(0, checkCount)) verdicts.push(await settle(source, p, p.choices?.[0]?.id ?? '1'))
        }
        runs.push(canon({ problems, verdicts }))
        source.dispose?.()
      } catch (err) {
        runs.push(`error ${errorText(err)}`)
      } finally {
        abort.abort()
      }
    }
    rule('determinism', runs[0] === runs[1], 'same seed produced different problems or verdicts', label)
    if (seeds.length > 1 && plugin.kind === 'client') {
      const { ctx, abort } = context(seeds[1])
      try {
        const source = await withTimeout(plugin.create(parsed, ctx, { formats: plugin.formats }), timeoutMs, 'create()')
        const other = drawProblems(source, plugin.maxLevel, draws)
        const first = runs[0].startsWith('error') ? null : (JSON.parse(runs[0]) as { problems: unknown }).problems
        // Informational for tiny banks, but a seeded generator should vary with the seed.
        rule('determinism.seeded', canon(other) !== canon(first), 'different seeds produced identical problems', label)
        source.dispose?.()
      } catch {
        // Reported by the rules above.
      } finally {
        abort.abort()
      }
    }
  }

  function drawProblems(source: ProblemSource, maxLevel: number, n: number): Problem[] | string {
    const out: Problem[] = []
    try {
      for (let i = 0; i < n; i++) out.push(source.next(1 + (i % maxLevel)))
    } catch (err) {
      return errorText(err)
    }
    return out
  }

  function checkProblems(problems: readonly Problem[], tag: string): void {
    const byId = new Map<string, string>()
    for (const p of problems) {
      const where = `problem ${JSON.stringify(p.id)} ("${String(p.prompt).slice(0, 40)}")`
      rule('problem.shape', typeof p.id === 'string' && p.id.length > 0, `${where}: id must be a non-empty string`, tag)
      rule('problem.shape', typeof p.prompt === 'string' && p.prompt.trim().length > 0, `${where}: empty prompt`, tag)
      rule('problem.level', Number.isInteger(p.level) && p.level >= 1 && p.level <= plugin.maxLevel, `${where}: level ${p.level} outside 1..${plugin.maxLevel}`, tag)
      rule('problem.format', plugin.formats.includes(p.format), `${where}: format "${p.format}" not declared by the plugin`, tag)
      if (p.label !== undefined) rule('problem.label', [...p.label].length <= LABEL_MAX, `${where}: label "${p.label}" longer than ${LABEL_MAX}`, tag)
      if (typeof p.prompt === 'string') {
        const unknown = [...unknownMathCommands(p.prompt), ...(p.choices ?? []).flatMap((c) => unknownMathCommands(c.text))]
        rule('problem.prompt', (p.prompt.replace(/\\\$/g, '').split('$').length - 1) % 2 === 0, `${where}: unbalanced $`, tag)
        rule('problem.prompt', unknown.length === 0 || unknown.map((c) => `\\${c}`).join(' '), `${where}: unsupported TeX commands`, tag)
      }
      if (p.format === 'multiple-choice') {
        const choices = p.choices ?? []
        const ids = choices.map((c) => c.id)
        rule('problem.choices', choices.length >= 2 && choices.length <= MAX_CHOICES, `${where}: ${choices.length} choices (want 2..${MAX_CHOICES})`, tag)
        rule('problem.choices', new Set(ids).size === ids.length && ids.every((id) => typeof id === 'string' && id.length > 0), `${where}: choice ids must be unique and non-empty`, tag)
        rule('problem.choices', choices.every((c) => typeof c.text === 'string' && c.text.trim().length > 0), `${where}: empty choice text`, tag)
        const texts = choices.map((c) => mathTextToPlain(c.text).replace(/\s+/g, ''))
        rule('problem.choices', new Set(texts).size === texts.length, `${where}: duplicate choice texts ${JSON.stringify(texts)}`, tag)
      } else if (p.format === 'freeform') {
        rule('problem.shape', p.choices === undefined || p.choices.length === 0, `${where}: freeform problem carries choices`, tag)
        if (p.input !== undefined) rule('problem.input', inputIssue(p.input) ?? true, `${where}: invalid input spec`, tag)
      }
      if (typeof p.id === 'string') {
        const body = canon(p)
        const seen = byId.get(p.id)
        if (seen !== undefined) rule('problem.id', seen === body, `${where}: the same id was used for a different problem`, tag)
        else byId.set(p.id, body)
      }
    }
  }

  function checkLevels(source: ProblemSource, tag: string): void {
    for (const level of [0, -3, plugin.maxLevel + 10, 2.5, Number.NaN]) {
      let outcome: string | true = true
      try {
        const p = source.next(level)
        if (!(Number.isInteger(p.level) && p.level >= 1 && p.level <= plugin.maxLevel)) outcome = `got level ${p.level}`
      } catch (err) {
        outcome = errorText(err)
      }
      rule('problem.level', outcome, `next(${level}) must clamp to 1..${plugin.maxLevel}`, tag)
    }
  }

  async function settle(source: ProblemSource, problem: Problem, given: string): Promise<CheckResult | string> {
    try {
      const result = await withTimeout(source.check(problem, given), timeoutMs, 'check()')
      return result && typeof result.correct === 'boolean' ? result : `invalid verdict ${canon(result)}`
    } catch (err) {
      return errorText(err)
    }
  }

  async function checkVerdicts(source: ProblemSource, problems: readonly Problem[], tag: string): Promise<void> {
    const mc = problems.filter((p) => p.format === 'multiple-choice').slice(0, checkCount)
    const free = problems.filter((p) => p.format === 'freeform').slice(0, checkCount)
    for (const p of mc) {
      const where = `problem ${JSON.stringify(p.id)} ("${p.prompt.slice(0, 40)}")`
      const verdicts = await Promise.all((p.choices ?? []).map((c) => settle(source, p, c.id)))
      const failed = verdicts.find((v) => typeof v === 'string')
      if (!rule('check.shape', typeof failed !== 'string' || failed, `${where}: check() failed`, tag)) continue
      const correct = verdicts.filter((v) => (v as CheckResult).correct).length
      rule('check.mc', correct === 1, `${where}: ${correct} choices judged correct (want exactly 1)`, tag)
      const unknown = await settle(source, p, '__not-a-choice__')
      rule('check.mc', typeof unknown === 'string' ? unknown : !unknown.correct || 'judged correct', `${where}: an unknown choice id must be wrong`, tag)
    }
    for (const p of free) {
      const where = `problem ${JSON.stringify(p.id)} ("${p.prompt.slice(0, 40)}")`
      const junk = await settle(source, p, '')
      if (!rule('check.shape', typeof junk === 'string' ? junk : true, `${where}: check("") failed`, tag)) continue
      rule('check.freeform', !(junk as CheckResult).correct, `${where}: an empty answer was judged correct`, tag)
      const expected = (junk as CheckResult).expected
      if (typeof expected !== 'string' || !expected.trim()) continue
      // `expected` is display text; it may contain $…$ math — accept its plain form.
      const answer = mathTextToPlain(expected).trim()
      const exact = await settle(source, p, answer)
      rule('check.freeform', typeof exact === 'string' ? exact : exact.correct || 'judged wrong', `${where}: its own expected answer "${answer}" must be correct`, tag)
      const padded = await settle(source, p, ` ${answer} `)
      rule('check.normalize', typeof padded === 'string' ? padded : padded.correct || 'judged wrong', `${where}: " ${answer} " (padded) must be correct`, tag)
    }
  }

  return { plugin: plugin.id, checked, issues }
}
