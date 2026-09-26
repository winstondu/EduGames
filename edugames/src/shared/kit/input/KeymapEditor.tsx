/**
 * Generic key-binding editor for any game's Keymap: preset segmented control,
 * one row per action with "press a key" rebinding, conflict warnings, reset.
 * Unstyled semantic markup with `keymap-*` className hooks; the game's theme
 * styles it. Esc cancels a capture (so Esc itself is only bound via presets).
 */
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react'
import {
  MAX_KEYS_PER_ACTION,
  PRESET_IDS,
  PRESET_LABELS,
  keyLabel,
  loadKeyboardLayout,
  type KeyboardLayout,
  type Keymap,
  type KeymapState,
  type PresetId,
} from './keymap'

export interface KeymapEditorProps {
  keymap: Keymap
  /** Called after every change with the state to persist (e.g. saveKeymap). */
  onChange?(state: KeymapState): void
  presetLabels?: Partial<Record<PresetId, string>>
  className?: string
}

interface Capture {
  actionId: string
  slot: number
}

/** Keys that never make sense as a binding on their own. */
const IGNORED = new Set(['Tab', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'ContextMenu'])

export function KeymapEditor({ keymap, onChange, presetLabels, className }: KeymapEditorProps) {
  useSyncExternalStore(keymap.subscribe, () => keymap.revision, () => keymap.revision)
  const [capture, setCapture] = useState<Capture | null>(null)
  const [layout, setLayout] = useState<KeyboardLayout | null>(null)

  useEffect(() => {
    let live = true
    void loadKeyboardLayout().then((map) => live && setLayout(map))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!capture) return
    const onKey = (event: KeyboardEvent) => {
      // Capture phase + stopPropagation: the game must not see this key.
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') return setCapture(null)
      if (!event.code || IGNORED.has(event.code)) return
      keymap.rebind(capture.actionId, event.code, capture.slot)
      onChange?.(keymap.serialize())
      setCapture(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capture, keymap, onChange])

  const commit = (mutate: () => void) => {
    setCapture(null)
    mutate()
    onChange?.(keymap.serialize())
  }

  const labelOf = (id: string) => keymap.actions.find((a) => a.id === id)?.label ?? id
  const conflicts = keymap.conflicts()
  const conflicted = new Set(conflicts.map((c) => c.code))
  const capturing = capture ? keymap.actions.find((a) => a.id === capture.actionId) : undefined

  return (
    <div className={['keymap', className].filter(Boolean).join(' ')}>
      <div className="keymap-presets" role="radiogroup" aria-label="Key preset">
        {PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={keymap.preset === id}
            className="keymap-preset"
            onClick={() => commit(() => keymap.setPreset(id))}
          >
            {presetLabels?.[id] ?? PRESET_LABELS[id]}
          </button>
        ))}
      </div>

      <table className="keymap-table">
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Keys</th>
          </tr>
        </thead>
        <tbody>
          {keymap.actions.map((action, i) => {
            const codes = keymap.bindings[action.id]
            const showGroup = action.group && action.group !== keymap.actions[i - 1]?.group
            return (
              <Fragment key={action.id}>
                {showGroup && (
                  <tr className="keymap-group">
                    <th scope="colgroup" colSpan={2}>
                      {action.group}
                    </th>
                  </tr>
                )}
                <tr className="keymap-row">
                  <th scope="row" className="keymap-action">
                    {action.label}
                  </th>
                  <td className="keymap-keys">
                    {codes.map((code, slot) => {
                      const active = capture?.actionId === action.id && capture.slot === slot
                      const label = keyLabel(code, layout)
                      return (
                        <span key={`${code}-${slot}`} className="keymap-slot">
                          <button
                            type="button"
                            className={['keymap-key', conflicted.has(code) && 'is-conflict', active && 'is-capturing'].filter(Boolean).join(' ')}
                            aria-pressed={active}
                            aria-label={`${action.label}: ${label}. Change key`}
                            onClick={() => setCapture(active ? null : { actionId: action.id, slot })}
                          >
                            {active ? '…' : label}
                          </button>
                          <button
                            type="button"
                            className="keymap-remove"
                            aria-label={`Remove ${label} from ${action.label}`}
                            onClick={() => commit(() => keymap.rebind(action.id, null, slot))}
                          >
                            ×
                          </button>
                        </span>
                      )
                    })}
                    {codes.length < MAX_KEYS_PER_ACTION && (
                      <button
                        type="button"
                        className={['keymap-add', capture?.actionId === action.id && capture.slot === codes.length && 'is-capturing'].filter(Boolean).join(' ')}
                        aria-label={`Add a key for ${action.label}`}
                        onClick={() => setCapture({ actionId: action.id, slot: codes.length })}
                      >
                        {capture?.actionId === action.id && capture.slot === codes.length ? '…' : '+'}
                      </button>
                    )}
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>

      <p className="keymap-status" aria-live="polite">
        {capturing ? `Press a key for ${capturing.label}… (Esc to cancel)` : ''}
      </p>

      {conflicts.length > 0 && (
        <ul className="keymap-conflicts" role="alert">
          {conflicts.map((c) => (
            <li key={c.code}>
              {keyLabel(c.code, layout)} is used by {c.actions.map(labelOf).join(' and ')}
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="keymap-reset" disabled={!keymap.customized} onClick={() => commit(() => keymap.reset())}>
        Reset to {presetLabels?.[keymap.preset] ?? PRESET_LABELS[keymap.preset]} keys
      </button>
    </div>
  )
}
