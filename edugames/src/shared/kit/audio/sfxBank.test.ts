import { beforeAll, describe, expect, test } from 'bun:test'
import { AudioDirector } from './AudioDirector'
import { SFX_BANK, SFX_NAMES } from './sfxBank'

type Zzfx = typeof import('zzfx')
let zzfx: Zzfx

beforeAll(async () => {
  // zzfx constructs an AudioContext at import; Bun has none, so stub it.
  const g = globalThis as { AudioContext?: unknown }
  const had = 'AudioContext' in g
  if (!had) g.AudioContext = class {}
  zzfx = await import('zzfx')
  if (!had) delete g.AudioContext
})

describe('SFX bank', () => {
  test('has every named effect', () => {
    expect(SFX_NAMES.sort()).toEqual(['blip', 'boing', 'clang', 'click', 'crunch', 'gameOver', 'levelUp', 'powerup', 'zap'])
  })

  test('each effect renders short, finite, audible, unclipped samples', () => {
    for (const name of SFX_NAMES) {
      const params = [...SFX_BANK[name]]
      params[1] = 0
      const samples = zzfx.ZZFX.buildSamples(...params)
      const seconds = samples.length / zzfx.ZZFX.sampleRate
      const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0)
      expect(samples.every(Number.isFinite), name).toBe(true)
      expect(seconds, name).toBeGreaterThan(0.02)
      expect(seconds, name).toBeLessThan(1.6)
      expect(peak, name).toBeGreaterThan(0.05)
      expect(peak, name).toBeLessThanOrEqual(1)
    }
  })
})

describe('AudioDirector without Web Audio', () => {
  test('every method is a safe no-op and mute toggles', async () => {
    const audio = new AudioDirector({ storageKey: 'test.muted' })
    await audio.unlock()
    expect(audio.unlocked).toBe(false)
    audio.sfx('zap')
    audio.music('play')
    expect(audio.track).toBe('play')
    let changes = 0
    audio.subscribe(() => changes++)
    const muted = audio.muted
    expect(audio.toggleMuted()).toBe(!muted)
    expect(changes).toBe(1)
    audio.setMuted(!muted) // unchanged → no event
    expect(changes).toBe(1)
    audio.dispose()
    audio.music('menu')
    expect(audio.track).toBe('play')
  })
})
