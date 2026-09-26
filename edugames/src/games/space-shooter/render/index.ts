/**
 * Excalibur view for the space shooter (contract below; the UI codes against it).
 *
 * The view owns an ex.Engine on the given canvas at the fixed world resolution
 * (WORLD.width × WORLD.height, letterboxed with DisplayMode.FitContainer). Its
 * scene steps the pure game engine with a fixed stepper and mirrors
 * engine.state into pooled actors; all gameplay lives in the engine. World x is
 * measured from the leading edge; screen x = ltr ? x : WORLD.width − x.
 */
import '@fontsource/comic-neue/700.css'
import * as ex from 'excalibur'
import { clearMathTextCache } from '../../../shared/mathtext/canvas'
import { createTimeController, type TimeController } from '../../../shared/kit/time'
import { POWERUP_ICONS } from '../assets/powerups'
import { SHIP_SKINS, type ShipSkinId } from '../assets/ships'
import { PALETTE } from '../assets/spec'
import { POWERUP_KINDS, STEP_SECONDS, WORLD, type Direction, type Engine, type GameEvent, type PowerupKind } from '../engine/types'
import { clientToWorld, worldToClient } from './layout'
import { GameScene, MAX_FRAME_SECONDS } from './scene'
import { FONT_PROBE } from './theme'

export interface GameViewOptions {
  canvas: HTMLCanvasElement
  engine: Engine // from engine/types
  direction: Direction
  ship: ShipSkinId
  /** Initial real-time multiplier (player speed setting, default 1). */
  speed?: number
  /** Runs one fixed step (default engine.step(); the DEV harness passes harness.tick). */
  step?(): GameEvent[]
  /** Called after every fixed step with that step's events (the view already used them for FX). */
  onStep(events: GameEvent[]): void
}

export interface GameView {
  /** Resolves when assets + font are loaded and the loop is running (or once the view is disposed). */
  ready: Promise<void>
  /** Feed events returned by engine.dispatch() (e.g. 'fired', 'hit' after resolveCheck) so FX play for them too. */
  pushEvents(events: GameEvent[]): void
  /** Stop/resume stepping + animation (engine pause is a separate command). */
  setPaused(paused: boolean): void
  /** Step pacing: speed scale, lockstep and queued manual steps (the engine stays deterministic). */
  readonly time: TimeController
  /** Map client (CSS px) ↔ world coords; world x is measured from the leading edge. */
  clientToWorld(clientX: number, clientY: number): { x: number; y: number }
  worldToClient(x: number, y: number): { x: number; y: number }
  dispose(): void
}

const SCENE = 'space-shooter'
/** Don't hold the game hostage to a slow web font; fall back after this. */
const FONT_TIMEOUT_MS = 2500

/** Minimal loader: no splash, no play button, no post-load delay; paints plain space while loading. */
class QuickLoader extends ex.DefaultLoader {
  override onDraw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = PALETTE.space
    ctx.fillRect(0, 0, WORLD.width, WORLD.height)
  }

  override async onAfterLoad(): Promise<void> {}
}

/** The comic web font as an Excalibur Loadable, so the scene starts only once text measures correctly. */
class FontLoadable implements ex.Loadable<boolean> {
  data = false

  isLoaded(): boolean {
    return this.data
  }

  async load(): Promise<boolean> {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (fonts) {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS))
      await Promise.race([fonts.load(FONT_PROBE).catch(() => undefined), timeout])
    }
    // Layouts measured with fallback-font widths must not survive.
    clearMathTextCache()
    this.data = true
    return true
  }
}

/** Raster quality for text and procedural sprites (HiDPI, capped for memory). */
function pickQuality(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  return Math.min(2, Math.max(1, Math.round(dpr * 4) / 4))
}

export function createGameView(options: GameViewOptions): GameView {
  const { canvas, direction } = options
  const quality = pickQuality()
  const skin = SHIP_SKINS.find((s) => s.id === options.ship) ?? SHIP_SKINS[0]
  const shipImage = new ex.ImageSource(skin.url)
  const powerupImages = Object.fromEntries(POWERUP_KINDS.map((k) => [k, new ex.ImageSource(POWERUP_ICONS[k].url)])) as Record<
    PowerupKind,
    ex.ImageSource
  >

  const game = new ex.Engine({
    canvasElement: canvas,
    width: WORLD.width,
    height: WORLD.height,
    displayMode: ex.DisplayMode.FitContainer,
    antialiasing: true,
    pixelRatio: quality,
    enableCanvasTransparency: true,
    backgroundColor: ex.Color.fromHex(PALETTE.space),
    suppressPlayButton: true,
    suppressConsoleBootMessage: true,
    pointerScope: ex.PointerScope.Canvas,
    scrollPreventionMode: ex.ScrollPreventionMode.None,
    grabWindowFocus: false,
    physics: false,
  })

  let disposed = false
  let settleOnDispose = () => {}
  const disposal = new Promise<void>((resolve) => (settleOnDispose = resolve))
  const time = createTimeController({ stepSeconds: STEP_SECONDS, maxFrameSeconds: MAX_FRAME_SECONDS, scale: options.speed })
  const scene = new GameScene({
    sim: options.engine,
    time,
    step: options.step,
    direction,
    quality,
    shipImage,
    powerupImages,
    onStep: (events) => {
      if (!disposed) options.onStep(events)
    },
  })
  game.addScene(SCENE, scene)

  const loader = new QuickLoader({ loadables: [new FontLoadable(), shipImage, ...Object.values(powerupImages)] })
  const started = game.start(SCENE, { loader }).then(() => {
    // start() resolves after loading; the scene activates on the next frame.
    if (disposed || game.currentScene === scene) return
    return new Promise<void>((resolve) => {
      const sub = game.on('postframe', () => {
        if (disposed || game.currentScene === scene) {
          sub.close()
          resolve()
        }
      })
    })
  })

  // A view disposed mid-load (React StrictMode) settles instead of hanging.
  const ready = Promise.race([started, disposal])

  const rect = () => canvas.getBoundingClientRect()

  return {
    ready,
    pushEvents(events) {
      if (!disposed) scene.pushEvents(events)
    },
    setPaused(paused) {
      if (!disposed) scene.setPaused(paused)
    },
    time,
    clientToWorld: (clientX, clientY) => clientToWorld(rect(), direction, clientX, clientY),
    worldToClient: (x, y) => worldToClient(rect(), direction, x, y),
    dispose() {
      if (disposed) return
      disposed = true
      scene.stop()
      game.dispose()
      settleOnDispose()
    },
  }
}
