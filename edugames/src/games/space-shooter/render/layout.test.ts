import { describe, expect, test } from 'bun:test'
import { SHIP_SPRITE } from '../assets/spec'
import { WORLD, laneCenterY } from '../engine/types'
import {
  MIN_ROCK_TEXT,
  chooseRockLabel,
  clientToWorld,
  laneDividers,
  mirrorX,
  placeBubble,
  quiverContent,
  worldToClient,
  wrongShake,
  type FitText,
} from './layout'

/** Fake measure: 0.5 × size px per character, scaled down linearly to fit. */
const fit: FitText = (text, size, maxWidth) => {
  const width = text.length * size * 0.5
  return width <= maxWidth ? size : (size * maxWidth) / width
}

describe('mirroring and client mapping', () => {
  test('ltr is identity, rtl mirrors and is self-inverse', () => {
    expect(mirrorX(250, 'ltr')).toBe(250)
    expect(mirrorX(250, 'rtl')).toBe(WORLD.width - 250)
    expect(mirrorX(mirrorX(123, 'rtl'), 'rtl')).toBe(123)
  })

  test('client ↔ world round-trips through a letterboxed canvas rect', () => {
    const rect = { left: 40, top: 100, width: 800, height: 450 }
    for (const direction of ['ltr', 'rtl'] as const) {
      const w = clientToWorld(rect, direction, 240, 325)
      expect(w.y).toBeCloseTo(450)
      expect(w.x).toBeCloseTo(direction === 'ltr' ? 400 : 1200)
      const c = worldToClient(rect, direction, w.x, w.y)
      expect(c.x).toBeCloseTo(240)
      expect(c.y).toBeCloseTo(325)
    }
  })

  test('zero-size rect does not produce NaN', () => {
    const w = clientToWorld({ left: 0, top: 0, width: 0, height: 0 }, 'ltr', 10, 10)
    expect(Number.isFinite(w.x) && Number.isFinite(w.y)).toBe(true)
  })
})

describe('laneDividers', () => {
  test('lanes − 1 lines, halfway between lane centres', () => {
    for (const lanes of [3, 4, 5]) {
      const lines = laneDividers(lanes)
      expect(lines).toHaveLength(lanes - 1)
      lines.forEach((y, i) => {
        expect(y).toBeGreaterThan(laneCenterY(i, lanes))
        expect(y).toBeLessThan(laneCenterY(i + 1, lanes))
      })
    }
  })
})

describe('chooseRockLabel', () => {
  test('short prompts are drawn as-is', () => {
    const label = chooseRockLabel({ prompt: '6 + 7' }, 80, fit)
    expect(label.text).toBe('6 + 7')
    expect(label.placeholder).toBe(false)
    expect(label.size).toBeGreaterThanOrEqual(MIN_ROCK_TEXT)
  })

  test('a problem label wins over the prompt', () => {
    const label = chooseRockLabel({ prompt: 'What is 3/4 of 12 apples in the basket?', label: '¾ × 12' }, 70, fit)
    expect(label.text).toBe('¾ × 12')
  })

  test('long prompts fall back to a big "?"', () => {
    const label = chooseRockLabel({ prompt: 'Sam has 12 apples and gives 5 away. How many are left?' }, 70, fit)
    expect(label).toMatchObject({ text: '?', placeholder: true })
  })

  test('fitted prompt stays within 1.6 × radius', () => {
    const r = 65
    const label = chooseRockLabel({ prompt: '125 + 250' }, r, fit)
    if (!label.placeholder) expect(label.text.length * label.size * 0.5).toBeLessThanOrEqual(r * 1.6 + 1e-9)
  })
})

describe('placeBubble', () => {
  test('above the ship when there is room, below it under the HUD band', () => {
    const low = placeBubble(600, 70, 18)
    expect(low.above).toBe(true)
    expect(low.y + 35 + 18).toBeLessThanOrEqual(600 - SHIP_SPRITE.height / 2)
    const top = placeBubble(laneCenterY(0, 5), 70, 18)
    expect(top.above).toBe(false)
    expect(top.y - 35 - 18).toBeGreaterThanOrEqual(laneCenterY(0, 5) + SHIP_SPRITE.height / 2)
  })
})

describe('quiverContent', () => {
  const base = { targetId: 1, inputMode: 'freeform' as const, quiver: '', choices: [], status: 'playing' as const }

  test('typing shows the quiver text', () => {
    expect(quiverContent({ ...base, quiver: '12' }, 0)).toMatchObject({ mode: 'typing', text: '12' })
  })

  test('empty with a target shows "?" and a blinking caret', () => {
    const a = quiverContent(base, 0)
    const b = quiverContent(base, 0.5)
    expect(a.mode).toBe('empty')
    expect(a.caret).not.toBe(b.caret)
  })

  test('multiple choice shows a pick hint sized to the choices', () => {
    const choices = [1, 2, 3].map((i) => ({ id: `c${i}`, text: String(i) }))
    expect(quiverContent({ ...base, inputMode: 'multiple-choice', choices }, 0)).toMatchObject({ mode: 'choice', text: 'pick 1–3' })
  })

  test('hidden without a target, and after game over', () => {
    expect(quiverContent({ ...base, targetId: null, inputMode: null }, 0).mode).toBe('hidden')
    expect(quiverContent({ ...base, quiver: '4', status: 'over' }, 0).mode).toBe('hidden')
  })
})

describe('wrongShake', () => {
  test('zero when idle or finished, bounded while shaking', () => {
    expect(wrongShake(0, 1)).toBe(0)
    expect(wrongShake(0.6, 1)).toBe(0)
    for (let t = 0; t < 1; t += 0.01) expect(Math.abs(wrongShake(0.1, t))).toBeLessThanOrEqual(9)
  })
})
