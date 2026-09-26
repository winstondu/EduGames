/**
 * Browser binding for the space-shooter harness (DEV ONLY; ui/session.ts
 * imports it dynamically behind `import.meta.env.DEV`). Wires a
 * ShooterHarness to the live view and registers it with the harness runtime
 * (`window.__edugames`, meta panel).
 *
 * - The view's loop runs `harness.tick()`; the session skips its own broker.
 * - act() outside lockstep waits for the view to run the steps (or, while
 *   the game is paused and the view is frozen, runs them directly).
 * - The harness time scale / lockstep drive the view's time controller.
 */
import type { Engine, GameEvent } from '../engine/types'
import type { ProblemSource } from '../../../generators/types'
import { registerHarness } from '../../../shared/harness/runtime'
import type { GameView } from '../render'
import { createShooterHarness, type ShooterHarness } from './adapter'

export interface BrowserHarnessOptions {
  engine: Engine
  source: Pick<ProblemSource, 'check'>
  game: string
  generatorId: string
  /** Canonical generator params (plugin.serializeOptions). */
  params: Record<string, string>
  seed: number
  /** Game settings recorded in replays and shown in the meta panel (lanes, direction, ship, speed). */
  settings: Record<string, string | number | boolean>
  /** window.__edugames.open() request this session was built for, if any. */
  requestId?: string
  getView(): GameView | null
  /** The view is frozen (game paused or over): steps must run directly. */
  isPaused(): boolean
}

export interface BrowserHarness extends ShooterHarness {
  /** Call once the view is ready: applies the time settings and registers with the runtime. */
  attach(): void
}

export function createBrowserHarness(options: BrowserHarnessOptions): BrowserHarness {
  const { engine, getView } = options
  let waiters: { target: number; resolve(): void }[] = []
  let unregister: (() => void) | null = null

  const harness = createShooterHarness({
    engine,
    source: options.source,
    meta: { generatorId: options.generatorId, params: options.params, seed: options.seed, settings: options.settings },
    advanceSteps(n) {
      if (n <= 0) return
      if (options.isPaused() || !getView()) {
        // The view isn't stepping; run them here.
        for (let i = 0; i < n; i++) harness.tick()
        return
      }
      return new Promise<void>((resolve) => waiters.push({ target: harness.stepIndex + n, resolve }))
    },
    onTimeChange({ scale, lockstep }) {
      const view = getView()
      view?.time.setScale(scale)
      view?.time.setLockstep(lockstep)
    },
  })

  function release(all: boolean): void {
    if (!waiters.length) return
    const due = all ? waiters : waiters.filter((w) => w.target <= harness.stepIndex)
    if (!due.length) return
    waiters = all ? [] : waiters.filter((w) => w.target > harness.stepIndex)
    for (const w of due) w.resolve()
  }

  harness.subscribe((events: GameEvent[]) => {
    release(false)
    // The game ended or paused mid-wait: the view stops stepping, so don't hang.
    if (events.some((e) => e.type === 'gameOver') || options.isPaused()) release(true)
  })

  const dispose = harness.dispose
  return Object.assign(harness, {
    attach() {
      const view = getView()
      if (!view || unregister) return
      const speed = Number(options.settings.speed)
      if (Number.isFinite(speed)) harness.time.setScale(speed)
      unregister = registerHarness({
        harness,
        game: options.game,
        generatorId: options.generatorId,
        params: options.params,
        seed: options.seed,
        settings: options.settings,
        requestId: options.requestId,
      })
    },
    dispose() {
      unregister?.()
      unregister = null
      release(true)
      dispose()
    },
  })
}
