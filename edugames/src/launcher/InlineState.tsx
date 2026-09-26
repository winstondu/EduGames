/** Small inline loading / error rows for launcher panels. */
export function InlineLoading({ label }: { label: string }) {
  return (
    <div className="inline-state" role="status">
      <span className="loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>{label}</span>
    </div>
  )
}

export function InlineError({ message, detail, onRetry }: { message: string; detail?: string; onRetry?(): void }) {
  return (
    <div className="inline-state inline-state--error" role="alert">
      <div>
        <strong>{message}</strong>
        {detail && <p className="muted inline-detail">{detail}</p>}
      </div>
      {onRetry && (
        <button type="button" className="btn btn--small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
