/** Step 3: configure a generator plugin for a game (sign-in status, variant, format) and play. */
import { useId, useMemo, useState, type FormEvent } from 'react'
import { compatibleFormats } from '../games/registry'
import type { GameDefinition } from '../games/types'
import { createGeneratorContext, loadGenerator } from '../generators/registry'
import type {
  AuthStatus,
  GeneratorAuth,
  GeneratorManifestEntry,
  GeneratorPlugin,
  GeneratorVariant,
  ProblemFormat,
} from '../generators/types'
import { InlineError, InlineLoading } from './InlineState'
import { Link } from './Link'
import { navigate } from './nav'
import { loadPrefs, savePrefs } from './prefs'
import { FORMAT_LABEL, buildPlayUrl } from './urls'
import { randomSeed, useAsync } from './useAsync'
import { groupVariants, variantKey } from './variants'

/** Variant lists at most this long with a single group render as preset tiles. */
const PRESET_MAX = 12

export function GeneratorSetup({ game, entry }: { game: GameDefinition; entry: GeneratorManifestEntry }) {
  const [plugin, retry] = useAsync(async () => {
    const loaded = await loadGenerator(entry.id)
    if (!loaded) throw new Error(`"${entry.name}" isn't available right now.`)
    return loaded
  }, [entry.id])

  return (
    <section className="panel launcher-step" aria-labelledby="step-setup">
      <h2 id="step-setup" className="panel-title">
        <span className="step-number" aria-hidden="true">
          3
        </span>{' '}
        Set up {entry.name}
      </h2>
      {plugin.status === 'loading' && <InlineLoading label={`Loading ${entry.name}…`} />}
      {plugin.status === 'error' && (
        <InlineError message={`Couldn't load ${entry.name}.`} detail={plugin.error.message} onRetry={retry} />
      )}
      {plugin.status === 'ready' && <PluginSetup game={game} plugin={plugin.value} />}
    </section>
  )
}

function PluginSetup({ game, plugin }: { game: GameDefinition; plugin: GeneratorPlugin<unknown> }) {
  const formats = compatibleFormats(game, plugin.formats)
  const [format, setFormat] = useState<ProblemFormat>(() => {
    const remembered = loadPrefs().format
    return remembered && formats.includes(remembered) ? remembered : formats[0]
  })
  const [variants, retryVariants] = useAsync(
    (signal) =>
      plugin.listVariants ? plugin.listVariants(createGeneratorContext(plugin.id, randomSeed(), signal)) : Promise.resolve(null),
    [plugin],
  )
  const list = variants.status === 'ready' ? variants.value : null
  const presets = !!list && list.length <= PRESET_MAX && new Set(list.map((v) => v.group ?? '')).size <= 1
  const [chosenKey, setSelectedKey] = useState<string | null>(null)
  // Until the player picks, preselect the last variant played (or the first preset).
  const defaultKey = useMemo(() => {
    if (!list) return null
    const remembered = loadPrefs().variants?.[plugin.id]
    const pick = list.find((v) => variantKey(v) === remembered) ?? (presets ? list[0] : undefined)
    return pick ? variantKey(pick) : null
  }, [list, presets, plugin.id])
  const selectedKey = chosenKey ?? defaultKey
  const selected = list?.find((v) => variantKey(v) === selectedKey) ?? null

  const playFormat = plugin.formatSelectable ? format : undefined
  const needsVariant = !!plugin.listVariants
  const url = !needsVariant || selected ? buildPlayUrl(game.id, plugin.id, selected?.params, playFormat) : null
  const valid = !!url && plugin.parseOptions(new URL(url, location.origin).searchParams) !== null

  function remember() {
    savePrefs({
      game: game.id,
      gen: plugin.id,
      ...(playFormat ? { format: playFormat } : {}),
      ...(selected ? { variants: { [plugin.id]: variantKey(selected) } } : {}),
    })
  }

  return (
    <div className="setup">
      <p className="setup-description">{plugin.description}</p>
      {plugin.auth && <AuthBadge plugin={plugin} auth={plugin.auth} />}

      {plugin.formatSelectable && formats.length > 1 && (
        <div className="setup-row">
          <span className="setup-label" id="format-label">
            Answer by
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="format-label">
            {formats.map((f) => (
              <label key={f}>
                <input type="radio" name="format" value={f} checked={format === f} onChange={() => setFormat(f)} />
                {FORMAT_LABEL[f]}
              </label>
            ))}
          </div>
        </div>
      )}

      {needsVariant && variants.status === 'loading' && <InlineLoading label="Loading choices…" />}
      {needsVariant && variants.status === 'error' && (
        <InlineError message="Couldn't load the list." detail={variants.error.message} onRetry={retryVariants} />
      )}
      {list && list.length === 0 && <p className="muted">Nothing to pick from yet.</p>}
      {list && list.length > 0 && (
        <VariantPicker
          variants={list}
          presets={presets}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          playUrl={valid ? url : null}
          onPlay={remember}
        />
      )}
      {!needsVariant && !valid && <p className="muted">This practice set can only be opened from a shared link.</p>}

      <div className="play-bar">
        <div className="play-bar-summary">
          <span className="muted">{valid ? 'Ready:' : needsVariant ? 'Pick one above' : 'Not ready'}</span>
          {valid && <strong className="play-bar-title">{selected?.label ?? plugin.name}</strong>}
          {valid && playFormat && <span className="chip">{FORMAT_LABEL[playFormat]}</span>}
        </div>
        {valid && url ? (
          <Link className="btn btn--primary btn--big play-button" href={url} onClick={remember}>
            Play <span aria-hidden="true">▶</span>
          </Link>
        ) : (
          <button type="button" className="btn btn--primary btn--big play-button" disabled>
            Play <span aria-hidden="true">▶</span>
          </button>
        )}
      </div>
    </div>
  )
}

function VariantPicker({
  variants,
  presets,
  selectedKey,
  onSelect,
  playUrl,
  onPlay,
}: {
  variants: GeneratorVariant[]
  presets: boolean
  selectedKey: string | null
  onSelect(key: string): void
  playUrl: string | null
  onPlay(): void
}) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupVariants(variants, presets ? '' : query), [variants, presets, query])
  const name = useId()
  const count = groups.reduce((n, g) => n + g.items.length, 0)

  if (presets) {
    return (
      <div className="preset-grid" role="radiogroup" aria-label="Choose a set">
        {variants.map((v) => {
          const key = variantKey(v)
          return (
            <label key={key} className="preset-card">
              <input type="radio" name={name} checked={key === selectedKey} onChange={() => onSelect(key)} />
              <strong>{v.label}</strong>
              {v.description && <span className="preset-text">{v.description}</span>}
            </label>
          )
        })}
      </div>
    )
  }

  return (
    <div className="lesson-picker">
      <div className="lesson-search">
        <label className="visually-hidden" htmlFor={`${name}-search`}>
          Search
        </label>
        <input
          id={`${name}-search`}
          className="input"
          type="search"
          placeholder={`Search ${variants.length} lessons…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <span className="lesson-count muted" aria-live="polite">
          {query ? `${count} found` : `${variants.length} lessons`}
        </span>
      </div>
      <div className="lesson-list">
        {groups.length === 0 && <p className="muted lesson-empty">No lessons match “{query}”.</p>}
        {groups.map((g, i) => (
          <div key={g.group} className="lesson-group" role="group" aria-labelledby={`${name}-g${i}`}>
            <div className="lesson-group-title" id={`${name}-g${i}`}>
              {g.parent && <span className="lesson-group-parent">{g.parent} ›</span>} {g.title || 'Other'}
            </div>
            {g.items.map((v) => {
              const key = variantKey(v)
              return (
                <label
                  key={key}
                  className="lesson-row"
                  onDoubleClick={() => {
                    if (playUrl && key === selectedKey) {
                      onPlay()
                      navigate(playUrl)
                    }
                  }}
                >
                  <input type="radio" name={name} checked={key === selectedKey} onChange={() => onSelect(key)} />
                  <span className="lesson-label">{v.label}</span>
                  {v.description && <span className="lesson-text muted">{v.description}</span>}
                </label>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function AuthBadge({ plugin, auth }: { plugin: GeneratorPlugin<unknown>; auth: GeneratorAuth }) {
  const [status, refresh] = useAsync((signal) => auth.status(createGeneratorContext(plugin.id, randomSeed(), signal)), [auth])
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formId = useId()

  const current: AuthStatus | null = status.status === 'ready' ? status.value : null

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const credentials = Object.fromEntries(auth.fields.map((f) => [f.name, String(data.get(f.name) ?? '')]))
    setBusy(true)
    setError(null)
    try {
      const result = await auth.login(createGeneratorContext(plugin.id, randomSeed(), new AbortController().signal), credentials)
      if (result.error || !result.loggedIn) setError(result.error ?? "That didn't work. Check your details.")
      else {
        setFormOpen(false)
        refresh()
      }
    } catch {
      setError("Couldn't sign in right now. Try again later.")
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    try {
      await auth.logout(createGeneratorContext(plugin.id, randomSeed(), new AbortController().signal))
    } finally {
      setBusy(false)
      refresh()
    }
  }

  return (
    <div className="auth">
      <div className="auth-row">
        {status.status === 'loading' && <span className="chip">Checking sign-in…</span>}
        {status.status === 'error' && <span className="chip chip--warn">Sign-in status unavailable</span>}
        {current?.loggedIn && (
          <span className="chip chip--good">
            Signed in as {current.displayName ?? 'you'}
            {current.demo && <span className="auth-demo"> · demo</span>}
          </span>
        )}
        {current && !current.loggedIn && (
          <span className="chip chip--warn">
            Not signed in{current.demo && <span className="auth-demo"> · demo mode</span>}
          </span>
        )}
        {current && !current.loggedIn && !formOpen && (
          <button type="button" className="btn btn--small" onClick={() => setFormOpen(true)} aria-controls={formId}>
            Sign in
          </button>
        )}
        {current?.loggedIn && !current.demo && (
          <button type="button" className="btn btn--small" onClick={logout} disabled={busy}>
            Sign out
          </button>
        )}
      </div>
      {formOpen && (
        <form id={formId} className="auth-form" onSubmit={submit}>
          {auth.fields.map((f) => (
            <label key={f.name} className="field">
              {f.label}
              <input
                className="input"
                name={f.name}
                type={f.type}
                required
                autoComplete={f.type === 'password' ? 'current-password' : f.type === 'email' ? 'email' : 'username'}
              />
            </label>
          ))}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <div className="auth-actions">
            <button type="submit" className="btn btn--accent btn--small" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
