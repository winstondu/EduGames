/**
 * Harness meta panel (DEV ONLY): a collapsible overlay with the mounted
 * session's meta (generator, params, seed, settings, format), time controls
 * (scale, lockstep, step), a command console, event log, state inspector,
 * replay export and an "open" form that also lists hidden (test-only)
 * generators. Game-agnostic: it only talks to GameHarness.
 */
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { markUnrecordedForTab } from '../unrecorded'
import { currentHarness, subscribeHarness, type HarnessEntry } from './runtime'
import type { HarnessOpenOptions } from './types'

export interface MetaPanelOptions {
  open(opts: HarnessOpenOptions): Promise<unknown>
  /** Games for the open form. */
  games?: readonly { id: string; name: string }[]
  /** Generators for the open form, hidden ones included. */
  generators?(): Promise<readonly { id: string; name: string; hidden?: boolean }[]>
}

const COLLAPSED_KEY = 'edugames.harness.panel'
const POLL_MS = 250
const LOG_LIMIT = 60

function readCollapsed(): boolean {
  try {
    return sessionStorage.getItem(COLLAPSED_KEY) !== 'open'
  } catch {
    return true
  }
}

export function MetaPanel(options: MetaPanelOptions) {
  const entry = useSyncExternalStore(subscribeHarness, currentHarness, currentHarness)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = () => {
    setCollapsed((c) => {
      try {
        sessionStorage.setItem(COLLAPSED_KEY, c ? 'open' : 'closed')
      } catch {
        // ignore
      }
      return !c
    })
  }
  if (collapsed) {
    return (
      <button type="button" className="egh-fab" onClick={toggle} title="Harness meta panel (DEV)" aria-label="Open harness panel">
        🛠{entry ? <span className="egh-dot" /> : null}
      </button>
    )
  }
  return (
    <aside className="egh-panel" aria-label="Harness meta panel">
      <header className="egh-head">
        <strong>Harness</strong>
        <span className="egh-muted">DEV · unrecorded</span>
        <button type="button" className="egh-x" onClick={toggle} aria-label="Collapse harness panel">
          ×
        </button>
      </header>
      {entry ? <SessionView key={`${entry.generatorId}:${entry.seed}`} entry={entry} /> : <p className="egh-muted">No game session.</p>}
      <OpenForm options={options} entry={entry} />
    </aside>
  )
}

/** Re-render every POLL_MS while mounted (state and events are polled, not pushed). */
function usePoll(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return tick
}

function SessionView({ entry }: { entry: HarnessEntry }) {
  const { harness } = entry
  /** Driving the game from the panel makes the run unrecorded (like window.__edugames). */
  const drive = <T,>(fn: () => T): T => {
    markUnrecordedForTab()
    return fn()
  }
  usePoll()
  const [log, setLog] = useState<{ seq: number; lines: string[] }>({ seq: 0, lines: [] })
  const [command, setCommand] = useState('')
  const [reply, setReply] = useState('')
  const [showState, setShowState] = useState(false)
  const state = harness.state() as Record<string, unknown>

  useEffect(() => {
    const timer = setInterval(() => {
      setLog((prev) => {
        const { seq, events } = harness.events(prev.seq)
        if (!events.length) return prev.seq === seq ? prev : { ...prev, seq }
        const lines = [...prev.lines, ...events.map((e) => JSON.stringify(e))].slice(-LOG_LIMIT)
        return { seq, lines }
      })
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [harness])

  async function run(e: FormEvent, act: boolean) {
    e.preventDefault()
    const text = command.trim()
    const result = await drive(() => (act ? harness.act(text || null) : harness.send(text)))
    setReply(result.error ? `error: ${result.error}` : `ok (${result.events.length} events)`)
  }

  function exportReplay() {
    const replay = harness.exportReplay()
    const blob = new Blob([JSON.stringify(replay, null, 1)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${replay.gameId}-${replay.generatorId}-${replay.seed}.replay.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    console.info('[harness] replay', replay)
  }

  const params = new URLSearchParams(entry.params).toString()
  const format = typeof state.inputMode === 'string' ? state.inputMode : (state.target as { format?: string } | null)?.format
  return (
    <div className="egh-body">
      <dl className="egh-meta">
        <dt>game</dt>
        <dd>{entry.game}</dd>
        <dt>generator</dt>
        <dd>
          {entry.generatorId}
          {params ? <code> ?{params}</code> : null}
        </dd>
        <dt>seed</dt>
        <dd>{entry.seed}</dd>
        {Object.entries(entry.settings).map(([k, v]) => (
          <SettingRow key={k} name={k} value={v} />
        ))}
        <dt>format</dt>
        <dd>{format ?? '—'}</dd>
        <dt>step</dt>
        <dd>{(harness as { stepIndex?: number }).stepIndex ?? '—'}</dd>
      </dl>

      <div className="egh-row">
        <label className="egh-grow">
          scale {harness.time.scale.toFixed(2)}×
          <input
            type="range"
            min={0.1}
            max={2}
            step={0.05}
            value={harness.time.scale}
            onChange={(e) => drive(() => harness.time.setScale(Number(e.target.value)))}
          />
        </label>
        <label>
          <input type="checkbox" checked={harness.time.lockstep} onChange={(e) => drive(() => harness.time.setLockstep(e.target.checked))} /> lockstep
        </label>
      </div>
      <div className="egh-row">
        {[1, 10, 60].map((n) => (
          <button key={n} type="button" onClick={() => drive(() => harness.time.step(n))}>
            +{n}
          </button>
        ))}
        <button type="button" onClick={exportReplay}>
          Export replay
        </button>
      </div>

      <form className="egh-row" onSubmit={(e) => run(e, false)}>
        <input
          className="egh-grow"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={harness.commands.map((c) => c.name).join(' · ')}
          aria-label="Harness command"
        />
        <button type="submit">send</button>
        <button type="button" onClick={(e) => run(e, true)}>
          act
        </button>
      </form>
      {reply && <p className="egh-muted">{reply}</p>}

      <details open>
        <summary>events</summary>
        <pre className="egh-log">{log.lines.slice().reverse().join('\n') || '—'}</pre>
      </details>
      <details open={showState} onToggle={(e) => setShowState((e.target as HTMLDetailsElement).open)}>
        <summary>state</summary>
        {showState && <pre className="egh-log">{JSON.stringify(state, null, 1)}</pre>}
      </details>
    </div>
  )
}

function SettingRow({ name, value }: { name: string; value: string | number | boolean }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{String(value)}</dd>
    </>
  )
}

function OpenForm({ options, entry }: { options: MetaPanelOptions; entry: HarnessEntry | null }) {
  const games = options.games ?? []
  const [generators, setGenerators] = useState<readonly { id: string; name: string; hidden?: boolean }[]>([])
  const [game, setGame] = useState(entry?.game ?? games[0]?.id ?? '')
  const [gen, setGen] = useState(entry?.generatorId ?? 'fixture')
  const [params, setParams] = useState(entry ? new URLSearchParams(entry.params).toString() : 'set=mixed')
  const [settings, setSettings] = useState('')
  const [seed, setSeed] = useState('')
  const [speed, setSpeed] = useState('1')
  const [lockstep, setLockstep] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let live = true
    options.generators?.().then(
      (list) => live && setGenerators(list),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [options])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const settingsRecord: Record<string, string | number> = {}
    for (const [k, v] of new URLSearchParams(settings)) settingsRecord[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
    setStatus('opening…')
    try {
      await options.open({
        game,
        gen,
        params: Object.fromEntries(new URLSearchParams(params)),
        seed: seed.trim() ? Number(seed) >>> 0 : undefined,
        speed: Number(speed),
        lockstep,
        settings: settingsRecord,
      })
      setStatus('')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <details className="egh-open">
      <summary>open…</summary>
      <form onSubmit={submit} className="egh-form">
        <label>
          game
          <select value={game} onChange={(e) => setGame(e.target.value)}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          generator
          <select value={gen} onChange={(e) => setGen(e.target.value)}>
            {!generators.some((g) => g.id === gen) && <option value={gen}>{gen}</option>}
            {generators.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.hidden ? ' (test-only)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          params
          <input value={params} onChange={(e) => setParams(e.target.value)} placeholder="set=mixed / format=mc&ops=add" />
        </label>
        <label>
          settings
          <input value={settings} onChange={(e) => setSettings(e.target.value)} placeholder="lanes=5&direction=rtl&ship=scout" />
        </label>
        <label>
          seed
          <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="random" inputMode="numeric" />
        </label>
        <label>
          scale
          <input value={speed} onChange={(e) => setSpeed(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          <input type="checkbox" checked={lockstep} onChange={(e) => setLockstep(e.target.checked)} /> lockstep
        </label>
        <button type="submit">Open (unrecorded)</button>
        {status && <p className="egh-muted">{status}</p>}
      </form>
    </details>
  )
}

// Collapsed: a small tab on the top edge's centre (between HUD pills and above the play field), so it never covers game controls.
export const META_PANEL_CSS = `
#edugames-harness { position: fixed; top: 0; left: 50%; transform: translateX(-50%); z-index: 2147483000; font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; color: #e8ecff; }
#edugames-harness button, #edugames-harness input, #edugames-harness select { font: inherit; color: #111; }
.egh-fab { position: relative; display: block; width: 44px; height: 18px; padding: 0; font-size: 11px !important; line-height: 16px; border-radius: 0 0 9px 9px; border: 1px solid #556; border-top: 0; background: #1d2136b3; color: #fff !important; cursor: pointer; }
.egh-dot { position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; border-radius: 50%; background: #5f5; }
.egh-panel { width: min(360px, calc(100vw - 16px)); max-height: calc(100vh - 16px); margin-top: 4px; overflow: auto; background: #151a2ef2; border: 1px solid #445; border-radius: 8px; padding: 8px; box-shadow: 0 6px 24px #0008; }
.egh-head { display: flex; gap: 8px; align-items: baseline; }
.egh-x { margin-left: auto; background: none; border: 0; color: #fff !important; font-size: 16px; cursor: pointer; }
.egh-muted { color: #9aa3c7; margin: 4px 0; }
.egh-meta { display: grid; grid-template-columns: auto 1fr; gap: 1px 8px; margin: 6px 0; }
.egh-meta dt { color: #9aa3c7; }
.egh-meta dd { margin: 0; overflow-wrap: anywhere; }
.egh-row { display: flex; gap: 6px; align-items: center; margin: 6px 0; flex-wrap: wrap; }
.egh-grow { flex: 1; min-width: 0; }
.egh-grow input[type=range] { width: 100%; }
.egh-log { max-height: 160px; overflow: auto; background: #0b0e1a; padding: 4px; margin: 4px 0; white-space: pre-wrap; word-break: break-all; }
.egh-form { display: grid; gap: 4px; }
.egh-form label { display: grid; grid-template-columns: 70px 1fr; align-items: center; gap: 6px; }
#edugames-harness details summary { cursor: pointer; color: #c9d1ff; }
`
