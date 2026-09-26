import { describe, expect, test } from 'bun:test'
import { createAsteroidSprite } from './asteroid'
import { createBackground, drawStarfield } from './background'
import { drawBurst, drawFizzle, drawFlame, drawLaser } from './fx'
import type { CanvasFactory } from './paint'

/**
 * Headless stand-in for a 2D context: records every call and property write,
 * so "same seed ⇒ same drawing" can be checked without a raster backend.
 */
function recordingCanvas(log: string[]): CanvasFactory {
  return (width, height) => {
    log.push(`canvas ${width}x${height}`)
    const ctx = recordingContext(log)
    return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement
  }
}

function recordingContext(log: string[]): CanvasRenderingContext2D {
  const round = (v: unknown) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)
  const target: Record<string, unknown> = {}
  return new Proxy(target, {
    get(_, key: string) {
      if (key in target) return target[key]
      return (...args: unknown[]) => {
        log.push(`${key}(${args.map(round).join(',')})`)
        if (key === 'measureText') return { width: String(args[0]).length * 10 }
        if (key.startsWith('create')) return { addColorStop: (o: number, c: string) => log.push(`stop ${o} ${c}`) }
        return undefined
      }
    },
    set(_, key: string, value) {
      target[key] = value
      log.push(`${key}=${round(value)}`)
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

function record(draw: (factory: CanvasFactory, ctx: CanvasRenderingContext2D) => void): string[] {
  const log: string[] = []
  draw(recordingCanvas(log), recordingContext(log))
  return log
}

describe('procedural sprites', () => {
  test('asteroid is deterministic per seed and sized ~2.3r', () => {
    const a = record((f) => createAsteroidSprite({ radius: 50, variant: 2, seed: 9 }, f))
    const b = record((f) => createAsteroidSprite({ radius: 50, variant: 2, seed: 9 }, f))
    const c = record((f) => createAsteroidSprite({ radius: 50, variant: 2, seed: 10 }, f))
    expect(a[0]).toBe('canvas 115x115')
    expect(a.length).toBeGreaterThan(50)
    expect(b).toEqual(a)
    expect(c).not.toEqual(a)
  })

  test('every asteroid variant renders, including out-of-range indices', () => {
    for (const variant of [0, 1, 2, 3, 4, -1]) {
      expect(record((f) => createAsteroidSprite({ radius: 30, variant, seed: 1 }, f)).length).toBeGreaterThan(20)
    }
  })

  test('background is deterministic and mirrors the planet by direction', () => {
    const opts = { width: 800, height: 450, seed: 3, laneDividers: [150, 300] }
    const ltr = record((f) => createBackground({ ...opts, direction: 'ltr' }, f))
    expect(record((f) => createBackground({ ...opts, direction: 'ltr' }, f))).toEqual(ltr)
    expect(record((f) => createBackground({ ...opts, direction: 'rtl' }, f))).not.toEqual(ltr)
    expect(ltr.filter((l) => l.startsWith('setLineDash')).length).toBe(1)
  })

  test('starfield drifts over time but repeats for the same frame', () => {
    const frame = { width: 800, height: 450, seed: 5, direction: 'ltr' as const }
    const t1 = record((_, ctx) => drawStarfield(ctx, { ...frame, time: 1 }))
    expect(record((_, ctx) => drawStarfield(ctx, { ...frame, time: 1 }))).toEqual(t1)
    expect(record((_, ctx) => drawStarfield(ctx, { ...frame, time: 2 }))).not.toEqual(t1)
  })

  test('fx are deterministic, and bursts/fizzles draw nothing once finished', () => {
    const burst = { x: 10, y: 10, size: 100, text: 'POW!', font: 'sans-serif' }
    expect(record((_, ctx) => drawBurst(ctx, { ...burst, t: 0.3 }))).toEqual(record((_, ctx) => drawBurst(ctx, { ...burst, t: 0.3 })))
    expect(record((_, ctx) => drawBurst(ctx, { ...burst, t: 1 }))).toEqual([])
    expect(record((_, ctx) => drawFizzle(ctx, { x: 0, y: 0, size: 80, t: 1 }))).toEqual([])
    expect(record((_, ctx) => drawFizzle(ctx, { x: 0, y: 0, size: 80, t: 0.5 })).length).toBeGreaterThan(10)
    const laser = { x: 0, y: 0, dir: 1 as const, length: 100, thickness: 10, time: 0.2 }
    expect(record((_, ctx) => drawLaser(ctx, laser))).toEqual(record((_, ctx) => drawLaser(ctx, laser)))
    const flame = { x: 0, y: 0, dir: -1 as const, size: 40, time: 0.7, boosted: true }
    expect(record((_, ctx) => drawFlame(ctx, flame))).toEqual(record((_, ctx) => drawFlame(ctx, flame)))
  })
})
