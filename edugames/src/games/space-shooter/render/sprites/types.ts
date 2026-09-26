/**
 * Signatures of the procedural sprite modules in this folder. The renderer
 * imports these; art agents implement them. All functions draw with the
 * Canvas 2D API only and are deterministic for a given seed.
 *
 *   asteroid.ts   export function createAsteroidSprite(opts: AsteroidSpriteOptions): HTMLCanvasElement
 *   background.ts export function createBackground(opts: BackgroundOptions): HTMLCanvasElement
 *                 export function drawStarfield(ctx, opts: StarfieldFrame): void
 *   fx.ts         export function drawBurst(ctx, opts: BurstFrame): void
 *                 export function drawFizzle(ctx, opts: FizzleFrame): void
 *                 export function drawLaser(ctx, opts: LaserFrame): void
 *                 export function drawFlame(ctx, opts: FlameFrame): void
 */

export interface AsteroidSpriteOptions {
  /** Radius in device pixels; the returned canvas is ~2.3×radius square, centred. */
  radius: number
  /** Palette index into PALETTE.asteroids (0..3). */
  variant: number
  /** Shape seed: lumps and crater placement. */
  seed: number
}

export interface BackgroundOptions {
  width: number
  height: number
  seed: number
  /** Which side the planet sits on: 'ltr' → planet low-left, 'rtl' → low-right. */
  direction: 'ltr' | 'rtl'
  /** Lane divider y positions in pixels (drawn as comic dashed lines). */
  laneDividers: number[]
}

export interface StarfieldFrame {
  width: number
  height: number
  /** Seconds; stars drift opposite to travel direction for parallax. */
  time: number
  direction: 'ltr' | 'rtl'
  seed: number
}

/** Comic "POW!"/"ZAP!" starburst. `t` is 0..1 progress; draw nothing at t ≥ 1. */
export interface BurstFrame {
  x: number
  y: number
  t: number
  /** Base size in pixels. */
  size: number
  /** Short exclamation drawn in the burst, e.g. "POW!", "+20". */
  text: string
  /** Font family stack for the text. */
  font: string
}

/** Wrong-answer puff: grey smoke + wobbly "✗". `t` 0..1. */
export interface FizzleFrame {
  x: number
  y: number
  t: number
  size: number
}

/** Laser bolt centred at x,y travelling in `dir` (+1 right, -1 left). */
export interface LaserFrame {
  x: number
  y: number
  dir: 1 | -1
  /** Bolt length in pixels. */
  length: number
  thickness: number
  time: number
}

/** Engine flame whose root is at x,y pointing away from `dir` (the travel direction). */
export interface FlameFrame {
  x: number
  y: number
  dir: 1 | -1
  size: number
  time: number
  /** Boosted flame is longer/bluer (speedBoost active). */
  boosted: boolean
}
