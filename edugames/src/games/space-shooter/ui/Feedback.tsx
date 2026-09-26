/** Wrong-answer feedback toast (with optional hint) and the "checking…" indicator. */
import { useEffect, useState } from 'react'
import { MathText } from '../../../shared/mathtext/MathText'

export interface WrongFeedback {
  /** Unique per toast (restarts the timer). */
  id: number
  display: string
  expected?: string
  explanation?: string
  hint?: string
}

const TOAST_MS = 4000
const TOAST_WITH_HINT_MS = 9000

export function FeedbackToast({ feedback, onDone }: { feedback: WrongFeedback; onDone(): void }) {
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    const timer = setTimeout(onDone, showHint ? TOAST_WITH_HINT_MS : TOAST_MS)
    return () => clearTimeout(timer)
  }, [feedback.id, showHint, onDone])

  return (
    <div className="ss-toast" role="status">
      <strong className="ss-toast-title">Not quite!</strong>
      <p>
        You fired{' '}
        <b className="ss-toast-given">
          <MathText text={feedback.display} />
        </b>
        {feedback.expected && (
          <>
            {' '}
            · answer:{' '}
            <b className="ss-toast-expected">
              <MathText text={feedback.expected} />
            </b>
          </>
        )}
      </p>
      {feedback.explanation && (
        <p className="ss-toast-explain">
          <MathText text={feedback.explanation} />
        </p>
      )}
      {feedback.hint &&
        (showHint ? (
          <p className="ss-toast-hint">
            <MathText text={feedback.hint} />
          </p>
        ) : (
          <button
            type="button"
            className="btn btn--small btn--accent ss-toast-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowHint(true)}
          >
            Show hint
          </button>
        ))}
    </div>
  )
}

export function PendingChip({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <div className="ss-pending" role="status">
      <span className="loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      Checking{count > 1 ? ` ${count}` : ''}…
    </div>
  )
}
