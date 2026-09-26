/** Settings form (start screen + pause), pause menu, settings dialog and keyboard help. */
import { useId, useState, useSyncExternalStore } from 'react'
import { KeymapEditor } from '../../../shared/kit/input/KeymapEditor'
import { keyLabel, saveKeymap, type Keymap } from '../../../shared/kit/input/keymap'
import { GAME_SPEEDS, GAME_SPEED_LABELS } from '../../../shared/kit/time'
import { SHIP_SKINS } from '../assets/ships'
import { UI_ICONS } from '../assets/ui'
import { MAX_LANES, MIN_LANES, type Direction } from '../engine/types'
import { GAME_ID, needsRestart, type GameSettings } from '../settings'
import { Modal } from './Screens'

const LANE_OPTIONS = Array.from({ length: MAX_LANES - MIN_LANES + 1 }, (_, i) => MIN_LANES + i)

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: 'ltr', label: 'Left → Right' },
  { value: 'rtl', label: 'Right → Left' },
]

export interface SettingsFormProps {
  value: GameSettings
  onChange(next: GameSettings): void
  muted: boolean
  onMutedChange(muted: boolean): void
  /** Show key presets / rebinding (keyboard players only). */
  keymap?: Keymap
}

export function SettingsForm({ value, onChange, muted, onMutedChange, keymap }: SettingsFormProps) {
  const id = useId()
  const set = (patch: Partial<GameSettings>) => onChange({ ...value, ...patch })
  return (
    <div className="ss-settings">
      <div className="ss-setting">
        <span className="ss-setting-label" id={`${id}-ship`}>
          Ship
        </span>
        <div className="ss-ships" role="radiogroup" aria-labelledby={`${id}-ship`}>
          {SHIP_SKINS.map((skin) => (
            <label key={skin.id} className="ss-ship">
              <input
                type="radio"
                name={`${id}-ship`}
                checked={value.ship === skin.id}
                onChange={() => set({ ship: skin.id })}
              />
              <img
                src={skin.url}
                alt=""
                width={96}
                height={60}
                className={value.direction === 'rtl' ? 'is-mirrored' : undefined}
              />
              <span>{skin.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="ss-setting">
        <span className="ss-setting-label" id={`${id}-dir`}>
          Fly
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby={`${id}-dir`}>
          {DIRECTIONS.map((d) => (
            <label key={d.value}>
              <input
                type="radio"
                name={`${id}-dir`}
                checked={value.direction === d.value}
                onChange={() => set({ direction: d.value })}
              />
              {d.label}
            </label>
          ))}
        </div>
      </div>

      <div className="ss-setting-pair">
        <div className="ss-setting">
          <span className="ss-setting-label" id={`${id}-lanes`}>
            Lanes
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby={`${id}-lanes`}>
            {LANE_OPTIONS.map((n) => (
              <label key={n}>
                <input type="radio" name={`${id}-lanes`} checked={value.lanes === n} onChange={() => set({ lanes: n })} />
                {n}
              </label>
            ))}
          </div>
        </div>

        <div className="ss-setting">
          <span className="ss-setting-label" id={`${id}-sound`}>
            Sound
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby={`${id}-sound`}>
            <label>
              <input type="radio" name={`${id}-sound`} checked={!muted} onChange={() => onMutedChange(false)} />
              On
            </label>
            <label>
              <input type="radio" name={`${id}-sound`} checked={muted} onChange={() => onMutedChange(true)} />
              Off
            </label>
          </div>
        </div>
      </div>

      <div className="ss-setting">
        <span className="ss-setting-label" id={`${id}-speed`}>
          Speed
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby={`${id}-speed`}>
          {GAME_SPEEDS.map((speed) => (
            <label key={speed}>
              <input type="radio" name={`${id}-speed`} checked={value.speed === speed} onChange={() => set({ speed })} />
              {GAME_SPEED_LABELS[speed]}
            </label>
          ))}
        </div>
        {value.speed < 1 && <p className="ss-note">Slow-motion scores get a 🐢 on the leaderboard.</p>}
      </div>

      {keymap && (
        <details className="ss-setting ss-keys">
          <summary className="ss-setting-label">Keys</summary>
          <KeymapEditor keymap={keymap} onChange={(state) => saveKeymap(GAME_ID, state)} className="ss-keymap" />
        </details>
      )}
    </div>
  )
}

/** Settings opened from the pause menu: applying changes restarts the run. */
export function SettingsDialog({
  settings,
  muted,
  onMutedChange,
  onApply,
  onClose,
  keymap,
}: {
  settings: GameSettings
  muted: boolean
  onMutedChange(muted: boolean): void
  /** Called with the new settings; the caller restarts when `needsRestart`. */
  onApply(next: GameSettings): void
  onClose(): void
  keymap?: Keymap
}) {
  const [draft, setDraft] = useState(settings)
  const restart = needsRestart(draft, settings)
  const changed = restart || draft.speed !== settings.speed
  return (
    <Modal label="Settings" onEscape={onClose}>
      <h2 className="ss-modal-title">Settings</h2>
      <SettingsForm value={draft} onChange={setDraft} muted={muted} onMutedChange={onMutedChange} keymap={keymap} />
      {restart && <p className="ss-note">Changing the ship, direction or lanes starts a new game.</p>}
      <div className="ss-actions">
        {changed ? (
          <button type="button" className="btn btn--primary" onClick={() => onApply(draft)} data-autofocus>
            {restart ? <>Apply &amp; restart</> : 'Apply'}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onClose} data-autofocus={changed ? undefined : true}>
          {changed ? 'Cancel' : 'Back'}
        </button>
      </div>
    </Modal>
  )
}

export function PauseMenu({
  onResume,
  onSettings,
  onRestart,
  onQuit,
  keymap,
}: {
  onResume(): void
  onSettings(): void
  onRestart(): void
  onQuit(): void
  /** Keyboard players get the key help. */
  keymap?: Keymap
}) {
  return (
    <Modal label="Paused" onEscape={onResume} className="ss-modal--narrow">
      <h2 className="ss-modal-title comic-title">Paused</h2>
      <div className="ss-menu">
        <button type="button" className="btn btn--primary btn--big" onClick={onResume} data-autofocus>
          <img src={UI_ICONS.play} alt="" width={28} height={28} /> Resume
        </button>
        <button type="button" className="btn" onClick={onSettings}>
          <img src={UI_ICONS.settings} alt="" width={24} height={24} className="ss-btn-icon" /> Settings
        </button>
        <button type="button" className="btn" onClick={onRestart}>
          Restart
        </button>
        <button type="button" className="btn btn--ghost ss-quit" onClick={onQuit}>
          <img src={UI_ICONS.back} alt="" width={24} height={24} className="ss-btn-icon" /> Quit to menu
        </button>
      </div>
      {keymap && <KeyboardHelp keymap={keymap} />}
    </Modal>
  )
}

/** Key help from the player's current bindings. */
export function KeyboardHelp({ keymap }: { keymap: Keymap }) {
  useSyncExternalStore(keymap.subscribe, () => keymap.revision, () => keymap.revision)
  const keys = (...ids: string[]) => [...new Set(ids.flatMap((id) => keymap.bindings[id] ?? []))]
  const kbds = (codes: string[]) =>
    codes.length ? (
      codes.map((code, i) => (
        <span key={code}>
          {i > 0 && ' '}
          <kbd>{keyLabel(code)}</kbd>
        </span>
      ))
    ) : (
      <span className="muted">unbound</span>
    )
  // One key per choice (the first bound), e.g. 1 2 3 4.
  const choices = [1, 2, 3, 4].flatMap((n) => keymap.bindings[`choose${n}`]?.slice(0, 1) ?? [])
  return (
    <dl className="ss-help">
      <dt>{kbds(keys('moveUp', 'moveDown'))}</dt>
      <dd>Change lane</dd>
      <dt>
        <kbd>0</kbd>–<kbd>9</kbd> then {kbds(keys('fire').slice(0, 1))}
      </dt>
      <dd>Type an answer and fire</dd>
      <dt>{kbds(choices)}</dt>
      <dd>Pick a choice</dd>
      <dt>{kbds(keys('pause'))}</dt>
      <dd>Pause</dd>
    </dl>
  )
}
