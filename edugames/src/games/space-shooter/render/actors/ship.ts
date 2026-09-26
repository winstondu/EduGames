/**
 * The player's ship: soft rim glow (the ink outline vanishes on deep space),
 * animated exhaust flame at SHIP_SPRITE.exhaust, the SVG hull, and a shield
 * bubble with hit pips. Mirrored for rtl; blinks while invulnerable.
 */
import * as ex from 'excalibur'
import { PALETTE, SHIP_SPRITE } from '../../assets/spec'
import type { Direction } from '../../engine/types'
import { drawAt, surface, type CanvasImage } from '../graphics'
import { travelSign } from '../layout'
import { drawFlame } from '../sprites/fx'
import { TAU, withAlpha } from '../sprites/paint'
import { glowImage } from '../textures'
import { COLORS, Z } from '../theme'

const FLAME_W = 180
const FLAME_H = 96
/** Flame root inset from the canvas edge it grows away from. */
const FLAME_PAD = 14
const FLAME_SIZE = 46
const SHIELD_W = 216
const SHIELD_H = 168

export interface ShipFrame {
  x: number
  y: number
  /** Target lane minus eased lane: tilts the nose toward the move. */
  laneDelta: number
  time: number
  invulnerable: number
  shield: number
  boosted: boolean
  visible: boolean
}

export class ShipActor extends ex.Actor {
  private readonly sign: 1 | -1
  private readonly hull: CanvasImage | null
  private readonly glow = glowImage('#9cc4ff', 250, 170, 0.42)
  private readonly shieldGlow = glowImage(COLORS.shield, 280, 220, 0.3)
  private readonly flame: ex.Canvas
  private readonly bubble: ex.Canvas
  private frame: ShipFrame = { x: 0, y: 0, laneDelta: 0, time: 0, invulnerable: 0, shield: 0, boosted: false, visible: true }
  private shieldDrawn = -1

  constructor(direction: Direction, quality: number, hull: CanvasImage | null) {
    super({ z: Z.ship })
    this.sign = travelSign(direction)
    this.hull = hull
    if (hull) hull.flipHorizontal = direction === 'rtl'
    const dir = this.sign
    const rootX = dir === 1 ? FLAME_W - FLAME_PAD : FLAME_PAD
    this.flame = surface(FLAME_W, FLAME_H, quality, (ctx) =>
      drawFlame(ctx, { x: rootX, y: FLAME_H / 2, dir, size: FLAME_SIZE, time: this.frame.time, boosted: this.frame.boosted }),
    )
    this.bubble = surface(SHIELD_W, SHIELD_H, quality, (ctx) => paintShield(ctx, this.frame.shield))
    this.graphics.forceOnScreen = true
    this.graphics.onPostDraw = (ctx) => this.paint(ctx)
  }

  sync(frame: ShipFrame): void {
    this.frame = frame
    this.pos.setTo(frame.x, frame.y)
    this.flame.flagDirty()
    if (frame.shield !== this.shieldDrawn) {
      this.shieldDrawn = frame.shield
      this.bubble.flagDirty()
    }
  }

  private paint(ctx: ex.ExcaliburGraphicsContext): void {
    const f = this.frame
    if (!f.visible) return
    const s = this.sign
    const bob = Math.sin(f.time * 2.6) * 2.5
    const tilt = Math.max(-1, Math.min(1, f.laneDelta)) * 0.2 * s
    const blinkOff = f.invulnerable > 0 && Math.floor(f.time * 12) % 2 === 1
    ctx.save()
    ctx.translate(0, bob)
    ctx.opacity = ctx.opacity * (blinkOff ? 0.3 : 1)
    drawAt(ctx, this.glow, -6 * s, 0, { opacity: 0.9 })
    ctx.save()
    ctx.rotate(tilt)
    const rootX = s * (SHIP_SPRITE.exhaust.x - SHIP_SPRITE.width / 2)
    const rootY = SHIP_SPRITE.exhaust.y - SHIP_SPRITE.height / 2
    drawAt(ctx, this.flame, rootX + s * (FLAME_PAD - FLAME_W / 2), rootY)
    if (this.hull) drawAt(ctx, this.hull, 0, 0)
    ctx.restore()
    ctx.restore()
    if (f.shield > 0) {
      const pulse = 1 + Math.sin(f.time * 4) * 0.025
      drawAt(ctx, this.shieldGlow, 0, bob, { opacity: 0.8 })
      drawAt(ctx, this.bubble, 0, bob, { scale: pulse, opacity: 0.92 })
    }
  }
}

/** Translucent comic bubble with one pip per remaining shield hit. */
function paintShield(ctx: CanvasRenderingContext2D, hits: number): void {
  if (hits <= 0) return
  const cx = SHIELD_W / 2
  const cy = SHIELD_H / 2 - 6
  const rx = SHIELD_W / 2 - 14
  const ry = SHIELD_H / 2 - 22
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU)
  ctx.fillStyle = withAlpha(COLORS.shield, 0.16)
  ctx.fill()
  ctx.lineWidth = 7
  ctx.strokeStyle = withAlpha(PALETTE.ink, 0.7)
  ctx.stroke()
  ctx.lineWidth = 3.5
  ctx.strokeStyle = COLORS.shield
  ctx.stroke()
  // Glassy highlight on the upper-left rim.
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx - 12, ry - 10, 0, Math.PI * 1.08, Math.PI * 1.42)
  ctx.lineWidth = 5
  ctx.strokeStyle = withAlpha('#ffffff', 0.7)
  ctx.stroke()
  // Pips along the bottom rim.
  const n = Math.min(hits, 6)
  const gap = 20
  for (let i = 0; i < n; i++) {
    const px = cx + (i - (n - 1) / 2) * gap
    const py = cy + ry + 2
    ctx.beginPath()
    ctx.arc(px, py, 7, 0, TAU)
    ctx.fillStyle = COLORS.shield
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = PALETTE.ink
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(px - 2, py - 2, 2, 0, TAU)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }
}
