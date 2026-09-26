/** View-wide constants: fonts, draw order, colours not in the art PALETTE. */
import { PALETTE } from '../assets/spec'

export const FONT_FAMILY = '"Comic Neue", "Comic Sans MS", "Chalkboard SE", sans-serif'
/** Loaded before `ready` resolves (weight 700 is the only one we draw with). */
export const FONT_PROBE = '700 40px "Comic Neue"'

/** Draw order (ex.Actor z). */
export const Z = {
  background: 0,
  stars: 1,
  lanes: 2,
  powerups: 10,
  asteroids: 20,
  bolts: 30,
  ship: 40,
  quiver: 60,
  fx: 70,
  overlay: 90,
} as const

export const COLORS = {
  target: PALETTE.star,
  pending: '#9fdcff',
  shield: '#6fd3ff',
  hurt: '#ff3b3b',
  bonus: '#ffe066',
  points: '#7dff9c',
  lost: '#c9c9d6',
} as const

/** Comic outline widths relative to text size. */
export function inkWidth(size: number): number {
  return Math.max(3, size * 0.12)
}
