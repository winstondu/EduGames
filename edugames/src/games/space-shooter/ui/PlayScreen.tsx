/**
 * One run of the space shooter: canvas + Excalibur view, overlays aligned to
 * the world rect (HUD, question banner, choices, feedback), the touch "deck"
 * (keypad / choices) and the pause, settings and game-over dialogs.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { AnswerInputSpec, GeneratorPlugin, ProblemFormat } from '../../../generators/types'
import type { AudioDirector } from '../../../shared/kit/audio'
import { useHud } from '../../../shared/kit/hooks'
import { createHudStore } from '../../../shared/kit/hudStore'
import type { Keymap } from '../../../shared/kit/input/keymap'
import { START_LIVES, WORLD, type Command } from '../engine/types'
import { GAME_ID, needsRestart, type GameSettings } from '../settings'
import { ChoicePad, Keypad, QuestionBanner, QuiverReadout } from './Answers'
import { keyToAction, laneAtY, needsBanner, REPEATING_ACTIONS } from './controls'
import { FeedbackToast, PendingChip, type WrongFeedback } from './Feedback'
import { GameOver, type RunResult } from './GameOver'
import { Hud } from './Hud'
import { useMediaQuery, useMuted } from './hooks'
import { PauseMenu, SettingsDialog } from './Menus'
import { Modal } from './Screens'
import { startSession, type HudSnapshot, type Session } from './session'

/** Portrait-ish viewports stack HUD / stage / deck vertically. */
const STACKED_QUERY = '(max-aspect-ratio: 5/4)'

export interface PlayScreenProps {
  generatorId: string
  plugin: GeneratorPlugin<unknown>
  options: unknown
  title: string
  formats: readonly ProblemFormat[]
  settings: GameSettings
  audio: AudioDirector
  keymap: Keymap
  seed: number
  onRestart(next?: GameSettings): void
  /** Settings that apply live (speed): persist them without restarting. */
  onSettingsChange(next: GameSettings): void
  onQuit(): void
}

interface LayerRect {
  left: number
  top: number
  width: number
  height: number
}

function idleHud(lanes: number, input: AnswerInputSpec): HudSnapshot {
  return {
    status: 'playing',
    score: 0,
    level: 1,
    streak: 0,
    bestStreak: 0,
    lives: START_LIVES,
    shield: 0,
    correct: 0,
    wrong: 0,
    lanes,
    effects: [],
    target: null,
    inputMode: null,
    choices: [],
    quiver: '',
    input,
    pending: 0,
  }
}

function describeFailure(err: unknown, pluginName: string): string {
  const e = err instanceof Error ? err : null
  if (e?.name === 'IncompatibleGeneratorError') {
    return `This ${pluginName} set can't be played in Space Shooter. ${e.message}`.trim()
  }
  if (e?.name === 'AbortError') return 'Loading was interrupted. Try again.'
  // Plugins should reject with player-facing text, but add context in case it's technical.
  return `We couldn't load the problems.${e?.message ? ` (${e.message})` : ''}`
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]')
}

export function PlayScreen(props: PlayScreenProps) {
  const { plugin, settings, audio, title, keymap } = props
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [panel, setPanel] = useState<'settings' | null>(null)
  const [feedback, setFeedback] = useState<WrongFeedback | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [layer, setLayer] = useState<LayerRect | null>(null)
  const stacked = useMediaQuery(STACKED_QUERY)
  const coarse = useMediaQuery('(pointer: coarse)')
  const muted = useMuted(audio)
  const idle = useMemo(
    () => createHudStore(() => idleHud(settings.lanes, plugin.defaultInput), () => 0),
    [settings.lanes, plugin],
  )
  const hud = useHud(session?.hud ?? idle)
  const lastMode = useRef<ProblemFormat | null>(null)
  if (hud.inputMode) lastMode.current = hud.inputMode

  // Build the session once per mount (the parent remounts this screen to restart).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const controller = new AbortController()
    startSession({
      generatorId: props.generatorId,
      plugin,
      options: props.options,
      formats: props.formats,
      settings,
      canvas,
      audio,
      seed: props.seed,
      signal: controller.signal,
    }).then(
      (s) => {
        if (!controller.signal.aborted) setSession(s)
      },
      (err: unknown) => {
        if (controller.signal.aborted) return
        const message = describeFailure(err, plugin.name)
        setFailure(message)
        if (import.meta.env.DEV) void import('../../../shared/harness/runtime').then((r) => r.reportOpenFailure(GAME_ID, message))
      },
    )
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Session events → feedback toast and game over.
  useEffect(() => {
    if (!session) return
    let toastId = 0
    return session.subscribe((events) => {
      for (const e of events) {
        if (e.type === 'wrongAnswer') {
          const asteroid = session.engine.state.asteroids.find((a) => a.id === e.asteroidId)
          setFeedback({
            id: ++toastId,
            display: e.display,
            expected: e.expected,
            explanation: e.explanation,
            hint: asteroid?.problem.hint,
          })
        } else if (e.type === 'gameOver') {
          const s = session.engine.state
          setFeedback(null)
          setResult({
            score: e.score,
            correct: s.correct,
            wrong: s.wrong,
            bestStreak: s.bestStreak,
            level: s.level,
            durationMs: Date.now() - session.startedAt,
          })
        }
      }
    })
  }, [session])

  // Keyboard, through the player's keymap.
  useEffect(() => {
    if (!session) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target)) return
      if (document.querySelector('dialog[open]')) return
      const s = session.engine.state
      if (s.status === 'over') return
      const action = keyToAction(keymap, e, { inputMode: s.inputMode, input: s.input })
      if (!action) return
      e.preventDefault()
      if (e.repeat && !(action.type === 'command' && REPEATING_ACTIONS.has(action.command.type))) return
      if (action.type === 'togglePause') {
        if (s.status === 'paused') session.resume()
        else session.pause()
      } else if (s.status === 'playing') {
        session.dispatch(action.command)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, keymap])

  // Auto-pause when the tab is hidden.
  useEffect(() => {
    if (!session) return
    const onVisibility = () => {
      if (document.hidden) session.pause()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [session])

  // Align the overlay layer with the view's (letterboxed) world rect.
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || !session) return
    let raf = 0
    const update = () => {
      const r = stage.getBoundingClientRect()
      const a = session.view.worldToClient(0, 0)
      const b = session.view.worldToClient(WORLD.width, WORLD.height)
      const next = {
        left: Math.round(Math.min(a.x, b.x) - r.left),
        top: Math.round(Math.min(a.y, b.y) - r.top),
        width: Math.round(Math.abs(b.x - a.x)),
        height: Math.round(Math.abs(b.y - a.y)),
      }
      if (!(next.width > 0 && next.height > 0)) return
      setLayer((prev) =>
        prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height
          ? prev
          : next,
      )
    }
    // The view re-fits on its own resize handling; measure a couple of frames later.
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => (raf = requestAnimationFrame(update)))
    }
    update()
    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(stage)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [session])

  const send = useCallback(
    (command: Command) => {
      if (session?.engine.state.status === 'playing') session.dispatch(command)
    },
    [session],
  )

  function onStagePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!session || session.engine.state.status !== 'playing') return
    if (e.target instanceof Element && e.target.closest('button, a, input, .ss-toast')) return
    const { y } = session.view.clientToWorld(e.clientX, e.clientY)
    send({ type: 'moveToLane', lane: laneAtY(y, session.engine.state.lanes) })
  }

  const clearFeedback = useCallback(() => setFeedback(null), [])
  const playing = hud.status === 'playing' && !!session
  const mode = hud.inputMode ?? lastMode.current
  const target = hud.target?.problem ?? null
  const showDeck = stacked || coarse
  const rtl = settings.direction === 'rtl'
  const hudEl = (
    <Hud
      hud={hud}
      title={title}
      muted={muted}
      slow={settings.speed < 1}
      engine={session?.engine ?? null}
      onPause={() => session?.pause()}
      onToggleMute={() => audio.toggleMuted()}
    />
  )
  const choicePad = (layout: 'strip' | 'grid') => (
    <ChoicePad
      choices={hud.inputMode === 'multiple-choice' ? hud.choices : []}
      enabled={playing && hud.inputMode === 'multiple-choice'}
      layout={layout}
      onChoose={(index) => send({ type: 'choose', index })}
    />
  )
  const layerStyle = layer
    ? ({
        left: layer.left,
        top: layer.top,
        width: layer.width,
        height: layer.height,
        '--u': `${layer.width / WORLD.width}px`,
      } as CSSProperties)
    : undefined

  return (
    <div className={`ss-root ${stacked ? 'is-stacked' : 'is-wide'}${showDeck ? ' has-deck' : ''}${rtl ? ' is-rtl' : ''}`}>
      {stacked && (
        <div className="ss-top">
          {hudEl}
          <div className="ss-top-banner">{target && <QuestionBanner problem={target} />}</div>
        </div>
      )}

      <div className="ss-stage-area">
        <div className="ss-stage" ref={stageRef} onPointerDown={onStagePointerDown}>
          <canvas ref={canvasRef} className="ss-canvas" aria-label="Game area" />
          {session && layer && (
            <div className="ss-layer" style={layerStyle}>
              {!stacked && hudEl}
              {!stacked && target && needsBanner(target) && (
                <div className="ss-layer-banner">
                  <QuestionBanner problem={target} />
                </div>
              )}
              {!showDeck && mode === 'multiple-choice' && <div className="ss-layer-choices">{choicePad('strip')}</div>}
              <PendingChip count={hud.pending} />
              {feedback && (
                <div className="ss-layer-toast">
                  <FeedbackToast key={feedback.id} feedback={feedback} onDone={clearFeedback} />
                </div>
              )}
            </div>
          )}
          {!session && !failure && (
            <div className="ss-stage-loading" role="status">
              <span className="loader" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              Loading problems…
            </div>
          )}
        </div>
      </div>

      {showDeck && (
        <div className="ss-deck">
          {mode === 'multiple-choice' && choicePad(stacked ? 'grid' : 'strip')}
          {mode === 'freeform' && (
            <>
              <QuiverReadout
                quiver={hud.quiver}
                input={hud.input}
                hint={hud.inputMode ? (coarse ? 'Answer…' : 'Type, then Enter') : 'Pick a lane'}
              />
              {coarse ? (
                <Keypad
                  input={hud.input}
                  enabled={playing && hud.inputMode === 'freeform'}
                  canFire={!!hud.quiver}
                  onChar={(char) => send({ type: 'typeChar', char })}
                  onBackspace={() => send({ type: 'backspace' })}
                  onFire={() => send({ type: 'fire' })}
                />
              ) : null}
            </>
          )}
          {mode === null && (
            <p className="ss-deck-hint">{coarse ? 'Tap a lane to line up with an asteroid!' : 'Use ↑ ↓ to line up with an asteroid!'}</p>
          )}
        </div>
      )}

      {hud.status === 'paused' && !result && panel === null && (
        <PauseMenu
          onResume={() => session?.resume()}
          onSettings={() => setPanel('settings')}
          onRestart={() => props.onRestart()}
          onQuit={props.onQuit}
          keymap={coarse ? undefined : keymap}
        />
      )}
      {panel === 'settings' && (
        <SettingsDialog
          settings={settings}
          muted={muted}
          onMutedChange={(m) => audio.setMuted(m)}
          onApply={(next) => {
            if (needsRestart(next, settings)) return props.onRestart(next)
            props.onSettingsChange(next)
            session?.setSpeed(next.speed)
            setPanel(null)
          }}
          onClose={() => setPanel(null)}
          keymap={coarse ? undefined : keymap}
        />
      )}
      {result && (
        <GameOver
          result={result}
          gameId={GAME_ID}
          generatorId={props.generatorId}
          boardKey={plugin.boardKey(props.options)}
          boardTitle={title}
          meta={{
            board: title.slice(0, 80),
            lanes: settings.lanes,
            direction: settings.direction,
            ship: settings.ship,
            level: result.level,
            speed: session?.slowestSpeed ?? settings.speed,
          }}
          onPlayAgain={() => props.onRestart()}
          onChangeGenerator={props.onQuit}
        />
      )}
      {failure && (
        <Modal label="Couldn't start" onEscape={props.onQuit} className="ss-modal--narrow">
          <h2 className="ss-modal-title comic-title">Uh-oh!</h2>
          <p className="ss-failure">{failure}</p>
          <div className="ss-actions">
            <button type="button" className="btn btn--primary" onClick={() => props.onRestart()} data-autofocus>
              Try again
            </button>
            <button type="button" className="btn" onClick={props.onQuit}>
              Back to menu
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
