import { describe, expect, test } from 'bun:test'
import { WORLD } from '../engine/types'
import { reservedTopWorld, toastAnchor } from './overlays'

describe('toastAnchor', () => {
  test('docks in the half of the stage away from the ship', () => {
    expect([0, 1, 2, 3].map((lane) => toastAnchor(lane, 4))).toEqual(['bottom', 'bottom', 'top', 'top'])
    expect([0, 1, 2].map((lane) => toastAnchor(lane, 3))).toEqual(['bottom', 'top', 'top'])
    expect([0, 1, 2, 3, 4].map((lane) => toastAnchor(lane, 5))).toEqual(['bottom', 'bottom', 'top', 'top', 'top'])
  })
})

describe('reservedTopWorld', () => {
  test('maps the overlay bottom from CSS px to world y', () => {
    expect(reservedTopWorld(40, 360)).toBe(WORLD.height / 9)
    expect(reservedTopWorld(900, 360)).toBe(WORLD.height)
  })

  test('null when nothing is measured', () => {
    expect(reservedTopWorld(0, 360)).toBeNull()
    expect(reservedTopWorld(40, 0)).toBeNull()
    expect(reservedTopWorld(Number.NaN, 360)).toBeNull()
  })
})
