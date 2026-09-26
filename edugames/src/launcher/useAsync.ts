import { useCallback, useEffect, useState, type DependencyList } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; value: T }

/**
 * Run `task` whenever `deps` change (or `retry()` is called); the previous run's
 * signal is aborted and its result ignored.
 */
export function useAsync<T>(task: (signal: AbortSignal) => Promise<T>, deps: DependencyList): [AsyncState<T>, () => void] {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    task(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ status: 'ready', value })
      },
      (err: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error: err instanceof Error ? err : new Error(String(err)) })
      },
    )
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return [state, retry]
}

/** A random 32-bit seed for plugin contexts. */
export function randomSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0
}
