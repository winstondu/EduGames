/**
 * Art contract. Every sprite follows the "retro comic" look:
 *  - flat fills, 2–3 tones per material (base, shadow, highlight)
 *  - thick ink outline: stroke #1b1b2f, stroke-width 4 (outer) / 2.5 (inner detail),
 *    stroke-linejoin="round", stroke-linecap="round"
 *  - no <filter>, <text>, <image>, external refs, fonts, CSS, or scripts
 *    (sprites are rasterized to offscreen canvases via <img>)
 *  - root <svg> must carry explicit width/height equal to its viewBox size
 *
 * Ships: nose points +x (right). The renderer mirrors horizontally for RTL
 * play and draws the animated engine flame itself at `exhaust`.
 */
export const SHIP_SPRITE = {
  width: 128,
  height: 80,
  /** Where the flame attaches (rear, centre line). */
  exhaust: { x: 12, y: 40 },
  /** Where lasers leave the nose. */
  muzzle: { x: 124, y: 40 },
} as const

/** Powerup icons: square, drawn inside a comic "badge" with its own outline. */
export const POWERUP_SPRITE = { size: 64 } as const

/** Comic palette shared by procedural sprites and UI. */
export const PALETTE = {
  ink: '#1b1b2f',
  space: '#12121f',
  spaceLight: '#1d1d33',
  star: '#ffd23f',
  paper: '#fff6e0',
  laser: '#ff4d4d',
  laserCore: '#fff1c1',
  good: '#3ecf6b',
  bad: '#ff5a5f',
  accent: '#3ba7ff',
  /** Four asteroid palettes: [base, shadow, highlight]. */
  asteroids: [
    ['#b8aea3', '#8a7f75', '#d9d1c7'], // grey stone
    ['#c98a4b', '#9c6334', '#e6ac6f'], // orange clay
    ['#8c8a86', '#6a6864', '#adaba7'], // dark granite
    ['#a18ab8', '#7b6593', '#c3afd6'], // purple crystal
  ],
} as const
