import { describe, expect, test } from 'bun:test'
import { EntityPool } from './pool'

interface Item {
  id: number
  x: number
}

function harness() {
  const log: string[] = []
  let created = 0
  const pool = new EntityPool<Item, { n: number; x: number; bound: number }>({
    create: () => ({ n: ++created, x: 0, bound: 0 }),
    bind: (a, item) => {
      a.bound = item.id
      log.push(`bind ${a.n}←${item.id}`)
    },
    update: (a, item) => {
      a.x = item.x
    },
    release: (a) => log.push(`release ${a.n}`),
  })
  return { pool, log, created: () => created }
}

describe('EntityPool', () => {
  test('binds once per entity, updates every sync', () => {
    const { pool, log } = harness()
    pool.sync([{ id: 7, x: 1 }])
    pool.sync([{ id: 7, x: 2 }])
    expect(log).toEqual(['bind 1←7'])
    expect(pool.get(7)?.x).toBe(2)
  })

  test('releases vanished entities and recycles their actors', () => {
    const { pool, log, created } = harness()
    pool.sync([
      { id: 1, x: 0 },
      { id: 2, x: 0 },
    ])
    pool.sync([{ id: 2, x: 0 }])
    expect(log).toContain('release 1')
    expect(pool.get(1)).toBeUndefined()
    pool.sync([
      { id: 2, x: 0 },
      { id: 3, x: 0 },
    ])
    expect(created()).toBe(2)
    expect(pool.get(3)?.n).toBe(1)
    expect(pool.size).toBe(2)
    expect(pool.all()).toHaveLength(2)
  })

  test('empty sync releases everything', () => {
    const { pool } = harness()
    pool.sync([{ id: 1, x: 0 }])
    pool.sync([])
    expect(pool.size).toBe(0)
    expect(pool.all()).toHaveLength(1)
  })
})
