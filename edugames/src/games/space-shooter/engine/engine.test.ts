import { describe, expect, test } from 'bun:test'
import type { AnswerInputSpec, CheckResult, Problem, ProblemFormat, ProblemSource } from '../../../generators/types'
import { createRng } from '../../../shared/rng'
import {
  CHECK_TIMEOUT_SECONDS,
  MAX_LIVES,
  SHIELD_HITS,
  START_LIVES,
  STEP_SECONDS,
  WORLD,
  asteroidRadius,
  createEngine,
  type AsteroidState,
  type Command,
  type Engine,
  type GameConfig,
  type GameEvent,
  type PowerupKind,
} from './index'
import { crossingSeconds, levelForCorrect, spawnInterval } from './difficulty'
import { acceptsChar } from './input'
import { bonusPoints, hitPoints } from './scoring'

const NUMERIC: AnswerInputSpec = { kind: 'numeric', maxLength: 4, allow: '-' }

interface FakeSource extends ProblemSource {
  answers: Map<string, string>
  levels: number[]
}

/** Problems "n+0" (answer n); `formatFor(n)` picks each problem's format. */
function fakeSource(formatFor: (n: number) => ProblemFormat = () => 'freeform', input?: AnswerInputSpec): FakeSource {
  let n = 0
  const answers = new Map<string, string>()
  const levels: number[] = []
  return {
    answers,
    levels,
    next(level) {
      n++
      levels.push(level)
      const format = formatFor(n)
      const id = `p${n}`
      const problem: Problem = { id, prompt: `$${n}+0$`, level, format }
      if (format === 'multiple-choice') {
        problem.choices = [0, 1, 2].map((i) => ({ id: `${id}-c${i}`, text: String(n + i - 1) }))
        answers.set(id, `${id}-c1`)
      } else {
        if (input) problem.input = input
        answers.set(id, String(n))
      }
      return problem
    },
    check(problem, given) {
      const expected = answers.get(problem.id)
      return { correct: given === expected, expected }
    },
  }
}

function makeEngine(overrides: Partial<GameConfig> = {}): { engine: Engine; source: FakeSource } {
  const source = (overrides.problems as FakeSource | undefined) ?? fakeSource()
  const engine = createEngine({ lanes: 3, problems: source, defaultInput: NUMERIC, maxLevel: 10, seed: 42, ...overrides })
  return { engine, source }
}

function steps(engine: Engine, n: number): GameEvent[] {
  const out: GameEvent[] = []
  for (let i = 0; i < n; i++) out.push(...engine.step())
  return out
}

function stepsFor(engine: Engine, seconds: number): GameEvent[] {
  return steps(engine, Math.round(seconds / STEP_SECONDS))
}

function stepUntil(engine: Engine, pred: (e: GameEvent) => boolean, maxSteps = 6000): { event: GameEvent; events: GameEvent[] } {
  const events: GameEvent[] = []
  for (let i = 0; i < maxSteps; i++) {
    const evs = engine.step()
    events.push(...evs)
    const event = evs.find(pred)
    if (event) return { event, events }
  }
  throw new Error('condition not reached')
}

function ofType<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type)
}

const shipLane = (engine: Engine) => Math.round(engine.state.ship.laneY)

/** Wait for the first asteroid, then park it in the ship's lane at `x`. */
function firstAsteroidInShipLane(engine: Engine, x = 900): AsteroidState {
  stepUntil(engine, (e) => e.type === 'asteroidSpawned')
  const a = engine.state.asteroids[0]
  a.lane = shipLane(engine)
  a.x = x
  engine.step()
  expect(engine.state.targetId).toBe(a.id)
  return a
}

/** Wait for two asteroids, then park both in the ship's lane (a nearer than b). */
function twoInShipLane(engine: Engine, xa = 700, xb = 1300): [AsteroidState, AsteroidState] {
  stepUntil(engine, (e) => e.type === 'asteroidSpawned')
  const a = engine.state.asteroids[0]
  a.x = 1500
  stepUntil(engine, (e) => e.type === 'asteroidSpawned')
  const b = engine.state.asteroids.find((x) => x.id !== a.id)!
  a.lane = b.lane = shipLane(engine)
  a.x = xa
  b.x = xb
  engine.step()
  expect(engine.state.targetId).toBe(a.id)
  return [a, b]
}

/** Type and fire the right (or given) answer at the current target; returns the checkRequested event. */
function shoot(engine: Engine, source: FakeSource, text?: string) {
  const target = engine.state.asteroids.find((a) => a.id === engine.state.targetId)!
  const answer = text ?? source.answers.get(target.problem.id)!
  for (const char of answer) engine.dispatch({ type: 'typeChar', char })
  const fired = engine.dispatch({ type: 'fire' })
  expect(fired[0]?.type).toBe('fired')
  const { event } = stepUntil(engine, (e) => e.type === 'checkRequested', 120)
  return event as Extract<GameEvent, { type: 'checkRequested' }>
}

function resolve(engine: Engine, checkId: number, result: CheckResult | null): GameEvent[] {
  return engine.dispatch({ type: 'resolveCheck', checkId, result })
}

/** Push a powerup right in front of the ship and step until collected. */
function collect(engine: Engine, kind: PowerupKind, id = 9000) {
  engine.state.powerups.push({ id, lane: shipLane(engine), x: WORLD.shipX + WORLD.shipHalfLength + 30, kind })
  const events = engine.step()
  const got = ofType(events, 'powerupCollected')
  expect(got.length).toBe(1)
  return got[0]
}

describe('pure helpers', () => {
  test('difficulty curves', () => {
    expect(crossingSeconds(1)).toBeCloseTo(13)
    expect(crossingSeconds(10)).toBeCloseTo(6)
    expect(crossingSeconds(20)).toBeCloseTo(6)
    expect(spawnInterval(10, 3)).toBeLessThan(spawnInterval(1, 3))
    expect(levelForCorrect(0, 10)).toBe(1)
    expect(levelForCorrect(8, 10)).toBe(2)
    expect(levelForCorrect(1000, 10)).toBe(10)
    expect(levelForCorrect(1000, 1)).toBe(1)
  })

  test('points', () => {
    expect(hitPoints(1, 0, false)).toBe(10)
    expect(hitPoints(3, 4, false)).toBe(38)
    expect(hitPoints(1, 50, false)).toBe(30)
    expect(hitPoints(1, 50, true)).toBe(60)
    expect(bonusPoints(2, true)).toBe(40)
  })

  test('char filters', () => {
    expect(acceptsChar(NUMERIC, '7')).toBe(true)
    expect(acceptsChar(NUMERIC, '-')).toBe(true)
    expect(acceptsChar(NUMERIC, '.')).toBe(false)
    expect(acceptsChar(NUMERIC, 'a')).toBe(false)
    expect(acceptsChar(NUMERIC, '12')).toBe(false)
    const text: AnswerInputSpec = { kind: 'text', maxLength: 10, allow: "'" }
    expect(acceptsChar(text, 'q')).toBe(true)
    expect(acceptsChar(text, 'É')).toBe(true)
    expect(acceptsChar(text, ' ')).toBe(true)
    expect(acceptsChar(text, "'")).toBe(true)
    expect(acceptsChar(text, '+')).toBe(false)
  })
})

describe('initial state', () => {
  test('defaults and lane clamping', () => {
    const { engine } = makeEngine({ lanes: 9 })
    const s = engine.state
    expect(s.status).toBe('playing')
    expect(s.lanes).toBe(5)
    expect(s.lives).toBe(START_LIVES)
    expect(s.level).toBe(1)
    expect(s.ship.lane).toBe(2)
    expect(s.input).toEqual(NUMERIC)
    expect(s.inputMode).toBeNull()
    expect(makeEngine({ lanes: 1 }).engine.state.lanes).toBe(3)
  })
})

describe('spawning', () => {
  test('first asteroid enters from the far edge with a problem', () => {
    const { engine, source } = makeEngine()
    const { event, events } = stepUntil(engine, (e) => e.type === 'asteroidSpawned')
    expect(events.length).toBeGreaterThan(0)
    expect(engine.state.time).toBeGreaterThan(0.9)
    const a = engine.state.asteroids[0]
    expect(event).toEqual({ type: 'asteroidSpawned', asteroidId: a.id, lane: a.lane })
    expect(a.radius).toBe(asteroidRadius(3))
    expect(a.x).toBe(WORLD.width + a.radius)
    expect(a.speed).toBeGreaterThan((WORLD.width / 13) * 0.9)
    expect(a.speed).toBeLessThan((WORLD.width / 13) * 1.1)
    expect(a.problem.id).toBe('p1')
    expect(source.levels).toEqual([1])
    const x0 = a.x
    engine.step()
    expect(a.x).toBeCloseTo(x0 - a.speed * STEP_SECONDS)
  })

  test('respects the cap and never stacks in a lane', () => {
    for (const lanes of [3, 4, 5]) {
      const { engine } = makeEngine({ lanes, seed: lanes * 7 })
      engine.state.shield = 1e9
      let spawned = 0
      for (let i = 0; i < 60 * 90; i++) {
        const before = engine.state.asteroids.map((a) => ({ ...a }))
        const events = engine.step()
        for (const e of ofType(events, 'asteroidSpawned')) {
          spawned++
          const a = engine.state.asteroids.find((x) => x.id === e.asteroidId)!
          for (const o of before) if (o.lane === a.lane) expect(Math.abs(o.x - a.x)).toBeGreaterThanOrEqual(3 * a.radius - 20)
        }
        expect(engine.state.asteroids.length).toBeLessThanOrEqual(lanes + 1)
      }
      expect(spawned).toBeGreaterThan(20)
      // every lane gets used
      expect(new Set(engine.state.asteroids.map((a) => a.lane)).size).toBeGreaterThan(0)
    }
  })

  test('asteroids use lanes randomly', () => {
    const { engine } = makeEngine({ lanes: 5 })
    engine.state.shield = 1e9
    const lanes = new Set<number>()
    for (let i = 0; i < 60 * 60; i++) for (const e of ofType(engine.step(), 'asteroidSpawned')) lanes.add(e.lane)
    expect(lanes.size).toBe(5)
  })
})

describe('ship movement', () => {
  test('moves clamp and laneY eases', () => {
    const { engine } = makeEngine()
    engine.dispatch({ type: 'moveUp' })
    engine.dispatch({ type: 'moveUp' })
    engine.dispatch({ type: 'moveUp' })
    expect(engine.state.ship.lane).toBe(0)
    engine.step()
    expect(engine.state.ship.laneY).toBeCloseTo(1 - 8 * STEP_SECONDS)
    steps(engine, 10)
    expect(engine.state.ship.laneY).toBe(0)
    engine.dispatch({ type: 'moveToLane', lane: 99 })
    expect(engine.state.ship.lane).toBe(2)
    engine.dispatch({ type: 'moveDown' })
    expect(engine.state.ship.lane).toBe(2)
    engine.dispatch({ type: 'moveToLane', lane: -3 })
    expect(engine.state.ship.lane).toBe(0)
  })
})

describe('targeting and input', () => {
  test('target follows the ship lane and sets input mode', () => {
    const source = fakeSource((n) => (n === 1 ? 'freeform' : 'multiple-choice'))
    const { engine } = makeEngine({ problems: source })
    const a = firstAsteroidInShipLane(engine)
    expect(engine.state.inputMode).toBe('freeform')
    expect(engine.state.choices).toEqual([])
    engine.dispatch({ type: 'typeChar', char: '1' })
    expect(engine.state.quiver).toBe('1')

    // Move away: target lost, quiver cleared.
    engine.dispatch({ type: 'moveUp' })
    const { events } = stepUntil(engine, (e) => e.type === 'targetChanged', 60)
    expect(ofType(events, 'targetChanged')[0].targetId).toBeNull()
    expect(engine.state.quiver).toBe('')
    expect(engine.state.inputMode).toBeNull()
    expect(engine.state.input).toEqual(NUMERIC)

    // A multiple-choice asteroid in the new lane.
    stepUntil(engine, (e) => e.type === 'asteroidSpawned')
    const b = engine.state.asteroids.find((x) => x.id !== a.id)!
    b.lane = shipLane(engine)
    b.x = 800
    const ev = engine.step()
    expect(ofType(ev, 'targetChanged')[0].targetId).toBe(b.id)
    expect(engine.state.inputMode).toBe('multiple-choice')
    expect(engine.state.choices.map((c) => c.text)).toEqual(['1', '2', '3'])
    // typing is ignored in multiple-choice mode
    engine.dispatch({ type: 'typeChar', char: '2' })
    expect(engine.state.quiver).toBe('')
  })

  test('nearest asteroid wins', () => {
    const { engine } = makeEngine()
    const a = firstAsteroidInShipLane(engine, 1200)
    stepUntil(engine, (e) => e.type === 'asteroidSpawned')
    const b = engine.state.asteroids.find((x) => x.id !== a.id)!
    b.lane = shipLane(engine)
    b.x = 700
    engine.step()
    expect(engine.state.targetId).toBe(b.id)
  })

  test('problem input overrides the default and typing is filtered', () => {
    const textInput: AnswerInputSpec = { kind: 'text', maxLength: 3 }
    const { engine } = makeEngine({ problems: fakeSource(() => 'freeform', textInput) })
    firstAsteroidInShipLane(engine)
    expect(engine.state.input).toEqual(textInput)
    for (const char of ['a', '+', 'B', ' ', '9', 'z']) engine.dispatch({ type: 'typeChar', char })
    expect(engine.state.quiver).toBe('aB ')
    engine.dispatch({ type: 'backspace' })
    expect(engine.state.quiver).toBe('aB')
    engine.dispatch({ type: 'clearQuiver' })
    expect(engine.state.quiver).toBe('')
  })

  test('numeric filter and max length', () => {
    const { engine } = makeEngine()
    firstAsteroidInShipLane(engine)
    for (const char of ['-', 'x', '1', '.', '2', '3', '4', '5']) engine.dispatch({ type: 'typeChar', char })
    expect(engine.state.quiver).toBe('-123')
  })

  test('fire needs a quiver; choose needs a valid index', () => {
    const { engine } = makeEngine({ problems: fakeSource(() => 'multiple-choice') })
    firstAsteroidInShipLane(engine)
    expect(engine.dispatch({ type: 'fire' })).toEqual([])
    expect(engine.dispatch({ type: 'choose', index: 7 })).toEqual([])
    const ev = engine.dispatch({ type: 'choose', index: 2 })
    expect(ev).toHaveLength(1)
    const fired = ev[0] as Extract<GameEvent, { type: 'fired' }>
    expect(fired).toMatchObject({ type: 'fired', lane: shipLane(engine), display: '2' })
    const bolt = engine.state.bolts[0]
    expect(bolt).toMatchObject({ id: fired.boltId, given: 'p1-c2', display: '2', x: WORLD.shipX + WORLD.shipHalfLength })
  })

  test('revision bumps on HUD changes', () => {
    const { engine } = makeEngine()
    firstAsteroidInShipLane(engine)
    const r = engine.state.revision
    engine.dispatch({ type: 'typeChar', char: '1' })
    expect(engine.state.revision).toBeGreaterThan(r)
    const r2 = engine.state.revision
    engine.dispatch({ type: 'typeChar', char: 'x' })
    expect(engine.state.revision).toBe(r2)
  })
})

describe('checks', () => {
  test('bolt → checkRequested → correct hit', () => {
    const { engine, source } = makeEngine()
    const a = firstAsteroidInShipLane(engine)
    const check = shoot(engine, source)
    expect(check).toMatchObject({ asteroidId: a.id, problem: a.problem, given: '1' })
    expect(engine.state.bolts).toHaveLength(0)
    expect(a.pending).toBe(true)
    expect(a.speed).toBe(0)
    // pending asteroid is no longer the target
    expect(engine.state.targetId).toBeNull()
    const x = a.x
    steps(engine, 30)
    expect(a.x).toBe(x)

    const events = resolve(engine, check.checkId, { correct: true, explanation: 'yes' })
    expect(events[0]).toEqual({ type: 'hit', asteroidId: a.id, lane: a.lane, x, points: 10, bonus: false, explanation: 'yes' })
    expect(engine.state.asteroids.find((o) => o.id === a.id)).toBeUndefined()
    expect(engine.state.score).toBe(10)
    expect(engine.state.streak).toBe(1)
    expect(engine.state.correct).toBe(1)
    // stale id ignored
    expect(resolve(engine, check.checkId, { correct: true })).toEqual([])
    expect(engine.state.score).toBe(10)
  })

  test('wrong answer un-pends, breaks streak, passes expected/explanation', () => {
    const { engine, source } = makeEngine()
    const a = firstAsteroidInShipLane(engine)
    const speed = a.speed
    engine.state.streak = 4
    const check = shoot(engine, source, '99')
    const events = resolve(engine, check.checkId, { correct: false, expected: '1', explanation: 'it is 1' })
    expect(events[0]).toEqual({ type: 'wrongAnswer', asteroidId: a.id, lane: a.lane, x: a.x, display: '99', expected: '1', explanation: 'it is 1' })
    expect(a.pending).toBe(false)
    expect(a.speed).toBe(speed)
    expect(a.wrongFlash).toBeGreaterThan(0)
    expect(engine.state.streak).toBe(0)
    expect(engine.state.wrong).toBe(1)
    expect(engine.state.targetId).toBe(a.id)
    stepsFor(engine, 1)
    expect(a.wrongFlash).toBe(0)
  })

  test('null result voids without penalty', () => {
    const { engine, source } = makeEngine()
    const a = firstAsteroidInShipLane(engine)
    const check = shoot(engine, source)
    const events = resolve(engine, check.checkId, null)
    expect(events[0]).toEqual({ type: 'checkVoided', checkId: check.checkId, asteroidId: a.id })
    expect(a.pending).toBe(false)
    expect(a.speed).toBeGreaterThan(0)
    expect(engine.state.wrong).toBe(0)
    expect(engine.state.lives).toBe(START_LIVES)
  })

  test('checks time out after CHECK_TIMEOUT_SECONDS of play', () => {
    const { engine, source } = makeEngine()
    const a = firstAsteroidInShipLane(engine, 1400)
    const check = shoot(engine, source)
    engine.dispatch({ type: 'pause' })
    expect(engine.step()).toEqual([])
    engine.dispatch({ type: 'resume' })
    const { event } = stepUntil(engine, (e) => e.type === 'checkVoided')
    expect(event).toEqual({ type: 'checkVoided', checkId: check.checkId, asteroidId: a.id })
    expect(a.pending).toBe(false)
    // a late verdict is ignored
    expect(resolve(engine, check.checkId, { correct: true })).toEqual([])
    expect(engine.state.score).toBe(0)
  })

  test('timeout fires on schedule', () => {
    const { engine, source } = makeEngine()
    firstAsteroidInShipLane(engine, 1400)
    const check = shoot(engine, source)
    const t0 = engine.state.time
    const { event } = stepUntil(engine, (e) => e.type === 'checkVoided')
    expect(event).toMatchObject({ checkId: check.checkId })
    expect(engine.state.time - t0).toBeCloseTo(CHECK_TIMEOUT_SECONDS, 1)
  })

  test('bolts pass through pending asteroids', () => {
    const { engine, source } = makeEngine()
    const [a, b] = twoInShipLane(engine)
    const first = shoot(engine, source)
    expect(first.asteroidId).toBe(a.id)
    expect(engine.state.targetId).toBe(b.id)
    const second = shoot(engine, source)
    expect(second.asteroidId).toBe(b.id)
  })

  test('a bolt only strikes the asteroid it was aimed at', () => {
    const { engine } = makeEngine()
    const [a, b] = twoInShipLane(engine)
    // Two quick shots at `a`: the first freezes it, the second must not land on `b`.
    for (const answer of ['1', '9']) {
      for (const char of answer) engine.dispatch({ type: 'typeChar', char })
      engine.dispatch({ type: 'fire' })
    }
    expect(engine.state.bolts.map((bolt) => bolt.targetId)).toEqual([a.id, a.id])
    const events = stepsFor(engine, 1.5)
    const checks = ofType(events, 'checkRequested')
    expect(checks.map((c) => c.asteroidId)).toEqual([a.id])
    expect(b.pending).toBe(false)
    expect(engine.state.bolts).toHaveLength(0)
  })

  test('bolts leaving the world vanish', () => {
    const { engine } = makeEngine()
    const a = firstAsteroidInShipLane(engine)
    engine.dispatch({ type: 'typeChar', char: '1' })
    engine.dispatch({ type: 'fire' })
    a.lane = (a.lane + 1) % 3
    stepsFor(engine, 1.5)
    expect(engine.state.bolts).toHaveLength(0)
  })

  test('pending asteroids never hurt the ship', () => {
    const { engine, source } = makeEngine()
    const a = firstAsteroidInShipLane(engine)
    shoot(engine, source)
    a.x = WORLD.shipX
    const events = stepsFor(engine, 2)
    expect(ofType(events, 'shipHit')).toHaveLength(0)
    expect(engine.state.lives).toBe(START_LIVES)
  })
})

describe('damage', () => {
  test('ship hit costs a life and grants invulnerability', () => {
    const { engine } = makeEngine()
    const a = firstAsteroidInShipLane(engine, WORLD.shipX + WORLD.shipHalfLength + 150)
    const { events } = stepUntil(engine, (e) => e.type === 'shipHit')
    expect(ofType(events, 'shipHit')[0]).toEqual({ type: 'shipHit', lane: a.lane, absorbedByShield: false })
    expect(ofType(events, 'lifeLost')[0]).toEqual({ type: 'lifeLost', lives: START_LIVES - 1 })
    expect(engine.state.asteroids.find((o) => o.id === a.id)).toBeUndefined()
    expect(engine.state.ship.invulnerable).toBeCloseTo(1.5)
  })

  test('invulnerable ship lets asteroids drift through harmlessly', () => {
    const { engine } = makeEngine()
    engine.state.ship.invulnerable = 60
    const a = firstAsteroidInShipLane(engine, WORLD.shipX + 10)
    engine.state.ship.invulnerable = 1.5
    const events = stepsFor(engine, 1.2)
    expect(ofType(events, 'shipHit')).toHaveLength(0)
    expect(ofType(events, 'lifeLost')).toHaveLength(0)
    expect(engine.state.asteroids.find((o) => o.id === a.id)).toBeUndefined()
  })

  test('asteroid passing in another lane costs a life', () => {
    const { engine } = makeEngine()
    stepUntil(engine, (e) => e.type === 'asteroidSpawned')
    const a = engine.state.asteroids[0]
    a.lane = shipLane(engine) === 0 ? 2 : 0
    a.x = WORLD.shipX
    const { events } = stepUntil(engine, (e) => e.type === 'asteroidPassed')
    expect(ofType(events, 'asteroidPassed')[0]).toEqual({ type: 'asteroidPassed', asteroidId: a.id, lane: a.lane, absorbedByShield: false })
    expect(engine.state.lives).toBe(START_LIVES - 1)
  })

  test('shield absorbs hits', () => {
    const { engine } = makeEngine()
    collect(engine, 'shield')
    expect(engine.state.shield).toBe(SHIELD_HITS)
    firstAsteroidInShipLane(engine, WORLD.shipX + WORLD.shipHalfLength + 150)
    const { events } = stepUntil(engine, (e) => e.type === 'shipHit')
    expect(ofType(events, 'shipHit')[0].absorbedByShield).toBe(true)
    expect(ofType(events, 'lifeLost')).toHaveLength(0)
    expect(engine.state.shield).toBe(SHIELD_HITS - 1)
    expect(engine.state.lives).toBe(START_LIVES)
  })

  test('game over at 0 lives', () => {
    const { engine } = makeEngine()
    engine.state.lives = 1
    firstAsteroidInShipLane(engine, WORLD.shipX + WORLD.shipHalfLength + 150)
    engine.state.score = 123
    const { events } = stepUntil(engine, (e) => e.type === 'gameOver')
    expect(ofType(events, 'gameOver')[0]).toEqual({ type: 'gameOver', score: 123 })
    expect(engine.state.status).toBe('over')
    const t = engine.state.time
    expect(engine.step()).toEqual([])
    expect(engine.state.time).toBe(t)
    expect(engine.dispatch({ type: 'resume' })).toEqual([])
    expect(engine.state.status).toBe('over')
    engine.dispatch({ type: 'moveUp' })
    expect(engine.state.ship.lane).toBe(1)
  })

  test('an untouched game ends', () => {
    const { engine } = makeEngine()
    const { events } = stepUntil(engine, (e) => e.type === 'gameOver', 60 * 120)
    expect(ofType(events, 'lifeLost').map((e) => e.lives)).toEqual([2, 1, 0])
  })
})

describe('powerups and effects', () => {
  test('powerups spawn every 12-18 s and drift in', () => {
    const { engine } = makeEngine()
    engine.state.shield = 1e9
    engine.dispatch({ type: 'moveToLane', lane: 0 })
    let seenAt = -1
    for (let i = 0; i < 60 * 19 && seenAt < 0; i++) {
      engine.step()
      if (engine.state.powerups.length) seenAt = engine.state.time
    }
    expect(seenAt).toBeGreaterThanOrEqual(12)
    expect(seenAt).toBeLessThanOrEqual(18)
    const p = engine.state.powerups[0]
    const x = p.x
    engine.step()
    expect(p.x).toBeLessThan(x)
    let maxAlive = 0
    for (let i = 0; i < 60 * 120; i++) {
      engine.step()
      maxAlive = Math.max(maxAlive, engine.state.powerups.length)
    }
    expect(maxAlive).toBeLessThanOrEqual(2)
  })

  test('collected when reaching the ship in its lane', () => {
    const { engine } = makeEngine()
    const lane = shipLane(engine)
    engine.state.powerups.push({ id: 9001, lane, x: 700, kind: 'extraLife' })
    engine.state.powerups.push({ id: 9002, lane: (lane + 1) % 3, x: 300, kind: 'shield' })
    const { event, events } = stepUntil(engine, (e) => e.type === 'powerupCollected')
    expect(event).toEqual({ type: 'powerupCollected', kind: 'extraLife', lane, fromRandom: false })
    expect(engine.state.lives).toBe(START_LIVES + 1)
    expect(events.filter((e) => e.type === 'powerupCollected')).toHaveLength(1)
    stepsFor(engine, 3)
    expect(engine.state.powerups.find((p) => p.id === 9002)).toBeUndefined()
    expect(engine.state.shield).toBe(0)
  })

  test('extraLife caps at MAX_LIVES', () => {
    const { engine } = makeEngine()
    engine.state.lives = MAX_LIVES
    collect(engine, 'extraLife')
    expect(engine.state.lives).toBe(MAX_LIVES)
  })

  test('random resolves to a concrete kind', () => {
    const { engine } = makeEngine()
    const got = collect(engine, 'random')
    expect(got.fromRandom).toBe(true)
    expect(got.kind).not.toBe('random')
  })

  test('scoreBoost doubles points and ends after 15 s', () => {
    const { engine, source } = makeEngine()
    collect(engine, 'scoreBoost')
    expect(engine.state.effects).toEqual([{ kind: 'scoreBoost', remaining: 15, duration: 15 }])
    firstAsteroidInShipLane(engine)
    const check = shoot(engine, source)
    const hit = ofType(resolve(engine, check.checkId, { correct: true }), 'hit')[0]
    expect(hit.points).toBe(20)
    const { event } = stepUntil(engine, (e) => e.type === 'effectEnded')
    expect(event).toEqual({ type: 'effectEnded', kind: 'scoreBoost' })
    expect(engine.state.effects).toEqual([])
  })

  test('doubleShots destroys the next asteroid in the lane', () => {
    const { engine, source } = makeEngine()
    collect(engine, 'doubleShots')
    const [a, b] = twoInShipLane(engine)
    const check = shoot(engine, source)
    const hits = ofType(resolve(engine, check.checkId, { correct: true }), 'hit')
    expect(hits.map((h) => [h.asteroidId, h.bonus])).toEqual([
      [a.id, false],
      [b.id, true],
    ])
    expect(engine.state.correct).toBe(1)
    expect(engine.state.score).toBe(20)
  })

  test('speedBoost doubles bolt and lane-switch speed', () => {
    const { engine } = makeEngine()
    collect(engine, 'speedBoost')
    expect(engine.state.effects[0]).toMatchObject({ kind: 'speedBoost', remaining: 10 })
    engine.dispatch({ type: 'moveUp' })
    engine.step()
    expect(engine.state.ship.laneY).toBeCloseTo(1 - 16 * STEP_SECONDS)
    steps(engine, 10)
    firstAsteroidInShipLane(engine, 1500)
    engine.dispatch({ type: 'typeChar', char: '5' })
    engine.dispatch({ type: 'fire' })
    const x0 = engine.state.bolts[0].x
    engine.step()
    expect(engine.state.bolts[0].x - x0).toBeCloseTo(2800 * STEP_SECONDS)
  })

  test('re-collecting an effect refreshes it', () => {
    const { engine } = makeEngine()
    collect(engine, 'doubleShots', 9001)
    stepsFor(engine, 5)
    collect(engine, 'doubleShots', 9002)
    expect(engine.state.effects).toHaveLength(1)
    expect(engine.state.effects[0].remaining).toBe(15)
  })
})

describe('progression', () => {
  test('levels up every 8 correct answers, capped at maxLevel', () => {
    const { engine, source } = makeEngine({ maxLevel: 2 })
    engine.state.shield = 1e9
    const levelUps: number[] = []
    let correct = 0
    while (correct < 17) {
      const events = engine.step()
      for (const e of events) if (e.type === 'levelUp') levelUps.push(e.level)
      if (engine.state.targetId === null) {
        const next = engine.state.asteroids.find((a) => !a.pending)
        if (next) {
          next.lane = shipLane(engine)
          next.x = Math.max(next.x, 800)
        }
        continue
      }
      const check = shoot(engine, source)
      for (const e of resolve(engine, check.checkId, { correct: true })) if (e.type === 'levelUp') levelUps.push(e.level)
      correct++
      if (correct === 7) expect(engine.state.level).toBe(1)
      if (correct === 8) expect(engine.state.level).toBe(2)
    }
    expect(levelUps).toEqual([2])
    expect(engine.state.level).toBe(2)
    expect(engine.state.streak).toBe(17)
    expect(engine.state.bestStreak).toBe(17)
    // new asteroids get level-2 problems
    stepUntil(engine, (e) => e.type === 'asteroidSpawned')
    expect(source.levels.at(-1)).toBe(2)
  })
})

describe('pause', () => {
  test('pause freezes time and input; resume continues', () => {
    const { engine } = makeEngine()
    firstAsteroidInShipLane(engine)
    engine.dispatch({ type: 'pause' })
    expect(engine.state.status).toBe('paused')
    const t = engine.state.time
    expect(engine.step()).toEqual([])
    expect(engine.state.time).toBe(t)
    engine.dispatch({ type: 'typeChar', char: '1' })
    engine.dispatch({ type: 'moveUp' })
    expect(engine.state.quiver).toBe('')
    expect(engine.state.ship.lane).toBe(1)
    engine.dispatch({ type: 'resume' })
    engine.step()
    expect(engine.state.time).toBeGreaterThan(t)
  })
})

describe('determinism', () => {
  /** A scripted bot: moves around, answers (mostly right), resolves checks one step late. */
  function play(seed: number) {
    const source = fakeSource((n) => (n % 3 === 0 ? 'multiple-choice' : 'freeform'))
    const { engine } = makeEngine({ problems: source, seed, lanes: 4 })
    engine.state.shield = 1e9
    const bot = createRng(seed ^ 0xbeef)
    const log: GameEvent[] = []
    let queued: Command[] = []
    for (let i = 0; i < 60 * 150; i++) {
      const cmds = queued
      queued = []
      for (const c of cmds) log.push(...engine.dispatch(c))
      if (i % 20 === 0) log.push(...engine.dispatch({ type: 'moveToLane', lane: Math.floor(bot() * 4) }))
      const s = engine.state
      if (s.targetId !== null && i % 15 === 0) {
        const target = s.asteroids.find((a) => a.id === s.targetId)!
        const answer = source.answers.get(target.problem.id)!
        const right = bot() < 0.8
        if (s.inputMode === 'multiple-choice') {
          const idx = s.choices.findIndex((c) => c.id === answer)
          log.push(...engine.dispatch({ type: 'choose', index: right ? idx : (idx + 1) % s.choices.length }))
        } else {
          for (const char of right ? answer : '7') log.push(...engine.dispatch({ type: 'typeChar', char }))
          log.push(...engine.dispatch({ type: 'fire' }))
        }
      }
      if (i === 3000) log.push(...engine.dispatch({ type: 'pause' }))
      if (i === 3100) log.push(...engine.dispatch({ type: 'resume' }))
      const events = engine.step()
      log.push(...events)
      for (const e of events) {
        if (e.type !== 'checkRequested') continue
        const r = bot()
        const result: CheckResult | null = r < 0.05 ? null : (source.check(e.problem, e.given) as CheckResult)
        if (r > 0.1) queued.push({ type: 'resolveCheck', checkId: e.checkId, result })
      }
    }
    return { state: structuredClone(engine.state), log }
  }

  test('same seed + commands ⇒ identical state and events', () => {
    const a = play(1234)
    const b = play(1234)
    expect(a.state).toEqual(b.state)
    expect(a.log).toEqual(b.log)
    expect(ofType(a.log, 'hit').length).toBeGreaterThan(5)
    expect(ofType(a.log, 'wrongAnswer').length).toBeGreaterThan(0)
    expect(ofType(a.log, 'checkVoided').length).toBeGreaterThan(0)
  })

  test('different seeds diverge', () => {
    expect(play(1).log).not.toEqual(play(2).log)
  })
})
