import { useSyncExternalStore } from 'react'
import type { HudStore } from './hudStore'

/** Subscribe a component to a HUD store; re-renders only when its version changes. */
export function useHud<T>(store: HudStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
