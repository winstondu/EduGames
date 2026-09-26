import { describe, expect, test } from 'bun:test'
import { MAX_CHOICES } from './space-shooter/engine/types'
import { SHOOTER_REQUIREMENTS } from './space-shooter/harness/session'
import { findGame, gameRequirements } from './registry'

describe('game registry', () => {
  test('space shooter declares the choice limit its engine and harness use', () => {
    const game = findGame('space-shooter')!
    expect(game.maxChoices).toBe(MAX_CHOICES)
    expect(gameRequirements(game)).toEqual({ formats: game.formats, maxChoices: MAX_CHOICES })
    expect(SHOOTER_REQUIREMENTS).toEqual(gameRequirements(game))
  })

  test('gameRequirements can narrow the formats', () => {
    const game = findGame('space-shooter')!
    expect(gameRequirements(game, ['freeform'])).toEqual({ formats: ['freeform'], maxChoices: game.maxChoices })
  })
})
