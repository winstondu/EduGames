/**
 * Headless space-shooter session (DEV ONLY): plugin → ProblemSource → engine,
 * with the seed convention replays depend on. Offline: `ctx.api` rejects, so
 * hybrid generators can't create a source here.
 */
import { createRng } from '../../../shared/rng'
import type { GeneratorContext, GeneratorPlugin, ProblemFormat, ProblemRequirements, ProblemSource } from '../../../generators/types'
import { createEngine, type Engine } from '../engine'
import { MAX_CHOICES } from '../engine/types'
import { deriveSeeds } from '../seeds'

/**
 * Game id and default lane count, mirrored from settings.ts so the harness
 * (and scripts/sim.ts) don't pull in the asset imports settings.ts brings.
 */
export const GAME_ID = 'space-shooter'
export const DEFAULT_LANES = 4

/** Formats the space shooter presents (mirrors its GameDefinition). */
export const SHOOTER_FORMATS: readonly ProblemFormat[] = ['freeform', 'multiple-choice']

/** Requirements the space shooter passes to create() (mirrors its GameDefinition). */
export const SHOOTER_REQUIREMENTS: ProblemRequirements = { formats: SHOOTER_FORMATS, maxChoices: MAX_CHOICES }

export { deriveSeeds }

export interface ShooterSessionOptions {
  plugin: GeneratorPlugin<unknown>
  params: Record<string, string>
  seed: number
  lanes?: number
  /** Scoped fetch for hybrid plugins; default rejects (offline). */
  api?: GeneratorContext['api']
}

export interface ShooterSession {
  plugin: GeneratorPlugin<unknown>
  options: unknown
  source: ProblemSource
  engine: Engine
  lanes: number
  dispose(): void
}

function offline(): Promise<Response> {
  return Promise.reject(new Error('network is disabled in the headless harness'))
}

export async function createShooterSession(opts: ShooterSessionOptions): Promise<ShooterSession> {
  const { plugin, params, seed } = opts
  const options = plugin.parseOptions(new URLSearchParams(params))
  if (options === null) throw new Error(`generator "${plugin.id}": missing required params`)
  const seeds = deriveSeeds(seed)
  const abort = new AbortController()
  const ctx: GeneratorContext = { rng: createRng(seeds.generator), signal: abort.signal, api: opts.api ?? offline }
  const source = await plugin.create(options, ctx, SHOOTER_REQUIREMENTS)
  const lanes = opts.lanes ?? DEFAULT_LANES
  const engine = createEngine({ lanes, problems: source, defaultInput: plugin.defaultInput, maxLevel: plugin.maxLevel, seed: seeds.engine })
  return {
    plugin,
    options,
    source,
    engine,
    lanes: engine.config.lanes,
    dispose() {
      abort.abort()
      source.dispose?.()
    },
  }
}
