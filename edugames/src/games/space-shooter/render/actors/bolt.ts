/** A laser bolt with the answer it carries riding on top (text never mirrored). */
import * as ex from 'excalibur'
import type { BoltState, Direction } from '../../engine/types'
import { drawAt, surface, textSurface } from '../graphics'
import { travelSign } from '../layout'
import { drawLaser } from '../sprites/fx'
import { Z } from '../theme'

const LASER_W = 150
const LASER_H = 44
const LASER_LENGTH = 104
const LASER_THICKNESS = 16
const TEXT_SIZE = 38

export class BoltActor extends ex.Actor {
  entityId = 0
  private readonly quality: number
  private readonly sign: 1 | -1
  private readonly laser: ex.Canvas
  private text: ex.Canvas | null = null
  private display = ''
  private time = 0

  constructor(direction: Direction, quality: number) {
    super({ z: Z.bolts })
    this.quality = quality
    this.sign = travelSign(direction)
    const dir = this.sign
    this.laser = surface(LASER_W, LASER_H, quality, (ctx) =>
      drawLaser(ctx, { x: LASER_W / 2, y: LASER_H / 2, dir, length: LASER_LENGTH, thickness: LASER_THICKNESS, time: this.time }),
    )
    this.graphics.use(this.laser)
    this.graphics.onPostDraw = (ctx) => {
      if (this.text) drawAt(ctx, this.text, -this.sign * 8, -30)
    }
  }

  bind(b: BoltState): void {
    this.entityId = b.id
    this.graphics.visible = true
    if (b.display !== this.display || !this.text) {
      this.display = b.display
      this.text = b.display ? textSurface(b.display, TEXT_SIZE, this.quality) : null
    }
  }

  release(): void {
    this.graphics.visible = false
    this.entityId = 0
  }

  sync(x: number, y: number, time: number): void {
    this.time = time
    this.pos.setTo(x, y)
    this.laser.flagDirty()
  }
}
