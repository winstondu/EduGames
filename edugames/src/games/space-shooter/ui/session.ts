/**
 * One play session: the only place that touches the generator plugin.
 * plugin.create → engine → check broker → HUD store → view, wired into a
 * single event pipeline (broker, audio cues, HUD, React listeners). Framework
 * free; the React screen owns its lifetime.
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
import { createEngine, type ActiveEffect, type Command, type Engine, type GameEvent, type GameStatus } from '../engine'
import { createGameView, type GameView } from '../render'
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
  audio: AudioDirector
  seed: number
  /** Aborted when the session ends (also the plugin context's signal). */
  signal: AbortSignal
}

export interface Session {
  readonly engine: Engine
  readonly view: GameView
  readonly hud: HudStore<HudSnapshot>
  /** Wall-clock start (ms since epoch), for score plausibility. */
  readonly startedAt: number
  /** Apply a player command through the whole pipeline (view FX, checks, cues, HUD). */
  dispatch(command: Command): GameEvent[]
  pause(): void
  resume(): void
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
  const ctx = createGeneratorContext(init.generatorId, init.seed, signal)
  const source: ProblemSource = await plugin.create(init.options, ctx, { formats: init.formats })
  if (signal.aborted) {
    source.dispose?.()
    throw abortError()
  }

  const engine = createEngine({
    lanes: settings.lanes,
    problems: source,
    defaultInput: plugin.defaultInput,
    maxLevel: plugin.maxLevel,
    seed: init.seed,
  })
  const listeners = new Set<(events: readonly GameEvent[]) => void>()
  let view: GameView | null = null
  let disposed = false

  const broker = createCheckBroker<Problem, CheckResult>({
    check: (problem, given) => source.check(problem, given),
    // Verdicts ('hit' / 'wrongAnswer') go through the same pipeline as player input.
    dispatch: (command) => {
      if (!disposed) apply(command)
    },
  })
  const hud = createHudStore(
    () => readHud(engine, broker.pending()),
    () => engine.state.revision * 64 + Math.min(broker.pending(), 63),
  )

  function handle(events: readonly GameEvent[]): void {
    if (disposed) return
    if (events.length) {
      broker.handle(events)
      playCues(audio, events)
    }
    hud.poke()
    if (events.length) for (const listener of [...listeners]) listener(events)
  }

  function apply(command: Command): GameEvent[] {
    const events = engine.dispatch(command)
    if (events.length) view?.pushEvents(events)
    handle(events)
    return events
  }

  function teardown(): void {
    if (disposed) return
    disposed = true
    signal.removeEventListener('abort', teardown)
    listeners.clear()
    broker.dispose()
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
      onStep: handle,
    })
    await view.ready
  } catch (err) {
    teardown()
    throw err
  }
  if (disposed) throw abortError()
  const liveView = view

  audio.music(engine.state.level >= INTENSE_LEVEL ? 'intense' : 'play')

  return {
    engine,
    view: liveView,
    hud,
    startedAt: Date.now(),
    dispatch: (command) => (disposed ? [] : apply(command)),
    pause() {
      if (disposed || engine.state.status !== 'playing') return
      apply({ type: 'pause' })
      liveView.setPaused(true)
    },
    resume() {
      if (disposed || engine.state.status !== 'paused') return
      apply({ type: 'resume' })
      liveView.setPaused(false)
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
