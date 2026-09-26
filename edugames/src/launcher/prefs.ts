/** The launcher remembers the last game / generator / format / variant per browser. */
import type { ProblemFormat } from '../generators/types'

export interface LauncherPrefs {
  game?: string
  gen?: string
  format?: ProblemFormat
  /** variantKey() of the last variant played, per generator id. */
  variants?: Record<string, string>
}

const KEY = 'edugames.launcher'

export function loadPrefs(): LauncherPrefs {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return value && typeof value === 'object' ? (value as LauncherPrefs) : {}
  } catch {
    return {}
  }
}

export function savePrefs(update: Partial<LauncherPrefs>): void {
  try {
    const prev = loadPrefs()
    localStorage.setItem(KEY, JSON.stringify({ ...prev, ...update, variants: { ...prev.variants, ...update.variants } }))
  } catch {
    // Storage unavailable; nothing is remembered.
  }
}
