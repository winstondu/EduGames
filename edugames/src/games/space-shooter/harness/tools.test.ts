import { afterEach, describe, expect, test } from 'bun:test'
import fixture from '../../../generators/fixture/index'
import kindermath from '../../../generators/kindermath/index'
import math from '../../../generators/math/index'
import type { GeneratorPlugin } from '../../../generators/types'
import { createHarnessTools, HARNESS_TOOLS } from './tools'

const PLUGINS: Record<string, GeneratorPlugin<unknown>> = {
  math: math as GeneratorPlugin<unknown>,
  fixture: fixture as GeneratorPlugin<unknown>,
  kindermath: kindermath as GeneratorPlugin<unknown>,
}
const tools = createHarnessTools({ loadPlugin: async (id) => PLUGINS[id] ?? null, generatorIds: async () => Object.keys(PLUGINS) })
afterEach(() => tools.dispose())

describe('harness tools', () => {
  test('every tool has an object schema and a description', () => {
    for (const t of HARNESS_TOOLS) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.description.length).toBeGreaterThan(20)
    }
    expect(new Set(HARNESS_TOOLS.map((t) => t.name)).size).toBe(HARNESS_TOOLS.length)
  })

  test('open → act → export → replay reproduces the state', async () => {
    const opened = await tools.call('open_session', { gen: 'math', params: { format: 'freeform', ops: 'add' }, seed: 5, lanes: 3 })
    expect(opened.isError).toBeFalsy()
    expect((opened.value as { describe: string }).describe).toContain('RULES')
    const acted = await tools.call('act', { command: 'lane 2', advance: 3 })
    expect((acted.value as { state: { ship: { lane: number } } }).state.ship.lane).toBe(2)
    await tools.call('step', { n: 120 })
    const replay = (await tools.call('export_replay', {})).value
    const state = (await tools.call('state', {})).value
    const replayed = await tools.call('run_replay', { replay })
    expect((replayed.value as { state: unknown }).state).toEqual(state)
  })

  test('errors come back as isError results, not throws', async () => {
    expect((await tools.call('act', {})).isError).toBe(true) // no session
    expect((await tools.call('open_session', { gen: 'nope' })).isError).toBe(true)
    expect((await tools.call('open_session', { gen: 'kindermath' })).isError).toBe(true) // hybrid, offline
    expect((await tools.call('step', { n: 0 })).isError).toBe(true)
    expect((await tools.call('bogus', {})).isError).toBe(true)
    await tools.call('open_session', { gen: 'math' })
    const bad = await tools.call('act', { command: 'choose 9' })
    expect(bad.isError).toBeFalsy()
    expect((bad.value as { error?: string }).error).toBeTruthy()
  })

  test('list_generators, run_bots and conformance', async () => {
    const list = (await tools.call('list_generators', {})).value as { id: string; offline: boolean }[]
    expect(list.map((g) => g.id).sort()).toEqual(['fixture', 'kindermath', 'math'])
    expect(list.find((g) => g.id === 'kindermath')?.offline).toBe(false)
    const bots = (await tools.call('run_bots', { gen: 'math', games: 1, maxSeconds: 30 })).value as { deterministic: boolean; violations: string[] }[]
    expect(bots[0].deterministic).toBe(true)
    expect(bots[0].violations).toEqual([])
    const report = (await tools.call('conformance', { gen: 'fixture', cases: [{ set: 'mixed' }] })).value as { issues: unknown[] }
    expect(report.issues).toEqual([])
  })
})
