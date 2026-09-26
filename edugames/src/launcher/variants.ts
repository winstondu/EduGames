/** Grouping and search for generator variant pickers (pure). */
import type { GeneratorVariant } from '../generators/types'

export interface VariantGroup {
  /** Full group label, e.g. "5th Grade › Fractions" ('' for ungrouped). */
  group: string
  /** Leading part of a "A › B" group (e.g. the course), '' if there is none. */
  parent: string
  /** Last part of the group (e.g. the unit). */
  title: string
  items: GeneratorVariant[]
}

const SEPARATOR = /\s*›\s*/

function normalize(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

/** True if every whitespace-separated word of `query` appears in the label, group or description. */
export function matchesQuery(variant: GeneratorVariant, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = normalize([variant.label, variant.group ?? '', variant.description ?? ''].join(' '))
  return words.every((w) => haystack.includes(w))
}

/** Filter by `query` and group in first-seen order (items keep their order). */
export function groupVariants(variants: readonly GeneratorVariant[], query = ''): VariantGroup[] {
  const groups = new Map<string, VariantGroup>()
  for (const v of variants) {
    if (!matchesQuery(v, query)) continue
    const key = v.group ?? ''
    let g = groups.get(key)
    if (!g) {
      const parts = key.split(SEPARATOR)
      const title = parts.pop() ?? ''
      g = { group: key, parent: parts.join(' › '), title, items: [] }
      groups.set(key, g)
    }
    g.items.push(v)
  }
  return [...groups.values()]
}

/** Stable identity for a variant (its params), used for selection. */
export function variantKey(variant: GeneratorVariant): string {
  return new URLSearchParams(Object.entries(variant.params).sort(([a], [b]) => a.localeCompare(b))).toString()
}
