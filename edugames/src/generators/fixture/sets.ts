/**
 * Fixture problem sets for the dev harness. Each template builds one problem
 * (deterministically from the session rng) plus its answer; `sets` groups
 * templates and picks a check behavior (instant, slow, flaky).
 */
import { pick, randInt, shuffle, type Rng } from '../../shared/rng'
import type { AnswerInputSpec, Choice, Problem, ProblemFormat } from '../types'

export type FixtureSetName = 'mixed' | 'long' | 'mc' | 'freeform' | 'slow' | 'flaky'

export const FIXTURE_SETS: readonly FixtureSetName[] = ['mixed', 'long', 'mc', 'freeform', 'slow', 'flaky']

/** How check() answers: sync, after SLOW_CHECK_MS, or rejecting every FLAKY_EVERY-th call. */
export type CheckBehavior = 'instant' | 'slow' | 'flaky'

export const SLOW_CHECK_MS = 1500
export const FLAKY_EVERY = 3

/** Canonical answer: an integer, or a fraction n/d (equivalent fractions are accepted). */
export interface Answer {
  num: number
  den: number
}

export interface Built {
  problem: Omit<Problem, 'id' | 'level'>
  /** Freeform answer; for multiple-choice, the correct choice id is `correctChoice`. */
  answer: Answer
  correctChoice?: string
}

type Template = (rng: Rng, level: number) => Built

const NUMERIC: AnswerInputSpec = { kind: 'numeric', maxLength: 4, allow: '-' }
const FRACTION: AnswerInputSpec = { kind: 'numeric', maxLength: 5, allow: '/-' }

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a || 1
}

export function reduce(num: number, den: number): Answer {
  const g = gcd(num, den)
  const sign = den < 0 ? -1 : 1
  return { num: (sign * num) / g, den: (sign * den) / g }
}

export function formatAnswer(a: Answer): string {
  return a.den === 1 ? String(a.num) : `${a.num}/${a.den}`
}

/** Parse "12", "-3", "6/8" (unicode minus ok); null if malformed. */
export function parseAnswer(raw: string): Answer | null {
  const s = raw.replace(/\s+/g, '').replace(/[−–—]/g, '-')
  const m = /^([+-]?\d+)(?:\/([+-]?\d+))?$/.exec(s)
  if (!m) return null
  const num = Number(m[1])
  const den = m[2] === undefined ? 1 : Number(m[2])
  if (!den) return null
  return reduce(num, den)
}

function int(n: number): Answer {
  return { num: n, den: 1 }
}

/** Four distinct choices (ids a–d) around the correct text; math wrapped in $…$. */
function mcChoices(rng: Rng, correct: string, distractors: string[], math: boolean): { choices: Choice[]; correctChoice: string } {
  const unique = [...new Set(distractors.filter((d) => d !== correct))].slice(0, 3)
  let filler = 1
  while (unique.length < 3) {
    const extra = `${Number(correct) + 10 * filler++}`
    if (extra !== correct && !unique.includes(extra)) unique.push(extra)
  }
  const texts = shuffle(rng, [correct, ...unique])
  const choices = texts.map((text, i) => ({ id: 'abcd'[i], text: math ? `$${text}$` : text }))
  return { choices, correctChoice: choices[texts.indexOf(correct)].id }
}

function scale(level: number): number {
  return 5 + 5 * Math.max(1, level)
}

/** "7 + 5" — the shortest possible freeform prompt. */
const shortFreeform: Template = (rng, level) => {
  const a = randInt(rng, 1, scale(level))
  const b = randInt(rng, 1, scale(level))
  return { problem: { prompt: `${a} + ${b}`, format: 'freeform', input: NUMERIC }, answer: int(a + b) }
}

/** Multiple choice with plain-number choices. */
const multipleChoice: Template = (rng, level) => {
  const a = randInt(rng, 2, 3 + level * 2)
  const b = randInt(rng, 2, 9)
  const answer = a * b
  const { choices, correctChoice } = mcChoices(rng, String(answer), [String(answer + b), String(answer - b), String(answer + 1)], false)
  return { problem: { prompt: `${a} × ${b}`, format: 'multiple-choice', choices }, answer: int(answer), correctChoice }
}

/** Multiple choice whose prompt and choices are TeX ($\sqrt{…}$). */
const mathChoice: Template = (rng) => {
  const r = randInt(rng, 2, 12)
  const { choices, correctChoice } = mcChoices(rng, String(r), [String(r + 1), String(r - 1), String(r * 2)], true)
  return { problem: { prompt: `$\\sqrt{${r * r}}$`, label: '√', format: 'multiple-choice', choices }, answer: int(r), correctChoice }
}

const NAMES = ['Mia', 'Leo', 'Ava', 'Noah', 'Zoe', 'Ravi']
const THINGS = ['stickers', 'marbles', 'shells', 'stamps', 'cards']

/** A word problem long enough to need the banner, with inline math. */
const longWordProblem: Template = (rng, level) => {
  const name = pick(rng, NAMES)
  const thing = pick(rng, THINGS)
  const half = randInt(rng, 2, 4 + level * 2)
  const got = randInt(rng, 1, 9)
  const prompt =
    `${name} has $${half * 2}$ ${thing} in a box. ${name} gives away $\\frac{1}{2}$ of them to a friend, ` +
    `then finds $${got}$ more under the bed. How many ${thing} does ${name} have now?`
  return { problem: { prompt, label: '?', format: 'freeform', input: NUMERIC }, answer: int(half + got) }
}

/** Long multiple-choice prompt with $…$ math in both the prompt and the choices. */
const longChoice: Template = (rng) => {
  const a = randInt(rng, 2, 9)
  const b = randInt(rng, 2, 5)
  const answer = a * b + b
  const prompt = `A rocket burns $${a}$ units of fuel per minute for $${b}$ minutes, plus $${b}$ units to land. Which expression equals the total, $${a} \\times ${b} + ${b}$?`
  const { choices, correctChoice } = mcChoices(rng, String(answer), [String(a * b), String(answer + a), String(a + b + b)], true)
  return { problem: { prompt, label: '?', format: 'multiple-choice', choices }, answer: int(answer), correctChoice }
}

/** Fraction addition; answer typed as n/d (any equivalent fraction). */
const fraction: Template = (rng) => {
  const den = pick(rng, [2, 3, 4, 5, 6, 8])
  const a = randInt(rng, 1, den - 1)
  const b = randInt(rng, 1, den)
  return {
    problem: { prompt: `$\\frac{${a}}{${den}} + \\frac{${b}}{${den}}$`, label: 'a/b', format: 'freeform', input: FRACTION },
    answer: reduce(a + b, den),
  }
}

/** Exponent, e.g. $2^{5}$. */
const exponent: Template = (rng, level) => {
  const base = randInt(rng, 2, 3 + Math.min(level, 3))
  const exp = randInt(rng, 2, 3)
  return { problem: { prompt: `$${base}^{${exp}}$`, format: 'freeform', input: NUMERIC }, answer: int(base ** exp) }
}

const MIXED = [shortFreeform, multipleChoice, longWordProblem, fraction, exponent, mathChoice]

export interface FixtureSet {
  templates: Template[]
  check: CheckBehavior
}

export const SETS: Record<FixtureSetName, FixtureSet> = {
  mixed: { templates: MIXED, check: 'instant' },
  long: { templates: [longWordProblem, longChoice], check: 'instant' },
  mc: { templates: [multipleChoice, mathChoice, longChoice], check: 'instant' },
  freeform: { templates: [shortFreeform, longWordProblem, fraction, exponent], check: 'instant' },
  slow: { templates: MIXED, check: 'slow' },
  flaky: { templates: MIXED, check: 'flaky' },
}

/** Templates of `set` whose format is allowed; empty when none are. */
export function templatesFor(set: FixtureSetName, formats: readonly ProblemFormat[]): Template[] {
  // Build once with a throwaway rng to learn each template's format.
  const probe: Rng = () => 0.5
  return SETS[set].templates.filter((t) => formats.includes(t(probe, 1).problem.format))
}
