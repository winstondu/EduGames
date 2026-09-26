/**
 * Problem-generator plugin contract.
 *
 * Games never import a concrete generator. They receive a `gen` id from the
 * URL (e.g. `/space-shooter?gen=math&mode=choice&ops=add,sub`), resolve it
 * through `registry.ts`, and talk only to the interfaces below. Everything is
 * string-based so non-numeric generators (spelling, vocab, …) fit unchanged.
 *
 * This module must stay free of DOM, React, and game imports.
 */
import type { Rng } from '../shared/rng'

/** How the player supplies an answer. */
export type AnswerMode = 'typed' | 'choice'

export interface Problem {
  /** Unique within a ProblemSource instance. */
  id: string
  /** Short display text drawn on the target, e.g. "6+7", "8÷2", "4×2". Keep ≤ 8 chars. */
  prompt: string
  /** Canonical answer, already normalized (see ProblemSource.normalize). */
  answer: string
  /** Difficulty level the problem was generated at (1 = easiest). */
  level: number
}

/** A live, stateful source of problems for one play session. */
export interface ProblemSource {
  /** Generate the next problem at `level` (clamped to 1..plugin.maxLevel). */
  next(level: number): Problem
  /**
   * `count` distinct answer choices for `problem`, including the correct one,
   * in shuffled order. Distractors should be plausible (off-by-one, wrong op, …).
   */
  choices(problem: Problem, count: number): string[]
  /** Canonicalize raw player input (trim, strip leading zeros, lowercase, …). */
  normalize(raw: string): string
  /** True when `input` (raw or normalized) answers `problem`. */
  isCorrect(problem: Problem, input: string): boolean
}

export interface AnswerInputSpec {
  /** 'numeric' → digit keypad; 'text' → letters. */
  kind: 'numeric' | 'text'
  /** Max characters the quiver accepts. */
  maxLength: number
}

export interface GeneratorPlugin<Options = unknown> {
  /** URL id, e.g. "math". Lowercase, [a-z0-9-]. */
  id: string
  name: string
  description: string
  input: AnswerInputSpec
  answerModes: readonly AnswerMode[]
  defaultAnswerMode: AnswerMode
  maxLevel: number
  /** Read generator-specific options from the URL; must tolerate missing/garbage params. */
  parseOptions(params: URLSearchParams): Options
  /** Serialize options back to URL params (inverse of parseOptions). */
  serializeOptions(options: Options): Record<string, string>
  create(options: Options, rng: Rng): ProblemSource
}
