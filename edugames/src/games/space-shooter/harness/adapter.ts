/**
 * GameHarness adapter for the space shooter (DEV ONLY). Works headless (the
 * default: act() runs fixed steps itself) and in the browser, where the view
 * owns the real loop: it calls `harness.tick()` instead of `engine.step()`
 * and passes `advanceSteps` so act() can wait for its loop.
 *
 * Every engine command (including check verdicts) is logged with the step
 * index it landed on, so `exportReplay()` reproduces the run exactly.
 */
import { createCheckBroker, type CheckBroker } from '../../../shared/kit/checkBroker'
import type { ActResult, GameHarness, HarnessTime, Replay } from '../../../shared/harness/types'
import type { CheckResult, ProblemSource } from '../../../generators/types'
import { CHECK_TIMEOUT_SECONDS, STEP_SECONDS, type Command, type Engine, type GameEvent, type GameState } from '../engine/types'
import { COMMANDS, parseCommand, validateCommands } from './commands'
import { GAME_ID } from './session'
import { compactEvent, describe, snapshot, type HarnessEvent, type ShooterSnapshot } from './snapshot'

export const DEFAULT_ADVANCE_SECONDS = 0.5
export const MIN_TIME_SCALE = 0.1
export const MAX_TIME_SCALE = 2
/** Events kept for events(since) polling. */
const EVENT_BUFFER = 2000

export interface TimeSource {
  /** Call `fn` after `ms` real milliseconds (backstop while awaiting checks); returns a cancel function. */
  after(ms: number, fn: () => void): () => void
}

const realTime: TimeSource = {
  after(ms, fn) {
    const timer = setTimeout(fn, ms)
    return () => clearTimeout(timer)
  },
}

export interface ReplayMeta {
  generatorId: string
  params: Record<string, string>
  seed: number
  settings: Record<string, string | number | boolean>
}

export interface ShooterHarnessOptions {
  engine: Engine
  /** Answers are checked here (sync or async) unless `check` overrides it. */
  source: Pick<ProblemSource, 'check'>
  check?: ProblemSource['check']
  meta: ReplayMeta
  /** Real-time cap per check before it resolves as failed (default CHECK_TIMEOUT_SECONDS). */
  checkTimeoutMs?: number
  /**
   * Browser hook: resolve once the host loop has run `n` more `tick()`s.
   * Used only while lockstep is off; without it the harness steps itself
   * (headless), which also makes lockstep the default.
   */
  advanceSteps?: (n: number) => void | Promise<void>
  timeSource?: TimeSource
  /** Notified when scale / lockstep change (the view adjusts its loop). */
  onTimeChange?(time: { scale: number; lockstep: boolean }): void
}

export type TickListener = (events: GameEvent[], state: GameState) => void

export interface ShooterHarness extends GameHarness<ShooterSnapshot, HarnessEvent> {
  readonly engine: Engine
  /** Fixed steps run so far through tick(). */
  readonly stepIndex: number
  /** Run one fixed step through the harness (logs, routes checks). The view's loop calls this. */
  tick(): GameEvent[]
  /** Dispatch an engine command with logging (host use; players go through send/act). */
  dispatch(command: Command): GameEvent[]
  /** Await in-flight checks; false if the real-time backstop fired first. */
  settle(): Promise<boolean>
  pendingChecks(): number
  /** Called after every tick and dispatch with the events it caused (possibly none). */
  subscribe(listener: TickListener): () => void
  dispose(): void
}

export function createShooterHarness(options: ShooterHarnessOptions): ShooterHarness {
  const { engine, meta, advanceSteps } = options
  const timeSource = options.timeSource ?? realTime
  const checkTimeoutMs = options.checkTimeoutMs ?? CHECK_TIMEOUT_SECONDS * 1000
  const check = options.check ?? ((problem, given) => options.source.check(problem, given))

  let stepIndex = 0
  let seq = 0
  let buffer: HarnessEvent[] = []
  const log: Replay['log'] = []
  const checks: Record<number, CheckResult | null> = {}
  const listeners = new Set<TickListener>()
  let drainWaiters: (() => void)[] = []
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false

  let scale = 1
  let lockstep = !advanceSteps

  function record(events: GameEvent[]): void {
    for (const event of events) buffer.push(compactEvent(event, ++seq))
    if (buffer.length > EVENT_BUFFER) buffer = buffer.slice(-EVENT_BUFFER)
    for (const listener of listeners) listener(events, engine.state)
  }

  function dispatch(command: Command): GameEvent[] {
    const events = engine.dispatch(command)
    log.push({ step: stepIndex, command })
    if (command.type === 'resolveCheck') checks[command.checkId] = command.result
    record(events)
    return events
  }

  const broker: CheckBroker = createCheckBroker<Parameters<typeof check>[0], CheckResult>({
    check,
    timeoutMs: checkTimeoutMs,
    dispatch(command) {
      if (disposed) return
      dispatch(command)
      if (broker.pending() === 0) {
        const waiters = drainWaiters
        drainWaiters = []
        for (const resolve of waiters) resolve()
      }
    },
  })

  function tick(): GameEvent[] {
    const events = engine.step()
    stepIndex++
    record(events)
    broker.handle(events)
    return events
  }

  async function settle(): Promise<boolean> {
    if (broker.pending() === 0) return true
    return new Promise<boolean>((resolve) => {
      const cancel = timeSource.after(checkTimeoutMs + 500, () => resolve(false))
      drainWaiters.push(() => {
        cancel()
        resolve(true)
      })
    })
  }

  function runSteps(n: number): void {
    for (let i = 0; i < n; i++) tick()
  }

  function send(command: string | object): ActResult<ShooterSnapshot, HarnessEvent> {
    const parsed = parseCommand(command)
    const reject = (error: string) => ({ state: snapshot(engine.state), events: [], error })
    if ('error' in parsed) return reject(parsed.error)
    const invalid = validateCommands(parsed.commands, engine.state)
    if (invalid) return reject(invalid)
    const from = seq
    for (const c of parsed.commands) dispatch(c)
    return { state: snapshot(engine.state), events: since(from) }
  }

  function since(from: number): HarnessEvent[] {
    return buffer.filter((e) => e.seq > from)
  }

  async function act(command: string | object | null, opts?: { advance?: number }): Promise<ActResult<ShooterSnapshot, HarnessEvent>> {
    const from = seq
    if (command !== null && command !== undefined) {
      const result = send(command)
      if (result.error) return result
    }
    const advance = opts?.advance ?? DEFAULT_ADVANCE_SECONDS
    const n = Number.isFinite(advance) && advance > 0 ? Math.round(advance / STEP_SECONDS) : 0
    if (lockstep || !advanceSteps) runSteps(n)
    else await advanceSteps(n)
    await settle()
    return { state: snapshot(engine.state), events: since(from) }
  }

  const time: HarnessTime = {
    get scale() {
      return scale
    },
    get lockstep() {
      return lockstep
    },
    setScale(value) {
      if (!Number.isFinite(value)) return
      scale = Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, value))
      options.onTimeChange?.({ scale, lockstep })
    },
    setLockstep(on) {
      // Headless there is no free-running loop, so lockstep stays on.
      lockstep = on || !advanceSteps
      options.onTimeChange?.({ scale, lockstep })
    },
    step(n) {
      runSteps(Math.max(0, Math.floor(n) || 0))
    },
  }

  return {
    gameId: GAME_ID,
    commands: COMMANDS,
    engine,
    get stepIndex() {
      return stepIndex
    },
    describe,
    state: () => snapshot(engine.state),
    send,
    act(command, opts) {
      // Serialize: overlapping act() calls would interleave steps.
      const run = queue.then(() => act(command, opts))
      queue = run.catch(() => undefined)
      return run
    },
    events(from = 0) {
      return { seq, events: since(from) }
    },
    time,
    exportReplay(): Replay {
      return {
        version: 1,
        gameId: GAME_ID,
        generatorId: meta.generatorId,
        params: { ...meta.params },
        seed: meta.seed,
        settings: { ...meta.settings },
        // A trailing null command marks the step the run had reached.
        log: [...log, { step: stepIndex, command: null }],
        checks: { ...checks },
      }
    },
    tick,
    dispatch,
    settle,
    pendingChecks: () => broker.pending(),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      disposed = true
      broker.dispose()
      listeners.clear()
      const waiters = drainWaiters
      drainWaiters = []
      for (const resolve of waiters) resolve()
    },
  }
}
