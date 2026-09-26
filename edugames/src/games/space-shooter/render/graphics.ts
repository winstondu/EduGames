/**
 * Small Excalibur adapters for the procedural Canvas 2D art: static canvases
 * as Graphics, redrawable ex.Canvas surfaces, comic text, and a helper that
 * draws a Graphic centred with an extra transform from inside onPostDraw.
 */
import * as ex from 'excalibur'
import { drawMathText, fitMathTextSize, measureMathText, type MathCanvasContext } from '../../../shared/mathtext/canvas'
import { PALETTE } from '../assets/spec'
import { FONT_FAMILY, inkWidth } from './theme'

/** A pre-rendered canvas (device pixels) drawn at a logical size. Rotation/flip/opacity come from ex.Graphic. */
export class CanvasImage extends ex.Graphic {
  readonly source: HTMLCanvasElement

  constructor(source: HTMLCanvasElement, width: number, height: number) {
    super({ width, height })
    this.source = source
  }

  protected _drawImage(ctx: ex.ExcaliburGraphicsContext, x: number, y: number): void {
    ctx.drawImage(this.source, 0, 0, this.source.width, this.source.height, x, y, this.width, this.height)
  }

  clone(): CanvasImage {
    return new CanvasImage(this.source, this.width, this.height)
  }
}

/**
 * A redrawable Canvas 2D surface of logical size w×h rasterised at `quality`.
 * It re-rasterises only after `flagDirty()` (call it every frame for animated art).
 */
export function surface(width: number, height: number, quality: number, draw: (ctx: CanvasRenderingContext2D) => void): ex.Canvas {
  return new ex.Canvas({
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
    quality,
    smoothing: true,
    cache: true,
    draw,
  })
}

export interface DrawAtOptions {
  rotation?: number
  scale?: number
  scaleX?: number
  opacity?: number
}

/** Draw `graphic` centred on (x, y) in the current (actor-local) space. */
export function drawAt(ctx: ex.ExcaliburGraphicsContext, graphic: ex.Graphic, x: number, y: number, opts: DrawAtOptions = {}): void {
  ctx.save()
  ctx.translate(x, y)
  if (opts.rotation) ctx.rotate(opts.rotation)
  const s = opts.scale ?? 1
  const sx = (opts.scaleX ?? 1) * s
  if (sx !== 1 || s !== 1) ctx.scale(sx, s)
  if (opts.opacity !== undefined) ctx.opacity = ctx.opacity * Math.max(0, Math.min(1, opts.opacity))
  graphic.draw(ctx, -graphic.width / 2, -graphic.height / 2)
  ctx.restore()
}

let measurer: CanvasRenderingContext2D | null = null

/** Shared 2D context for text measurement. */
export function measureContext(): CanvasRenderingContext2D {
  if (!measurer) {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    measurer = ctx
  }
  return measurer
}

export function comicFont(size: number) {
  return { fontFamily: FONT_FAMILY, size, weight: 700 as const }
}

/** Width of comic (math) text at `size`. */
export function textWidth(text: string, size: number): number {
  return measureMathText(measureContext(), text, comicFont(size)).width
}

/** Largest size ≤ size at which `text` is ≤ maxWidth wide. */
export function fitText(text: string, size: number, maxWidth: number): number {
  return fitMathTextSize(measureContext(), text, { ...comicFont(size), maxWidth, minSize: 1 })
}

export interface ComicTextStyle {
  color?: string
  stroke?: string
  /** Outline width; default scales with size. */
  strokeWidth?: number
}

/** Outlined comic text (may contain $…$ math) centred on (cx, cy). Never mirrored. */
export function paintComicText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number, style: ComicTextStyle = {}): void {
  drawMathText(ctx as MathCanvasContext, text, cx, cy, {
    ...comicFont(size),
    color: style.color ?? PALETTE.paper,
    align: 'center',
    baseline: 'middle',
    stroke: { color: style.stroke ?? PALETTE.ink, width: style.strokeWidth ?? inkWidth(size) },
  })
}

/** A cached surface holding one piece of comic text, sized to fit it. */
export function textSurface(text: string, size: number, quality: number, style: ComicTextStyle = {}): ex.Canvas {
  const stroke = style.strokeWidth ?? inkWidth(size)
  const w = textWidth(text, size) + stroke * 2 + 8
  const h = size * 1.5 + stroke * 2
  return surface(w, h, quality, (ctx) => paintComicText(ctx, text, w / 2, h / 2, size, style))
}

export function color(hex: string, alpha = 1): ex.Color {
  const c = ex.Color.fromHex(hex)
  c.a = alpha
  return c
}
