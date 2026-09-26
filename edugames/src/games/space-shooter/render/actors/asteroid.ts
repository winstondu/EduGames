/**
 * One asteroid: rotating procedural rock, upright comic problem label, a
 * pulsing dashed ring when it is the target, a spinning dotted ring and "…"
 * while its answer is being checked, and a shake after a wrong answer.
 */
import * as ex from 'excalibur'
import { PALETTE } from '../../assets/spec'
import type { AsteroidState } from '../../engine/types'
import { drawAt, fitText, paintComicText, surface, type CanvasImage } from '../graphics'
import { chooseRockLabel, wrongShake, type RockLabel } from '../layout'
import { TAU } from '../sprites/paint'
import { asteroidImage } from '../textures'
import { COLORS, Z, inkWidth } from '../theme'

export interface AsteroidFrame {
  x: number
  y: number
  time: number
  targeted: boolean
}

export class AsteroidActor extends ex.Actor {
  entityId = 0
  rockRadius = 0
  variant = 0
  private readonly quality: number
  private rock: CanvasImage | null = null
  private rockLabel: RockLabel = { text: '', size: 0, placeholder: true }
  private readonly labelCanvas: ex.Canvas
  private readonly targetRing: ex.Canvas
  private readonly pendingRing: ex.Canvas
  private pending = false
  private wrongFlash = 0
  private frame: AsteroidFrame = { x: 0, y: 0, time: 0, targeted: false }
  /** Seconds the current target lock has lasted (drives the ring's pop-in). */
  private lockTime = 0

  constructor(quality: number) {
    super({ z: Z.asteroids })
    this.quality = quality
    this.labelCanvas = surface(8, 8, quality, (ctx) => this.paintLabel(ctx))
    this.targetRing = surface(8, 8, quality, (ctx) => paintRing(ctx, this.rockRadius + 24, this.rockRadius + 12, [16, 11], COLORS.target))
    this.pendingRing = surface(8, 8, quality, (ctx) => paintRing(ctx, this.rockRadius + 24, this.rockRadius + 10, [0.1, 15], COLORS.pending))
    this.graphics.onPostDraw = (ctx) => this.paint(ctx)
  }

  bind(a: AsteroidState): void {
    this.entityId = a.id
    this.rockRadius = a.radius
    this.variant = a.variant
    this.rock = asteroidImage(a.variant, a.shapeSeed, a.radius, this.quality)
    this.graphics.use(this.rock)
    this.graphics.visible = true
    this.rockLabel = chooseRockLabel(a.problem, a.radius, fitText)
    const labelW = Math.max(a.radius * 2.2, this.rockLabel.size * 3)
    this.labelCanvas.width = labelW
    this.labelCanvas.height = this.rockLabel.size * 1.8 + 12
    const ring = (a.radius + 24) * 2
    for (const c of [this.targetRing, this.pendingRing]) {
      c.width = ring
      c.height = ring
      c.flagDirty()
    }
    this.labelCanvas.flagDirty()
    this.lockTime = 0
  }

  release(): void {
    this.graphics.visible = false
    this.entityId = 0
  }

  sync(a: AsteroidState, frame: AsteroidFrame, dt: number): void {
    this.frame = frame
    this.pending = a.pending
    this.wrongFlash = a.wrongFlash
    this.lockTime = frame.targeted ? this.lockTime + dt : 0
    this.pos.setTo(frame.x + wrongShake(a.wrongFlash, frame.time), frame.y)
    if (this.rock) this.rock.rotation = a.rotation
  }

  private paintLabel(ctx: CanvasRenderingContext2D): void {
    const { text, size, placeholder } = this.rockLabel
    if (!text) return
    const w = this.labelCanvas.width
    const h = this.labelCanvas.height
    paintComicText(ctx, text, w / 2, h / 2, size, {
      color: placeholder ? PALETTE.star : PALETTE.paper,
      strokeWidth: inkWidth(size) + (placeholder ? 1 : 0),
    })
  }

  private paint(ctx: ex.ExcaliburGraphicsContext): void {
    const { time, targeted } = this.frame
    const r = this.rockRadius
    if (this.pending) {
      drawAt(ctx, this.pendingRing, 0, 0, { rotation: time * 3.2 })
    } else if (targeted) {
      const pop = Math.min(1, this.lockTime / 0.18)
      const scale = (1.25 - 0.25 * pop) * (1 + Math.sin(time * 7) * 0.04)
      drawAt(ctx, this.targetRing, 0, 0, { rotation: time * 0.6, scale, opacity: pop })
    }
    // Only the body graphic spins; the label stays upright (it wobbles after a wrong answer).
    const wobble = this.wrongFlash > 0 ? Math.sin(time * 40) * 0.08 : 0
    drawAt(ctx, this.labelCanvas, 0, 0, { rotation: wobble })
    if (this.pending) paintDots(ctx, r, time)
  }
}

const DOT_FILL = ex.Color.fromHex(PALETTE.paper)
const DOT_INK = ex.Color.fromHex(PALETTE.ink)

/** "…" of three bouncing dots under the label while a check is in flight. */
function paintDots(ctx: ex.ExcaliburGraphicsContext, r: number, time: number): void {
  const y = r * 0.9
  for (let i = 0; i < 3; i++) {
    const hop = Math.max(0, Math.sin(time * 9 - i * 0.9)) * 9
    ctx.drawCircle(ex.vec((i - 1) * 22, y - hop), 8, DOT_FILL, DOT_INK, 4)
  }
}

/** Comic ring: ink dashes under coloured dashes (dash [0.1, gap] with round caps = dots). */
function paintRing(ctx: CanvasRenderingContext2D, c: number, radius: number, dash: [number, number], stroke: string): void {
  ctx.lineCap = 'round'
  ctx.setLineDash(dash)
  ctx.beginPath()
  ctx.arc(c, c, radius, 0, TAU)
  ctx.lineWidth = dash[0] < 1 ? 13 : 10
  ctx.strokeStyle = PALETTE.ink
  ctx.stroke()
  ctx.lineWidth = dash[0] < 1 ? 7 : 5
  ctx.strokeStyle = stroke
  ctx.stroke()
  ctx.setLineDash([])
}
