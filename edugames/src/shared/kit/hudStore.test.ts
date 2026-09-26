import { describe, expect, test } from 'bun:test'
import { createHudStore } from './hudStore'

function game() {
  const state = { score: 0, revision: 0 }
  let reads = 0
  const store = createHudStore(
    () => {
      reads++
      return { score: state.score }
    },
    () => state.revision,
  )
  return { state, store, reads: () => reads }
}

describe('createHudStore', () => {
  test('snapshot is stable until the version changes', () => {
    const { state, store, reads } = game()
    const a = store.getSnapshot()
    state.score = 10 // no revision bump → not visible yet
    expect(store.getSnapshot()).toBe(a)
    state.revision++
    const b = store.getSnapshot()
    expect(b).not.toBe(a)
    expect(b.score).toBe(10)
    expect(store.getSnapshot()).toBe(b)
    expect(reads()).toBe(2)
  })

  test('poke notifies only when the version moved', () => {
    const { state, store } = game()
    let calls = 0
    const unsubscribe = store.subscribe(() => calls++)
    store.poke()
    expect(calls).toBe(0)
    state.revision++
    store.poke()
    store.poke()
    expect(calls).toBe(1)
    unsubscribe()
    state.revision++
    store.poke()
    expect(calls).toBe(1)
  })

  test('poke still notifies after a render already read the new snapshot', () => {
    const { state, store } = game()
    let calls = 0
    store.subscribe(() => calls++)
    state.revision++
    store.getSnapshot()
    store.poke()
    expect(calls).toBe(1)
  })
})
