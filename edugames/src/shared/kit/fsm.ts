/**
 * Tiny typed finite-state machine for screen/session flow
 * (menu → playing → paused → over …). State and event names are inferred:
 *
 *   const m = createMachine({
 *     initial: 'menu',
 *     states: { menu: { on: { start: 'playing' } }, playing: { on: { die: 'over' } }, over: {} },
 *   })
 *   m.send('start') // m.state === 'playing'
 */

export interface MachineConfig<S extends string, E extends string> {
  initial: NoInfer<S>
  states: { [K in S]: { on?: { [Ev in E]?: NoInfer<S> } } }
}

export type MachineListener<S extends string, E extends string> = (state: S, previous: S, event: E) => void

export interface Machine<S extends string, E extends string> {
  readonly state: S
  /** Apply an event; returns true if it caused a transition (unknown events in this state are ignored). */
  send(event: E): boolean
  /** Whether `event` would transition from the current state. */
  can(event: E): boolean
  /** Called after every transition (including self-transitions). Returns an unsubscribe function. */
  subscribe(listener: MachineListener<S, E>): () => void
}

export function createMachine<S extends string, E extends string = never>(config: MachineConfig<S, E>): Machine<S, E> {
  let state: S = config.initial
  const listeners = new Set<MachineListener<S, E>>()

  const target = (event: E): S | undefined => config.states[state]?.on?.[event]

  return {
    get state() {
      return state
    },
    send(event) {
      const next = target(event)
      if (next === undefined) return false
      const previous = state
      state = next
      for (const listener of [...listeners]) listener(state, previous, event)
      return true
    },
    can: (event) => target(event) !== undefined,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
