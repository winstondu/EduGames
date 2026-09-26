import type { ProblemFormat, ProblemRequirements } from '../generators/types'
import type { GameDefinition } from './types'

export const GAMES: readonly GameDefinition[] = [
  {
    id: 'space-shooter',
    name: 'Space Shooter',
    description: 'Blast asteroids by answering the problems they carry.',
    formats: ['freeform', 'multiple-choice'],
    // The choice strip has four slots (engine MAX_CHOICES; keys 1–4).
    maxChoices: 4,
    load: () => import('./space-shooter/ui/SpaceShooterGame'),
  },
]

export function findGame(id: string): GameDefinition | undefined {
  return GAMES.find((g) => g.id === id)
}

/** Formats a game can present for a generator; empty → incompatible pair. */
export function compatibleFormats(game: GameDefinition, generatorFormats: readonly ProblemFormat[]): ProblemFormat[] {
  return game.formats.filter((f) => generatorFormats.includes(f))
}

/** What `game` asks of a generator's create(): its formats (optionally narrowed) and choice limit. */
export function gameRequirements(game: GameDefinition, formats: readonly ProblemFormat[] = game.formats): ProblemRequirements {
  return { formats, maxChoices: game.maxChoices }
}
