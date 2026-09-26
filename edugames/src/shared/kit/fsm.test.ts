import { describe, expect, test } from 'bun:test'
import { createMachine } from './fsm'

function screens() {
  return createMachine({
    initial: 'menu',
    states: {
      menu: { on: { start: 'playing' } },
      playing: { on: { pause: 'paused', die: 'over' } },
      paused: { on: { resume: 'playing', quit: 'menu' } },
      over: { on: { restart: 'playing', quit: 'menu' } },
    },
  })
}

describe('createMachine', () => {
  test('transitions on known events and ignores others', () => {
    const m = screens()
    expect(m.state).toBe('menu')
    expect(m.send('pause')).toBe(false)
    expect(m.state).toBe('menu')
    expect(m.send('start')).toBe(true)
    expect(m.state).toBe('playing')
    expect(m.can('resume')).toBe(false)
    expect(m.can('pause')).toBe(true)
    m.send('pause')
    m.send('quit')
    expect(m.state).toBe('menu')
  })

  test('notifies subscribers with state, previous and event', () => {
    const m = screens()
    const log: string[] = []
    const off = m.subscribe((s, prev, e) => log.push(`${prev}-${e}->${s}`))
    m.send('start')
    m.send('die')
    off()
    m.send('restart')
    expect(log).toEqual(['menu-start->playing', 'playing-die->over'])
    expect(m.state).toBe('playing')
  })

  test('infers state and event names', () => {
    const m = screens()
    // @ts-expect-error unknown event name
    m.send('jump')
    const s: 'menu' | 'playing' | 'paused' | 'over' = m.state
    expect(s).toBe('menu')
  })
})
