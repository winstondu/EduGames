/**
 * Game contract. Games and generators compose freely (m + n, not m × n):
 * a game declares which problem formats it can present, and the launcher
 * offers only generators whose `formats` overlap.
 */
import type { ComponentType } from 'react'
import type { ProblemFormat } from '../generators/types'

export interface GameProps {
  /** Resolved generator id from the URL (`gen`). */
  generatorId: string
  /** All URL params (generator options included). */
  params: URLSearchParams
  /** Navigate back to the launcher. */
  onExit(): void
}

export interface GameDefinition {
  /** URL path segment and leaderboard gameId, e.g. "space-shooter". */
  id: string
  name: string
  description: string
  /** Formats this game can present; passed to plugin.create() as requirements. */
  formats: readonly ProblemFormat[]
  /** Most choices one multiple-choice problem may have (requirements.maxChoices). */
  maxChoices: number
  /** Lazy-loaded game screen (keeps each game's engine/renderer out of the launcher bundle). */
  load(): Promise<{ default: ComponentType<GameProps> }>
}
