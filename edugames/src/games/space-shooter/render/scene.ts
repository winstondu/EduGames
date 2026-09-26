/**
 * The play scene. Owns the fixed-step loop, paced by a TimeController (player
 * speed, DEV harness scale / lockstep); the engine is the only source of truth, and mirrors engine.state into pooled actors each frame; no gameplay
 * logic lives here. Positions are interpolated between the last two steps.
 */
import * as ex from 'excalibur'
import type { TimeController } from '../../../shared/kit/time'
import { POWERUP_SPRITE, SHIP_SPRITE } from '../assets/spec'
import {
  STEP_SECONDS,
  WORLD,
  laneCenterY,
  type AsteroidState,
  type BoltState,
  type Direction,
  type Engine,
  type GameEvent,
  type PowerupKind,
  type PowerupState,
} from '../engine/types'
import { AsteroidActor } from './actors/asteroid'
import { BackdropActor, LaneHighlightActor, StarfieldActor } from './actors/backdrop'
import { BoltActor } from './actors/bolt'
import { POWERUP_DRAW_SIZE, PowerupActor } from './actors/powerup'
import { QuiverActor } from './actors/quiver'
import { ShipActor } from './actors/ship'
import { EffectsActor, type FxLookup } from './effects'
import { CanvasImage } from './graphics'
import { lerp, mirrorX } from './layout'
import { EntityPool } from './pool'

export interface GameSceneOptions {
  sim: Engine
  direction: Direction
  quality: number
  shipImage: ex.ImageSource
  powerupImages: Record<PowerupKind, ex.ImageSource>
  /** Paces the fixed steps (scale, lockstep, queued manual steps). */
  time: TimeController
  /** Runs one fixed step (default: sim.step(); the DEV harness routes it through harness.tick()). */
  step?(): GameEvent[]
  onStep(events: GameEvent[]): void
}

/** Max seconds of animation per frame (tab switches, debugger pauses). */
export const MAX_FRAME_SECONDS = 0.25

export class GameScene extends ex.Scene {
  private readonly o: GameSceneOptions
  private readonly lanes: number
  private time = 0
  private frameDt = 0
  private alpha = 0
  private paused = false
  private stopped = false
  /** Entity x before the most recent step (ids are unique across entity kinds). */
  private readonly prevX = new Map<number, number>()
  private prevLaneY = 0
  private ship!: ShipActor
  private quiver!: QuiverActor
  private stars!: StarfieldActor
  private laneBand!: LaneHighlightActor
  private fx!: EffectsActor
  private asteroids!: EntityPool<AsteroidState, AsteroidActor>
  private bolts!: EntityPool<BoltState, BoltActor>
  private powerups!: EntityPool<PowerupState, PowerupActor>
  private shipPos = { x: 0, y: 0 }
  private targetId: number | null = null

  constructor(options: GameSceneOptions) {
    super()
    this.o = options
    this.lanes = options.sim.state.lanes
    this.prevLaneY = options.sim.state.ship.laneY
  }

  readonly lookup: FxLookup = {
    asteroid: (id) => {
      const a = this.asteroids?.get(id)
      if (!a || a.entityId !== id) return undefined
      return { x: a.pos.x, y: a.pos.y, radius: a.rockRadius, variant: a.variant }
    },
    ship: () => this.shipPos,
  }

  override onInitialize(): void {
    const { direction, quality } = this.o
    this.add(new BackdropActor(this.lanes, direction, quality))
    this.stars = new StarfieldActor(direction)
    this.add(this.stars)
    this.laneBand = new LaneHighlightActor(this.lanes)
    this.add(this.laneBand)

    this.ship = new ShipActor(direction, quality, rasterize(this.o.shipImage, SHIP_SPRITE.width, SHIP_SPRITE.height, quality * 1.5))
    this.add(this.ship)
    this.quiver = new QuiverActor(direction, quality)
    this.add(this.quiver)
    this.fx = new EffectsActor(direction, quality, this.lanes)
    this.add(this.fx)

    const icons: Partial<Record<PowerupKind, CanvasImage>> = {}
    for (const [kind, img] of Object.entries(this.o.powerupImages) as [PowerupKind, ex.ImageSource][]) {
      const icon = rasterize(img, POWERUP_DRAW_SIZE, POWERUP_DRAW_SIZE, quality * (POWERUP_DRAW_SIZE / POWERUP_SPRITE.size))
      if (icon) icons[kind] = icon
    }

    this.asteroids = new EntityPool<AsteroidState, AsteroidActor>({
      create: () => this.spawn(new AsteroidActor(quality)),
      bind: (actor, a) => actor.bind(a),
      update: (actor, a) =>
        actor.sync(a, { x: this.screenX(a.id, a.x), y: laneCenterY(a.lane, this.lanes), time: this.time, targeted: a.id === this.targetId }, this.frameDt),
      release: (actor) => actor.release(),
    })
    this.bolts = new EntityPool<BoltState, BoltActor>({
      create: () => this.spawn(new BoltActor(direction, quality)),
      bind: (actor, b) => actor.bind(b),
      update: (actor, b) => actor.sync(this.screenX(b.id, b.x), laneCenterY(b.lane, this.lanes), this.time),
      release: (actor) => actor.release(),
    })
    this.powerups = new EntityPool<PowerupState, PowerupActor>({
      create: () => this.spawn(new PowerupActor(icons)),
      bind: (actor, p) => actor.bind(p),
      update: (actor, p) => actor.sync(this.screenX(p.id, p.x), laneCenterY(p.lane, this.lanes), this.time),
      release: (actor) => actor.release(),
    })
    this.syncActors()
  }

  override onPreUpdate(_engine: ex.Engine, elapsedMs: number): void {
    if (this.paused || this.stopped) return
    const clock = this.o.time
    const realDt = Math.min(Math.max(0, elapsedMs / 1000), MAX_FRAME_SECONDS)
    const steps = clock.advance(realDt)
    // Animation follows game time: scaled in slow motion, step-by-step in lockstep.
    const dt = clock.lockstep ? steps * STEP_SECONDS : realDt * clock.scale
    this.time += dt
    this.frameDt = dt
    for (let i = 0; i < steps && !this.stopped && !this.paused; i++) this.runStep()
    if (this.stopped) return
    // Lockstep sits exactly on a step (and steps may run outside this loop), so show the current state.
    this.alpha = clock.lockstep ? 1 : clock.alpha()
    this.fx.advance(dt)
    this.syncActors()
  }

  private runStep(): void {
    this.capture()
    const events = this.o.step ? this.o.step() : this.o.sim.step()
    if (events.length) this.fx.handle(events, this.lookup)
    try {
      this.o.onStep(events)
    } catch (err) {
      console.error('[space-shooter view] onStep threw', err)
    }
  }

  /** FX for events that came from engine.dispatch() rather than step(). */
  pushEvents(events: readonly GameEvent[]): void {
    if (!this.stopped && events.length && this.fx) this.fx.handle(events, this.lookup)
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return
    this.paused = paused
    this.o.time.reset()
  }

  /** Stop stepping for good (the view is being disposed). */
  stop(): void {
    this.stopped = true
  }

  private spawn<A extends ex.Actor>(actor: A): A {
    this.add(actor)
    return actor
  }

  private capture(): void {
    const s = this.o.sim.state
    this.prevX.clear()
    for (const a of s.asteroids) this.prevX.set(a.id, a.x)
    for (const b of s.bolts) this.prevX.set(b.id, b.x)
    for (const p of s.powerups) this.prevX.set(p.id, p.x)
    this.prevLaneY = s.ship.laneY
  }

  private screenX(id: number, x: number): number {
    const prev = this.prevX.get(id)
    return mirrorX(prev === undefined ? x : lerp(prev, x, this.alpha), this.o.direction)
  }

  private syncActors(): void {
    const s = this.o.sim.state
    this.targetId = s.targetId
    const laneY = lerp(this.prevLaneY, s.ship.laneY, this.alpha)
    const shipY = laneCenterY(laneY, this.lanes)
    this.shipPos = { x: mirrorX(WORLD.shipX, this.o.direction), y: shipY }
    this.stars.sync(this.time)
    this.laneBand.sync(laneY)
    this.ship.sync({
      x: this.shipPos.x,
      y: shipY,
      laneDelta: s.ship.lane - laneY,
      time: this.time,
      invulnerable: s.ship.invulnerable,
      shield: s.shield,
      boosted: s.effects.some((e) => e.kind === 'speedBoost'),
      visible: s.status !== 'over',
    })
    this.asteroids.sync(s.asteroids)
    this.bolts.sync(s.bolts)
    this.powerups.sync(s.powerups)
    this.quiver.sync(s, this.shipPos.x, shipY, this.time)
  }
}

/** Re-rasterise a loaded (SVG) image at `scale` × its logical size so it stays crisp on HiDPI. */
function rasterize(img: ex.ImageSource, width: number, height: number, scale: number): CanvasImage | null {
  if (!img.isLoaded()) return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img.image, 0, 0, canvas.width, canvas.height)
  return new CanvasImage(canvas, width, height)
}
