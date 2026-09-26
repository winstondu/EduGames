import { useSyncExternalStore } from 'react'
import type { PlayerIdentity, PlayerView } from '../types'

/** Current player from any auth view; re-renders when it changes. */
export function usePlayer(auth: PlayerView): PlayerIdentity {
  return useSyncExternalStore(auth.subscribe, auth.player, auth.player)
}
