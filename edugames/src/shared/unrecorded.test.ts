import { afterEach, describe, expect, test } from 'bun:test'
import { UNRECORDED_KEY, isUnrecorded, setUnrecorded } from './unrecorded'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

const throwing = {
  getItem(): string | null {
    throw new Error('denied')
  },
  setItem() {
    throw new Error('denied')
  },
  removeItem() {
    throw new Error('denied')
  },
}

describe('isUnrecorded', () => {
  test('off by default', () => {
    expect(isUnrecorded({ search: '', local: memoryStorage(), session: memoryStorage() })).toBe(false)
    expect(isUnrecorded({})).toBe(false)
  })

  test('URL param turns it on and sticks for the tab', () => {
    const session = memoryStorage()
    expect(isUnrecorded({ search: '?gen=math&unrecorded=1', session })).toBe(true)
    expect(session.data.get(UNRECORDED_KEY)).toBe('1')
    expect(isUnrecorded({ search: '?gen=math', session })).toBe(true)
    expect(isUnrecorded({ search: '?unrecorded=0', session: memoryStorage() })).toBe(false)
  })

  test('localStorage flag turns it on; setUnrecorded toggles it', () => {
    const local = memoryStorage()
    const session = memoryStorage()
    setUnrecorded(true, { local, session })
    expect(local.data.get(UNRECORDED_KEY)).toBe('1')
    expect(isUnrecorded({ local, session })).toBe(true)
    isUnrecorded({ search: '?unrecorded=1', local, session })
    setUnrecorded(false, { local, session })
    expect(isUnrecorded({ local, session })).toBe(false)
  })

  test('blocked storage never throws', () => {
    expect(isUnrecorded({ search: '?unrecorded=1', local: throwing, session: throwing })).toBe(true)
    expect(isUnrecorded({ local: throwing, session: throwing })).toBe(false)
    expect(() => setUnrecorded(true, { local: throwing, session: throwing })).not.toThrow()
  })
})

describe('browser globals', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.location
    delete g.localStorage
    delete g.sessionStorage
  })

  test('reads location / storage from globalThis by default', () => {
    const local = memoryStorage()
    const session = memoryStorage()
    g.location = { search: '?unrecorded=1' }
    g.localStorage = local
    g.sessionStorage = session
    expect(isUnrecorded()).toBe(true)
    expect(session.data.get(UNRECORDED_KEY)).toBe('1')
    g.location = { search: '' }
    setUnrecorded(false)
    expect(isUnrecorded()).toBe(false)
    setUnrecorded(true)
    expect(isUnrecorded()).toBe(true)
  })
})
