/**
 * Event-driven comic FX (one actor drawing every live effect): hit bursts +
 * debris + floating points, wrong-answer fizzles with the answer bouncing
 * back, ship hits (shake + red flash), shield absorbs, lane-edge flashes,
 * powerup labels, level banners and "lost signal" puffs. Purely cosmetic:
 * reads events, never touches the engine.
 */
import * as ex from 'excalibur'
import { POWERUP_ICONS } from '../assets/powerups'
import { PALETTE, SHIP_SPRITE } from '../assets/spec'
import { WORLD, laneCenterY, laneHeight, type Direction, type GameEvent } from '../engine/types'
import { CanvasImage, color, drawAt, surface, textSurface } from './graphics'
import { mirrorX, travelSign } from './layout'
import { drawBurst, drawFizzle } from './sprites/fx'
import { COLORS, FONT_FAMILY, Z } from './theme'

export interface FxLookup {
  /** Last drawn state of an asteroid (valid for a frame after the engine removed it). */
  asteroid(id: number): { x: number; y: number; radius: number; variant: number } | undefined
  ship(): { x: number; y: number }
}

type DrawFn = (ctx: ex.ExcaliburGraphicsContext, k: number, age: number) => void

interface Effect {
  age: number
  life: number
  draw: DrawFn
  done?: () => void
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  fill: ex.Color
  age: number
  life: number
}

/** Re-paintable square canvas, pooled by size so bursts don't allocate textures per hit. */
interface PooledSurface {
  side: number
  canvas: ex.Canvas
  paint: (ctx: CanvasRenderingContext2D) => void
}

const HIT_WORDS = ['POW!', 'ZAP!', 'BAM!', 'KA-POW!', 'WHAM!', 'BOOM!']
const INK = ex.Color.fromHex(PALETTE.ink)
const MAX_PARTICLES = 220

export class EffectsActor extends ex.Actor {
  private readonly direction: Direction
  private readonly sign: 1 | -1
  private readonly quality: number
  private readonly lanes: number
  private effects: Effect[] = []
  private particles: Particle[] = []
  private readonly pool = new Map<number, PooledSurface[]>()
  private hitCount = 0
  private readonly edgeGlow: Record<'hurt' | 'shield', CanvasImage>

  constructor(direction: Direction, quality: number, lanes: number) {
    super({ pos: ex.Vector.Zero, z: Z.fx })
    this.direction = direction
    this.sign = travelSign(direction)
    this.quality = quality
    this.lanes = lanes
    const laneH = laneHeight(lanes)
    this.edgeGlow = { hurt: edgeGradient(COLORS.hurt, laneH), shield: edgeGradient(COLORS.shield, laneH) }
    this.graphics.forceOnScreen = true
    this.graphics.onPostDraw = (ctx) => this.paint(ctx)
  }

  /** Advance effect clocks (seconds of unpaused animation). */
  advance(dt: number): void {
    for (const e of this.effects) e.age += dt
    const alive: Effect[] = []
    for (const e of this.effects) {
      if (e.age < e.life) alive.push(e)
      else e.done?.()
    }
    this.effects = alive
    for (const p of this.particles) {
      p.age += dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 260 * dt
      p.vx *= 1 - 1.4 * dt
    }
    this.particles = this.particles.filter((p) => p.age < p.life)
  }

  handle(events: readonly GameEvent[], lookup: FxLookup): void {
    for (const e of events) {
      switch (e.type) {
        case 'fired':
          this.muzzle(lookup.ship())
          break
        case 'hit': {
          const rock = lookup.asteroid(e.asteroidId)
          const x = mirrorX(e.x, this.direction)
          const y = laneCenterY(e.lane, this.lanes)
          const r = rock?.radius ?? 60
          if (e.bonus) {
            this.burst(x, y, r * 2.1, 'BONUS!', 0.7)
          } else {
            this.burst(x, y, r * 2.6, HIT_WORDS[this.hitCount++ % HIT_WORDS.length], 0.8)
          }
          this.debris(x, y, r, rock?.variant ?? 0, e.bonus ? 10 : 16)
          this.floatText(`+${e.points}`, x, y - r - 28, e.bonus ? 34 : 44, COLORS.points, { rise: 90, life: 1.1, delay: 0.08 })
          break
        }
        case 'wrongAnswer': {
          const rock = lookup.asteroid(e.asteroidId)
          const r = rock?.radius ?? 60
          const x = mirrorX(e.x, this.direction)
          const y = laneCenterY(e.lane, this.lanes)
          const front = x - this.sign * r * 1.15
          this.fizzle(front, y, r * 1.2)
          if (e.display) this.bounceBack(e.display, front, y)
          break
        }
        case 'checkVoided': {
          const rock = lookup.asteroid(e.asteroidId)
          if (!rock) break
          this.ring(rock.x, rock.y, rock.radius * 0.9, rock.radius * 1.5, COLORS.lost, 0.6, 5)
          this.floatText('…lost signal', rock.x, rock.y - rock.radius - 8, 24, COLORS.lost, { rise: 40, life: 1.3 })
          break
        }
        case 'shipHit': {
          const ship = lookup.ship()
          if (e.absorbedByShield) {
            this.ring(ship.x, ship.y, 70, 150, COLORS.shield, 0.55, 10)
            this.floatText('BLOCKED!', ship.x, ship.y - 70, 34, COLORS.shield, { rise: 50, life: 0.9 })
            this.shake(5, 180)
          } else {
            this.flash(COLORS.hurt, 0.45, 0.45)
            this.burst(ship.x + this.sign * 50, ship.y, 170, 'BONK!', 0.7)
            this.shake(14, 380)
          }
          break
        }
        case 'asteroidPassed': {
          const y = laneCenterY(e.lane, this.lanes)
          this.edgeFlash(y, e.absorbedByShield ? 'shield' : 'hurt')
          if (!e.absorbedByShield) {
            this.flash(COLORS.hurt, 0.25, 0.35)
            this.shake(8, 260)
          } else {
            const ship = lookup.ship()
            this.ring(ship.x, ship.y, 70, 140, COLORS.shield, 0.5, 8)
          }
          break
        }
        case 'powerupCollected': {
          const ship = lookup.ship()
          const label = `${POWERUP_ICONS[e.kind].label.toUpperCase()}!`
          this.ring(ship.x, ship.y, 40, 170, PALETTE.star, 0.5, 9)
          this.floatText(e.fromRandom ? `? ${label}` : label, ship.x + this.sign * 40, ship.y - 76, 40, PALETTE.star, { rise: 70, life: 1.4 })
          break
        }
        case 'levelUp':
          this.banner(`LEVEL ${e.level}!`)
          break
        case 'gameOver': {
          const ship = lookup.ship()
          this.burst(ship.x, ship.y, 320, 'BOOM!', 1.1)
          this.debris(ship.x, ship.y, 60, 2, 28)
          this.shake(18, 500)
          break
        }
        default:
          break
      }
    }
  }

  // ── primitives ─────────────────────────────────────────────────────────

  private add(life: number, draw: DrawFn, done?: () => void, delay = 0): void {
    this.effects.push({ age: -delay, life, draw, done })
  }

  private shake(magnitude: number, ms: number): void {
    this.scene?.camera.shake(magnitude, magnitude, ms)
  }

  private acquire(side: number): PooledSurface {
    const key = Math.ceil(side / 32) * 32
    const free = this.pool.get(key)
    const hit = free?.pop()
    if (hit) return hit
    const s: PooledSurface = { side: key, paint: () => {}, canvas: null as unknown as ex.Canvas }
    s.canvas = surface(key, key, this.quality, (ctx) => s.paint(ctx))
    return s
  }

  private release(s: PooledSurface): void {
    s.paint = () => {}
    const list = this.pool.get(s.side) ?? []
    if (list.length < 6) list.push(s)
    this.pool.set(s.side, list)
  }

  private burst(x: number, y: number, size: number, text: string, life: number): void {
    const s = this.acquire(size * 2.3)
    let t = 0
    s.paint = (ctx) => drawBurst(ctx, { x: s.side / 2, y: s.side / 2, t, size, text, font: FONT_FAMILY })
    this.add(
      life,
      (ctx, k) => {
        t = k
        s.canvas.flagDirty()
        drawAt(ctx, s.canvas, x, y)
      },
      () => this.release(s),
    )
  }

  private fizzle(x: number, y: number, size: number): void {
    const s = this.acquire(size * 2.2)
    let t = 0
    s.paint = (ctx) => drawFizzle(ctx, { x: s.side / 2, y: s.side / 2, t, size })
    this.add(
      0.8,
      (ctx, k) => {
        t = k
        s.canvas.flagDirty()
        drawAt(ctx, s.canvas, x, y)
      },
      () => this.release(s),
    )
  }

  private debris(x: number, y: number, radius: number, variant: number, count: number): void {
    const palette = PALETTE.asteroids[((variant % 4) + 4) % 4]
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5
      const speed = 160 + Math.random() * 260
      this.particles.push({
        x: x + Math.cos(a) * radius * 0.4,
        y: y + Math.sin(a) * radius * 0.4,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 80,
        r: 4 + Math.random() * radius * 0.12,
        fill: ex.Color.fromHex(palette[i % 3]),
        age: 0,
        life: 0.55 + Math.random() * 0.4,
      })
    }
  }

  private floatText(
    text: string,
    x: number,
    y: number,
    size: number,
    fill: string,
    opts: { rise?: number; life?: number; delay?: number } = {},
  ): void {
    const g = textSurface(text, size, this.quality, { color: fill })
    const rise = opts.rise ?? 60
    this.add(
      opts.life ?? 1,
      (ctx, k) => {
        const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.55 : k < 0.25 ? 1.15 - ((k - 0.15) / 0.1) * 0.15 : 1
        const fade = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1
        drawAt(ctx, g, x, y - rise * easeOut(k), { scale: pop, opacity: fade })
      },
      undefined,
      opts.delay,
    )
  }

  /** The wrong answer hops back toward the ship, spinning and fading. */
  private bounceBack(display: string, x: number, y: number): void {
    const g = textSurface(display, 42, this.quality, { color: PALETTE.bad })
    const back = -this.sign
    this.add(0.85, (ctx, k) => {
      const hop = Math.sin(k * Math.PI) * 70
      drawAt(ctx, g, x + back * 150 * k, y - 20 - hop, { rotation: back * k * 1.4, opacity: k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1 })
    })
  }

  private ring(x: number, y: number, from: number, to: number, hex: string, life: number, width: number): void {
    const c = ex.Color.fromHex(hex)
    const ink = INK.clone()
    this.add(life, (ctx, k) => {
      const r = from + (to - from) * easeOut(k)
      const a = 1 - k
      c.a = a
      ink.a = a * 0.8
      ctx.drawCircle(ex.vec(x, y), r, ex.Color.Transparent, ink, width + 4)
      ctx.drawCircle(ex.vec(x, y), r, ex.Color.Transparent, c, width)
    })
  }

  private flash(hex: string, strength: number, life: number): void {
    const c = color(hex, 0)
    this.add(life, (ctx, k) => {
      c.a = strength * (1 - k) * (1 - k)
      ctx.drawRectangle(ex.vec(-40, -40), WORLD.width + 80, WORLD.height + 80, c)
    })
  }

  private edgeFlash(y: number, kind: 'hurt' | 'shield'): void {
    const g = this.edgeGlow[kind]
    const x = mirrorX(g.width / 2, this.direction)
    this.add(0.7, (ctx, k) => {
      const pulse = k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9
      drawAt(ctx, g, x, y, { scaleX: this.sign, opacity: pulse })
    })
  }

  private muzzle(ship: { x: number; y: number }): void {
    const nose = ship.x + this.sign * (SHIP_SPRITE.muzzle.x - SHIP_SPRITE.width / 2)
    const core = color(PALETTE.laserCore, 1)
    const glow = color(PALETTE.laser, 0.5)
    this.add(0.14, (ctx, k) => {
      core.a = 1 - k
      glow.a = 0.5 * (1 - k)
      ctx.drawCircle(ex.vec(nose, ship.y), 26 * (0.6 + k), glow)
      ctx.drawCircle(ex.vec(nose, ship.y), 12 * (1 - k * 0.5), core)
    })
  }

  private banner(text: string): void {
    const cx = WORLD.width / 2
    const cy = WORLD.height / 2 - 20
    const s = this.acquire(420 * 2.3)
    let t = 0
    s.paint = (ctx) => drawBurst(ctx, { x: s.side / 2, y: s.side / 2, t, size: 420, text: '', font: FONT_FAMILY })
    const label = textSurface(text, 96, this.quality, { color: PALETTE.star })
    const life = 1.7
    this.add(
      life,
      (ctx, k) => {
        t = Math.min(0.999, k)
        s.canvas.flagDirty()
        drawAt(ctx, s.canvas, cx, cy, { opacity: 0.9 })
        const pop = k < 0.12 ? 0.3 + (k / 0.12) * 0.85 : k < 0.2 ? 1.15 - ((k - 0.12) / 0.08) * 0.15 : 1
        const fade = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1
        drawAt(ctx, label, cx, cy, { scale: pop, rotation: -0.06, opacity: fade })
      },
      () => this.release(s),
    )
  }

  private paint(ctx: ex.ExcaliburGraphicsContext): void {
    for (const p of this.particles) {
      const k = p.age / p.life
      ctx.save()
      ctx.opacity = ctx.opacity * (k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1)
      ctx.drawCircle(ex.vec(p.x, p.y), p.r * (1 - k * 0.4), p.fill, INK, 2.5)
      ctx.restore()
    }
    for (const e of this.effects) {
      if (e.age < 0) continue
      e.draw(ctx, Math.min(1, e.age / e.life), e.age)
    }
  }
}

function easeOut(k: number): number {
  return 1 - (1 - k) * (1 - k)
}

/** Horizontal glow strip (bright at the leading edge, fading inward). */
function edgeGradient(hex: string, height: number): CanvasImage {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 8
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 64, 0)
    const c = ex.Color.fromHex(hex)
    g.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, 0.85)`)
    g.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 8)
  }
  return new CanvasImage(canvas, 180, height)
}
