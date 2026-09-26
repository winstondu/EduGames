import type { PowerupKind } from '../../engine/types'
import doubleShotsUrl from './doubleShots.svg?url'
import extraLifeUrl from './extraLife.svg?url'
import randomUrl from './random.svg?url'
import scoreBoostUrl from './scoreBoost.svg?url'
import shieldUrl from './shield.svg?url'
import speedBoostUrl from './speedBoost.svg?url'

export const POWERUP_ICONS: Record<PowerupKind, { url: string; label: string }> = {
  extraLife: { url: extraLifeUrl, label: 'Extra Life' },
  scoreBoost: { url: scoreBoostUrl, label: 'Score ×2' },
  doubleShots: { url: doubleShotsUrl, label: 'Double Shots' },
  shield: { url: shieldUrl, label: 'Shield' },
  speedBoost: { url: speedBoostUrl, label: 'Speed Boost' },
  random: { url: randomUrl, label: 'Mystery' },
}
