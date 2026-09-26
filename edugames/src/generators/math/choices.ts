/** Multiple-choice options: the answer plus three plausible distractors. */
import type { Choice } from '../types'
import { shuffle, type Rng } from '../../shared/rng'
import { OPS } from './options'
import { solve, type Question } from './checker'

export const CHOICE_IDS = ['a', 'b', 'c', 'd'] as const

/** Largest value a distractor may take (answers fit the 3-char freeform input too). */
const MAX_VALUE = 999

/** Slips a learner might make: off by one or two. */
function near({ answer }: Question): number[] {
  return [answer + 1, answer - 1, answer + 2, answer - 2]
}

/** Conceptual mistakes: wrong operation, swapped digits, off by ten. */
function far({ a, op, b, answer }: Question): number[] {
  const out = OPS.filter((other) => other !== op).map((other) => solve(a, other, b))
  if (answer >= 10) out.push(Number(String(answer).split('').reverse().join('')))
  out.push(answer + 10, answer - 10)
  return out
}

/** Distinct, non-negative integer distractors (never the answer); at least one is a near miss. */
export function distractors(rng: Rng, q: Question, count = 3): number[] {
  // Keep wrong-operation values in the problem's ballpark (no 819 for 21 + 39).
  const max = Math.min(MAX_VALUE, 3 * Math.max(q.a, q.b, q.answer, 3))
  const valid = (n: number) => Number.isInteger(n) && n >= 0 && n <= max && n !== q.answer
  const [first, ...restNear] = shuffle(rng, near(q).filter(valid))
  const rest = shuffle(rng, [...restNear, ...far(q)])
  const out: number[] = []
  for (const n of [first, ...rest]) {
    if (out.length < count && n !== undefined && valid(n) && !out.includes(n)) out.push(n)
  }
  // Tiny answers can run out of candidates; widen outward until we have enough.
  for (let k = 3; out.length < count; k++) {
    for (const n of [q.answer + k, q.answer - k]) {
      if (out.length < count && valid(n) && !out.includes(n)) out.push(n)
    }
  }
  return out
}

/** Four choices (ids 'a'..'d') with the correct one at a random position. */
export function makeChoices(rng: Rng, q: Question): Choice[] {
  const values = shuffle(rng, [q.answer, ...distractors(rng, q, CHOICE_IDS.length - 1)])
  return values.map((n, i) => ({ id: CHOICE_IDS[i], text: String(n) }))
}
