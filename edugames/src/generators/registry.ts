/**
 * Runtime generator loader. Placeholder signatures — the "generator hosting"
 * build step implements these (manifest fetch + same-origin dynamic import).
 */
import type { GeneratorContext, GeneratorManifest, GeneratorPlugin } from './types'

export const DEFAULT_GENERATOR_ID = 'math'

/** Fetch (and memoize) `GET /api/generators`. */
export declare function fetchManifest(): Promise<GeneratorManifest>

/** Resolve a plugin by id via the manifest; null for unknown ids. Rejects on network/module errors. */
export declare function loadGenerator(id: string): Promise<GeneratorPlugin<unknown> | null>

/** Build the host context for a plugin (scoped `api`, seeded rng, abort signal). */
export declare function createGeneratorContext(pluginId: string, seed: number, signal: AbortSignal): GeneratorContext
