/**
 * "fixture" client plugin (hidden, dev harness only): deterministic problem
 * sets that exercise every presentation path — short/long prompts, $…$ math,
 * fractions, exponents, both formats — plus slow and flaky checks.
 * URL: `?gen=fixture&set=mixed|long|mc|freeform|slow|flaky`.
 */
import {
  IncompatibleGeneratorError,
  type AnswerInputSpec,
  type CheckResult,
  type GeneratorPlugin,
  type Problem,
  type ProblemSource,
} from '../types'
import { FIXTURE_SETS, FLAKY_EVERY, SETS, SLOW_CHECK_MS, formatAnswer, parseAnswer, templatesFor, type Answer, type FixtureSetName } from './sets'

export { FIXTURE_SETS, type FixtureSetName } from './sets'

export interface FixtureOptions {
  set: FixtureSetName
}

const DEFAULT_SET: FixtureSetName = 'mixed'
const MAX_LEVEL = 3
const DEFAULT_INPUT: AnswerInputSpec = { kind: 'numeric', maxLength: 5, allow: '-/' }

function isSet(s: string): s is FixtureSetName {
  return (FIXTURE_SETS as readonly string[]).includes(s)
}

interface Stored {
  answer: Answer
  correctChoice?: string
}

function judge(problem: Problem, stored: Stored | undefined, given: string): CheckResult {
  if (!stored) return { correct: false }
  const expected = formatAnswer(stored.answer)
  const explanation = `Answer: ${expected}`
  if (problem.format === 'multiple-choice') return { correct: given === stored.correctChoice, expected, explanation }
  const parsed = parseAnswer(given)
  const correct = !!parsed && parsed.num === stored.answer.num && parsed.den === stored.answer.den
  return { correct, expected, explanation }
}

const plugin: GeneratorPlugin<FixtureOptions> = {
  id: 'fixture',
  name: 'Fixture',
  description: 'Test-only problem sets for the dev harness (long prompts, math, slow and flaky checks).',
  kind: 'client',
  hidden: true,
  maxLevel: MAX_LEVEL,
  defaultInput: DEFAULT_INPUT,
  formats: ['freeform', 'multiple-choice'],
  formatSelectable: false,
  parseOptions(params) {
    const set = (params.get('set') ?? '').trim().toLowerCase()
    return { set: isSet(set) ? set : DEFAULT_SET }
  },
  serializeOptions: (options) => ({ set: options.set }),
  boardKey: (options) => `fixture/${options.set}`,
  describe: async (options) => `Fixture · ${options.set}`,
  listVariants: async () => FIXTURE_SETS.map((set) => ({ label: set, params: { set }, group: 'Fixture' })),
  async create(options, ctx, requirements): Promise<ProblemSource> {
    const set = SETS[options.set] ?? SETS[DEFAULT_SET]
    const templates = templatesFor(options.set, requirements.formats)
    if (templates.length === 0) throw new IncompatibleGeneratorError(`Fixture set "${options.set}" has no problems in the supported formats.`)
    const answers = new Map<string, Stored>()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let count = 0
    let checks = 0
    return {
      next(level) {
        const lvl = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level) || 1))
        const template = templates[Math.floor(ctx.rng() * templates.length)]
        const built = template(ctx.rng, lvl)
        const id = `fixture-${++count}`
        answers.set(id, { answer: built.answer, correctChoice: built.correctChoice })
        return { ...built.problem, id, level: lvl }
      },
      check(problem, given) {
        const result = judge(problem, answers.get(problem.id), given)
        if (set.check === 'instant') return result
        if (set.check === 'flaky') {
          checks++
          return checks % FLAKY_EVERY === 0 ? Promise.reject(new Error('fixture: flaky check failed')) : Promise.resolve(result)
        }
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            timers.delete(timer)
            resolve(result)
          }, SLOW_CHECK_MS)
          timers.add(timer)
        })
      },
      dispose() {
        for (const timer of timers) clearTimeout(timer)
        timers.clear()
      },
    }
  },
}

export default plugin
