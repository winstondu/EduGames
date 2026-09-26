/**
 * Pure view geometry: world ↔ screen mirroring, client mapping, lane lines,
 * asteroid label choice and quiver bubble placement. No DOM or Excalibur, so
 * it is unit-tested directly.
 */
import { SHIP_SPRITE } from '../assets/spec'
import { WORLD, laneCenterY, type Direction, type GameState } from '../engine/types'

/** Screen x of a world x (world x is measured from the leading edge). Self-inverse. */
export function mirrorX(x: number, direction: Direction): number {
  return direction === 'ltr' ? x : WORLD.width - x
}

/** +1 when travel (ship → asteroids) points right on screen, −1 for rtl. */
export function travelSign(direction: Direction): 1 | -1 {
  return direction === 'ltr' ? 1 : -1
}

export interface ClientRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Client (CSS px) → world coords. `rect` is the canvas's client rect; with
 * DisplayMode.FitContainer the canvas itself keeps the world's aspect ratio
 * (the letterbox is the container around it), so the mapping is linear.
 */
export function clientToWorld(rect: ClientRect, direction: Direction, clientX: number, clientY: number): { x: number; y: number } {
  const sx = rect.width > 0 ? ((clientX - rect.left) / rect.width) * WORLD.width : 0
  const sy = rect.height > 0 ? ((clientY - rect.top) / rect.height) * WORLD.height : 0
  return { x: mirrorX(sx, direction), y: sy }
}

export function worldToClient(rect: ClientRect, direction: Direction, x: number, y: number): { x: number; y: number } {
  return {
    x: rect.left + (mirrorX(x, direction) / WORLD.width) * rect.width,
    y: rect.top + (y / WORLD.height) * rect.height,
  }
}

/** World y of the lines between adjacent lanes. */
export function laneDividers(lanes: number): number[] {
  const out: number[] = []
  for (let i = 0; i < lanes - 1; i++) out.push((laneCenterY(i, lanes) + laneCenterY(i + 1, lanes)) / 2)
  return out
}

/** Smallest prompt size worth drawing on a rock; below it the asteroid shows "?". */
export const MIN_ROCK_TEXT = 26

/** Largest size ≤ `size` at which `text` is ≤ `maxWidth` wide (fitMathTextSize-shaped). */
export type FitText = (text: string, size: number, maxWidth: number) => number

export interface RockLabel {
  text: string
  size: number
  /** True when the prompt didn't fit and a "?" stands in (the UI banner shows it). */
  placeholder: boolean
}

/**
 * What an asteroid shows: the problem's short `label` if it has one, else the
 * prompt when it fits in ~1.6 × radius at ≥ MIN_ROCK_TEXT px, else a big "?".
 */
export function chooseRockLabel(problem: { prompt: string; label?: string }, radius: number, fit: FitText): RockLabel {
  const maxWidth = radius * 1.6
  const base = Math.max(MIN_ROCK_TEXT, Math.min(54, radius * 0.66))
  const label = problem.label?.trim()
  if (label) return { text: label, size: Math.max(18, fit(label, base, maxWidth)), placeholder: false }
  const prompt = problem.prompt.trim()
  if (prompt) {
    const size = fit(prompt, base, maxWidth)
    if (size >= MIN_ROCK_TEXT) return { text: prompt, size, placeholder: false }
  }
  return { text: '?', size: Math.min(80, radius * 0.95), placeholder: true }
}

/** Quiver bubble box (world/screen y) and whether its tail points down (bubble above the ship). */
export interface BubblePlacement {
  /** Centre y of the bubble body. */
  y: number
  above: boolean
}

export const BUBBLE_GAP = 6

/** Default ceiling for the bubble: the HUD band (a little overlap is fine). */
export const BUBBLE_CEILING = WORLD.hudTop - 12

/**
 * Put the bubble above the ship unless it would climb above `ceiling` (the HUD
 * band, or the bottom of whatever the UI overlays at the top, e.g. a tall
 * question banner); then hang it below. `bodyHeight` excludes the tail of height `tail`.
 */
export function placeBubble(shipY: number, bodyHeight: number, tail: number, ceiling = BUBBLE_CEILING): BubblePlacement {
  const halfShip = SHIP_SPRITE.height / 2
  const aboveTop = shipY - halfShip - BUBBLE_GAP - tail - bodyHeight
  if (aboveTop >= Math.max(BUBBLE_CEILING, ceiling)) return { y: aboveTop + bodyHeight / 2, above: true }
  return { y: shipY + halfShip + BUBBLE_GAP + tail + bodyHeight / 2, above: false }
}

export type QuiverMode = 'hidden' | 'typing' | 'empty' | 'choice'

export interface QuiverContent {
  mode: QuiverMode
  text: string
  caret: boolean
  above: boolean
}

/** Multiple-choice hint for touch devices (no number keys to press). */
export const TOUCH_CHOICE_HINT = 'tap an answer'

/**
 * What the quiver bubble shows: typed answer, "?" + caret while empty, a pick
 * hint for multiple choice ("pick 1–n" keys, or a tap hint on touch), or nothing.
 */
export function quiverContent(
  state: Pick<GameState, 'targetId' | 'inputMode' | 'quiver' | 'choices' | 'status'>,
  time: number,
  touch = false,
): Omit<QuiverContent, 'above'> {
  const caret = Math.floor(time * 2.4) % 2 === 0
  if (state.status === 'over') return { mode: 'hidden', text: '', caret }
  if (state.inputMode === 'multiple-choice' && state.targetId !== null) {
    if (touch) return { mode: 'choice', text: TOUCH_CHOICE_HINT, caret }
    const n = Math.max(1, state.choices.length)
    return { mode: 'choice', text: `pick 1–${n}`, caret }
  }
  if (state.quiver) return { mode: 'typing', text: state.quiver, caret }
  if (state.targetId === null) return { mode: 'hidden', text: '', caret }
  return { mode: 'empty', text: '?', caret }
}

/** Horizontal shake offset for an asteroid that just bounced a wrong answer (wrongFlash seconds, 0 = none). */
export function wrongShake(wrongFlash: number, time: number, flashSeconds = 0.6): number {
  if (!(wrongFlash > 0) || wrongFlash >= flashSeconds) return 0
  const k = 1 - wrongFlash / flashSeconds
  return Math.sin(time * 70) * 9 * k
}

/** Linear interpolation helper for between-step rendering. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
