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

  test('without an open() request there is nothing to claim or fail', () => {
    expect(takeOpenRequest('g', 'x')).toBeNull()
    expect(() => reportOpenFailure('g', 'boom')).not.toThrow()
  })
})
