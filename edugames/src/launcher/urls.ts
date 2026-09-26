/**
 * App URLs (History API, no router library):
 *   /                                  launcher
 *   /?game=<gameId>&gen=<generatorId>  launcher with a game / generator preselected
 *   /<gameId>?gen=<id>&<options>       a game screen
 * Pure helpers, so they are unit-tested without a DOM.
 */
import type { ProblemFormat } from '../generators/types'

/** `format` URL param values for plugins with `formatSelectable` (aliases a plugin's parseOptions accepts). */
export const FORMAT_PARAM: Record<ProblemFormat, string> = {
  freeform: 'freeform',
  'multiple-choice': 'mc',
}

/** Player-facing names for problem formats. */
export const FORMAT_LABEL: Record<ProblemFormat, string> = {
  freeform: 'Type the answer',
  'multiple-choice': 'Multiple choice',
}

export type Route = { kind: 'launcher' } | { kind: 'game'; gameId: string }

const GAME_SEGMENT = /^[a-z0-9-]{1,32}$/

/** Map a pathname to a route; anything that isn't `/` or a single game-id segment is a (possibly unknown) game. */
export function parseRoute(pathname: string): Route {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return { kind: 'launcher' }
  const id = safeDecode(segments[0]).toLowerCase()
  return { kind: 'game', gameId: segments.length === 1 && GAME_SEGMENT.test(id) ? id : '' }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * `/<gameId>?gen=<id>&<variant params>&format=<fmt>`. `gen` always comes first;
 * a variant can't override `gen`, and an explicit `format` wins over the variant's.
 */
export function buildPlayUrl(
  gameId: string,
  generatorId: string,
  variantParams: Record<string, string> = {},
  format?: ProblemFormat,
): string {
  const params = new URLSearchParams({ gen: generatorId })
  for (const [key, value] of Object.entries(variantParams)) {
    if (key === 'gen' || (format && key === 'format')) continue
    params.set(key, value)
  }
  if (format) params.set('format', FORMAT_PARAM[format])
  return `/${encodeURIComponent(gameId)}?${params}`
}

/** Launcher URL, optionally preselecting a game and generator. */
export function launcherUrl(gameId?: string, generatorId?: string): string {
  const params = new URLSearchParams()
  if (gameId) params.set('game', gameId)
  if (gameId && generatorId) params.set('gen', generatorId)
  const query = params.toString()
  return query ? `/?${query}` : '/'
}
