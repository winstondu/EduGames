/**
 * Space shooter screen (GameDefinition.load target). Resolves the generator
 * plugin from the URL, shows the start screen with settings, then runs
 * PlayScreen (remounted per run so every restart gets a fresh session).
 */
import { useEffect, useState } from 'react'
import { findGame } from '../../registry'
import type { GameProps } from '../../types'
import { createGeneratorContext, loadGenerator } from '../../../generators/registry'
import { PROBLEM_FORMATS, type GeneratorPlugin, type ProblemFormat } from '../../../generators/types'
import { UI_ICONS } from '../assets/ui'
import { GAME_ID, loadSettings, sanitizeSettings, saveSettings, type GameSettings } from '../settings'
import { useAudioDirector, useMediaQuery, useMuted, useShooterKeymap } from './hooks'
import { KeyboardHelp, SettingsForm } from './Menus'
import { PlayScreen } from './PlayScreen'
import { GameLoading, GameMessage } from './Screens'
import './space-shooter.css'

type Setup =
  | { state: 'loading' }
  | { state: 'error'; title: string; message: string; retryable: boolean }
  | { state: 'ready'; plugin: GeneratorPlugin<unknown>; options: unknown; title: string }

function randomSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0
}

/** Load the plugin, parse its options from the URL and fetch the board title. */
function useSetup(generatorId: string, params: URLSearchParams, formats: readonly ProblemFormat[], gameName: string) {
  const [setup, setSetup] = useState<Setup>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const done = (next: Setup) => {
      if (!controller.signal.aborted) setSetup(next)
    }
    setSetup({ state: 'loading' })
    ;(async () => {
      let plugin: GeneratorPlugin<unknown> | null
      try {
        plugin = await loadGenerator(generatorId)
      } catch (err) {
        return done({
          state: 'error',
          title: 'Lost signal!',
          message: `We couldn't load the practice set. ${err instanceof Error ? err.message : ''}`.trim(),
          retryable: true,
        })
      }
      if (!plugin) {
        return done({ state: 'error', title: 'Unknown practice set', message: `There's no practice set called "${generatorId}".`, retryable: false })
      }
      if (!formats.some((f) => plugin.formats.includes(f))) {
        return done({
          state: 'error',
          title: "That won't fit!",
          message: `${plugin.name} asks questions ${gameName} can't show. Pick another practice set.`,
          retryable: false,
        })
      }
      const options = plugin.parseOptions(params)
      if (options === null) {
        return done({
          state: 'error',
          title: 'Missing settings',
          message: `This link is missing some ${plugin.name} settings. Pick a set from the menu instead.`,
          retryable: false,
        })
      }
      let title = plugin.name
      try {
        title = (await plugin.describe(options, createGeneratorContext(generatorId, randomSeed(), controller.signal))) || plugin.name
      } catch {
        // Keep the plugin name as the title.
      }
      done({ state: 'ready', plugin, options, title })
    })()
    return () => controller.abort()
    // params identity changes per render; the URL (and so this screen) is keyed by the router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatorId, attempt])

  return [setup, () => setAttempt((n) => n + 1)] as const
}

export default function SpaceShooterGame({ generatorId, params, onExit }: GameProps) {
  const game = findGame(GAME_ID)
  const gameName = game?.name ?? 'Space Shooter'
  const formats = game?.formats ?? PROBLEM_FORMATS
  const [setup, retry] = useSetup(generatorId, params, formats, gameName)
  const audio = useAudioDirector()
  const muted = useMuted(audio)
  const coarse = useMediaQuery('(pointer: coarse)')
  const keymap = useShooterKeymap()
  const [settings, setSettings] = useState(loadSettings)
  const [run, setRun] = useState(0)
  const [seed, setSeed] = useState(randomSeed)
  // DEV harness open(): settings for its runs only (never saved).
  const [harnessSettings, setHarnessSettings] = useState<GameSettings | null>(null)

  useEffect(() => {
    if (run === 0) audio?.music('menu')
  }, [audio, run])

  // DEV: a window.__edugames.open() request skips the start screen with its seed and settings.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    let live = true
    void import('../../../shared/harness/runtime').then((runtime) => {
      const request = live ? runtime.takeOpenRequest(GAME_ID, generatorId) : null
      if (!request) return
      setHarnessSettings(sanitizeSettings({ ...loadSettings(), ...request.settings }))
      setSeed(request.seed ?? randomSeed())
      setRun((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [generatorId])

  const setupError = setup.state === 'error' ? `${setup.title} ${setup.message}` : null
  useEffect(() => {
    if (import.meta.env.DEV && setupError) void import('../../../shared/harness/runtime').then((r) => r.reportOpenFailure(GAME_ID, setupError))
  }, [setupError])

  function changeSettings(next: GameSettings) {
    setSettings(next)
    saveSettings(next)
  }

  function start(next?: GameSettings) {
    if (next) {
      changeSettings(next)
      setHarnessSettings(null)
    }
    setSeed(randomSeed())
    setRun((n) => n + 1)
  }

  if (setup.state === 'loading' || !audio) return <GameLoading label="Getting the problems ready…" />

  if (setup.state === 'error') {
    return (
      <GameMessage
        title={setup.title}
        actions={
          <>
            {setup.retryable && (
              <button type="button" className="btn btn--primary" onClick={retry}>
                Try again
              </button>
            )}
            <button type="button" className="btn" onClick={onExit}>
              Back to menu
            </button>
          </>
        }
      >
        {setup.message}
      </GameMessage>
    )
  }

  if (run === 0) {
    return (
      <main className="ss-start">
        <div className="panel ss-start-card">
          <button type="button" className="btn btn--ghost btn--small ss-start-back" onClick={onExit}>
            <img src={UI_ICONS.back} alt="" width={22} height={22} /> Menu
          </button>
          <p className="ss-kicker">{gameName}</p>
          <h1 className="ss-start-title comic-title">{setup.title}</h1>
          {!setup.title.includes(setup.plugin.name) && <p className="muted ss-start-sub">{setup.plugin.name}</p>}
          <SettingsForm
            value={settings}
            onChange={changeSettings}
            muted={muted}
            onMutedChange={(m) => audio.setMuted(m)}
            keymap={coarse ? undefined : keymap}
          />
          {coarse ? (
            <p className="ss-note ss-start-help">Tap a lane to move. Tap the answer (or type it on the keypad) and hit FIRE!</p>
          ) : (
            <KeyboardHelp keymap={keymap} />
          )}
          <button type="button" className="btn btn--primary btn--big ss-start-button" onClick={() => start()} autoFocus>
            Start!
          </button>
        </div>
      </main>
    )
  }

  return (
    <PlayScreen
      key={run}
      generatorId={generatorId}
      plugin={setup.plugin}
      options={setup.options}
      title={setup.title}
      formats={formats}
      settings={harnessSettings ?? settings}
      audio={audio}
      keymap={keymap}
      seed={seed}
      onRestart={start}
      onSettingsChange={(next) => (harnessSettings ? setHarnessSettings(next) : changeSettings(next))}
      onQuit={onExit}
    />
  )
}
