/**
 * Scripted players for soak tests and the simulator (DEV ONLY). Bots emit
 * text commands (so they exercise the parser) from the live state.
 *  - random: mashes random commands.
 *  - wrong:  lines up on the most urgent asteroid and answers it wrongly.
 *  - oracle: lines up and answers correctly.
 * Generic over generators: answers are found only through ProblemSource.check
 * (each choice id for multiple choice; a wrong probe's `expected` for
 * freeform). Probing calls check(), so oracle/wrong refuse hybrid generators,
 * whose checks would reach upstream services.
 */
import { createRng, randInt, type Rng } from '../../../shared/rng'
import type { CheckResult, GeneratorPlugin, Problem, ProblemSource } from '../../../generators/types'
import { acceptsChar } from '../engine/input'
import { WORLD, type AsteroidState, type GameState } from '../engine/types'

export type BotName = 'random' | 'wrong' | 'oracle'

export const BOT_NAMES: readonly BotName[] = ['random', 'wrong', 'oracle']

export interface BotView {
  state: GameState
  source: Pick<ProblemSource, 'check'>
}

export interface Bot {
  name: BotName
  /** Commands to send now (may be empty = wait). */
  decide(view: BotView): Promise<string[]>
}

/** Freeform probe no sane checker accepts. */
const PROBE = '␀probe'

async function probe(source: BotView['source'], problem: Problem, given: string): Promise<CheckResult | null> {
  try {
    return await source.check(problem, given)
  } catch {
    return null
  }
}

/** Non-pending asteroids ahead of the ship, most urgent (soonest impact) first. */
function threats(s: GameState): AsteroidState[] {
  const eta = (a: AsteroidState) => (a.x - WORLD.shipX) / Math.max(a.speed, 1)
  return s.asteroids.filter((a) => !a.pending && a.x > WORLD.shipX).sort((a, b) => eta(a) - eta(b) || a.id - b.id)
}

function boltInFlight(s: GameState, a: AsteroidState): boolean {
  return s.bolts.some((b) => b.lane === a.lane && b.x < a.x)
}

type Solver = (problem: Problem, s: GameState, source: BotView['source']) => Promise<string | null>

/** Shared aiming loop: go to the most urgent unshot asteroid's lane, answer the target. */
function aimer(name: BotName, solve: Solver): Bot {
  return {
    name,
    async decide({ state: s, source }) {
      if (s.status !== 'playing') return []
      const next = threats(s).find((a) => !boltInFlight(s, a))
      if (!next) return []
      if (s.ship.lane !== next.lane) return [`lane ${next.lane}`]
      const target = s.asteroids.find((a) => a.id === s.targetId)
      if (!target || boltInFlight(s, target)) return []
      const command = await solve(target.problem, s, source)
      return command ? [command] : []
    },
  }
}

function freeformText(text: string, s: GameState): string | null {
  return [...text].every((c) => acceptsChar(s.input, c)) ? text : null
}

function oracle(): Bot {
  const answers = new Map<string, string>()
  return aimer('oracle', async (problem, s, source) => {
    const known = answers.get(problem.id)
    if (known) return known
    let command: string | null = null
    if (problem.format === 'multiple-choice') {
      const choices = problem.choices ?? []
      const results = await Promise.all(choices.map((c) => probe(source, problem, c.id)))
      const i = results.findIndex((r) => r?.correct)
      if (i >= 0) command = `choose ${i + 1}`
    } else {
      const result = await probe(source, problem, PROBE)
      const text = result && !result.correct && result.expected ? freeformText(result.expected, s) : null
      if (text) command = `answer ${text}`
    }
    if (command) answers.set(problem.id, command)
    return command
  })
}

function wrong(): Bot {
  return aimer('wrong', async (problem, s, source) => {
    if (problem.format === 'multiple-choice') {
      const choices = problem.choices ?? []
      for (let i = 0; i < choices.length; i++) {
        const r = await probe(source, problem, choices[i].id)
        if (r && !r.correct) return `choose ${i + 1}`
      }
      return choices.length ? 'choose 1' : null
    }
    // Without a known `expected` (probe failed) a candidate may occasionally be right; fine for a soak bot.
    const expected = (await probe(source, problem, PROBE))?.expected
    const candidate = ['0', '1', '7', 'x'].find((c) => c !== expected && freeformText(c, s))
    return candidate ? `answer ${candidate}` : null
  })
}

function random(rng: Rng): Bot {
  const verbs = ['up', 'down', 'lane', 'choose', 'type', 'fire', 'answer', 'backspace', 'wait', 'wait']
  return {
    name: 'random',
    async decide({ state: s }) {
      if (s.status !== 'playing') return []
      const verb = verbs[Math.floor(rng() * verbs.length)]
      switch (verb) {
        case 'lane':
          return [`lane ${randInt(rng, 0, s.lanes - 1)}`]
        case 'choose':
          return [`choose ${randInt(rng, 1, 4)}`]
        case 'type':
          return [`type ${randInt(rng, 0, 9)}`]
        case 'answer':
          return [`answer ${randInt(rng, 0, 30)}`]
        default:
          return [verb]
      }
    },
  }
}

export interface BotOptions {
  plugin: Pick<GeneratorPlugin<unknown>, 'id' | 'kind'>
  seed?: number
}

export function createBot(name: BotName, opts: BotOptions): Bot {
  if (name !== 'random' && opts.plugin.kind === 'hybrid') {
    throw new Error(`${name} bot refuses hybrid generator "${opts.plugin.id}": probing checks would post to its upstream`)
  }
  switch (name) {
    case 'random':
      return random(createRng((opts.seed ?? 1) ^ 0xb07))
    case 'wrong':
      return wrong()
    case 'oracle':
      return oracle()
  }
}
