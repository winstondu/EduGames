/** A drifting powerup badge: bobbing icon over a pulsing glow. */
import * as ex from 'excalibur'
import { PALETTE } from '../../assets/spec'
import type { PowerupKind, PowerupState } from '../../engine/types'
import { drawAt, type CanvasImage } from '../graphics'
import { glowImage } from '../textures'
import { Z } from '../theme'

export const POWERUP_DRAW_SIZE = 84

export class PowerupActor extends ex.Actor {
  entityId = 0
  private readonly icons: Partial<Record<PowerupKind, CanvasImage>>
  private readonly glow = glowImage(PALETTE.star, 190, 190, 0.55)
  private icon: CanvasImage | null = null
  private time = 0

  constructor(icons: Partial<Record<PowerupKind, CanvasImage>>) {
    super({ z: Z.powerups })
    this.icons = icons
    this.graphics.forceOnScreen = true
    this.graphics.onPostDraw = (ctx) => {
      if (!this.graphics.visible) return
      const t = this.time
      const phase = this.entityId * 1.7
      const bob = Math.sin(t * 3.2 + phase) * 7
      drawAt(ctx, this.glow, 0, bob, { scale: 1 + Math.sin(t * 5 + phase) * 0.08, opacity: 0.75 + Math.sin(t * 5 + phase) * 0.2 })
      if (this.icon) drawAt(ctx, this.icon, 0, bob, { rotation: Math.sin(t * 2.1 + phase) * 0.14 })
    }
  }

  bind(p: PowerupState): void {
    this.entityId = p.id
    this.icon = this.icons[p.kind] ?? null
    this.graphics.visible = true
  }

  release(): void {
    this.graphics.visible = false
    this.entityId = 0
  }

  sync(x: number, y: number, time: number): void {
    this.time = time
    this.pos.setTo(x, y)
  }
}
