import { beforeEach, describe, expect, test } from 'bun:test'
import { clearMathTextCache, drawMathText, fitMathTextSize, measureMathText, type MathCanvasContext } from './canvas'

/** Fake 2D context: every glyph is 0.5em wide; records draw calls. */
function fakeCtx() {
  const calls: string[] = []
  let measures = 0
  const ctx = {
    font: '10px sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    measureText(text: string) {
      measures++
      const size = Number(/([\d.]+)px/.exec(ctx.font)![1])
      return { width: [...text].length * size * 0.5 } as TextMetrics
    },
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    fillText: (t: string, x: number, y: number) => calls.push(`fill ${t} ${x.toFixed(1)} ${y.toFixed(1)} ${ctx.font}`),
    strokeText: (t: string) => calls.push(`strokeText ${t} lw=${ctx.lineWidth}`),
    beginPath: () => calls.push('path'),
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => calls.push(`stroke lw=${ctx.lineWidth.toFixed(2)} ${String(ctx.strokeStyle)}`),
  }
  return { ctx: ctx as unknown as MathCanvasContext, calls, measures: () => measures }
}

const FONT = { fontFamily: 'Comic', size: 20, weight: 700 }

beforeEach(() => clearMathTextCache())

describe('measureMathText', () => {
  test('plain text is its measured width with font-relative vertical metrics', () => {
    const { ctx } = fakeCtx()
    const m = measureMathText(ctx, '6+7', FONT)
    expect(m.width).toBe(30)
    expect(m.ascent).toBeCloseTo(14.8)
    expect(m.descent).toBeCloseTo(4.4)
  })

  test('binary operators get spacing inside math; unary minus does not', () => {
    const { ctx } = fakeCtx()
    const spaced = measureMathText(ctx, '$6+7$', FONT).width
    expect(spaced).toBeCloseTo(30 + 2 * 0.22 * 20)
    expect(measureMathText(ctx, '$-7$', FONT).width).toBe(20)
  })

  test('fractions are taller than text and centred on the axis', () => {
    const { ctx } = fakeCtx()
    const text = measureMathText(ctx, '$3$', FONT)
    const frac = measureMathText(ctx, '$\\frac{3}{4}$', FONT)
    expect(frac.ascent).toBeGreaterThan(text.ascent)
    expect(frac.descent).toBeGreaterThan(text.descent * 2)
  })

  test('superscripts raise the ascent and are smaller', () => {
    const { ctx } = fakeCtx()
    const base = measureMathText(ctx, '$x$', FONT)
    const sq = measureMathText(ctx, '$x^2$', FONT)
    expect(sq.ascent).toBeGreaterThan(base.ascent)
    expect(sq.width - base.width).toBeLessThan(10) // 0.7em digit + italic nudge < 1 full digit
  })

  test('layouts are cached and the caller font is restored', () => {
    const { ctx, measures } = fakeCtx()
    ctx.font = '12px serif'
    measureMathText(ctx, 'Combine like terms: $4x + 6x$.', FONT)
    const first = measures()
    measureMathText(ctx, 'Combine like terms: $4x + 6x$.', FONT)
    expect(measures()).toBe(first)
    expect(ctx.font).toBe('12px serif')
  })

  test('fitMathTextSize shrinks to fit', () => {
    const { ctx } = fakeCtx()
    expect(fitMathTextSize(ctx, '12', { ...FONT, maxWidth: 100 })).toBe(20)
    const size = fitMathTextSize(ctx, '123456789', { ...FONT, maxWidth: 45 })
    expect(size).toBeCloseTo(10, 1)
    expect(measureMathText(ctx, '123456789', { ...FONT, size }).width).toBeLessThanOrEqual(45)
    expect(fitMathTextSize(ctx, '123456789', { ...FONT, maxWidth: 45, minSize: 14 })).toBe(14)
  })
})

describe('drawMathText', () => {
  test('strokes everything before filling, with doubled outline width', () => {
    const { ctx, calls } = fakeCtx()
    drawMathText(ctx, '$\\frac{1}{2}x$', 0, 0, { ...FONT, color: '#fff', stroke: { color: '#111', width: 3 } })
    const firstFill = calls.findIndex((c) => c.startsWith('fill '))
    const lastStroke = calls.findLastIndex((c) => c.startsWith('stroke') && c.includes('#111'))
    expect(lastStroke).toBeLessThan(firstFill)
    expect(calls.filter((c) => c.startsWith('strokeText')).every((c) => c.endsWith('lw=6'))).toBe(true)
    expect(calls[0]).toBe('save')
    expect(calls.at(-1)).toBe('restore')
    // Italic variable uses an italic font.
    expect(calls.some((c) => c.startsWith('fill x') && c.includes('italic 700'))).toBe(true)
  })

  test('align and baseline anchor the box', () => {
    const { ctx, calls } = fakeCtx()
    const m = drawMathText(ctx, '42', 100, 50, { ...FONT, color: '#fff', align: 'center', baseline: 'middle' })
    expect(m.width).toBe(20)
    // Left edge = 100 − 10; baseline = 50 + (ascent − descent)/2 = 55.2.
    expect(calls).toContain('fill 42 90.0 55.2 700 20px Comic')
    calls.length = 0
    drawMathText(ctx, '42', 100, 50, { ...FONT, color: '#fff', align: 'right' })
    expect(calls).toContain('fill 42 80.0 50.0 700 20px Comic')
  })
})
