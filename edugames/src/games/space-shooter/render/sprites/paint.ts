/**
 * Small Canvas 2D helpers shared by the procedural sprite modules. Plain
 * canvas API only so the art can be rendered headlessly (tests, previews).
 */

import { PALETTE } from '../../assets/spec'

export const TAU = Math.PI * 2

/**
 * Creates a blank canvas of the given device-pixel size. Callers outside the
 * browser (tests, preview scripts) pass their own, e.g. @napi-rs/canvas cast
 * to HTMLCanvasElement.
 */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement

export const createDomCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  return ctx
}

/** Stable 32-bit hash for seeding from strings (FNV-1a). */
export function hashString(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Closed smooth path through points (quadratic curves via midpoints). */
export function traceSmooth(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]): void {
  const n = pts.length
  const mid = (a: readonly [number, number], b: readonly [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const start = mid(pts[n - 1], pts[0])
  ctx.beginPath()
  ctx.moveTo(start[0], start[1])
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n])
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1])
  }
  ctx.closePath()
}

export interface CraterColors {
  base: string
  shadow: string
  highlight: string
}

/**
 * Comic crater lit from `light` (unit-ish vector pointing toward the light):
 * shadowed bowl wall on the lit side, pale rim on the far side, ink ring.
 */
export function drawCrater(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  colors: CraterColors,
  opts: { ink: number; tilt?: number; squash?: number; light?: readonly [number, number]; outline?: boolean },
): void {
  const tilt = opts.tilt ?? 0
  const squash = opts.squash ?? 0.85
  const [lx, ly] = opts.light ?? [-0.7, -0.7]
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(x, y, r, r * squash, tilt, 0, TAU)
  ctx.fillStyle = colors.shadow
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.beginPath()
  ctx.ellipse(x - lx * r * 0.45, y - ly * r * 0.45, r * 0.84, r * squash * 0.84, tilt, 0, TAU)
  ctx.fillStyle = colors.base
  ctx.fill()
  ctx.restore()
  // Pale rim on the side away from the light.
  const away = Math.atan2(-ly, -lx)
  ctx.beginPath()
  ctx.ellipse(x, y, r + opts.ink * 0.9, r * squash + opts.ink * 0.9, tilt, away - 0.9, away + 0.9)
  ctx.strokeStyle = colors.highlight
  ctx.lineWidth = opts.ink * 1.1
  ctx.lineCap = 'round'
  ctx.stroke()
  if (opts.outline !== false) {
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * squash, tilt, 0, TAU)
    ctx.strokeStyle = PALETTE.ink
    ctx.lineWidth = opts.ink
    ctx.stroke()
  }
  ctx.restore()
}

/** Four-point comic sparkle centred at x,y with arm length r. */
export function traceSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const k = r * 0.14
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.quadraticCurveTo(x + k, y - k, x + r, y)
  ctx.quadraticCurveTo(x + k, y + k, x, y + r)
  ctx.quadraticCurveTo(x - k, y + k, x - r, y)
  ctx.quadraticCurveTo(x - k, y - k, x, y - r)
  ctx.closePath()
}

/** '#rrggbb' + alpha → rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
