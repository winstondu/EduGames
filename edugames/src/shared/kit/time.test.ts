import { describe, expect, test } from 'bun:test'
import { GAME_SPEED_LABELS, GAME_SPEEDS, createTimeController, sanitizeGameSpeed } from './time'

const STEP = 1 / 60

function run(time: ReturnType<typeof createTimeController>, frames: number, dt = STEP): number {
  let total = 0
  for (let i = 0; i < frames; i++) total += time.advance(dt)
  return total
}

describe('GameSpeed', () => {
  test('every speed has a label; sanitize falls back to 1', () => {
    for (const s of GAME_SPEEDS) expect(GAME_SPEED_LABELS[s]).toBeTruthy()
    expect(GAME_SPEED_LABELS[0.5]).toBe('Slow 🐢')
    expect(sanitizeGameSpeed('0.25')).toBe(0.25)
    expect(sanitizeGameSpeed(0.3)).toBe(1)
    expect(sanitizeGameSpeed(undefined)).toBe(1)
  })
})

describe('createTimeController', () => {
  test('scale 1 matches the plain fixed stepper', () => {
    const t = createTimeController({ stepSeconds: STEP })
    expect(run(t, 600)).toBe(600)
  })

  test('slow motion runs proportionally fewer steps', () => {
    for (const scale of [0.75, 0.5, 0.25]) {
      const t = createTimeController({ stepSeconds: STEP, scale })
      expect(run(t, 600)).toBe(600 * scale)
    }
    const fast = createTimeController({ stepSeconds: STEP, scale: 2 })
    expect(run(fast, 60)).toBe(120)
  })

  test('setScale clamps to 0.1..2 and ignores junk', () => {
    const t = createTimeController({ stepSeconds: STEP })
    t.setScale(5)
    expect(t.scale).toBe(2)
    t.setScale(0)
    expect(t.scale).toBe(0.1)
    t.setScale(Number.NaN)
    expect(t.scale).toBe(0.1)
  })

  test('the real frame is clamped before scaling', () => {
    const t = createTimeController({ stepSeconds: STEP, maxFrameSeconds: 0.25, scale: 2 })
    expect(t.advance(10)).toBe(30)
    const slow = createTimeController({ stepSeconds: STEP, maxFrameSeconds: 0.25, scale: 0.5 })
    expect(slow.advance(10)).toBe(7)
  })

  test('lockstep freezes real time; requested steps still run', () => {
    const t = createTimeController({ stepSeconds: STEP })
    t.advance(STEP * 0.5)
    expect(t.alpha()).toBeCloseTo(0.5)
    t.setLockstep(true)
    expect(t.lockstep).toBe(true)
    expect(t.alpha()).toBe(0)
    expect(run(t, 100)).toBe(0)
    t.requestSteps(3)
    expect(t.queued).toBe(3)
    expect(t.advance(STEP)).toBe(3)
    expect(t.advance(STEP)).toBe(0)
    t.setLockstep(false)
    expect(t.advance(STEP)).toBe(1)
  })

  test('requested steps add to real-time steps, even on a zero delta', () => {
    const t = createTimeController({ stepSeconds: STEP })
    t.requestSteps(2.9)
    t.requestSteps(-4)
    t.requestSteps(Number.NaN)
    expect(t.advance(0)).toBe(2)
    t.requestSteps(5)
    expect(t.advance(STEP)).toBe(6)
  })

  test('reset drops accumulated time but keeps queued steps', () => {
    const t = createTimeController({ stepSeconds: STEP })
    t.advance(STEP * 0.9)
    t.requestSteps(1)
    t.reset()
    expect(t.alpha()).toBe(0)
    expect(t.advance(STEP * 0.5)).toBe(1)
  })
})
