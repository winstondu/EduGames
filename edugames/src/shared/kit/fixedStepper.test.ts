import { describe, expect, test } from 'bun:test'
import { createFixedStepper } from './fixedStepper'

const STEP = 1 / 60

describe('createFixedStepper', () => {
  test('runs whole steps and keeps the remainder', () => {
    const s = createFixedStepper(STEP)
    expect(s.advance(STEP * 0.5)).toBe(0)
    expect(s.alpha()).toBeCloseTo(0.5)
    expect(s.advance(STEP * 0.75)).toBe(1)
    expect(s.alpha()).toBeCloseTo(0.25)
  })

  test('exact multiples are not lost to float error', () => {
    const s = createFixedStepper(STEP)
    expect(s.advance(3 * STEP)).toBe(3)
    let total = 0
    for (let i = 0; i < 600; i++) total += s.advance(STEP)
    expect(total).toBe(600)
  })

  test('clamps long frames (spiral-of-death guard)', () => {
    const s = createFixedStepper(STEP, 0.25)
    expect(s.advance(5)).toBe(15)
  })

  test('ignores bad deltas and resets', () => {
    const s = createFixedStepper(STEP)
    expect(s.advance(-1)).toBe(0)
    expect(s.advance(Number.NaN)).toBe(0)
    s.advance(STEP * 0.9)
    s.reset()
    expect(s.alpha()).toBe(0)
    expect(s.advance(STEP * 0.5)).toBe(0)
  })

  test('alpha stays below 1', () => {
    const s = createFixedStepper(STEP)
    s.advance(STEP * 0.9999999999)
    expect(s.alpha()).toBeLessThan(1)
  })

  test('rejects a non-positive step', () => {
    expect(() => createFixedStepper(0)).toThrow()
  })
})
