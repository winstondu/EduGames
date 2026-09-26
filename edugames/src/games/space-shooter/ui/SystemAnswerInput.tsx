/**
 * Freeform answer typed with the device's system keyboard (stacked touch
 * layout, text answers — see usesSystemKeyboard). A real <input> mirrors the
 * engine's quiver, which stays the source of truth: every change is diffed
 * against the quiver and sent as engine commands (quiverEdits), refused
 * characters never reach it, and the field re-syncs to whatever the quiver holds.
 */
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import type { AnswerInputSpec } from '../../../generators/types'
import type { Command } from '../engine/types'
import { allowedCharsHint, quiverEdits } from './controls'

/** Keep FIRE from taking focus (the keyboard stays open). */
const keepFocus = (e: MouseEvent) => e.preventDefault()

const REJECT_MS = 1600

/** iOS only opens its keyboard for focus() inside a user gesture; elsewhere a sticky activation is enough. */
function canFocusWithoutGesture(): boolean {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return !ios && navigator.userActivation?.hasBeenActive !== false
}

export interface SystemAnswerInputProps {
  quiver: string
  input: AnswerInputSpec
  /** Current target id (auto-focus when a new text target becomes active); null without a target. */
  targetId: number | null
  /** False once the run is over (the field is disabled). */
  enabled: boolean
  placeholder: string
  /** The engine's quiver right now (read back after sending commands). */
  readQuiver(): string
  send(command: Command): void
  /** Non-editing keys (arrows, Escape…) from a physical keyboard; returns whether the game handled them. */
  onKey(e: globalThis.KeyboardEvent): boolean
}

export function SystemAnswerInput(props: SystemAnswerInputProps) {
  const { quiver, input, targetId, enabled, placeholder } = props
  const ref = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const [rejected, setRejected] = useState(0)

  // Quiver changed elsewhere (fired, harness command, physical key outside the field): mirror it.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !composing.current && el.value !== quiver) el.value = quiver
  }, [quiver])

  // A new target: open the keyboard where a script may (never on iOS, never before the player interacted).
  useEffect(() => {
    const el = ref.current
    if (!el || targetId === null || !enabled || document.activeElement === el) return
    if (document.querySelector('dialog[open]') || !canFocusWithoutGesture()) return
    el.focus({ preventScroll: true })
  }, [targetId, enabled])

  useEffect(() => {
    if (!rejected) return
    const timer = setTimeout(() => setRejected(0), REJECT_MS)
    return () => clearTimeout(timer)
  }, [rejected])

  /** Send the field's value to the engine; re-sync the field unless an IME composition is still open. */
  function commit(): void {
    const el = ref.current
    if (!el) return
    const edit = quiverEdits(props.readQuiver(), el.value, input)
    for (const command of edit.commands) props.send(command)
    if (edit.rejected.length) setRejected((n) => n + 1)
    const now = props.readQuiver()
    if (!composing.current && el.value !== now) el.value = now
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    composing.current = false
    commit()
    props.send({ type: 'fire' })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || [...e.key].length === 1 || EDITING_KEYS.has(e.key)) return
    if (props.onKey(e.nativeEvent)) e.preventDefault()
  }

  return (
    <form className={`ss-sysfield${rejected ? ` is-rejected is-shake-${rejected % 2}` : ''}`} onSubmit={onSubmit} autoComplete="off">
      <div className="ss-sysfield-row">
        <label className="ss-sysfield-box">
          <span className="visually-hidden">Your answer</span>
          <input
            ref={ref}
            className="ss-sysfield-input"
            type="text"
            name="answer"
            defaultValue={quiver}
            placeholder={placeholder}
            disabled={!enabled}
            maxLength={input.maxLength}
            inputMode="text"
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-describedby="ss-sysfield-help"
            onInput={commit}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => {
              composing.current = false
              commit()
            }}
            onKeyDown={onKeyDown}
          />
          <span className="ss-quiver-count" aria-hidden="true">
            {[...quiver].length}/{input.maxLength}
          </span>
        </label>
        <button type="submit" className="ss-fire ss-sysfield-fire" disabled={!enabled || !quiver} onMouseDown={keepFocus}>
          FIRE!
        </button>
      </div>
      <p id="ss-sysfield-help" className="ss-sysfield-help" role={rejected ? 'alert' : undefined}>
        {rejected ? 'Only ' : 'Use '}
        {allowedCharsHint(input)}
      </p>
    </form>
  )
}

/** Keys the field edits with itself (plus Enter, which submits). */
const EDITING_KEYS: ReadonlySet<string> = new Set(['Enter', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Process', 'Unidentified', 'Dead'])
