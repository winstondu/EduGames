/**
 * Static comic space backdrop (gradient, nebulae, sparkle stars, big cratered
 * planet on the leading edge, dashed lane dividers) and a per-frame parallax
 * starfield layer drawn on top of it.
 */

import { createRng, randInt, type Rng } from '../../../../shared/rng'
import { PALETTE } from '../../assets/spec'
import { context2d, createDomCanvas, drawCrater, TAU, traceSparkle, withAlpha, type CanvasFactory, type CraterColors } from './paint'
import type { BackgroundOptions, StarfieldFrame } from './types'

const PLANET: CraterColors = { base: '#e0553a', shadow: '#a8352b', highlight: '#ff8f5e' }
const NEBULA = ['#3a2a6e', '#1f3f78', '#5a2a5e']

export function createBackground(opts: BackgroundOptions, createCanvas: CanvasFactory = createDomCanvas): HTMLCanvasElement {
  const w = Math.max(1, Math.round(opts.width))
  const h = Math.max(1, Math.round(opts.height))
  const canvas = createCanvas(w, h)
  const ctx = context2d(canvas)
  const rng = createRng(opts.seed)
  /** Size unit: 1 at a 900px-tall landscape screen. */
  const u = Math.min(w, h) / 900

  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, PALETTE.space)
  sky.addColorStop(1, PALETTE.spaceLight)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  drawNebulae(ctx, rng, w, h)
  drawDots(ctx, rng, w, h, u)
  drawSparkles(ctx, rng, w, h, u)
  drawPlanet(ctx, rng, w, h, opts.direction)
  drawLanes(ctx, w, u, opts.laneDividers)
  return canvas
}

function drawNebulae(ctx: CanvasRenderingContext2D, rng: Rng, w: number, h: number): void {
  const count = randInt(rng, 3, 5)
  for (let i = 0; i < count; i++) {
    const cx = rng() * w
    const cy = rng() * h * 0.8
    const color = NEBULA[i % NEBULA.length]
    // A blotch is a cluster of soft discs so it reads lumpy, not circular.
    const blobs = randInt(rng, 3, 5)
    const spread = Math.min(w, h) * (0.12 + rng() * 0.12)
    for (let j = 0; j < blobs; j++) {
      const x = cx + (rng() - 0.5) * spread * 1.6
      const y = cy + (rng() - 0.5) * spread * 0.8
      const r = spread * (0.5 + rng() * 0.6)
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, withAlpha(color, 0.3))
      g.addColorStop(0.6, withAlpha(color, 0.13))
      g.addColorStop(1, withAlpha(color, 0))
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
  }
}

function drawDots(ctx: CanvasRenderingContext2D, rng: Rng, w: number, h: number, u: number): void {
  const count = Math.round((w * h) / 5500)
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.25 + rng() * 0.55
    ctx.fillStyle = rng() < 0.3 ? PALETTE.star : PALETTE.paper
    ctx.beginPath()
    ctx.arc(rng() * w, rng() * h, Math.max(0.6, u * (0.8 + rng() * 1.4)), 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawSparkles(ctx: CanvasRenderingContext2D, rng: Rng, w: number, h: number, u: number): void {
  const count = Math.max(6, Math.round((w * h) / 70000))
  const placed: [number, number][] = []
  ctx.lineJoin = 'round'
  for (let i = 0, tries = 0; i < count && tries < count * 10; tries++) {
    const x = rng() * w
    const y = rng() * h
    const big = rng() < 0.25
    const r = u * (big ? 14 + rng() * 10 : 5 + rng() * 6)
    if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < Math.min(w, h) * 0.07)) continue
    placed.push([x, y])
    i++
    traceSparkle(ctx, x, y, r)
    ctx.fillStyle = PALETTE.star
    ctx.fill()
    if (big) {
      ctx.strokeStyle = PALETTE.ink
      ctx.lineWidth = Math.max(1.5, r * 0.16)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, y, r * 0.12, 0, TAU)
      ctx.fillStyle = PALETTE.paper
      ctx.fill()
    }
  }
}

/** Big red planet peeking up from the bottom on the leading-edge side. */
function drawPlanet(ctx: CanvasRenderingContext2D, rng: Rng, w: number, h: number, direction: 'ltr' | 'rtl'): void {
  const m = Math.min(w, h)
  const R = m * 0.5
  const side = direction === 'ltr' ? 1 : -1
  const cx = direction === 'ltr' ? w * 0.1 : w * 0.9
  const cy = h + R - m * 0.3
  const ink = Math.max(3, m * 0.006)
  /** Lit from the scene interior (upper right for ltr). */
  const light: [number, number] = [0.6 * side, -0.8]

  const halo = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.25)
  halo.addColorStop(0, withAlpha('#ff7a4a', 0.28))
  halo.addColorStop(1, withAlpha('#ff7a4a', 0))
  ctx.fillStyle = halo
  ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6)

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, TAU)
  ctx.fillStyle = PLANET.shadow
  ctx.fill()
  ctx.clip()
  ctx.beginPath()
  ctx.arc(cx + light[0] * R * 0.16, cy + light[1] * R * 0.16, R * 0.99, 0, TAU)
  ctx.fillStyle = PLANET.base
  ctx.fill()

  // Soft latitude bands for a gas-giant-ish comic feel.
  ctx.strokeStyle = withAlpha(PLANET.shadow, 0.45)
  ctx.lineWidth = ink * 1.6
  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    const y = cy - R * (0.55 + i * 0.14 + rng() * 0.04)
    ctx.beginPath()
    ctx.moveTo(cx - R, y + R * 0.05)
    ctx.quadraticCurveTo(cx, y - R * 0.06, cx + R, y + R * 0.05)
    ctx.stroke()
  }

  // Craters on the visible cap (upper arc), smaller toward the limb.
  const craters: [number, number, number][] = []
  const want = randInt(rng, 8, 12)
  for (let tries = 0; craters.length < want && tries < 120; tries++) {
    const a = -Math.PI / 2 + (rng() - 0.5) * Math.PI * 0.9
    const d = R * (0.3 + rng() * 0.62)
    const x = cx + Math.cos(a) * d
    const y = cy + Math.sin(a) * d
    const cr = R * (0.05 + rng() * 0.1) * (1.2 - d / R)
    if (y + cr > h || y - cr < cy - R) continue
    if (craters.some(([px, py, pr]) => Math.hypot(px - x, py - y) < (pr + cr) * 1.25)) continue
    craters.push([x, y, cr])
  }
  for (const [x, y, cr] of craters) {
    // Foreshorten toward the limb.
    const dx = (x - cx) / R
    const dy = (y - cy) / R
    const squash = Math.max(0.45, Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)) * 0.9 + 0.2)
    drawCrater(ctx, x, y, cr, PLANET, { ink: ink * 0.65, tilt: Math.atan2(dy, dx) + Math.PI / 2, squash, light })
  }

  // Rim light along the lit limb.
  const la = Math.atan2(light[1], light[0])
  ctx.strokeStyle = PLANET.highlight
  ctx.lineWidth = ink * 1.8
  for (const [from, to] of [[-0.42, 0.12], [0.22, 0.34]]) {
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.9, la + from * side, la + to * side, side < 0)
    ctx.stroke()
  }
  ctx.restore()

  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, TAU)
  ctx.strokeStyle = PALETTE.ink
  ctx.lineWidth = ink * 1.4
  ctx.stroke()
}

function drawLanes(ctx: CanvasRenderingContext2D, w: number, u: number, ys: readonly number[]): void {
  const lw = Math.max(2, u * 3.5)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.setLineDash([u * 26, u * 20])
  for (const y of ys) {
    ctx.beginPath()
    ctx.moveTo(0, y + lw * 0.6)
    ctx.lineTo(w, y + lw * 0.6)
    ctx.strokeStyle = withAlpha(PALETTE.ink, 0.8)
    ctx.lineWidth = lw * 1.8
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.strokeStyle = withAlpha(PALETTE.paper, 0.28)
    ctx.lineWidth = lw
    ctx.stroke()
  }
  ctx.restore()
}

interface FieldStar {
  x: number
  y: number
  /** Speed as a fraction of width per second. */
  speed: number
  r: number
  phase: number
  sparkle: boolean
  color: string
}

const fieldCache = new Map<string, FieldStar[]>()

function fieldStars(seed: number, w: number, h: number): FieldStar[] {
  const key = `${seed}:${w}:${h}`
  const hit = fieldCache.get(key)
  if (hit) return hit
  const rng = createRng(seed ^ 0x5eed)
  const u = Math.min(w, h) / 900
  const count = Math.max(12, Math.round((w * h) / 16000))
  const stars: FieldStar[] = []
  for (let i = 0; i < count; i++) {
    const near = rng() < 0.2
    stars.push({
      x: rng() * w,
      y: rng() * h,
      speed: near ? 0.05 + rng() * 0.03 : 0.012 + rng() * 0.02,
      r: u * (near ? 1.6 + rng() * 1.2 : 0.7 + rng() * 0.9),
      phase: rng() * TAU,
      sparkle: near && rng() < 0.35,
      color: rng() < 0.4 ? PALETTE.star : PALETTE.paper,
    })
  }
  if (fieldCache.size > 8) fieldCache.clear()
  fieldCache.set(key, stars)
  return stars
}

/** Parallax star layer; stars drift opposite to travel and wrap around. */
export function drawStarfield(ctx: CanvasRenderingContext2D, frame: StarfieldFrame): void {
  const { width: w, height: h, time } = frame
  const travel = frame.direction === 'ltr' ? 1 : -1
  const margin = Math.min(w, h) * 0.03
  const span = w + margin * 2
  ctx.save()
  for (const s of fieldStars(frame.seed, w, h)) {
    const raw = s.x - travel * s.speed * w * time + margin
    const x = (((raw % span) + span) % span) - margin
    ctx.globalAlpha = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(time * 2.2 + s.phase))
    ctx.fillStyle = s.color
    if (s.sparkle) {
      traceSparkle(ctx, x, s.y, s.r * 3)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.arc(x, s.y, s.r, 0, TAU)
      ctx.fill()
    }
    // Faint speed streak on near stars.
    if (s.speed > 0.04) {
      ctx.globalAlpha *= 0.2
      ctx.fillRect(travel > 0 ? x : x - s.r * 8, s.y - s.r * 0.35, s.r * 8, s.r * 0.7)
    }
  }
  ctx.restore()
}
