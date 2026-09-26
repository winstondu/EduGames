import { describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS, needsRestart, sanitizeSettings } from './settings'
import { isSlowMotion } from './ui/controls'

describe('settings', () => {
  test('speed is sanitized to a GameSpeed (default 1)', () => {
    expect(sanitizeSettings({ speed: 0.5 }).speed).toBe(0.5)
    expect(sanitizeSettings({ speed: '0.25' }).speed).toBe(0.25)
    expect(sanitizeSettings({ speed: 0.3 }).speed).toBe(1)
    expect(sanitizeSettings({}).speed).toBe(1)
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  test('only ship, direction and lanes need a restart; speed applies live', () => {
    expect(needsRestart(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, speed: 0.5 })).toBe(false)
    expect(needsRestart(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, lanes: 5 })).toBe(true)
    expect(needsRestart(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, direction: 'rtl' })).toBe(true)
    expect(needsRestart(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, ship: 'scout' })).toBe(true)
  })

  test('slow-motion leaderboard badge', () => {
    expect(isSlowMotion({ speed: 0.75 })).toBe(true)
    expect(isSlowMotion({ speed: 1 })).toBe(false)
    expect(isSlowMotion({})).toBe(false)
    expect(isSlowMotion(undefined)).toBe(false)
  })
})
