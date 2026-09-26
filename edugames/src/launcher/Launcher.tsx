/**
 * Launcher: choose a game, then a generator whose formats the game supports
 * (m games + n generators; incompatible pairs are hidden), then configure the
 * generator (variant, format) and play. Plugins are loaded at runtime through
 * the generator registry; nothing here knows a concrete game or generator.
 */
import { useEffect } from 'react'
import { GAMES, compatibleFormats, findGame } from '../games/registry'
import type { GameDefinition } from '../games/types'
import { fetchManifest } from '../generators/registry'
import type { GeneratorManifestEntry } from '../generators/types'
import { GeneratorSetup } from './GeneratorSetup'
import { InlineError, InlineLoading } from './InlineState'
import { navigate } from './nav'
import { loadPrefs } from './prefs'
import { FORMAT_LABEL, launcherUrl } from './urls'
import { useAsync } from './useAsync'
import './launcher.css'

export function Launcher({ search }: { search: string }) {
  const params = new URLSearchParams(search)
  const requested = params.get('game')
  const prefs = loadPrefs()
  const game = requested ? findGame(requested) : GAMES.length === 1 ? GAMES[0] : findGame(prefs.game ?? '')
  const generatorId = game ? params.get('gen') : null

  return (
    <div className="launcher">
      <header className="launcher-header">
        <h1 className="comic-title launcher-logo">EduGames</h1>
        <p className="launcher-tagline">Pick a game. Pick what to practice. Blast off!</p>
      </header>

      <main className="launcher-steps">
        <section className="panel launcher-step" aria-labelledby="step-game">
          <h2 id="step-game" className="panel-title">
            <StepNumber n={1} /> Choose a game
          </h2>
          <div className="card-grid">
            {GAMES.map((g) => (
              <button
                key={g.id}
                type="button"
                className="pick-card"
                aria-pressed={g.id === game?.id}
                onClick={() => navigate(launcherUrl(g.id), { replace: true })}
              >
                <GameBadge name={g.name} />
                <span className="pick-card-body">
                  <strong className="pick-card-title">{g.name}</strong>
                  <span className="pick-card-text">{g.description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {game && <GeneratorStep key={game.id} game={game} selectedId={generatorId} />}
      </main>
    </div>
  )
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="step-number" aria-hidden="true">
      {n}
    </span>
  )
}

/** Comic starburst with the game's initials (games carry no launcher art, keeping their assets out of this bundle). */
function GameBadge({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <span className="game-badge" aria-hidden="true">
      <svg viewBox="0 0 100 100" width="72" height="72">
        <polygon
          points="50,4 61,30 90,20 74,45 97,62 68,66 70,95 50,76 30,95 32,66 3,62 26,45 10,20 39,30"
          fill="var(--star)"
          stroke="var(--ink)"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <text x="50" y="60" textAnchor="middle" fontSize="28" fontWeight="700" fill="var(--ink)" fontFamily="inherit">
          {initials}
        </text>
      </svg>
    </span>
  )
}

function GeneratorStep({ game, selectedId }: { game: GameDefinition; selectedId: string | null }) {
  const [manifest, retry] = useAsync(() => fetchManifest(), [])
  // Test-only generators (`hidden`) never show in the launcher; the dev harness opens them directly.
  const entries = manifest.status === 'ready' ? manifest.value.generators.filter((e) => !e.hidden) : []
  const compatible = entries.filter((e) => compatibleFormats(game, e.formats).length > 0)
  const hidden = entries.length - compatible.length
  const selected = compatible.find((e) => e.id === selectedId)

  // Preselect the last generator used with this game (or the only one).
  useEffect(() => {
    if (selectedId || manifest.status !== 'ready') return
    const prefs = loadPrefs()
    const pick = compatible.find((e) => e.id === prefs.gen && prefs.game === game.id) ?? (compatible.length === 1 ? compatible[0] : undefined)
    if (pick) navigate(launcherUrl(game.id, pick.id), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest.status, selectedId, game.id])

  return (
    <>
      <section className="panel launcher-step" aria-labelledby="step-generator">
        <h2 id="step-generator" className="panel-title">
          <StepNumber n={2} /> What do you want to practice?
        </h2>
        {manifest.status === 'loading' && <InlineLoading label="Finding practice sets…" />}
        {manifest.status === 'error' && (
          <InlineError message="Couldn't reach the practice-set server." detail={manifest.error.message} onRetry={retry} />
        )}
        {manifest.status === 'ready' && compatible.length === 0 && (
          <p className="muted">No practice sets work with {game.name} yet.</p>
        )}
        {compatible.length > 0 && (
          <div className="card-grid">
            {compatible.map((entry) => (
              <GeneratorCard key={entry.id} game={game} entry={entry} selected={entry.id === selected?.id} />
            ))}
          </div>
        )}
        {hidden > 0 && (
          <p className="launcher-note muted">
            {hidden === 1 ? '1 practice set is' : `${hidden} practice sets are`} hidden because {game.name} can't show
            {hidden === 1 ? ' its' : ' their'} kind of questions.
          </p>
        )}
      </section>

      {selected && <GeneratorSetup key={selected.id} game={game} entry={selected} />}
    </>
  )
}

function GeneratorCard({ game, entry, selected }: { game: GameDefinition; entry: GeneratorManifestEntry; selected: boolean }) {
  const formats = compatibleFormats(game, entry.formats)
  return (
    <button
      type="button"
      className="pick-card"
      aria-pressed={selected}
      onClick={() => navigate(launcherUrl(game.id, entry.id), { replace: true })}
    >
      <span className="pick-card-body">
        <span className="pick-card-head">
          <strong className="pick-card-title">{entry.name}</strong>
          {entry.kind === 'hybrid' && <span className="chip chip--accent">Online</span>}
        </span>
        <span className="pick-card-text">{entry.description}</span>
        <span className="pick-card-chips">
          {formats.map((f) => (
            <span key={f} className="chip">
              {FORMAT_LABEL[f]}
            </span>
          ))}
        </span>
      </span>
    </button>
  )
}
