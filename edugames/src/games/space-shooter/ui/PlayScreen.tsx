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
import { dragLane, keyToAction, laneAtY, needsBanner, REPEATING_ACTIONS, usesSystemKeyboard } from './controls'
import { FeedbackToast, PendingChip, type WrongFeedback } from './Feedback'
import { GameOver, type RunResult } from './GameOver'
import { Hud } from './Hud'
import { useMediaQuery, useMuted, useVisualViewport } from './hooks'
import { PauseMenu, SettingsDialog } from './Menus'
import { reservedTopWorld, toastAnchor, type ToastAnchor } from './overlays'
import { Modal } from './Screens'
import { startSession, type HudSnapshot, type Session } from './session'
import { SystemAnswerInput } from './SystemAnswerInput'

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
  /** DEV: the window.__edugames.open() request this run was started for. */
  harnessRequestId?: string
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
  // Plugins reject with player-facing text in a plain Error (contract); anything else (TypeError,
  // SyntaxError, …) is technical, so the player gets a generic line and the console the details.
  if (e?.cause || (e && e.name !== 'Error')) console.warn('[space-shooter] generator failed to load:', e.cause ?? e)
  return (e?.name === 'Error' && e.message.trim()) || "We couldn't load the problems. Try again in a moment."
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
  const [toastAt, setToastAt] = useState<ToastAnchor>('top')
  const layerRef = useRef<HTMLDivElement>(null)
  /** CSS px below the layer's top covered by the HUD row (+ banner) in the wide layout. */
  const [reservedPx, setReservedPx] = useState(0)
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
      touch: coarse,
      audio,
      seed: props.seed,
      signal: controller.signal,
      harnessRequestId: props.harnessRequestId,
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
          const s = session.engine.state
          const asteroid = s.asteroids.find((a) => a.id === e.asteroidId)
          setToastAt(toastAnchor(s.ship.lane, s.lanes))
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

  // The wide HUD row (with the question banner) covers the top of the stage: keep the toast,
  // the pending chip and the ship's quiver bubble below it.
  useLayoutEffect(() => {
    const layerEl = layerRef.current
    const hudEl = stacked ? null : layerEl?.querySelector<HTMLElement>('.ss-hud')
    if (!session || !layerEl || !hudEl) {
      setReservedPx(0)
      session?.view.setReservedTop(null)
      return
    }
    const measure = () => {
      const top = layerEl.getBoundingClientRect().top
      const bottom = Math.ceil(hudEl.getBoundingClientRect().bottom - top)
      setReservedPx(bottom)
      session.view.setReservedTop(reservedTopWorld(bottom, layerEl.clientHeight))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(hudEl)
    observer.observe(layerEl)
    return () => observer.disconnect()
  }, [session, stacked, layer])

  const send = useCallback(
    (command: Command) => {
      if (session?.engine.state.status === 'playing') session.dispatch(command)
    },
    [session],
  )

  // Tap a lane to jump there; keep pressing and drag to steer (snaps lane by lane).
  const dragPointer = useRef<number | null>(null)

  function onStagePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!session || session.engine.state.status !== 'playing') return
    if (e.target instanceof Element && e.target.closest('button, a, input, .ss-toast')) return
    if (dragPointer.current !== null) return
    const { y } = session.view.clientToWorld(e.clientX, e.clientY)
    send({ type: 'moveToLane', lane: laneAtY(y, session.engine.state.lanes) })
    dragPointer.current = e.pointerId
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Synthetic or already-released pointer: the drag just ends at the stage edge.
    }
  }

  function onStagePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerId !== dragPointer.current || !session) return
    const s = session.engine.state
    if (s.status !== 'playing') return
    const { y } = session.view.clientToWorld(e.clientX, e.clientY)
    const lane = dragLane(y, s.lanes, s.ship.lane)
    if (lane !== s.ship.lane) send({ type: 'moveToLane', lane })
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerId === dragPointer.current) dragPointer.current = null
  }

  const clearFeedback = useCallback(() => setFeedback(null), [])
  const playing = hud.status === 'playing' && !!session
  const mode = hud.inputMode ?? lastMode.current
  const target = hud.target?.problem ?? null
  const showDeck = stacked || coarse
  const rtl = settings.direction === 'rtl'
  // Text answers on a portrait touch screen: a real field with the system keyboard instead of the keypad.
  const systemField = showDeck && mode === 'freeform' && usesSystemKeyboard({ stacked, coarse, input: hud.input })
  // …and the screen fits what the soft keyboard leaves visible.
  const viewport = useVisualViewport(systemField)
  const hudEl = (banner?: boolean) => (
    <Hud
      hud={hud}
      title={title}
      banner={banner && target && needsBanner(target) ? <QuestionBanner problem={target} /> : undefined}
      muted={muted}
      slow={(session?.slowestSpeed ?? settings.speed) < 1}
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
        '--reserved-top': `${reservedPx}px`,
      } as CSSProperties)
    : undefined
  const rootStyle = viewport
    ? ({ '--ss-vv-height': `${viewport.height}px`, '--ss-vv-top': `${viewport.top}px` } as CSSProperties)
    : undefined

  /** Physical keys pressed inside the answer field that aren't editing it (arrows, pause…), through the keymap. */
  function onFieldKey(e: KeyboardEvent): boolean {
    if (!session || document.querySelector('dialog[open]')) return false
    const s = session.engine.state
    if (s.status === 'over') return false
    const action = keyToAction(keymap, e, { inputMode: s.inputMode, input: s.input })
    if (!action || (action.type === 'command' && action.command.type === 'fire')) return false
    if (e.repeat && !(action.type === 'command' && REPEATING_ACTIONS.has(action.command.type))) return true
    if (action.type === 'togglePause') {
      if (s.status === 'paused') session.resume()
      else session.pause()
    } else if (s.status === 'playing') {
      session.dispatch(action.command)
    }
    return true
  }

  return (
    <div
      className={`ss-root ${stacked ? 'is-stacked' : 'is-wide'}${showDeck ? ' has-deck' : ''}${systemField ? ' has-system-field' : ''}${rtl ? ' is-rtl' : ''}`}
      style={rootStyle}
    >
      {stacked && (
        <div className="ss-top">
          {hudEl()}
          <div className="ss-top-banner">{target && <QuestionBanner problem={target} />}</div>
        </div>
      )}

      <div className="ss-stage-area">
        <div
          className="ss-stage"
          ref={stageRef}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          // Steering by tap must not blur the answer field (the keyboard would close and the layout jump).
          onMouseDown={systemField ? (e) => e.preventDefault() : undefined}
        >
          <canvas ref={canvasRef} className="ss-canvas" aria-label="Game area" />
          {session && layer && (
            <div className="ss-layer" style={layerStyle} ref={layerRef}>
              {!stacked && hudEl(true)}
              {!showDeck && mode === 'multiple-choice' && <div className="ss-layer-choices">{choicePad('strip')}</div>}
              {/* Notes dock on the far side (away from the ship); the toast takes the half away from its lane. */}
              <div className="ss-layer-notes is-top">
                <PendingChip count={hud.pending} />
                {feedback && toastAt === 'top' && <FeedbackToast key={feedback.id} feedback={feedback} onDone={clearFeedback} />}
              </div>
              {feedback && toastAt === 'bottom' && (
                <div className="ss-layer-notes is-bottom">
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
          {systemField && (
            <SystemAnswerInput
              quiver={hud.quiver}
              input={hud.input}
              targetId={hud.inputMode === 'freeform' ? (hud.target?.id ?? null) : null}
              enabled={!!session && hud.status !== 'over'}
              placeholder={hud.inputMode ? 'Type your answer…' : 'Pick a lane'}
              readQuiver={() => session?.engine.state.quiver ?? ''}
              send={send}
              onKey={onFieldKey}
            />
          )}
          {mode === 'freeform' && !systemField && (
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
