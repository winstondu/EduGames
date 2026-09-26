/**
 * Caches for procedural rasters: asteroid bodies (per variant × seed × radius),
 * the static backdrop (per lanes × direction) and a few soft glows. Sources are
 * shared; each caller gets its own CanvasImage wrapper so rotation/opacity stay
 * per-actor.
 */
import { WORLD, type Direction } from '../engine/types'
import { CanvasImage } from './graphics'
import { laneDividers } from './layout'
import { createAsteroidSprite } from './sprites/asteroid'
import { createBackground } from './sprites/background'
import { withAlpha } from './sprites/paint'

const BACKGROUND_SEED = 0x5ace
const ASTEROID_CACHE_LIMIT = 96

const asteroids = new Map<string, HTMLCanvasElement>()
const backgrounds = new Map<string, HTMLCanvasElement>()
const glows = new Map<string, HTMLCanvasElement>()

/** Asteroid body sized ~2.3 × radius (logical units). */
export function asteroidImage(variant: number, seed: number, radius: number, quality: number): CanvasImage {
  const r = Math.round(radius)
  const key = `${variant}|${seed}|${r}|${quality}`
  let source = asteroids.get(key)
  if (!source) {
    source = createAsteroidSprite({ radius: r * quality, variant, seed })
    if (asteroids.size >= ASTEROID_CACHE_LIMIT) asteroids.clear()
    asteroids.set(key, source)
  }
  return new CanvasImage(source, source.width / quality, source.height / quality)
}

/** Full-world static backdrop with lane dividers for `lanes`. */
export function backgroundImage(lanes: number, direction: Direction, quality: number): CanvasImage {
  const key = `${lanes}|${direction}|${quality}`
  let source = backgrounds.get(key)
  if (!source) {
    source = createBackground({
      width: WORLD.width * quality,
      height: WORLD.height * quality,
      seed: BACKGROUND_SEED,
      direction,
      laneDividers: laneDividers(lanes).map((y) => y * quality),
    })
    if (backgrounds.size >= 4) backgrounds.clear()
    backgrounds.set(key, source)
  }
  return new CanvasImage(source, WORLD.width, WORLD.height)
}

/** Soft radial glow (elliptical when w ≠ h), `color` fading to transparent. */
export function glowImage(color: string, width: number, height: number, strength = 0.5): CanvasImage {
  const key = `${color}|${width}|${height}|${strength}`
  let source = glows.get(key)
  if (!source) {
    source = document.createElement('canvas')
    const size = 128
    source.width = size
    source.height = size
    const ctx = source.getContext('2d')
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      g.addColorStop(0, withAlpha(color, strength))
      g.addColorStop(0.45, withAlpha(color, strength * 0.45))
      g.addColorStop(1, withAlpha(color, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)
    }
    glows.set(key, source)
  }
  return new CanvasImage(source, width, height)
}
