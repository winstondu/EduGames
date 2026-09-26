import { describe, expect, test } from 'bun:test'
import type { GameHarness, HarnessTime } from './types'
import { currentHarness, registerHarness, reportOpenFailure, takeOpenRequest } from './runtime'

function fakeHarness(): GameHarness & { time: HarnessTime } {
  const time: HarnessTime = {
    scale: 1,
    lockstep: false,
    setScale(s) {
      time.scale = s
    },
    setLockstep(on) {
      time.lockstep = on
    },
    step() {},
  }
  return {
    gameId: 'g',
    describe: () => '',
    commands: [],
    state: () => ({}),
    send: () => ({ state: {}, events: [] }),
    act: async () => ({ state: {}, events: [] }),
    events: () => ({ seq: 0, events: [] }),
    time,
    exportReplay: () => ({ version: 1, gameId: 'g', generatorId: 'x', params: {}, seed: 0, settings: {}, log: [], checks: {} }),
  }
}

const entry = (harness: GameHarness) => ({ harness, game: 'g', generatorId: 'x', params: {}, seed: 1, settings: {} })

describe('harness runtime (no window)', () => {
  test('register / unregister tracks the current session', () => {
    const harness = fakeHarness()
    const unregister = registerHarness(entry(harness))
    expect(currentHarness()?.harness).toBe(harness)
    unregister()
    expect(currentHarness()).toBeNull()
  })

  test('a stale unregister does not clear a newer session', () => {
    const first = registerHarness(entry(fakeHarness()))
    const second = fakeHarness()
    const unregister = registerHarness(entry(second))
    first()
    expect(currentHarness()?.harness).toBe(second)
    unregister()
  })

  test('a session only resolves the open() request it was built for', async () => {
    const navigated: string[] = []
    const { installHarnessRuntime } = await import('./runtime')
    ;(globalThis as { window?: unknown }).window ??= globalThis
    installHarnessRuntime({ navigate: (to) => navigated.push(to), panel: false })
    const api = (globalThis as unknown as { __edugames: import('./types').HarnessGlobal }).__edugames
    const opened = api.open({ game: 'g', gen: 'x', seed: 9 })
    const url = new URL(navigated.at(-1)!, 'http://local')
    const request = takeOpenRequest('g', 'x', url.searchParams)!
    expect(request.seed).toBe(9)
    expect(takeOpenRequest('g', 'x', new URLSearchParams({ harness: 'stale' }))).toBeNull()
    // A stale session for the same game + generator doesn't resolve it…
    const stale = registerHarness(entry(fakeHarness()))
    let settled = false
    void opened.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    stale()
    // …the one built for the request does.
    const unregister = registerHarness({ ...entry(fakeHarness()), requestId: request.id })
    expect((await opened).seed).toBe(1)
    unregister()
  })

  test('without an open() request there is nothing to claim or fail', () => {
    expect(takeOpenRequest('g', 'x', new URLSearchParams())).toBeNull()
    expect(() => reportOpenFailure('g', 'boom')).not.toThrow()
  })
})
