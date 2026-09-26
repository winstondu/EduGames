import { describe, expect, test } from 'bun:test'
import { createCheckBroker, type ResolveCheckCommand } from './checkBroker'

interface Result {
  correct: boolean
}

const req = (checkId: number, given = 'x') => ({ type: 'checkRequested', checkId, problem: { id: `p${checkId}` }, given })
const tick = () => new Promise((r) => setTimeout(r, 0))

function setup(check: (problem: { id: string }, given: string) => Result | Promise<Result>, timeoutMs?: number) {
  const dispatched: ResolveCheckCommand<Result>[] = []
  const broker = createCheckBroker<{ id: string }, Result>({ check, dispatch: (c) => dispatched.push(c), timeoutMs })
  return { broker, dispatched }
}

describe('createCheckBroker', () => {
  test('sync results dispatch immediately; other events are ignored', () => {
    const seen: string[] = []
    const { broker, dispatched } = setup((p, g) => {
      seen.push(`${p.id}:${g}`)
      return { correct: g === '42' }
    })
    broker.handle([{ type: 'fired' }, req(1, '42'), { type: 'hit' }, req(2, '7')])
    expect(seen).toEqual(['p1:42', 'p2:7'])
    expect(dispatched).toEqual([
      { type: 'resolveCheck', checkId: 1, result: { correct: true } },
      { type: 'resolveCheck', checkId: 2, result: { correct: false } },
    ])
    expect(broker.pending()).toBe(0)
  })

  test('async results dispatch on settle, in settle order', async () => {
    const resolvers = new Map<string, (r: Result) => void>()
    const { broker, dispatched } = setup((p) => new Promise((res) => resolvers.set(p.id, res)))
    broker.handle([req(1), req(2)])
    expect(dispatched).toEqual([])
    expect(broker.pending()).toBe(2)
    resolvers.get('p2')!({ correct: true })
    await tick()
    resolvers.get('p1')!({ correct: false })
    await tick()
    expect(dispatched.map((c) => [c.checkId, c.result?.correct])).toEqual([
      [2, true],
      [1, false],
    ])
    expect(broker.pending()).toBe(0)
  })

  test('throw or rejection → null result', async () => {
    const { broker, dispatched } = setup((p) => {
      if (p.id === 'p1') throw new Error('boom')
      return Promise.reject(new Error('network'))
    })
    broker.handle([req(1), req(2)])
    expect(dispatched).toEqual([{ type: 'resolveCheck', checkId: 1, result: null }])
    await tick()
    expect(dispatched[1]).toEqual({ type: 'resolveCheck', checkId: 2, result: null })
  })

  test('settlements after dispose are ignored', async () => {
    let resolve!: (r: Result) => void
    const { broker, dispatched } = setup(() => new Promise((res) => (resolve = res)))
    broker.handle([req(1)])
    broker.dispose()
    resolve({ correct: true })
    await tick()
    expect(dispatched).toEqual([])
    broker.handle([req(2)])
    expect(broker.pending()).toBe(0)
  })

  test('timeout resolves null once; late settlement ignored', async () => {
    let resolve!: (r: Result) => void
    const { broker, dispatched } = setup(() => new Promise((res) => (resolve = res)), 5)
    broker.handle([req(1)])
    await new Promise((r) => setTimeout(r, 20))
    expect(dispatched).toEqual([{ type: 'resolveCheck', checkId: 1, result: null }])
    resolve({ correct: true })
    await tick()
    expect(dispatched).toHaveLength(1)
  })

  test('duplicate in-flight checkIds start one check', async () => {
    let calls = 0
    const { broker, dispatched } = setup(async () => {
      calls++
      return { correct: true }
    })
    broker.handle([req(1), req(1)])
    await tick()
    expect(calls).toBe(1)
    expect(dispatched).toHaveLength(1)
  })
})
