import classicUrl from './classic.svg?url'
import interceptorUrl from './interceptor.svg?url'
import scoutUrl from './scout.svg?url'

export type ShipSkinId = 'classic' | 'scout' | 'interceptor'

export interface ShipSkin {
  id: ShipSkinId
  name: string
  url: string
}

export const SHIP_SKINS: readonly ShipSkin[] = [
  { id: 'classic', name: 'Comet', url: classicUrl },
  { id: 'scout', name: 'Blue Jay', url: scoutUrl },
  { id: 'interceptor', name: 'Viper', url: interceptorUrl },
]
