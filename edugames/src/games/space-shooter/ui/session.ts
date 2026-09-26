/**
 * One play session: the only place that touches the generator plugin.
 * plugin.create → engine → check broker → HUD store → view, wired into a
 * single event pipeline (broker, audio cues, HUD, React listeners). Framework
 * free; the React screen owns its lifetime.
 *
 * In DEV the session runs through the test harness (harness/browser.ts,
 * dynamically imported, so production builds carry none of it): the view
 * steps via `harness.tick`, player input goes through `harness.dispatch`
 * (logged for replays) and the harness's broker is the only check broker.
 */
import type {
  AnswerInputSpec,
  CheckResult,
  Choice,
  GeneratorPlugin,
  Problem,
  ProblemFormat,
  ProblemSource,
} from '../../../generators/types'
import { createGeneratorContext } from '../../../generators/registry'
import type { AudioDirector } from '../../../shared/kit/audio'
import { createCheckBroker } from '../../../shared/kit/checkBroker'
import { createHudStore, type HudStore } from '../../../shared/kit/hudStore'
import type { GameSpeed } from '../../../shared/kit/time'
import { MAX_CHOICES } from '../engine/types'
import { createEngine, type ActiveEffect, type Command, type Engine, type GameEvent, type GameStatus } from '../engine'
import type { ShooterHarness } from '../harness/adapter'
import { createGameView, type GameView } from '../render'
import { deriveSeeds } from '../seeds'
import type { GameSettings } from '../settings'
import { INTENSE_LEVEL, playCues } from './cues'

/** Immutable HUD/overlay snapshot; rebuilt only when `state.revision` or the pending count moves. */
export interface HudSnapshot {
  status: GameStatus
  score: number
  level: number
  streak: number
  bestStreak: number
  lives: number
  shield: number
  correct: number
  wrong: number
  lanes: number
  effects: readonly ActiveEffect[]
  /** Current target's problem (null without a target). */
  target: { id: number; problem: Problem } | null
  inputMode: ProblemFormat | null
  choices: readonly Choice[]
  quiver: string
  input: AnswerInputSpec
  /** Answer checks in flight (server-checked shots). */
  pending: number
}

export interface SessionInit {
  generatorId: string
  plugin: GeneratorPlugin<unknown>
  options: unknown
  /** Formats the game can present (passed to create() as requirements). */
  formats: readonly ProblemFormat[]
  settings: GameSettings
  canvas: HTMLCanvasElement
  /** Touch device (coarse pointer): the view's hints say "tap" instead of naming keys. */
  touch?: boolean
  audio: AudioDirector
  seed: number
  /** Aborted when the session ends (also the plugin context's signal). */
  signal: AbortSignal
  /** DEV: the window.__edugames.open() request this run was started for. */
  harnessRequestId?: string
}

export interface Session {
  readonly engine: Engine
  readonly view: GameView
  readonly hud: HudStore<HudSnapshot>
  /** Wall-clock start (ms since epoch), for score plausibility. */
  readonly startedAt: number
  /** Slowest player speed used during the run (slow-motion scores get a 🐢 badge). */
  readonly slowestSpeed: GameSpeed
  /** DEV only: the harness this session runs through (null in production). */
  readonly harness: ShooterHarness | null
  /** Apply a player command through the whole pipeline (view FX, checks, cues, HUD). */
  dispatch(command: Command): GameEvent[]
  pause(): void
  resume(): void
  /** Player speed setting, applied live. */
  setSpeed(speed: GameSpeed): void
  /** Every event batch (steps and dispatches), after the view, broker, cues and HUD saw it. */
  subscribe(listener: (events: readonly GameEvent[]) => void): () => void
  dispose(): void
}

function readHud(engine: Engine, pending: number): HudSnapshot {
  const s = engine.state
  const target = s.targetId === null ? undefined : s.asteroids.find((a) => a.id === s.targetId)
  return {
    status: s.status,
    score: s.score,
    level: s.level,
    streak: s.streak,
    bestStreak: s.bestStreak,
    lives: s.lives,
    shield: s.shield,
    correct: s.correct,
    wrong: s.wrong,
    lanes: s.lanes,
    effects: s.effects.map((e) => ({ ...e })),
    target: target ? { id: target.id, problem: target.problem } : null,
    inputMode: s.inputMode,
    choices: s.choices.slice(),
    quiver: s.quiver,
    input: s.input,
    pending,
  }
}

function abortError(): DOMException {
  return new DOMException('Session ended', 'AbortError')
}

/** Build a session. Rejects with the plugin's (user-presentable) error, or an AbortError if `signal` fires first. */
export async function startSession(init: SessionInit): Promise<Session> {
  const { plugin, settings, audio, signal } = init
  const seeds = deriveSeeds(init.seed)
  const ctx = createGeneratorContext(init.generatorId, seeds.generator, signal)
  const source: ProblemSource = await plugin.create(init.options, ctx, { formats: init.formats, maxChoices: MAX_CHOICES })
  const dev = import.meta.env.DEV ? await import('../harness/browser') : null
  if (signal.aborted) {
    source.dispose?.()
    throw abortError()
  }

  const engine = createEngine({
    lanes: settings.lanes,
    problems: source,
    defaultInput: plugin.defaultInput,
    maxLevel: plugin.maxLevel,
    seed: seeds.engine,
  })
  const listeners = new Set<(events: readonly GameEvent[]) => void>()
  let view: GameView | null = null
  let disposed = false
  let slowestSpeed = settings.speed

  // DEV: the harness owns stepping, logging and answer checks.
  let inViewStep = false
  /** During a view step: whether the step's own batch has been seen, and batches dispatched inside it. */
  let stepBatchSeen = false
  let nested: GameEvent[] = []
  const harness = dev
    ? dev.createBrowserHarness({
        engine,
        source,
        game: 'space-shooter',
        generatorId: init.generatorId,
        params: plugin.serializeOptions(init.options),
        seed: init.seed,
        settings: { lanes: engine.config.lanes, direction: settings.direction, ship: settings.ship, speed: settings.speed },
        requestId: init.harnessRequestId,
        getView: () => view,
        isPaused: () => engine.state.status !== 'playing',
      })
    : null

  const broker = harness
    ? null
    : createCheckBroker<Problem, CheckResult>({
        check: (problem, given) => source.check(problem, given),
        // Verdicts ('hit' / 'wrongAnswer') go through the same pipeline as player input.
        dispatch: (command) => {
          if (!disposed) apply(command)
        },
      })
  const pending = () => (harness ? harness.pendingChecks() : broker!.pending())
  const hud = createHudStore(
    () => readHud(engine, pending()),
    () => engine.state.revision * 64 + Math.min(pending(), 63),
  )

  function handle(events: readonly GameEvent[]): void {
    if (disposed) return
    if (events.length) {
      broker?.handle(events)
      playCues(audio, events)
    }
    // Pause may come from the harness too; the view follows the engine.
    view?.setPaused(engine.state.status === 'paused')
    hud.poke()
    if (events.length) for (const listener of [...listeners]) listener(events)
  }

  function apply(command: Command): GameEvent[] {
    // Harness dispatches reach handle() through its subscription below.
    if (harness) return harness.dispatch(command)
    const events = engine.dispatch(command)
    if (events.length) view?.pushEvents(events)
    handle(events)
    return events
  }

  // Everything the harness runs outside a view step (verdicts, send(), time.step()). Inside a view
  // step, the first batch is the step itself (the view gets it back from step()); later batches are
  // dispatches during the tick, e.g. a synchronous check's verdict, and ride along with the step.
  const unsubscribe = harness?.subscribe((events) => {
    if (disposed) return
    if (inViewStep) {
      if (stepBatchSeen) nested.push(...events)
      stepBatchSeen = true
      return
    }
    if (events.length) view?.pushEvents(events)
    handle(events)
  })

  function teardown(): void {
    if (disposed) return
    disposed = true
    signal.removeEventListener('abort', teardown)
    listeners.clear()
    unsubscribe?.()
    broker?.dispose()
    harness?.dispose()
    view?.dispose()
    source.dispose?.()
  }
  // Aborting the signal (screen unmount / restart) tears everything down, even mid-load.
  signal.addEventListener('abort', teardown)

  try {
    view = createGameView({
      canvas: init.canvas,
      engine,
      direction: settings.direction,
      ship: settings.ship,
      touch: init.touch,
      speed: settings.speed,
      step: harness
        ? () => {
            inViewStep = true
            stepBatchSeen = false
            nested = []
            try {
              const events = harness.tick()
              return nested.length ? [...events, ...nested] : events
            } finally {
              inViewStep = false
              nested = []
            }
          }
        : undefined,
      onStep: handle,
    })
    await view.ready
  } catch (err) {
    teardown()
    throw err
  }
  if (disposed) throw abortError()
  const liveView = view
  harness?.attach()

  audio.music(engine.state.level >= INTENSE_LEVEL ? 'intense' : 'play')

  return {
    engine,
    view: liveView,
    hud,
    startedAt: Date.now(),
    get slowestSpeed() {
      return slowestSpeed
    },
    harness,
    dispatch: (command) => (disposed ? [] : apply(command)),
    pause() {
      if (disposed || engine.state.status !== 'playing') return
      apply({ type: 'pause' })
    },
    resume() {
      if (disposed || engine.state.status !== 'paused') return
      apply({ type: 'resume' })
    },
    setSpeed(speed) {
      if (disposed) return
      slowestSpeed = Math.min(slowestSpeed, speed) as GameSpeed
      // DEV: the harness scale owns the view's pace (and the meta panel shows it).
      if (harness) harness.time.setScale(speed)
      else liveView.time.setScale(speed)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: teardown,
  }
}
