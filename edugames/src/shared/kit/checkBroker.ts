/**
 * Check broker: bridges a pure simulation (which emits `checkRequested` and
 * waits) and an answer checker that may be sync or async (e.g. a hybrid
 * generator plugin checking server-side). Structural types only, so any game
 * whose events/commands have these shapes can use it.
 *
 *   const broker = createCheckBroker({ check: (p, g) => source.check(p, g), dispatch: (c) => engine.dispatch(c) })
 *   broker.handle(engine.step())
 */

export interface CheckRequestedEvent<P = unknown> {
  type: 'checkRequested'
  checkId: number
  problem: P
  given: string
}

export interface ResolveCheckCommand<R = unknown> {
  type: 'resolveCheck'
  checkId: number
  /** null = the check failed (threw, rejected or timed out). */
  result: R | null
}

export interface CheckBrokerOptions<P, R> {
  check(problem: P, given: string): R | PromiseLike<R>
  dispatch(command: ResolveCheckCommand<R>): void
  /** Resolve async checks with `null` after this long (default: never; the sim may have its own timeout). */
  timeoutMs?: number
}

export interface CheckBroker {
  /** Scan a batch of events; starts a check for each `checkRequested`. Other events are ignored. */
  handle(events: readonly { type: string }[]): void
  /** Checks still in flight. */
  pending(): number
  /** Ignore every settlement from now on and clear timers. */
  dispose(): void
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as PromiseLike<unknown>).then === 'function'
}

export function createCheckBroker<P = unknown, R = unknown>(options: CheckBrokerOptions<P, R>): CheckBroker {
  const { check, dispatch, timeoutMs } = options
  /** checkId → timeout handle (or 0 when there is no timeout). */
  const inFlight = new Map<number, ReturnType<typeof setTimeout> | 0>()
  let disposed = false

  function settle(checkId: number, result: R | null): void {
    if (disposed || !inFlight.has(checkId)) return
    const timer = inFlight.get(checkId)
    if (timer) clearTimeout(timer)
    inFlight.delete(checkId)
    dispatch({ type: 'resolveCheck', checkId, result })
  }

  function start(event: CheckRequestedEvent<P>): void {
    const { checkId } = event
    if (inFlight.has(checkId)) return
    let outcome: R | PromiseLike<R>
    try {
      outcome = check(event.problem, event.given)
    } catch {
      dispatch({ type: 'resolveCheck', checkId, result: null })
      return
    }
    if (!isPromiseLike(outcome)) {
      dispatch({ type: 'resolveCheck', checkId, result: outcome })
      return
    }
    inFlight.set(checkId, timeoutMs !== undefined && timeoutMs >= 0 ? setTimeout(() => settle(checkId, null), timeoutMs) : 0)
    outcome.then(
      (result) => settle(checkId, result ?? null),
      () => settle(checkId, null),
    )
  }

  return {
    handle(events) {
      if (disposed) return
      for (const event of events) {
        if (event.type === 'checkRequested') start(event as CheckRequestedEvent<P>)
      }
    },
    pending: () => inFlight.size,
    dispose() {
      disposed = true
      for (const timer of inFlight.values()) if (timer) clearTimeout(timer)
      inFlight.clear()
    },
  }
}
