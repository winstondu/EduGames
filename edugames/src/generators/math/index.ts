/**
 * "math" client plugin: arithmetic drills (+ − × ÷) in freeform or
 * multiple-choice format. Composes generator.ts (problems) and checker.ts
 * (answers); bundled standalone and loaded at runtime via the manifest.
 */
import {
  IncompatibleGeneratorError,
  type AnswerInputSpec,
  type GeneratorPlugin,
  type ProblemFormat,
  type ProblemRequirements,
  type ProblemSource,
  choiceLimit,
  usableFormats,
} from '../types'
import { check } from './checker'
import { CHOICE_IDS } from './choices'
import { MAX_LEVEL, makeQuestion, toProblem } from './generator'
import {
  boardKey,
  describeOptions,
  normalizeOps,
  parseOptions,
  serializeOptions,
  type MathOptions,
} from './options'

export type { MathOptions, Op } from './options'

const FORMATS: readonly ProblemFormat[] = ['freeform', 'multiple-choice']

const DEFAULT_INPUT: AnswerInputSpec = { kind: 'numeric', maxLength: 3 }

/** The preferred format if the game supports it, else any other we can emit. */
export function resolveFormat(preferred: ProblemFormat, requirements: ProblemRequirements): ProblemFormat {
  const usable = usableFormats(requirements)
  if (usable.includes(preferred)) return preferred
  const fallback = FORMATS.find((f) => usable.includes(f))
  if (!fallback) throw new IncompatibleGeneratorError('Math problems need freeform or multiple-choice answers.')
  return fallback
}

const plugin: GeneratorPlugin<MathOptions> = {
  id: 'math',
  name: 'Math',
  description: 'Arithmetic practice: addition, subtraction, times tables and division.',
  kind: 'client',
  maxLevel: MAX_LEVEL,
  defaultInput: DEFAULT_INPUT,
  formats: FORMATS,
  formatSelectable: true,
  parseOptions,
  serializeOptions,
  boardKey,
  describe: async (options) => describeOptions(options),
  listVariants: async () => [
    { label: 'Addition', params: { ops: 'add' }, group: 'Math', description: 'Sums, from within 10 up to two digits.' },
    { label: 'Add & Subtract', params: { ops: 'add,sub' }, group: 'Math', description: 'Sums and differences, never negative.' },
    { label: 'Times Tables', params: { ops: 'mul' }, group: 'Math', description: 'Multiplication tables up to 12.' },
    { label: 'Division', params: { ops: 'div' }, group: 'Math', description: 'Exact division by up to 12.' },
    { label: 'Mixed', params: { ops: 'add,sub,mul,div' }, group: 'Math', description: 'All four operations.' },
  ],
  async create(options, ctx, requirements): Promise<ProblemSource> {
    const format = resolveFormat(options.format, requirements)
    const ops = normalizeOps(options.ops)
    const maxChoices = choiceLimit(requirements, CHOICE_IDS.length)
    let count = 0
    return {
      next(level) {
        const q = makeQuestion(ctx.rng, level, ops)
        return toProblem(ctx.rng, q, level, format, `math-${++count}`, maxChoices)
      },
      check,
    }
  },
}

export default plugin
