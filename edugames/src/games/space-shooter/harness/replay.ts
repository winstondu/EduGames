/**
 * Deterministic replay of a harness session (DEV ONLY). Re-creates the
 * session from seed + generator + params, then applies the logged commands at
 * their step indices. Check verdicts come from the log (or `replay.checks`
 * for hand-written replays), so the plugin's check() is never called and no
 * network is touched.
 */
import type { CheckResult, GeneratorPlugin } from '../../../generators/types'
import type { Replay } from '../../../shared/harness/types'
import type { Command, Engine, GameEvent, GameState } from '../engine/types'
import { createShooterSession, GAME_ID } from './session'
import { snapshot, type ShooterSnapshot } from './snapshot'

export type PluginLoader = (id: string) => Promise<GeneratorPlugin<unknown> | null>

export interface ReplayResult {
  engine: Engine
  /** Full final engine state (compare with JSON.stringify for determinism). */
  state: GameState
  snapshot: ShooterSnapshot
  steps: number
}

export interface ReplayOptions {
  /** Called after every step and command. */
  onTick?(events: GameEvent[], state: GameState): void
}

function asCommand(value: unknown, index: number): Command | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || typeof (value as { type?: unknown }).type !== 'string') {
    throw new Error(`replay log[${index}]: command must be an engine command object or null`)
  }
  return value as Command
}

export async function runReplay(replay: Replay, load: PluginLoader, opts: ReplayOptions = {}): Promise<ReplayResult> {
  if (replay?.version !== 1) throw new Error('unsupported replay version')
  if (replay.gameId !== GAME_ID) throw new Error(`replay is for "${replay.gameId}", not ${GAME_ID}`)
  const plugin = await load(replay.generatorId)
  if (!plugin) throw new Error(`unknown generator "${replay.generatorId}"`)
  const lanes = Number(replay.settings?.lanes)
  const session = await createShooterSession({
    plugin,
    params: replay.params ?? {},
    seed: replay.seed,
    lanes: Number.isFinite(lanes) ? lanes : undefined,
  })
  const { engine } = session
  const log = replay.log ?? []
  const commands = log.map((entry, i) => asCommand(entry.command, i))
  const logged = new Set(commands.flatMap((c) => (c?.type === 'resolveCheck' ? [c.checkId] : [])))
  const recorded = replay.checks ?? {}

  let steps = 0
  function apply(command: Command): void {
    // Not `onTick?.(engine.dispatch(…))`: optional calls skip argument evaluation.
    const events = engine.dispatch(command)
    opts.onTick?.(events, engine.state)
  }
  function runTo(target: number): void {
    while (steps < target) {
      const events = engine.step()
      steps++
      opts.onTick?.(events, engine.state)
      for (const e of events) {
        // Fallback for replays without logged verdicts: resolve at request time.
        if (e.type === 'checkRequested' && !logged.has(e.checkId) && e.checkId in recorded) {
          apply({ type: 'resolveCheck', checkId: e.checkId, result: (recorded[e.checkId] as CheckResult | null) ?? null })
        }
      }
    }
  }

  try {
    log.forEach((entry, i) => {
      if (!Number.isInteger(entry.step) || entry.step < steps) throw new Error(`replay log[${i}]: steps must be non-decreasing integers`)
      runTo(entry.step)
      const command = commands[i]
      if (command) apply(command)
    })
  } finally {
    session.dispose()
  }
  return { engine, state: engine.state, snapshot: snapshot(engine.state), steps }
}
