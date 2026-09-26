/**
 * Bridges a mutable game state to React without re-rendering every frame.
 * `version()` is a cheap change counter (e.g. `state.revision`); `read()`
 * builds a fresh, immutable HUD snapshot and runs only when the version moved.
 * The game loop calls `poke()` once per frame; subscribers are notified only
 * when the version changed. Compatible with `useSyncExternalStore`.
 */
export interface HudStore<T> {
  subscribe(listener: () => void): () => void
  /** Same object until `version()` changes. */
  getSnapshot(): T
  /** Notify subscribers if the version changed since the last notification. */
  poke(): void
}

export function createHudStore<T>(read: () => T, version: () => number): HudStore<T> {
  const listeners = new Set<() => void>()
  let snapshotVersion = version()
  let snapshot = read()
  let notifiedVersion = snapshotVersion

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      const v = version()
      if (v !== snapshotVersion) {
        snapshotVersion = v
        snapshot = read()
      }
      return snapshot
    },
    poke() {
      const v = version()
      if (v === notifiedVersion) return
      notifiedVersion = v
      for (const listener of [...listeners]) listener()
    },
  }
}
