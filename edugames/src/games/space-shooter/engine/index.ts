/**
 * Pure, deterministic space-shooter simulation (contract: ./types.ts).
 * Game-agnostic about problems: it only reads `Problem.format` / `choices` /
 * `input` and defers every answer check to the host via `checkRequested`.
 */
import { createRng } from '../../../shared/rng'
import { resolveCheck, tickChecks } from './checks'
import { collideShip, moveAsteroids, moveBolts } from './collisions'
import { clampLanes, createInitialState, hasEffect, touch, type EngineContext } from './context'
import { backspace, choose, clearQuiver, fire, typeChar } from './input'
import { nextPowerupInterval, tickEffects, tickPowerups } from './powerups'
import { checkGameOver } from './scoring'
import { FIRST_SPAWN_SECONDS, tickSpawner } from './spawner'
import { updateTarget } from './targeting'
import { STEP_SECONDS, type Command, type CreateEngine, type Engine, type GameConfig, type GameEvent } from './types'

export * from './types'

/** Ship lane-switch speed, lanes / s (×2 with speedBoost). */
export const LANE_SWITCH_SPEED = 8

function moveShip(ctx: EngineContext, dt: number): void {
  const ship = ctx.state.ship
  if (ship.invulnerable > 0) ship.invulnerable = Math.max(0, ship.invulnerable - dt)
  const delta = ship.lane - ship.laneY
  if (delta === 0) return
  const max = LANE_SWITCH_SPEED * (hasEffect(ctx.state, 'speedBoost') ? 2 : 1) * dt
  ship.laneY = Math.abs(delta) <= max ? ship.lane : ship.laneY + Math.sign(delta) * max
}

function setLane(ctx: EngineContext, lane: number): void {
  if (!Number.isFinite(lane)) return
  ctx.state.ship.lane = Math.min(ctx.state.lanes - 1, Math.max(0, Math.round(lane)))
}

function step(ctx: EngineContext): void {
  const s = ctx.state
  const dt = STEP_SECONDS
  s.time += dt
  moveShip(ctx, dt)
  tickEffects(ctx, dt)
  tickChecks(ctx)
  moveAsteroids(ctx, dt)
  moveBolts(ctx, dt)
  collideShip(ctx)
  checkGameOver(ctx)
  if (s.status !== 'playing') {
    updateTarget(ctx)
    return
  }
  tickPowerups(ctx, dt)
  tickSpawner(ctx, dt)
  updateTarget(ctx)
}

function apply(ctx: EngineContext, command: Command): void {
  const s = ctx.state
  if (command.type === 'resolveCheck') {
    // Verdicts may land while paused; they are dropped once the game is over.
    if (s.status === 'over') return
    resolveCheck(ctx, command.checkId, command.result)
    updateTarget(ctx)
    return
  }
  if (command.type === 'pause') {
    if (s.status === 'playing') {
      s.status = 'paused'
      touch(ctx)
    }
    return
  }
  if (command.type === 'resume') {
    if (s.status === 'paused') {
      s.status = 'playing'
      touch(ctx)
    }
    return
  }
  if (s.status !== 'playing') return
  switch (command.type) {
    case 'moveUp':
      return setLane(ctx, s.ship.lane - 1)
    case 'moveDown':
      return setLane(ctx, s.ship.lane + 1)
    case 'moveToLane':
      return setLane(ctx, command.lane)
    case 'typeChar':
      return typeChar(ctx, command.char)
    case 'backspace':
      return backspace(ctx)
    case 'clearQuiver':
      return clearQuiver(ctx)
    case 'fire':
      return fire(ctx)
    case 'choose':
      return choose(ctx, command.index)
  }
}

export const createEngine: CreateEngine = (input: GameConfig): Engine => {
  const config: GameConfig = { ...input, lanes: clampLanes(input.lanes), maxLevel: Math.max(1, Math.floor(input.maxLevel) || 1) }
  const rng = createRng(config.seed)
  const ctx: EngineContext = {
    config,
    state: createInitialState(config),
    rng,
    events: [],
    checks: new Map(),
    nextEntityId: 1,
    nextCheckId: 1,
    spawnTimer: FIRST_SPAWN_SECONDS,
    powerupTimer: 0,
  }
  ctx.powerupTimer = nextPowerupInterval(ctx)

  function drain(): GameEvent[] {
    const events = ctx.events
    ctx.events = []
    return events
  }

  return {
    config,
    get state() {
      return ctx.state
    },
    dispatch(command) {
      apply(ctx, command)
      return drain()
    },
    step() {
      if (ctx.state.status !== 'playing') return []
      step(ctx)
      return drain()
    },
  }
}
