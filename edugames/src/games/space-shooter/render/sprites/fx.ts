/**
 * Per-frame comic effects drawn straight into the caller's context: hit
 * starburst, wrong-answer fizzle, laser bolt and engine flame. Stateless and
 * deterministic: shape jitter is seeded from the inputs, motion from t/time.
 */

import { createRng } from '../../../../shared/rng'
import { PALETTE } from '../../assets/spec'
import { hashString, TAU, withAlpha } from './paint'
import type { BurstFrame, FizzleFrame, FlameFrame, LaserFrame } from './types'

const BURST_OUTER = '#ff8c1a'
const BURST_TEXT = '#e8322e'
const SMOKE = ['#a3a3b3', '#7b7b8c', '#c9c9d6'] as const

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function easeOutBack(x: number): number {
  const c = 1.9
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
}

/** Comic starburst that pops in, holds, then fades; text fitted inside. */
export function drawBurst(ctx: CanvasRenderingContext2D, f: BurstFrame): void {
  if (!(f.t >= 0 && f.t < 1) || f.size <= 0) return
  const out = clamp01((f.t - 0.7) / 0.3)
  const pop = (f.t < 0.18 ? easeOutBack(f.t / 0.18) : 1 + (f.t - 0.18) * 0.18) * (1 - out * out * 0.5)
  const alpha = 1 - out * out
  const R = (f.size / 2) * pop
  const ink = Math.max(2.5, f.size * 0.035)
  const rng = createRng(hashString(f.text) ^ 0xb0057)
  const spikes = 11 + Math.floor(rng() * 3)
  const jitter = Array.from({ length: spikes * 2 }, () => 0.85 + rng() * 0.3)
  const spin = rng() * TAU

  ctx.save()
  ctx.globalAlpha *= clamp01(alpha)
  ctx.translate(f.x, f.y)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Debris flecks flying outward.
  const flecks = 7
  for (let i = 0; i < flecks; i++) {
    const a = spin + (i / flecks) * TAU + 0.3
    const d = f.size * (0.45 + f.t * 0.45) * jitter[i]
    ctx.beginPath()
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, Math.max(1.5, f.size * 0.03 * (1 - f.t * 0.6)), 0, TAU)
    ctx.fillStyle = i % 2 ? PALETTE.star : BURST_OUTER
    ctx.fill()
    ctx.strokeStyle = PALETTE.ink
    ctx.lineWidth = ink * 0.5
    ctx.stroke()
  }

  ctx.rotate(-0.12 + f.t * 0.1)
  starPath(ctx, spikes, R, R * 0.62, jitter, spin)
  ctx.fillStyle = BURST_OUTER
  ctx.fill()
  ctx.strokeStyle = PALETTE.ink
  ctx.lineWidth = ink
  ctx.stroke()
  starPath(ctx, spikes, R * 0.74, R * 0.5, jitter, spin + Math.PI / spikes)
  ctx.fillStyle = PALETTE.star
  ctx.fill()

  if (f.text) {
    const inner = R * 0.95
    let px = f.size * 0.3 * pop
    ctx.font = `900 ${px}px ${f.font}`
    const wText = ctx.measureText(f.text).width
    if (wText > inner * 1.6) {
      px *= (inner * 1.6) / wText
      ctx.font = `900 ${px}px ${f.font}`
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = Math.max(2, px * 0.16)
    ctx.strokeStyle = PALETTE.ink
    ctx.strokeText(f.text, 0, px * 0.04)
    ctx.fillStyle = BURST_TEXT
    ctx.fillText(f.text, 0, px * 0.04)
  }
  ctx.restore()
}

function starPath(
  ctx: CanvasRenderingContext2D,
  spikes: number,
  outer: number,
  inner: number,
  jitter: readonly number[],
  offset: number,
): void {
  ctx.beginPath()
  for (let i = 0; i < spikes * 2; i++) {
    const a = offset + (i / (spikes * 2)) * TAU
    const r = (i % 2 === 0 ? outer : inner) * jitter[i]
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
}

/** Offsets (x, y, radius) of the smoke puffs as fractions of size. */
const PUFFS: readonly [number, number, number][] = [
  [0, 0.02, 0.24],
  [-0.22, 0.06, 0.17],
  [0.23, 0.05, 0.18],
  [-0.1, -0.16, 0.16],
  [0.13, -0.15, 0.15],
  [0.02, 0.2, 0.14],
]

/** Grey smoke puff that swells and rises, with a wobbly red ✗ popping over it. */
export function drawFizzle(ctx: CanvasRenderingContext2D, f: FizzleFrame): void {
  if (!(f.t >= 0 && f.t < 1) || f.size <= 0) return
  const s = f.size
  const grow = 0.65 + 0.6 * (1 - (1 - f.t) ** 2)
  const out = clamp01((f.t - 0.5) / 0.5)
  const alpha = 1 - out * out
  const ink = Math.max(2, s * 0.03)
  ctx.save()
  ctx.globalAlpha *= clamp01(alpha)
  ctx.translate(f.x, f.y - s * 0.15 * f.t)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Outline pass first, then fills, so the ink traces only the union's edge.
  const puffs = PUFFS.map(([x, y, r], i) => {
    const wob = 1 + 0.06 * Math.sin(f.t * 14 + i * 1.7)
    const drift = 1 + out * 0.9
    const shrink = 1 - out * (0.5 + (i % 3) * 0.15)
    return [x * s * grow * drift, y * s * grow * drift, r * s * grow * wob * shrink] as const
  })
  ctx.fillStyle = PALETTE.ink
  for (const [x, y, r] of puffs) {
    ctx.beginPath()
    ctx.arc(x, y, r + ink, 0, TAU)
    ctx.fill()
  }
  ctx.beginPath()
  for (const [x, y, r] of puffs) {
    ctx.moveTo(x + r, y)
    ctx.arc(x, y, r, 0, TAU)
  }
  ctx.fillStyle = SMOKE[1]
  ctx.fill()
  ctx.save()
  ctx.clip()
  // Lit tops: each puff's fill nudged up-left leaves a shadow underneath.
  ctx.fillStyle = SMOKE[0]
  for (const [x, y, r] of puffs) {
    ctx.beginPath()
    ctx.arc(x - r * 0.12, y - r * 0.2, r * 0.92, 0, TAU)
    ctx.fill()
  }
  ctx.fillStyle = SMOKE[2]
  for (const [x, y, r] of puffs) {
    ctx.beginPath()
    ctx.arc(x - r * 0.38, y - r * 0.42, r * 0.2, 0, TAU)
    ctx.fill()
  }
  ctx.restore()

  // Wobbly ✗.
  const xPop = (f.t < 0.15 ? easeOutBack(f.t / 0.15) : 1) * (1 - out * 0.4)
  const arm = s * 0.24 * xPop
  const strokes: [number, number, number, number][] = [
    [-arm, -arm, arm, arm],
    [arm, -arm, -arm, arm],
  ]
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? PALETTE.ink : PALETTE.bad
    ctx.lineWidth = (pass === 0 ? s * 0.12 + ink * 2 : s * 0.12) * xPop
    strokes.forEach(([x0, y0, x1, y1], k) => {
      const nx = -(y1 - y0)
      const ny = x1 - x0
      const len = Math.hypot(nx, ny) || 1
      ctx.beginPath()
      for (let i = 0; i <= 8; i++) {
        const u = i / 8
        const off = Math.sin(u * Math.PI * 2 + f.t * 18 + k * 2) * s * 0.025 * Math.sin(u * Math.PI)
        const px = x0 + (x1 - x0) * u + (nx / len) * off
        const py = y0 + (y1 - y0) * u + (ny / len) * off
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    })
  }
  ctx.restore()
}

/** Rounded red bolt with a cream core, ink edge and soft glow; head leads in `dir`. */
export function drawLaser(ctx: CanvasRenderingContext2D, f: LaserFrame): void {
  if (f.length <= 0 || f.thickness <= 0) return
  const half = Math.max(0, f.length / 2 - f.thickness / 2)
  const th = f.thickness
  const ink = Math.max(1.5, th * 0.18)
  const flicker = 1 + 0.12 * Math.sin(f.time * 47) + 0.06 * Math.sin(f.time * 83 + 1)
  ctx.save()
  ctx.translate(f.x, f.y)
  ctx.scale(f.dir, 1)
  ctx.lineCap = 'round'

  const line = (x0: number, x1: number, width: number, style: string) => {
    ctx.beginPath()
    ctx.moveTo(x0, 0)
    ctx.lineTo(x1, 0)
    ctx.lineWidth = width
    ctx.strokeStyle = style
    ctx.stroke()
  }
  // Glow, widest and faintest first.
  line(-half * 0.6, half, th * 3 * flicker, withAlpha(PALETTE.laser, 0.12))
  line(-half * 0.8, half, th * 2 * flicker, withAlpha(PALETTE.laser, 0.22))
  // Trailing speed ticks.
  for (const [dy, k] of [[-0.35, 0.5], [0.4, 0.35]] as const) {
    ctx.beginPath()
    ctx.moveTo(-half - f.length * k, dy * th)
    ctx.lineTo(-half - th * 0.4, dy * th)
    ctx.lineWidth = Math.max(1, th * 0.18)
    ctx.strokeStyle = withAlpha(PALETTE.laser, 0.55)
    ctx.stroke()
  }
  const tail = th * 0.2
  ctx.beginPath()
  ctx.moveTo(-half, -tail)
  ctx.lineTo(half, -th / 2)
  ctx.arc(half, 0, th / 2, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(-half, tail)
  ctx.arc(-half, 0, tail, Math.PI / 2, (Math.PI * 3) / 2)
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.lineWidth = ink * 2
  ctx.strokeStyle = PALETTE.ink
  ctx.stroke()
  ctx.fillStyle = PALETTE.laser
  ctx.fill()
  line(-half * 0.35, half, th * 0.36 * flicker, PALETTE.laserCore)
  // Hot tip.
  ctx.beginPath()
  ctx.arc(half, 0, th * 0.26, 0, TAU)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()
}

/** Flickering comic flame from the exhaust, pointing away from travel. */
export function drawFlame(ctx: CanvasRenderingContext2D, f: FlameFrame): void {
  if (f.size <= 0) return
  const colors = f.boosted ? ['#3ba7ff', '#9fdcff', '#ffffff'] : ['#ff7b1c', PALETTE.star, PALETTE.paper]
  const baseLen = f.size * (f.boosted ? 1.8 : 1)
  const halfH = f.size * (f.boosted ? 0.34 : 0.32)
  const ink = Math.max(2, f.size * 0.06)
  const tm = f.time
  ctx.save()
  ctx.translate(f.x, f.y)
  ctx.scale(-f.dir, 1)
  ctx.lineJoin = 'round'
  const layers: [number, number, number][] = [
    [1, 1, 0],
    [0.68, 0.64, 1.7],
    [0.38, 0.34, 3.1],
  ]
  layers.forEach(([lk, hk, phase], i) => {
    const flick = 1 + 0.13 * Math.sin(tm * 31 + phase) + 0.08 * Math.sin(tm * 53 + phase * 2)
    const len = baseLen * lk * flick
    const hh = halfH * hk
    const wob = Math.sin(tm * 23 + phase) * hh * 0.35
    ctx.beginPath()
    ctx.moveTo(0, -hh)
    // Upper edge with a side tongue, then tip, then lower edge back to the root.
    ctx.bezierCurveTo(len * 0.3, -hh * 1.1, len * 0.45, -hh * 0.9, len * 0.58, -hh * 0.95 + wob * 0.5)
    ctx.quadraticCurveTo(len * 0.62, -hh * 0.4, len * 0.72, -hh * 0.35 + wob)
    ctx.quadraticCurveTo(len * 0.9, -hh * 0.2, len, wob)
    ctx.quadraticCurveTo(len * 0.75, hh * 0.45 + wob, len * 0.55, hh * 0.9 - wob * 0.4)
    ctx.bezierCurveTo(len * 0.35, hh * 1.1, len * 0.15, hh * 1.05, 0, hh)
    ctx.quadraticCurveTo(-hh * 0.7, 0, 0, -hh)
    ctx.closePath()
    ctx.fillStyle = colors[i]
    ctx.fill()
    if (i === 0) {
      ctx.strokeStyle = PALETTE.ink
      ctx.lineWidth = ink
      ctx.stroke()
    }
  })
  if (f.boosted) {
    // Trailing sparks.
    const alpha = ctx.globalAlpha
    for (let k = 0; k < 3; k++) {
      const u = (tm * 2.5 + k / 3) % 1
      ctx.globalAlpha = alpha * (1 - u)
      ctx.beginPath()
      ctx.arc(baseLen * (0.9 + u * 0.6), Math.sin(k * 2.1 + tm * 9) * halfH * 0.8, f.size * 0.05, 0, TAU)
      ctx.fillStyle = colors[1]
      ctx.fill()
    }
  }
  ctx.restore()
}
