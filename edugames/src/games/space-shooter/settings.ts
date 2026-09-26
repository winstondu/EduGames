import { MAX_LANES, MIN_LANES, type Direction } from './engine/types'
import type { ShipSkinId } from './assets/ships'

export const GAME_ID = 'space-shooter'

/** Player-facing game settings (persisted per browser). Generator settings live in the URL. */
export interface GameSettings {
  ship: ShipSkinId
  direction: Direction
  lanes: number
}

export const DEFAULT_SETTINGS: GameSettings = {
  ship: 'classic',
  direction: 'ltr',
  lanes: 4,
}

const STORAGE_KEY = 'edugames.space-shooter.settings'

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return sanitizeSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable (private mode); settings just won't persist.
  }
}

export function sanitizeSettings(value: unknown): GameSettings {
  const v = (value ?? {}) as Partial<GameSettings>
  const ship = (['classic', 'scout', 'interceptor'] as const).find((s) => s === v.ship)
  const lanes = Number(v.lanes)
  return {
    ship: ship ?? DEFAULT_SETTINGS.ship,
    direction: v.direction === 'rtl' ? 'rtl' : 'ltr',
    lanes: Number.isInteger(lanes) ? Math.min(MAX_LANES, Math.max(MIN_LANES, lanes)) : DEFAULT_SETTINGS.lanes,
  }
}
