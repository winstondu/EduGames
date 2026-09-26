/** Answer UI: question banner, multiple-choice buttons, quiver readout and the touch keypad. */
import type { CSSProperties, MouseEvent } from 'react'
import type { AnswerInputSpec, Choice, Problem } from '../../../generators/types'
import { MathText } from '../../../shared/mathtext/MathText'
import { mathTextToPlain } from '../../../shared/mathtext/parse'
import { numericPadLayout, textPadLayout } from './controls'

/** Keep in-game buttons from stealing keyboard focus (Space/Enter must reach the game, not re-click them). */
const keepFocus = (e: MouseEvent) => e.preventDefault()

export function QuestionBanner({ problem }: { problem: Problem }) {
  return (
    <div className="ss-banner" role="status" aria-live="polite">
      <span className="ss-banner-tag" aria-hidden="true">
        ?
      </span>
      <MathText className="ss-banner-text" text={problem.prompt} />
    </div>
  )
}

const BADGES = ['1', '2', '3', '4']

/**
 * Multiple-choice buttons: a vertical 'strip' (hugging the leading edge / side
 * deck) or a 2×2 'grid' (stacked phone layout). Disabled without a target.
 */
export function ChoicePad({
  choices,
  enabled,
  layout,
  onChoose,
}: {
  choices: readonly Choice[]
  enabled: boolean
  layout: 'strip' | 'grid'
  onChoose(index: number): void
}) {
  const slots: (Choice | null)[] = choices.length ? [...choices] : [null, null, null, null]
  return (
    <div className={`ss-choices ss-choices--${layout}`} role="group" aria-label="Answer choices">
      {slots.map((choice, i) => {
        const long = choice ? [...mathTextToPlain(choice.text)].length > 6 : false
        return (
          <button
            key={choice?.id ?? i}
            type="button"
            className={`ss-choice${long ? ' is-long' : ''}`}
            disabled={!enabled || !choice}
            onMouseDown={keepFocus}
            onClick={() => onChoose(i)}
            aria-keyshortcuts={i < 4 ? BADGES[i] : undefined}
          >
            {i < 4 && (
              <span className="ss-choice-badge" aria-hidden="true">
                {BADGES[i]}
              </span>
            )}
            <span className="ss-choice-text">{choice ? <MathText text={choice.text} /> : '–'}</span>
          </button>
        )
      })}
    </div>
  )
}

export function QuiverReadout({ quiver, input, hint }: { quiver: string; input: AnswerInputSpec; hint: string }) {
  return (
    <div className="ss-quiver" aria-live="polite">
      <span className={`ss-quiver-text${quiver ? '' : ' is-empty'}`}>{quiver || hint}</span>
      <span className="ss-quiver-count" aria-hidden="true">
        {[...quiver].length}/{input.maxLength}
      </span>
    </div>
  )
}

export function Keypad({
  input,
  enabled,
  canFire,
  onChar,
  onBackspace,
  onFire,
}: {
  input: AnswerInputSpec
  enabled: boolean
  canFire: boolean
  onChar(char: string): void
  onBackspace(): void
  onFire(): void
}) {
  // Numeric: dial pad (extras in a 4th column); text: compact QWERTY. FIRE sits inside the grid either way.
  const { columns, cells } = input.kind === 'numeric' ? numericPadLayout(input) : textPadLayout(input)
  return (
    <div className={`ss-keypad ss-keypad--${input.kind === 'numeric' ? 'numeric' : 'text'}`}>
      <div className="ss-keys" role="group" aria-label="Keypad" style={{ '--cols': columns } as CSSProperties}>
        {cells.map((key, i) => {
          if (!key) return <span key={`gap-${i}`} aria-hidden="true" />
          const style = key.span ? { gridColumn: `span ${key.span}` } : undefined
          if (key.kind === 'fire') {
            return (
              <button key="fire" type="button" className="ss-fire ss-fire--pad" style={style} disabled={!enabled || !canFire} onMouseDown={keepFocus} onClick={onFire}>
                FIRE!
              </button>
            )
          }
          if (key.kind === 'backspace') {
            return (
              <button key="back" type="button" className="ss-key ss-key--back" style={style} disabled={!enabled} onMouseDown={keepFocus} onClick={onBackspace} aria-label="Delete">
                ⌫
              </button>
            )
          }
          const space = key.char === ' '
          return (
            <button
              key={key.char}
              type="button"
              className={`ss-key${/^[\p{L}\p{N}]$/u.test(key.char) || space ? '' : ' ss-key--op'}`}
              style={style}
              disabled={!enabled}
              onMouseDown={keepFocus}
              onClick={() => onChar(key.char)}
              aria-label={space ? 'Space' : undefined}
            >
              {space ? '␣' : key.char}
            </button>
          )
        })}
      </div>
    </div>
  )
}
