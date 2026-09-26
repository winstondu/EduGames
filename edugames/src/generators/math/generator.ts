/**
 * Problem generation: a gentle 10-level curve over + − × ÷. Operations are
 * introduced gradually (+ at 1, − at 2, × at 3, ÷ at 4) among those enabled;
 * if none of the enabled ops is introduced yet, the enabled ones are used at
 * this level's easiest settings. All answers are non-negative integers ≤ 198.
 */
import type { Problem, ProblemFormat } from '../types'
import { pick, randInt, type Rng } from '../../shared/rng'
import { formatPrompt, solve, type Question } from './checker'
import { makeChoices } from './choices'
import type { Op } from './options'

export const MAX_LEVEL = 10

interface LevelSpec {
  /** + : max sum, min operand. */
  addMax: number
  addMin: number
  /** − : max minuend, min subtrahend. */
  subMax: number
  subMin: number
  /** × and ÷ : tables up to `table`, other factor / quotient up to `times`, both ≥ `factorMin`. */
  table: number
  times: number
  factorMin: number
}

/** Index 0 = level 1. */
const LEVELS: readonly LevelSpec[] = [
  { addMax: 10, addMin: 0, subMax: 10, subMin: 0, table: 2, times: 5, factorMin: 1 },
  { addMax: 20, addMin: 1, subMax: 20, subMin: 1, table: 3, times: 5, factorMin: 1 },
  { addMax: 50, addMin: 2, subMax: 50, subMin: 2, table: 5, times: 10, factorMin: 1 },
  { addMax: 70, addMin: 3, subMax: 70, subMin: 3, table: 5, times: 10, factorMin: 2 },
  { addMax: 100, addMin: 5, subMax: 99, subMin: 5, table: 6, times: 10, factorMin: 2 },
  { addMax: 120, addMin: 8, subMax: 99, subMin: 8, table: 7, times: 10, factorMin: 2 },
  { addMax: 150, addMin: 10, subMax: 99, subMin: 10, table: 8, times: 10, factorMin: 2 },
  { addMax: 170, addMin: 10, subMax: 99, subMin: 10, table: 9, times: 12, factorMin: 2 },
  { addMax: 190, addMin: 10, subMax: 99, subMin: 10, table: 10, times: 12, factorMin: 2 },
  { addMax: 198, addMin: 10, subMax: 99, subMin: 10, table: 12, times: 12, factorMin: 2 },
]

/** Level at which each op joins the mix. */
const INTRODUCED: Record<Op, number> = { add: 1, sub: 2, mul: 3, div: 4 }

/** Round and clamp to 1..MAX_LEVEL (non-finite → 1). */
export function clampLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(MAX_LEVEL, Math.max(1, Math.round(level))) : 1
}

export function levelSpec(level: number): LevelSpec {
  return LEVELS[clampLevel(level) - 1]
}

/** Ops eligible at `level` from the enabled set. */
export function opsForLevel(level: number, ops: readonly Op[]): readonly Op[] {
  const ready = ops.filter((op) => INTRODUCED[op] <= clampLevel(level))
  return ready.length ? ready : ops
}

/** A random question at `level` using one of `ops` (non-empty). */
export function makeQuestion(rng: Rng, level: number, ops: readonly Op[]): Question {
  const s = levelSpec(level)
  const op = pick(rng, opsForLevel(level, ops))
  let a: number
  let b: number
  switch (op) {
    case 'add': {
      // Operands in [addMin, 99] with a + b ≤ addMax.
      const hi = Math.min(99, s.addMax - s.addMin)
      a = randInt(rng, s.addMin, hi)
      b = randInt(rng, s.addMin, Math.min(99, s.addMax - a))
      break
    }
    case 'sub': {
      a = randInt(rng, s.subMin, s.subMax)
      b = randInt(rng, s.subMin, a)
      break
    }
    case 'mul': {
      const t = randInt(rng, s.factorMin, s.table)
      const k = randInt(rng, s.factorMin, s.times)
      ;[a, b] = rng() < 0.5 ? [t, k] : [k, t]
      break
    }
    case 'div': {
      b = randInt(rng, s.factorMin, s.table)
      a = b * randInt(rng, s.factorMin, s.times)
      break
    }
  }
  return { a, op, b, answer: solve(a, op, b) }
}

const HINT: Record<Op, (q: Question) => string | undefined> = {
  add: () => undefined,
  sub: ({ a, b }) => `${b} + ? = ${a}`,
  mul: ({ a, b }) => (b <= 10 ? `${a} added ${b} times` : undefined),
  div: ({ a, b }) => `? × ${b} = ${a}`,
}

/** Build a Problem of the given format for `q` (multiple-choice: at most `maxChoices` choices, default 4). */
export function toProblem(rng: Rng, q: Question, level: number, format: ProblemFormat, id: string, maxChoices?: number): Problem {
  const prompt = formatPrompt(q.a, q.op, q.b)
  const problem: Problem = { id, prompt, label: prompt.replace(/ /g, ''), level: clampLevel(level), format }
  const hint = HINT[q.op](q)
  if (hint) problem.hint = hint
  if (format === 'multiple-choice') problem.choices = makeChoices(rng, q, maxChoices)
  else problem.input = { kind: 'numeric', maxLength: 3 }
  return problem
}
