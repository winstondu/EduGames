/**
 * Math plugin options: which operations to drill and how answers are entered.
 * URL form: `format=freeform|mc&ops=add,sub,mul,div` (defaults: mc, all ops).
 */
import type { ProblemFormat } from '../types'

export type Op = 'add' | 'sub' | 'mul' | 'div'

/** Canonical order; used for serializing, board keys and descriptions. */
export const OPS: readonly Op[] = ['add', 'sub', 'mul', 'div']

/** Prompt symbols (U+2212 minus, U+00D7 times, U+00F7 divide). */
export const OP_SYMBOL: Record<Op, string> = { add: '+', sub: '−', mul: '×', div: '÷' }

export interface MathOptions {
  format: ProblemFormat
  /** Enabled operations; empty means all. */
  ops: Op[]
}

export const DEFAULT_FORMAT: ProblemFormat = 'multiple-choice'

const FORMAT_PARAM: Record<ProblemFormat, string> = { freeform: 'freeform', 'multiple-choice': 'mc' }

const FORMAT_ALIASES: Record<string, ProblemFormat> = {
  freeform: 'freeform',
  ff: 'freeform',
  mc: 'multiple-choice',
  'multiple-choice': 'multiple-choice',
  choice: 'multiple-choice',
}

function isOp(s: string): s is Op {
  return (OPS as readonly string[]).includes(s)
}

/** Dedupe, drop unknowns and sort canonically; empty → all ops. */
export function normalizeOps(ops: readonly string[]): Op[] {
  const set = new Set(ops.filter(isOp))
  const out = OPS.filter((op) => set.has(op))
  return out.length ? out : OPS.slice()
}

/** Never returns null: every param is optional and garbage falls back to defaults. */
export function parseOptions(params: URLSearchParams): MathOptions {
  const rawFormat = (params.get('format') ?? '').trim().toLowerCase()
  const format = FORMAT_ALIASES[rawFormat] ?? DEFAULT_FORMAT
  const rawOps = (params.get('ops') ?? '').toLowerCase().split(',').map((s) => s.trim())
  return { format, ops: normalizeOps(rawOps) }
}

export function serializeOptions(options: MathOptions): Record<string, string> {
  return { format: FORMAT_PARAM[options.format], ops: normalizeOps(options.ops).join(',') }
}

/** e.g. "math/mc/add-sub"; ops in canonical order. */
export function boardKey(options: MathOptions): string {
  const fmt = options.format === 'freeform' ? 'ff' : 'mc'
  return `math/${fmt}/${normalizeOps(options.ops).join('-')}`
}

/** e.g. "Math · + −". */
export function describeOptions(options: MathOptions): string {
  return `Math · ${normalizeOps(options.ops).map((op) => OP_SYMBOL[op]).join(' ')}`
}
