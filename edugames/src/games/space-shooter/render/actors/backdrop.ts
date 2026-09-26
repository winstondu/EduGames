/** Static backdrop, parallax starfield and the ship-lane highlight. */
import * as ex from 'excalibur'
import { WORLD, laneCenterY, laneHeight, type Direction } from '../../engine/types'
import { color, surface } from '../graphics'
import { drawStarfield } from '../sprites/background'
import { backgroundImage } from '../textures'
import { Z } from '../theme'

const CENTER = ex.vec(WORLD.width / 2, WORLD.height / 2)
const STAR_SEED = 0x57a2

export class BackdropActor extends ex.Actor {
  constructor(lanes: number, direction: Direction, quality: number) {
    super({ pos: CENTER, z: Z.background })
    this.graphics.use(backgroundImage(lanes, direction, quality))
  }
}

/** Twinkling, drifting stars over the backdrop (re-rasterised every frame). */
export class StarfieldActor extends ex.Actor {
  private time = 0
  private readonly canvas: ex.Canvas

  constructor(direction: Direction) {
    super({ pos: CENTER, z: Z.stars })
    // Stars are soft dots: quality 1 keeps the per-frame upload small.
    this.canvas = surface(WORLD.width, WORLD.height, 1, (ctx) =>
      drawStarfield(ctx, { width: WORLD.width, height: WORLD.height, time: this.time, direction, seed: STAR_SEED }),
    )
    this.graphics.use(this.canvas)
    // Slightly dimmed so the play pieces stay the brightest things on screen.
    this.graphics.opacity = 0.8
  }

  sync(time: number): void {
    this.time = time
    this.canvas.flagDirty()
  }
}

/** Faint band behind the ship's lane (follows the eased lane position). */
export class LaneHighlightActor extends ex.Actor {
  private laneY = 0
  private readonly lanes: number
  private readonly fill = color('#bcd4ff', 0.06)
  private readonly edge = color('#bcd4ff', 0.14)

  constructor(lanes: number) {
    super({ pos: ex.Vector.Zero, z: Z.lanes })
    this.lanes = lanes
    this.graphics.forceOnScreen = true
    this.graphics.onPostDraw = (ctx) => {
      const h = laneHeight(this.lanes)
      const top = laneCenterY(this.laneY, this.lanes) - h / 2
      ctx.drawRectangle(ex.vec(0, top), WORLD.width, h, this.fill)
      ctx.drawRectangle(ex.vec(0, top), WORLD.width, 2, this.edge)
      ctx.drawRectangle(ex.vec(0, top + h - 2), WORLD.width, 2, this.edge)
    }
  }

  sync(laneY: number): void {
    this.laneY = laneY
  }
}
