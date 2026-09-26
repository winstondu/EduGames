/**
 * Canvas 2D renderer for `$…$` math text (plain Canvas API, no engine
 * imports). Lays the parse tree out into glyph runs and polylines (fraction
 * bars, radicals), cached per font + text, then draws them optionally with a
 * comic outline: every stroke is painted before any fill so outlines never
 * cut into neighbouring glyphs.
 *
 *   drawMathText(ctx, '$\\frac{3}{4} + x^2$', cx, cy, {
 *     fontFamily: '"Comic Neue", sans-serif', size: 28, weight: 700,
 *     color: '#fff6e0', align: 'center', baseline: 'middle', stroke: { color: '#1b1b2f', width: 4 },
 *   })
 */
import { parseMathText, type MathNode } from './parse'

export interface MathFontOptions {
  /** CSS font-family list, e.g. '"Comic Neue", sans-serif'. */
  fontFamily: string
  /** Base font size in px. */
  size: number
  /** CSS font weight (default 400). */
  weight?: number | string
}

export interface MathMetrics {
  width: number
  /** Extent above the alphabetic baseline (positive). */
  ascent: number
  /** Extent below the baseline (positive). */
  descent: number
}

export interface DrawMathOptions extends MathFontOptions {
  color: string
  /** Horizontal anchor at `x` (default 'left'). */
  align?: 'left' | 'center' | 'right'
  /** 'alphabetic' (default): `y` is the baseline; 'middle': the box is centred on `y`. */
  baseline?: 'alphabetic' | 'middle'
  /** Outline drawn under the fill; `width` is the visible outline thickness in px. */
  stroke?: { color: string; width: number }
}

/** Minimal context surface used here (a real CanvasRenderingContext2D satisfies it). */
export type MathCanvasContext = Pick<
  CanvasRenderingContext2D,
  | 'font'
  | 'measureText'
  | 'save'
  | 'restore'
  | 'fillText'
  | 'strokeText'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineJoin'
  | 'lineCap'
  | 'textAlign'
  | 'textBaseline'
>

/** Glyph run: `x`, `y` are the left end of its baseline, relative to the layout origin (y down). */
interface TextPrim {
  kind: 'text'
  text: string
  x: number
  y: number
  font: string
}

/** Polyline of flat [x0, y0, x1, y1, …] points. */
interface LinePrim {
  kind: 'line'
  points: number[]
  width: number
}

type Prim = TextPrim | LinePrim

interface Box extends MathMetrics {
  prims: Prim[]
}

export interface MathLayout extends MathMetrics {
  prims: readonly Prim[]
}

// Font-independent vertical metrics (fractions of the font size) keep layouts
// stable and centring predictable across fonts.
const ASCENT = 0.74
const DESCENT = 0.22
/** Height of the maths axis (fraction bars, − and +) above the baseline. */
const AXIS = 0.27
const SCRIPT_SCALE = 0.7
const FRAC_SCALE = 0.82
const MIN_SCALE = 0.45
const SPACE = { bin: 0.22, rel: 0.28, punct: 0.17 }

type Measure = (text: string, font: string) => number

function fontString(size: number, weight: number | string, family: string, italic: boolean): string {
  return `${italic ? 'italic ' : ''}${weight} ${Math.round(size * 100) / 100}px ${family}`
}

class Layouter {
  private readonly measure: Measure
  private readonly family: string
  private readonly weight: number | string
  private readonly minSize: number
  private readonly lineScale: number

  constructor(measure: Measure, opts: MathFontOptions) {
    this.measure = measure
    this.family = opts.fontFamily
    this.weight = opts.weight ?? 400
    this.minSize = opts.size * MIN_SCALE
    this.lineScale = Number(this.weight) >= 600 ? 0.075 : 0.06
  }

  private glyphs(text: string, size: number, italic: boolean): Box {
    const font = fontString(size, this.weight, this.family, italic)
    return {
      width: this.measure(text, font),
      ascent: size * ASCENT,
      descent: size * DESCENT,
      prims: [{ kind: 'text', text, x: 0, y: 0, font }],
    }
  }

  private thickness(size: number): number {
    return Math.max(1, size * this.lineScale)
  }

  /** Lay out a top-level string (prose + math segments). */
  text(input: string, size: number): Box {
    const row = new Row()
    for (const node of parseMathText(input)) {
      if (node.type === 'text') row.place(this.glyphs(node.text, size, false))
      else row.place(this.list(node.children, size))
    }
    return row.box()
  }

  list(nodes: readonly MathNode[], size: number): Box {
    const row = new Row()
    const scriptSize = Math.max(this.minSize, size * SCRIPT_SCALE)
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      switch (node.type) {
        case 'text':
        case 'num':
          row.place(this.glyphs(node.text, size, false))
          break
        case 'var':
          row.place(this.glyphs(node.text, size, true))
          // Italic overhang: nudge whatever follows (scripts included).
          if (i < nodes.length - 1) row.advance(size * 0.04)
          break
        case 'op': {
          const gap = node.kind === 'bin' || node.kind === 'rel' ? SPACE[node.kind] * size : 0
          row.advance(gap)
          row.place(this.glyphs(node.text, size, false))
          row.advance(node.kind === 'punct' ? SPACE.punct * size : gap)
          break
        }
        case 'space':
          row.advance(node.em * size)
          break
        case 'sup': {
          const box = this.list(node.children, scriptSize)
          const prev = row.last
          const shift = Math.max(size * 0.42, (prev?.ascent ?? 0) - box.ascent * 0.55)
          row.place(box, -shift)
          break
        }
        case 'sub': {
          const box = this.list(node.children, scriptSize)
          const prev = row.last
          const shift = Math.max(size * 0.2, (prev?.descent ?? 0) - box.descent * 0.5)
          row.place(box, shift)
          break
        }
        case 'frac':
          row.advance(size * 0.08)
          row.place(this.frac(node.num, node.den, size))
          row.advance(size * 0.08)
          break
        case 'sqrt':
          row.place(this.sqrt(node.children, node.index, size))
          break
      }
    }
    return row.box()
  }

  private frac(numNodes: readonly MathNode[], denNodes: readonly MathNode[], size: number): Box {
    const inner = Math.max(this.minSize, size * FRAC_SCALE)
    const num = this.list(numNodes, inner)
    const den = this.list(denNodes, inner)
    const thick = this.thickness(size)
    const gap = size * 0.1
    const pad = size * 0.08
    const width = Math.max(num.width, den.width, size * 0.4) + pad * 2
    const axis = size * AXIS
    const numBase = -(axis + thick / 2 + gap + num.descent)
    const denBase = -axis + thick / 2 + gap + den.ascent
    const prims: Prim[] = [
      ...offset(num.prims, (width - num.width) / 2, numBase),
      ...offset(den.prims, (width - den.width) / 2, denBase),
      { kind: 'line', points: [pad * 0.5, -axis, width - pad * 0.5, -axis], width: thick },
    ]
    return { width, ascent: -numBase + num.ascent, descent: Math.max(0, denBase + den.descent), prims }
  }

  private sqrt(children: readonly MathNode[], indexNodes: readonly MathNode[] | undefined, size: number): Box {
    const body = this.list(children, size)
    const thick = this.thickness(size)
    const gap = size * 0.12
    const top = Math.max(body.ascent, size * ASCENT) + gap + thick / 2
    const bottom = Math.max(body.descent, size * 0.05)
    let lead = 0
    const prims: Prim[] = []
    if (indexNodes?.length) {
      const index = this.list(indexNodes, Math.max(this.minSize, size * 0.5))
      lead = Math.max(0, index.width - size * 0.28)
      prims.push(...offset(index.prims, 0, -size * 0.42))
    }
    const hookX = lead
    const vX = lead + size * 0.28
    const riseX = lead + size * 0.5
    const bodyX = riseX + size * 0.06
    const end = bodyX + body.width + size * 0.06
    prims.push(
      {
        kind: 'line',
        points: [hookX, -size * 0.28, hookX + size * 0.1, -size * 0.34, vX, bottom, riseX, -top, end, -top],
        width: thick,
      },
      ...offset(body.prims, bodyX, 0),
    )
    return { width: end + size * 0.04, ascent: top + thick / 2, descent: bottom + thick / 2, prims }
  }
}

/** Accumulates boxes left to right on a shared baseline. */
class Row {
  private x = 0
  private ascent = 0
  private descent = 0
  private readonly prims: Prim[] = []
  last: MathMetrics | null = null

  advance(dx: number): void {
    this.x += dx
  }

  /** Place a box with its baseline shifted by `dy` (negative = up). */
  place(box: Box, dy = 0): void {
    this.prims.push(...offset(box.prims, this.x, dy))
    this.x += box.width
    this.ascent = Math.max(this.ascent, box.ascent - dy)
    this.descent = Math.max(this.descent, box.descent + dy)
    this.last = box
  }

  box(): Box {
    return { width: this.x, ascent: this.ascent, descent: this.descent, prims: this.prims }
  }
}

function offset(prims: readonly Prim[], dx: number, dy: number): Prim[] {
  if (!dx && !dy) return prims.slice()
  return prims.map((p) =>
    p.kind === 'text'
      ? { ...p, x: p.x + dx, y: p.y + dy }
      : { ...p, points: p.points.map((v, i) => v + (i % 2 ? dy : dx)) },
  )
}

// ── cache ──────────────────────────────────────────────────────────────────

const CACHE_LIMIT = 512
const cache = new Map<string, MathLayout>()

/**
 * Lay out `text` (prose with `$…$` math). Cached per font + text, so calling
 * it every frame for the same label is cheap. `ctx` is only used to measure.
 */
export function layoutMathText(ctx: Pick<MathCanvasContext, 'font' | 'measureText'>, text: string, opts: MathFontOptions): MathLayout {
  const key = `${opts.fontFamily}|${opts.weight ?? 400}|${opts.size}|${text}`
  const hit = cache.get(key)
  if (hit) return hit
  const saved = ctx.font
  let current = saved
  const measure: Measure = (t, font) => {
    if (font !== current) ctx.font = current = font
    return ctx.measureText(t).width
  }
  const box = new Layouter(measure, opts).text(text, opts.size)
  ctx.font = saved
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, box)
  return box
}

/** Drop cached layouts (e.g. after a web font finishes loading and widths change). */
export function clearMathTextCache(): void {
  cache.clear()
}

export function measureMathText(ctx: Pick<MathCanvasContext, 'font' | 'measureText'>, text: string, opts: MathFontOptions): MathMetrics {
  const { width, ascent, descent } = layoutMathText(ctx, text, opts)
  return { width, ascent, descent }
}

/** Largest size ≤ opts.size (and ≥ minSize) at which `text` fits in `maxWidth`. */
export function fitMathTextSize(
  ctx: Pick<MathCanvasContext, 'font' | 'measureText'>,
  text: string,
  opts: MathFontOptions & { maxWidth: number; minSize?: number },
): number {
  const { width } = layoutMathText(ctx, text, opts)
  if (width <= opts.maxWidth || width <= 0) return opts.size
  // Layout scales linearly with size (up to 1px line minimums), so one step suffices.
  return Math.max(opts.minSize ?? 0, Math.floor(opts.size * (opts.maxWidth / width) * 100) / 100)
}

/** Draw `text` at (x, y); returns its metrics. Leaves the context state unchanged. */
export function drawMathText(ctx: MathCanvasContext, text: string, x: number, y: number, opts: DrawMathOptions): MathMetrics {
  const layout = layoutMathText(ctx, text, opts)
  const { width, ascent, descent, prims } = layout
  const ox = opts.align === 'center' ? x - width / 2 : opts.align === 'right' ? x - width : x
  const oy = opts.baseline === 'middle' ? y + (ascent - descent) / 2 : y

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (opts.stroke && opts.stroke.width > 0) {
    ctx.strokeStyle = opts.stroke.color
    paint(ctx, prims, ox, oy, opts.stroke.width * 2, true)
  }
  ctx.fillStyle = opts.color
  ctx.strokeStyle = opts.color
  paint(ctx, prims, ox, oy, 0, false)
  ctx.restore()
  return { width, ascent, descent }
}

function paint(ctx: MathCanvasContext, prims: readonly Prim[], ox: number, oy: number, extra: number, outline: boolean): void {
  for (const p of prims) {
    if (p.kind === 'text') {
      ctx.font = p.font
      if (outline) {
        ctx.lineWidth = extra
        ctx.strokeText(p.text, ox + p.x, oy + p.y)
      } else {
        ctx.fillText(p.text, ox + p.x, oy + p.y)
      }
    } else {
      ctx.lineWidth = p.width + extra
      ctx.beginPath()
      ctx.moveTo(ox + p.points[0], oy + p.points[1])
      for (let i = 2; i < p.points.length; i += 2) ctx.lineTo(ox + p.points[i], oy + p.points[i + 1])
      ctx.stroke()
    }
  }
}
