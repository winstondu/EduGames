import type { GeneratorPlugin } from './types'

/** Lazy loaders keyed by generator id. Add new plugins here. */
const LOADERS: Record<string, () => Promise<{ default: GeneratorPlugin<any> }>> = {
  math: () => import('./math'),
}

export const DEFAULT_GENERATOR_ID = 'math'

export function listGeneratorIds(): string[] {
  return Object.keys(LOADERS)
}

/** Resolve a generator plugin by id; returns null for unknown ids. */
export async function loadGenerator(id: string): Promise<GeneratorPlugin<any> | null> {
  const load = LOADERS[id]
  if (!load) return null
  return (await load()).default
}
