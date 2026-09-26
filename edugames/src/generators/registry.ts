/**
 * Runtime generator loader: fetches the manifest from the API Worker and
 * dynamically imports plugin modules. Games never bundle a concrete generator,
 * so any game can use any plugin whose formats it supports.
 *
 * Security: only modules on the API origin (or, in dev, this page's origin,
 * where Vite serves the TS sources) are ever imported.
 */
import { API_BASE } from '../shared/apiBase'
import { createRng } from '../shared/rng'
import type { GeneratorContext, GeneratorManifest, GeneratorPlugin } from './types'

export const DEFAULT_GENERATOR_ID = 'math'

let manifestPromise: Promise<GeneratorManifest> | null = null
const pluginPromises = new Map<string, Promise<GeneratorPlugin<unknown> | null>>()

/** Drop memoized manifest/plugins (tests, or after a generators deploy). */
export function resetGeneratorRegistry(): void {
  manifestPromise = null
  pluginPromises.clear()
}

/** Fetch (and memoize) `GET <API_BASE>/v1/generators`. */
export function fetchManifest(): Promise<GeneratorManifest> {
  if (!manifestPromise) {
    const promise = requestManifest()
    manifestPromise = promise
    // Forget failures so the next call retries.
    promise.catch(() => {
      if (manifestPromise === promise) manifestPromise = null
    })
  }
  return manifestPromise
}

async function requestManifest(): Promise<GeneratorManifest> {
  const res = await fetch(`${API_BASE}/v1/generators`)
  if (!res.ok) throw new Error(`Couldn't load the generator list (HTTP ${res.status}).`)
  const manifest = (await res.json()) as GeneratorManifest
  if (!manifest || !Array.isArray(manifest.generators)) throw new Error('Malformed generator manifest.')
  return manifest
}

/** Origins plugin modules may be imported from. */
function trustedOrigins(): string[] {
  const origins = [new URL(API_BASE).origin]
  if (import.meta.env.DEV && typeof location !== 'undefined') origins.push(location.origin)
  return origins
}

/** Parse `entry` and ensure it's on a trusted origin; throws otherwise. */
function trustedEntry(id: string, entry: string): string {
  let url: URL
  try {
    url = new URL(entry)
  } catch {
    throw new Error(`Generator "${id}" has an invalid module URL.`)
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !trustedOrigins().includes(url.origin)) {
    throw new Error(`Refusing to load generator "${id}" from untrusted origin ${url.origin}.`)
  }
  return url.href
}

async function importPlugin(id: string): Promise<GeneratorPlugin<unknown> | null> {
  const manifest = await fetchManifest()
  const meta = manifest.generators.find((g) => g.id === id)
  if (!meta) return null
  const entry = trustedEntry(id, meta.entry)
  const mod = (await import(/* @vite-ignore */ entry)) as { default?: GeneratorPlugin<unknown> }
  const plugin = mod.default
  if (!plugin || typeof plugin !== 'object' || typeof plugin.create !== 'function') {
    throw new Error(`Generator "${id}" module has no plugin default export.`)
  }
  if (plugin.id !== id) throw new Error(`Generator module for "${id}" declares id "${plugin.id}".`)
  return plugin
}

/** Resolve a plugin by id via the manifest; null for unknown ids. Rejects on network/module errors. */
export function loadGenerator(id: string): Promise<GeneratorPlugin<unknown> | null> {
  const cached = pluginPromises.get(id)
  if (cached) return cached
  const promise = importPlugin(id)
  pluginPromises.set(id, promise)
  promise.catch(() => {
    if (pluginPromises.get(id) === promise) pluginPromises.delete(id)
  })
  return promise
}

/** Build the host context for a plugin (scoped `api`, seeded rng, abort signal). */
export function createGeneratorContext(pluginId: string, seed: number, signal: AbortSignal): GeneratorContext {
  const base = `${API_BASE}/v1/generators/${encodeURIComponent(pluginId)}/`
  return {
    rng: createRng(seed),
    signal,
    api(path, init) {
      // Abort on session end even when the plugin passes its own signal.
      const signals = init?.signal ? AbortSignal.any([signal, init.signal]) : signal
      return fetch(base + path.replace(/^\/+/, ''), { credentials: 'include', ...init, signal: signals })
    },
  }
}
