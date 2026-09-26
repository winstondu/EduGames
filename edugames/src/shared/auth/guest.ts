/**
 * Guest (stub) provider: no accounts. The nickname is kept on this device and sent with each
 * score; nothing is ever sent to the API as a credential. `requiresLogin` / `canLogin` are false.
 */
import { normalizeNickname } from './nickname'
import type { AuthProvider, PlayerIdentity } from './types'

/** Same key the space shooter used for its nickname, so existing players keep theirs. */
export const NICKNAME_KEY = 'edugames.nickname'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export interface GuestProviderOptions {
  /** Where the nickname lives; defaults to localStorage. Pass null (or an in-memory store) for tests / the harness. */
  storage?: StorageLike | null
}

function defaultStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null
  } catch {
    return null
  }
}

function readName(storage: StorageLike | null): string | null {
  try {
    const raw = storage?.getItem(NICKNAME_KEY)
    if (!raw) return null
    const checked = normalizeNickname(raw)
    return checked.ok ? checked.name : null
  } catch {
    return null
  }
}

export function createGuestProvider(options: GuestProviderOptions = {}): AuthProvider {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const listeners = new Set<() => void>()
  let player: PlayerIdentity = { kind: 'guest', displayName: readName(storage) }

  return {
    id: 'guest',
    requiresLogin: false,
    canLogin: false,
    current: () => player,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    login: async () => ({ ok: false, error: 'Sign-in is not available yet — play as a guest.' }),
    logout: async () => {},
    setNickname(name) {
      const checked = normalizeNickname(name)
      if (!checked.ok) return checked
      try {
        storage?.setItem(NICKNAME_KEY, checked.name)
      } catch {
        // Storage unavailable: the name lasts for this page only.
      }
      if (player.displayName !== checked.name) {
        player = { kind: 'guest', displayName: checked.name }
        for (const listener of [...listeners]) listener()
      }
      return checked
    },
    requestAuth: async () => ({}),
  }
}
