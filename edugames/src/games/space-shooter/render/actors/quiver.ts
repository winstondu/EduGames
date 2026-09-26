/**
 * The quiver: a comic speech bubble above the ship (tail pointing at it)
 * showing the freeform answer being typed, a blinking caret / "?" while
 * empty, or a "pick 1–4" hint for multiple-choice targets.
 */
import * as ex from 'excalibur'
import { PALETTE } from '../../assets/spec'
import type { Direction, GameState } from '../../engine/types'
import { drawAt, paintComicText, surface, textWidth } from '../graphics'
import { placeBubble, quiverContent, travelSign, type QuiverContent } from '../layout'
import { Z } from '../theme'

const BODY_H = 70
const TAIL = 18
const MARGIN = 8
const TEXT_SIZE = 42
const HINT_SIZE = 32
const MIN_W = 104
const MAX_W = 480

export class QuiverActor extends ex.Actor {
  private readonly sign: 1 | -1
  private readonly canvas: ex.Canvas
  private content: QuiverContent = { mode: 'hidden', text: '', caret: false, above: true }
  private key = ''
  private bodyW = MIN_W
  private popAt = -1
  private time = 0

  constructor(direction: Direction, quality: number) {
    super({ z: Z.quiver })
    this.sign = travelSign(direction)
    this.canvas = surface(MAX_W + MARGIN * 2, BODY_H + TAIL + MARGIN * 2, quality, (ctx) => this.paintBubble(ctx))
    this.graphics.forceOnScreen = true
    this.graphics.onPostDraw = (ctx) => {
      if (this.content.mode === 'hidden') return
      const age = this.time - this.popAt
      const pop = age >= 0 && age < 0.16 ? 1 + 0.14 * Math.sin((age / 0.16) * Math.PI) : 1
      drawAt(ctx, this.canvas, 0, 0, { scale: pop })
    }
  }

  sync(state: GameState, shipX: number, shipY: number, time: number): void {
    this.time = time
    const base = quiverContent(state, time)
    const placement = placeBubble(shipY, BODY_H, TAIL)
    const content: QuiverContent = { ...base, above: placement.above }
    const key = `${content.mode}|${content.text}|${content.mode === 'choice' ? '' : content.caret}|${content.above}`
    if (key !== this.key) {
      if (content.text !== this.content.text && content.mode === 'typing') this.popAt = time
      this.key = key
      this.content = content
      this.bodyW = this.measure(content)
      this.canvas.width = this.bodyW + MARGIN * 2
      this.canvas.flagDirty()
    }
    // Canvas centre sits between body and tail; shift so the body clears the ship.
    const cy = placement.above ? placement.y + TAIL / 2 : placement.y - TAIL / 2
    this.pos.setTo(shipX + this.sign * 26, cy)
  }

  private measure(c: QuiverContent): number {
    if (c.mode === 'hidden') return MIN_W
    const size = c.mode === 'choice' ? HINT_SIZE : TEXT_SIZE
    const w = textWidth(c.text, size) + (c.mode === 'choice' ? 40 : 64)
    return Math.max(MIN_W, Math.min(MAX_W, w))
  }

  private paintBubble(ctx: CanvasRenderingContext2D): void {
    const c = this.content
    if (c.mode === 'hidden') return
    const w = this.bodyW
    const left = MARGIN
    const top = c.above ? MARGIN : MARGIN + TAIL
    const bottom = top + BODY_H
    // Tail points back toward the ship's centre (bubble is shifted 26 px forward).
    const tailBase = left + w / 2 - this.sign * Math.min(26, w / 2 - 30)
    const tipX = tailBase - this.sign * 16
    const tipY = c.above ? bottom + TAIL : top - TAIL
    const baseY = c.above ? bottom : top
    const r = 22
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.roundRect(left, top, w, BODY_H, r)
    ctx.moveTo(tailBase - 14, baseY)
    ctx.lineTo(tipX, tipY)
    ctx.lineTo(tailBase + 14, baseY)
    ctx.lineWidth = 9
    ctx.strokeStyle = PALETTE.ink
    ctx.stroke()
    ctx.fillStyle = c.mode === 'choice' ? '#fff1b8' : PALETTE.paper
    ctx.fill()
    // Re-fill the tail joint so the body outline doesn't cut across it.
    ctx.beginPath()
    ctx.moveTo(tailBase - 11, baseY + (c.above ? -3 : 3))
    ctx.lineTo(tipX, tipY + (c.above ? -5 : 5))
    ctx.lineTo(tailBase + 11, baseY + (c.above ? -3 : 3))
    ctx.fill()
    // Halftone-ish shade along the lower edge for a printed-comic feel.
    ctx.fillStyle = 'rgba(27, 27, 47, 0.08)'
    ctx.beginPath()
    ctx.roundRect(left + 6, bottom - 16, w - 12, 10, 5)
    ctx.fill()

    const cx = left + w / 2
    const cy = top + BODY_H / 2
    if (c.mode === 'choice') {
      paintComicText(ctx, c.text, cx, cy, HINT_SIZE, { color: PALETTE.ink, stroke: PALETTE.paper, strokeWidth: 2 })
      return
    }
    const size = TEXT_SIZE
    const tw = c.mode === 'typing' ? textWidth(c.text, size) : textWidth('?', size)
    const tx = cx - 8
    if (c.mode === 'typing') {
      paintComicText(ctx, c.text, tx, cy, size, { color: PALETTE.ink, stroke: PALETTE.paper, strokeWidth: 2 })
    } else {
      paintComicText(ctx, '?', tx, cy, size, { color: '#b7aec2', stroke: PALETTE.paper, strokeWidth: 2 })
    }
    if (c.caret) {
      ctx.fillStyle = PALETTE.laser
      ctx.beginPath()
      ctx.roundRect(tx + tw / 2 + 6, cy - size * 0.42, 6, size * 0.84, 3)
      ctx.fill()
    }
  }
}
