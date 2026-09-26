/**
 * Procedural comic asteroid: lumpy rock, 3-tone shading, craters, ink outline.
 * The centre stays calm so the problem label drawn on top reads clearly.
 */

import { createRng, randInt, type Rng } from '../../../../shared/rng'
import { PALETTE } from '../../assets/spec'
import { context2d, createDomCanvas, drawCrater, TAU, traceSmooth, type CanvasFactory, type CraterColors } from './paint'
import type { AsteroidSpriteOptions } from './types'

type Pt = [number, number]

/** Light comes from the upper left. */
const LIGHT: Pt = [-0.7, -0.7]

export function createAsteroidSprite(
  opts: AsteroidSpriteOptions,
  createCanvas: CanvasFactory = createDomCanvas,
): HTMLCanvasElement {
  const r = Math.max(4, opts.radius)
  const size = Math.ceil(r * 2.3)
  const canvas = createCanvas(size, size)
  const ctx = context2d(canvas)
  const palette = PALETTE.asteroids[((Math.floor(opts.variant) % 4) + 4) % 4]
  const colors: CraterColors = { base: palette[0], shadow: palette[1], highlight: palette[2] }
  const rng = createRng(opts.seed)
  const ink = Math.max(3, r * 0.06)
  const detailInk = Math.max(1.5, ink * 0.6)
  const shape = rockShape(rng, r)

  ctx.translate(size / 2, size / 2)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  traceSmooth(ctx, shape.points)
  ctx.fillStyle = colors.shadow
  ctx.fill()

  ctx.save()
  ctx.clip()
  // Lit body: a big offset disc leaves a shadow crescent on the lower right.
  ctx.beginPath()
  ctx.arc(LIGHT[0] * r * 0.3, LIGHT[1] * r * 0.3, r * 1.02, 0, TAU)
  ctx.fillStyle = colors.base
  ctx.fill()

  if (opts.variant % 4 === 1) drawStrata(ctx, rng, r, colors.shadow, detailInk)

  // Rim highlight hugging the upper-left edge, plus a glint dot.
  const a0 = Math.PI * (1.08 + rng() * 0.06)
  const a1 = Math.PI * (1.34 + rng() * 0.06)
  ctx.beginPath()
  for (let i = 0; i <= 12; i++) {
    const a = a0 + ((a1 - a0) * i) / 12
    const d = shape.radiusAt(a) * r * 0.76
    const p: Pt = [Math.cos(a) * d, Math.sin(a) * d]
    if (i === 0) ctx.moveTo(p[0], p[1])
    else ctx.lineTo(p[0], p[1])
  }
  ctx.strokeStyle = colors.highlight
  ctx.lineWidth = r * 0.09
  ctx.stroke()
  const ag = Math.PI * 1.47
  const dg = shape.radiusAt(ag) * r * 0.74
  ctx.beginPath()
  ctx.arc(Math.cos(ag) * dg, Math.sin(ag) * dg, r * 0.045, 0, TAU)
  ctx.fillStyle = colors.highlight
  ctx.fill()

  const craters = placeCraters(rng, r, shape.radiusAt)
  for (const c of craters) {
    ctx.globalAlpha = c.subtle ? 0.45 : 1
    drawCrater(ctx, c.x, c.y, c.r, colors, {
      ink: detailInk,
      tilt: c.tilt,
      squash: c.squash,
      light: LIGHT,
      outline: !c.subtle,
    })
  }
  ctx.globalAlpha = 1

  if (opts.variant % 4 === 3) drawShards(ctx, rng, r, colors, detailInk, craters)

  drawSpecks(ctx, rng, r, shape.radiusAt, colors, craters)

  ctx.restore()

  traceSmooth(ctx, shape.points)
  ctx.strokeStyle = PALETTE.ink
  ctx.lineWidth = ink
  ctx.stroke()
  return canvas
}

interface RockShape {
  points: Pt[]
  /** Outline radius as a fraction of r at angle a (smooth part, max 1). */
  radiusAt: (a: number) => number
}

/** Lumpy outline from low-frequency harmonics plus per-vertex jitter, normalised to max radius r. */
function rockShape(rng: Rng, r: number): RockShape {
  const phases = [rng() * TAU, rng() * TAU, rng() * TAU]
  const amps = [0.07 + rng() * 0.07, 0.04 + rng() * 0.05, 0.025 + rng() * 0.03]
  const raw = (a: number) =>
    1 + amps[0] * Math.sin(2 * a + phases[0]) + amps[1] * Math.sin(3 * a + phases[1]) + amps[2] * Math.sin(5 * a + phases[2])
  const n = randInt(rng, 13, 18)
  const verts: { a: number; k: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = ((i + (rng() - 0.5) * 0.4) / n) * TAU
    verts.push({ a, k: raw(a) * (1 + (rng() - 0.5) * 0.12) })
  }
  const max = Math.max(...verts.map((v) => v.k))
  // Quadratic smoothing pulls the curve inside the vertices; allow a touch of overshoot.
  const scale = 1.02 / max
  return {
    points: verts.map((v) => [Math.cos(v.a) * v.k * scale * r, Math.sin(v.a) * v.k * scale * r]),
    radiusAt: (a) => Math.min(1, raw(a) * scale * 0.97),
  }
}

interface Crater {
  x: number
  y: number
  r: number
  tilt: number
  squash: number
  subtle: boolean
}

/** 3–6 craters kept off-centre, plus sometimes one faint central dimple. */
function placeCraters(rng: Rng, r: number, radiusAt: (a: number) => number): Crater[] {
  const out: Crater[] = []
  const count = randInt(rng, 3, 6)
  for (let tries = 0; out.length < count && tries < 60; tries++) {
    const big = out.length === 0
    const cr = r * (big ? 0.19 + rng() * 0.08 : 0.08 + rng() * 0.11)
    const a = rng() * TAU
    const edge = radiusAt(a) * r
    const d = r * 0.42 + rng() * (edge - r * 0.42 - cr * 0.35)
    const x = Math.cos(a) * d
    const y = Math.sin(a) * d
    if (out.some((c) => Math.hypot(c.x - x, c.y - y) < (c.r + cr) * 1.15)) continue
    // Keep the label zone (inner ~0.34r) clear of hard crater edges.
    if (d - cr < r * 0.34) continue
    out.push({ x, y, r: cr, tilt: rng() * Math.PI, squash: 0.78 + rng() * 0.17, subtle: false })
  }
  if (rng() < 0.5) {
    const a = rng() * TAU
    const d = r * rng() * 0.12
    out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: r * (0.12 + rng() * 0.05), tilt: rng() * Math.PI, squash: 0.8, subtle: true })
  }
  return out
}

function drawSpecks(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  r: number,
  radiusAt: (a: number) => number,
  colors: CraterColors,
  craters: Crater[],
): void {
  const count = randInt(rng, 5, 9)
  for (let i = 0; i < count; i++) {
    const a = rng() * TAU
    const d = r * 0.3 + rng() * (radiusAt(a) * r * 0.82 - r * 0.3)
    const x = Math.cos(a) * d
    const y = Math.sin(a) * d
    const sr = r * (0.018 + rng() * 0.022)
    if (craters.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + sr * 2)) continue
    ctx.beginPath()
    ctx.arc(x, y, Math.max(0.8, sr), 0, TAU)
    ctx.fillStyle = i % 3 === 2 ? colors.highlight : colors.shadow
    ctx.fill()
  }
}

/** Clay: a few curved sediment bands. */
function drawStrata(ctx: CanvasRenderingContext2D, rng: Rng, r: number, color: string, width: number): void {
  const tilt = (rng() - 0.5) * 0.6
  ctx.save()
  ctx.rotate(tilt)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.globalAlpha *= 0.55
  for (const y of [-0.55, 0.45, 0.68]) {
    const yy = (y + (rng() - 0.5) * 0.1) * r
    ctx.beginPath()
    ctx.moveTo(-r, yy)
    ctx.bezierCurveTo(-r * 0.4, yy - r * 0.12, r * 0.3, yy + r * 0.12, r, yy - r * 0.04)
    ctx.stroke()
  }
  ctx.restore()
}

/** Crystal: small faceted gems studding the rim. */
function drawShards(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  r: number,
  colors: CraterColors,
  ink: number,
  craters: Crater[],
): void {
  const count = randInt(rng, 2, 3)
  for (let i = 0, tries = 0; i < count && tries < 30; tries++) {
    const a = rng() * TAU
    const d = r * (0.55 + rng() * 0.2)
    const x = Math.cos(a) * d
    const y = Math.sin(a) * d
    const s = r * (0.12 + rng() * 0.05)
    if (craters.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + s * 1.4)) continue
    i++
    const rot = rng() * Math.PI
    const tip = (k: number, len: number): Pt => [x + Math.cos(rot + k) * len, y + Math.sin(rot + k) * len]
    const top = tip(-Math.PI / 2, s * 1.5)
    const bottom = tip(Math.PI / 2, s * 1.1)
    const left = tip(Math.PI, s * 0.7)
    const right = tip(0, s * 0.7)
    ctx.beginPath()
    ctx.moveTo(...top)
    ctx.lineTo(...right)
    ctx.lineTo(...bottom)
    ctx.lineTo(...left)
    ctx.closePath()
    ctx.fillStyle = colors.highlight
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(...top)
    ctx.lineTo(...right)
    ctx.lineTo(...bottom)
    ctx.lineTo(x, y)
    ctx.closePath()
    ctx.fillStyle = colors.shadow
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(...top)
    ctx.lineTo(...right)
    ctx.lineTo(...bottom)
    ctx.lineTo(...left)
    ctx.closePath()
    ctx.strokeStyle = PALETTE.ink
    ctx.lineWidth = ink * 0.8
    ctx.stroke()
  }
}
