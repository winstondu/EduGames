/**
 * Stateless answer checking. The answer is re-derived from the prompt the
 * generator wrote ("12 − 4"), so problems survive cloning/serialization and
 * the checker never needs the source that produced them.
 */
import type { CheckResult, Problem } from '../types'
import { OP_SYMBOL, type Op } from './options'

export interface Question {
  a: number
  op: Op
  b: number
  answer: number
}

export function solve(a: number, op: Op, b: number): number {
  switch (op) {
    case 'add': return a + b
    case 'sub': return a - b
    case 'mul': return a * b
    case 'div': return a / b
  }
}

export function formatPrompt(a: number, op: Op, b: number): string {
  return `${a} ${OP_SYMBOL[op]} ${b}`
}

const SYMBOL_OP: Record<string, Op> = Object.fromEntries(
  Object.entries(OP_SYMBOL).map(([op, sym]) => [sym, op as Op]),
)

/** Inverse of formatPrompt; null if the prompt isn't one of ours. */
export function parsePrompt(prompt: string): Question | null {
  const m = /^(\d+) (\S) (\d+)$/.exec(prompt.trim())
  const op = m && SYMBOL_OP[m[2]]
  if (!m || !op) return null
  const a = Number(m[1])
  const b = Number(m[3])
  const answer = solve(a, op, b)
  return Number.isInteger(answer) ? { a, op, b, answer } : null
}

/**
 * Canonical integer text for typed input, or null if it isn't an integer:
 * trims, drops inner spaces, accepts unicode minus/dashes and a leading '+',
 * strips leading zeros ("007" → "7", "-0" → "0").
 */
export function normalizeAnswer(raw: string): string | null {
  const s = raw.replace(/\s+/g, '').replace(/[−‒–—﹣－]/g, '-')
  const m = /^([+-]?)(\d+)$/.exec(s)
  if (!m) return null
  const digits = m[2].replace(/^0+(?=\d)/, '')
  return m[1] === '-' && digits !== '0' ? `-${digits}` : digits
}

export function check(problem: Problem, given: string): CheckResult {
  const q = parsePrompt(problem.prompt)
  if (!q) return { correct: false }
  const expected = String(q.answer)
  const explanation = `${problem.prompt} = ${expected}`
  if (problem.format === 'multiple-choice') {
    const choice = problem.choices?.find((c) => c.id === given)
    return { correct: choice?.text === expected, expected, explanation }
  }
  return { correct: normalizeAnswer(given) === expected, expected, explanation }
}
