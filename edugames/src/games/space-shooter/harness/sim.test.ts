import { describe, expect, test } from 'bun:test'
import fixture from '../../../generators/fixture/index'
import math from '../../../generators/math/index'
import type { GeneratorPlugin, Problem } from '../../../generators/types'
import { STEP_SECONDS, type GameState } from '../engine/types'
import { createShooterHarness } from './adapter'
import { createBot, type BotName } from './bots'
import { createInvariantChecker } from './invariants'
import { runReplay } from './replay'
import { openHeadless, runBotGame } from './runner'
import { createShooterSession } from './session'

const plugins: Record<string, GeneratorPlugin<unknown>> = { math: math as GeneratorPlugin<unknown>, fixture: fixture as GeneratorPlugin<unknown> }
const load = async (id: string) => plugins[id] ?? null

const GAMES = 30
const MAX_SECONDS = 60
const SOAK: { name: string; plugin: GeneratorPlugin<unknown>; params: Record<string, string> }[] = [
  { name: 'math mc', plugin: plugins.math, params: { format: 'mc' } },
  { name: 'math freeform', plugin: plugins.math, params: { format: 'freeform', ops: 'add,sub,mul' } },
  { name: 'fixture mixed', plugin: plugins.fixture, params: {} },
]

describe('soak: invariants hold for every bot', () => {
  for (const gen of SOAK) {
    for (const bot of ['random', 'wrong', 'oracle'] as BotName[]) {
      test(`${bot} × ${GAMES} on ${gen.name}`, async () => {
        let correct = 0
        let wrong = 0
        let over = 0
        for (let seed = 1; seed <= GAMES; seed++) {
          const r = await runBotGame({ plugin: gen.plugin, params: gen.params, seed, bot, maxSeconds: MAX_SECONDS })
          expect(r.violations).toEqual([])
          correct += r.correct
          wrong += r.wrong
          if (r.ended === 'over') over++
        }
        if (bot === 'oracle') {
          expect(wrong).toBe(0)
          expect(correct).toBeGreaterThan(GAMES * 10)
        }
        if (bot === 'wrong') {
          expect(correct).toBe(0)
          expect(over).toBe(GAMES)
        }
      }, 60_000)
    }
  }

  test('long, mc, freeform and flaky fixture sets', async () => {
    for (const set of ['long', 'mc', 'freeform', 'flaky']) {
      for (const bot of ['oracle', 'random'] as BotName[]) {
        for (let seed = 1; seed <= 5; seed++) {
          const r = await runBotGame({ plugin: plugins.fixture, params: { set }, seed, bot, maxSeconds: MAX_SECONDS })
          expect(r.violations).toEqual([])
          if (bot === 'oracle') expect(r.wrong).toBe(0)
        }
      }
    }
  }, 60_000)

  test('flaky checks void shots without penalty', async () => {
    const r = await runBotGame({ plugin: plugins.fixture, params: { set: 'flaky' }, seed: 4, bot: 'oracle', maxSeconds: MAX_SECONDS })
    const verdicts = r.replay.log.map((e) => e.command as { type: string; result?: unknown } | null).filter((c) => c?.type === 'resolveCheck')
    expect(verdicts.some((c) => c!.result === null)).toBe(true)
    expect(r.wrong).toBe(0)
    expect(r.violations).toEqual([])
  })
})

describe('determinism', () => {
  const cases: [BotName, string, Record<string, string>][] = [
    ['oracle', 'math', { format: 'mc' }],
    ['random', 'math', { format: 'freeform' }],
    ['wrong', 'fixture', {}],
    ['oracle', 'fixture', { set: 'flaky' }],
    ['random', 'fixture', { set: 'flaky' }],
  ]
  for (const [bot, gen, params] of cases) {
    test(`${bot} on ${gen} ${JSON.stringify(params)}: exportReplay → runReplay reproduces the final state`, async () => {
      for (const seed of [1, 7, 42]) {
        const r = await runBotGame({ plugin: plugins[gen], params, seed, bot, maxSeconds: MAX_SECONDS })
        const replayed = await runReplay(JSON.parse(JSON.stringify(r.replay)), load)
        expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(r.final))
      }
    })
  }

  test('replay invariants also hold', async () => {
    const r = await runBotGame({ plugin: plugins.math, params: {}, seed: 3, bot: 'random', maxSeconds: MAX_SECONDS })
    const invariants = createInvariantChecker()
    await runReplay(r.replay, load, { onTick: (events, state) => invariants.observe(events, state) })
    expect(invariants.violations).toEqual([])
  })

  test('same seed → same game; different seed → different game', async () => {
    const a = await runBotGame({ plugin: plugins.math, params: {}, seed: 5, bot: 'oracle', maxSeconds: 20 })
    const b = await runBotGame({ plugin: plugins.math, params: {}, seed: 5, bot: 'oracle', maxSeconds: 20 })
    const c = await runBotGame({ plugin: plugins.math, params: {}, seed: 6, bot: 'oracle', maxSeconds: 20 })
    expect(JSON.stringify(a.final)).toBe(JSON.stringify(b.final))
    expect(JSON.stringify(a.final)).not.toBe(JSON.stringify(c.final))
  })
})

describe('adapter', () => {
  async function open(params: Record<string, string> = { format: 'mc' }) {
    return openHeadless({ plugin: plugins.math, params, seed: 9 })
  }

  test('act advances round(advance / STEP) steps and reports events with monotonic seq', async () => {
    const { harness, dispose } = await open()
    const r1 = await harness.act(null, { advance: 1.5 })
    expect(harness.stepIndex).toBe(Math.round(1.5 / STEP_SECONDS))
    expect(r1.state.time).toBeCloseTo(1.5, 1)
    expect(r1.events.some((e) => e.type === 'asteroidSpawned')).toBe(true)
    const r2 = await harness.act('wait', { advance: 3 })
    const all = harness.events(0)
    expect(all.events.map((e) => e.seq)).toEqual(all.events.map((_, i) => i + 1))
    expect(all.seq).toBe(all.events.length)
    expect(harness.events(r1.events.at(-1)!.seq).events).toEqual(r2.events)
    dispose()
  })

  test('invalid commands return an error and leave the state untouched', async () => {
    const { harness, dispose } = await open()
    const before = JSON.stringify(harness.state())
    for (const bad of ['bogus', 'choose 9', '12', 'choose 1', 'type 5', 'fire']) {
      const r = await harness.act(bad)
      expect(r.error).toBeString()
      expect(r.events).toEqual([])
    }
    expect(JSON.stringify(harness.state())).toBe(before)
    expect(harness.stepIndex).toBe(0)
    dispose()
  })

  test('an LLM-style session answers the target', async () => {
    const { harness, dispose } = await open()
    let r = await harness.act('wait', { advance: 2 })
    const first = r.state.asteroids[0]
    r = await harness.act(`lane ${first.lane}`, { advance: 0.5 })
    expect(r.state.target).toBe(first.id)
    expect(r.state.choices.length).toBe(4)
    r = await harness.act('c1', { advance: 2 })
    expect(r.events.some((e) => e.type === 'checkRequested')).toBe(true)
    expect(r.events.some((e) => e.type === 'hit' || e.type === 'wrongAnswer')).toBe(true)
    expect(harness.describe()).toContain('choose <1-4>')
    expect(JSON.stringify(r.state).length).toBeLessThan(1500)
    dispose()
  })

  test('snapshot hides answers', async () => {
    const { harness, dispose } = await open({ format: 'freeform' })
    await harness.act(null, { advance: 3 })
    const text = JSON.stringify(harness.state())
    expect(text).not.toContain('math-')
    expect(text).not.toContain('expected')
    dispose()
  })

  test('time controls: scale clamps, headless stays lockstep, step(n) runs n steps', async () => {
    const { harness, dispose } = await open()
    harness.time.setScale(10)
    expect(harness.time.scale).toBe(2)
    harness.time.setScale(0)
    expect(harness.time.scale).toBe(0.1)
    harness.time.setLockstep(false)
    expect(harness.time.lockstep).toBe(true)
    harness.time.step(7)
    expect(harness.stepIndex).toBe(7)
    dispose()
  })

  test('browser mode: act() waits on the injected loop when lockstep is off', async () => {
    const session = await createShooterSession({ plugin: plugins.math, params: {}, seed: 2 })
    const changes: boolean[] = []
    const harness = createShooterHarness({
      engine: session.engine,
      source: session.source,
      meta: { generatorId: 'math', params: {}, seed: 2, settings: { lanes: 4 } },
      // Stand-in for the view's loop: tick n times on a later macrotask.
      advanceSteps: (n) => new Promise((resolve) => setTimeout(() => {
        for (let i = 0; i < n; i++) harness.tick()
        resolve()
      }, 1)),
      onTimeChange: (t) => changes.push(t.lockstep),
    })
    expect(harness.time.lockstep).toBe(false)
    await harness.act(null, { advance: 1 })
    expect(harness.stepIndex).toBe(60)
    harness.time.setLockstep(true)
    await harness.act(null, { advance: 1 })
    expect(harness.stepIndex).toBe(120)
    expect(changes).toEqual([true])
    harness.dispose()
    session.dispose()
  })

  test('a check that never settles is voided after the real-time timeout', async () => {
    const session = await createShooterSession({ plugin: plugins.math, params: { format: 'mc' }, seed: 3 })
    const harness = createShooterHarness({
      engine: session.engine,
      source: session.source,
      check: () => new Promise<never>(() => {}),
      checkTimeoutMs: 50,
      meta: { generatorId: 'math', params: { format: 'mc' }, seed: 3, settings: { lanes: 4 } },
    })
    let r = await harness.act(null, { advance: 2 })
    r = await harness.act(`lane ${r.state.asteroids[0].lane}`)
    r = await harness.act('choose 1', { advance: 2 })
    expect(r.events.some((e) => e.type === 'checkVoided')).toBe(true)
    expect(harness.pendingChecks()).toBe(0)
    expect(r.state.asteroids.every((a) => !a.pending)).toBe(true)
    harness.dispose()
    session.dispose()
  })

  test('slow checks (~1.5 s) are awaited and resolve, not void', async () => {
    const { harness, dispose } = await openHeadless({ plugin: plugins.fixture, params: { set: 'slow' }, seed: 1 })
    let r = await harness.act(null, { advance: 2 })
    r = await harness.act(`lane ${r.state.asteroids[0].lane}`)
    const answer = r.state.inputMode === 'multiple-choice' ? 'choose 1' : 'answer 1'
    const started = performance.now()
    r = await harness.act(answer, { advance: 1.5 })
    expect(performance.now() - started).toBeGreaterThan(1300)
    expect(r.events.some((e) => e.type === 'checkRequested')).toBe(true)
    expect(r.events.some((e) => e.type === 'hit' || e.type === 'wrongAnswer')).toBe(true)
    expect(r.events.some((e) => e.type === 'checkVoided')).toBe(false)
    dispose()
  }, 10_000)
})

describe('bots', () => {
  test('oracle and wrong refuse hybrid generators; random does not', () => {
    const plugin = { id: 'kindermath', kind: 'hybrid' as const }
    expect(() => createBot('oracle', { plugin })).toThrow(/hybrid/)
    expect(() => createBot('wrong', { plugin })).toThrow(/hybrid/)
    expect(() => createBot('random', { plugin })).not.toThrow()
  })

  test('oracle finds answers only through check()', async () => {
    const session = await createShooterSession({ plugin: plugins.math, params: { format: 'freeform' }, seed: 1 })
    const checked: string[] = []
    const source = { check: (p: Problem, given: string) => (checked.push(given), session.source.check(p, given)) }
    const bot = createBot('oracle', { plugin: plugins.math })
    const state = session.engine.state as GameState
    for (let i = 0; i < 400 && state.targetId === null; i++) {
      session.engine.step()
      if (state.asteroids[0] && state.ship.lane !== state.asteroids[0].lane) session.engine.dispatch({ type: 'moveToLane', lane: state.asteroids[0].lane })
    }
    const commands = await bot.decide({ state, source })
    expect(checked.length).toBe(1)
    expect(commands[0]).toMatch(/^answer \d+$/)
    session.dispose()
  })
})
