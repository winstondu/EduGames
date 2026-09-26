/** Full-screen loading / message states and a <dialog>-based modal, in the comic style. */
import { useEffect, useRef, type ReactNode } from 'react'

export function GameLoading({ label }: { label: string }) {
  return (
    <div className="screen-center" role="status" aria-live="polite">
      <div className="message-card">
        <div className="loader" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p>{label}</p>
      </div>
    </div>
  )
}

export function GameMessage({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <main className="screen-center">
      <div className="panel message-card" role="alert">
        <h1 className="comic-title">{title}</h1>
        <div>{children}</div>
        <div className="ss-actions">{actions}</div>
      </div>
    </main>
  )
}

/**
 * Modal dialog (focus trapped by the browser's top layer). Esc calls `onEscape`
 * instead of closing, so the host decides what "back" means.
 */
export function Modal({
  label,
  children,
  onEscape,
  className = '',
}: {
  label: string
  children: ReactNode
  onEscape?(): void
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const escape = useRef(onEscape)
  useEffect(() => {
    escape.current = onEscape
  })

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    // showModal() focuses the first focusable element; prefer an explicit [data-autofocus] target.
    // Open at the top (title in view) even when that target sits below the fold on short screens.
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
    const panel = dialog.querySelector<HTMLElement>('.ss-modal-panel')
    if (panel) panel.scrollTop = 0
    const onCancel = (e: Event) => {
      e.preventDefault()
      escape.current?.()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => {
      dialog.removeEventListener('cancel', onCancel)
      if (dialog.open) dialog.close()
    }
  }, [])

  return (
    <dialog ref={ref} className={`ss-modal ${className}`} aria-label={label}>
      <div className="panel ss-modal-panel">{children}</div>
    </dialog>
  )
}
