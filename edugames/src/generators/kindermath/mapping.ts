/**
 * Pure mapping helpers for the kindermath plugin: upstream question shapes →
 * host `Problem`s, label extraction, and the level-aware picker. DOM-free and
 * side-effect-free so it can be unit-tested with a seeded rng.
 */
import type { Problem, ProblemFormat } from '../types'
import { shuffle, type Rng } from '../../shared/rng'

/** One question as returned by our server half (mirrors api.kindermath.org). */
export interface KinderQuestion {
  id: string
  kind: 'MCQ' | 'TYPED'
  prompt: string
  choices?: { id: string; text: string }[]
  hint?: string
  difficulty?: number
}

/** Input spec used for TYPED (freeform) problems — a superset of the plugin default. */
export const TYPED_INPUT = { kind: 'text', maxLength: 12, allow: '-./x^' } as const

const MATH_SEGMENT = /\$([^$]+)\$/g

/**
 * A short label for cramped games: the prompt's single inline-math segment
 * (without the `$`s), but only when there is exactly one and it is ≤ 8 chars.
 */
export function extractLabel(prompt: string): string | undefined {
  const segments = [...prompt.matchAll(MATH_SEGMENT)].map((m) => m[1].trim())
  if (segments.length !== 1) return undefined
  const label = segments[0]
  return label.length > 0 && label.length <= 8 ? label : undefined
}

/** Clamp a raw difficulty to the plugin's 1..5 level range. */
export function toLevel(difficulty: number | undefined): number {
  const d = Math.round(Number(difficulty))
  if (!Number.isFinite(d)) return 1
  return Math.min(5, Math.max(1, d))
}

/** Map one upstream question to a host Problem, or null if it is malformed. */
export function toProblem(q: KinderQuestion): Problem | null {
  if (!q || typeof q.id !== 'string' || typeof q.prompt !== 'string') return null
  const base = {
    id: q.id,
    prompt: q.prompt,
    level: toLevel(q.difficulty),
    hint: typeof q.hint === 'string' ? q.hint : undefined,
    label: extractLabel(q.prompt),
  }
  if (q.kind === 'MCQ') {
    const choices = Array.isArray(q.choices)
      ? q.choices
          .filter((c) => c && typeof c.id === 'string' && typeof c.text === 'string')
          .map((c) => ({ id: c.id, text: c.text }))
      : []
    if (choices.length === 0) return null
    return { ...base, format: 'multiple-choice', choices }
  }
  if (q.kind === 'TYPED') {
    return { ...base, format: 'freeform', input: { ...TYPED_INPUT } }
  }
  return null
}

/**
 * Map a pool of upstream questions to host Problems compatible with the game's
 * accepted `formats`. Drops malformed and incompatible entries.
 */
export function mapPool(questions: KinderQuestion[], formats: readonly ProblemFormat[]): Problem[] {
  const allowed = new Set(formats)
  const out: Problem[] = []
  for (const q of questions) {
    const p = toProblem(q)
    if (p && allowed.has(p.format)) out.push(p)
  }
  return out
}

/**
 * A recycling, level-aware picker over a fixed pool. Prefers problems nearest
 * the requested level among those not yet served this cycle, reshuffling and
 * starting a fresh cycle when the pool is exhausted, and avoiding an immediate
 * repeat whenever the pool has more than one problem.
 */
export interface Picker {
  next(level: number): Problem
}

export function createPicker(pool: readonly Problem[], rng: Rng): Picker {
  if (pool.length === 0) throw new Error('kindermath: empty problem pool')
  const served = new Set<string>()
  let lastId: string | undefined

  return {
    next(level: number): Problem {
      const target = Math.min(5, Math.max(1, Math.round(level) || 1))
      let candidates = pool.filter((p) => !served.has(p.id))
      if (candidates.length === 0) {
        // Cycle complete — recycle the whole pool.
        served.clear()
        candidates = pool.slice()
      }
      // Avoid an immediate repeat when we can.
      if (candidates.length > 1 && lastId !== undefined) {
        const withoutLast = candidates.filter((p) => p.id !== lastId)
        if (withoutLast.length > 0) candidates = withoutLast
      }
      // Prefer the tier nearest the requested level.
      let best = Infinity
      for (const p of candidates) best = Math.min(best, Math.abs(p.level - target))
      const nearest = candidates.filter((p) => Math.abs(p.level - target) === best)
      const chosen = shuffle(rng, nearest)[0]
      served.add(chosen.id)
      lastId = chosen.id
      return chosen
    },
  }
}
