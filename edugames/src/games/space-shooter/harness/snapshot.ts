/**
 * Compact, player-visible snapshot of the space shooter (DEV ONLY), ~1 KB of
 * JSON for an LLM or a bot: what is on screen, never hidden engine state
 * (no answers, no rng, no problem ids). `describe()` explains it.
 */
import type { AnswerInputSpec, ProblemFormat } from '../../../generators/types'
import { CHECK_TIMEOUT_SECONDS, MAX_LIVES, SHIELD_HITS, WORLD, type GameEvent, type GameState, type GameStatus, type PowerupKind } from '../engine/types'
import { COMMANDS } from './commands'

/** Ship front edge; snapshot `x` values are distances from here (world units). */
export const SHIP_EDGE = WORLD.shipX + WORLD.shipHalfLength

export interface AsteroidSnapshot {
  id: number
  lane: number
  /** Distance of the asteroid centre from the ship's front edge (rounded). */
  x: number
  /** Seconds until it reaches the ship edge at its current speed (null while pending). */
  eta: number | null
  prompt: string
  format: ProblemFormat
  /** A shot at it is being checked; it is frozen and immune until the verdict. */
  pending: boolean
}

export interface ShooterSnapshot {
  status: GameStatus
  time: number
  score: number
  lives: number
  level: number
  streak: number
  correct: number
  wrong: number
  shield: number
  effects: { kind: string; remaining: number }[]
  lanes: number
  ship: { lane: number }
  target: number | null
  inputMode: ProblemFormat | null
  input: AnswerInputSpec
  quiver: string
  choices: { n: number; text: string }[]
  asteroids: AsteroidSnapshot[]
  powerups: { lane: number; x: number; kind: PowerupKind }[]
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function snapshot(s: GameState): ShooterSnapshot {
  return {
    status: s.status,
    time: round1(s.time),
    score: s.score,
    lives: s.lives,
    level: s.level,
    streak: s.streak,
    correct: s.correct,
    wrong: s.wrong,
    shield: s.shield,
    effects: s.effects.map((e) => ({ kind: e.kind, remaining: round1(e.remaining) })),
    lanes: s.lanes,
    ship: { lane: s.ship.lane },
    target: s.targetId,
    inputMode: s.inputMode,
    input: s.input,
    quiver: s.quiver,
    choices: s.choices.map((c, i) => ({ n: i + 1, text: c.text })),
    asteroids: s.asteroids
      .slice()
      .sort((a, b) => a.x - b.x || a.id - b.id)
      .map((a) => {
        const x = Math.round(a.x - SHIP_EDGE)
        return {
          id: a.id,
          lane: a.lane,
          x,
          eta: a.pending || a.speed <= 0 ? null : round1(Math.max(0, a.x - a.radius - SHIP_EDGE) / a.speed),
          prompt: a.problem.prompt,
          format: a.problem.format,
          pending: a.pending,
        }
      }),
    powerups: s.powerups.map((p) => ({ lane: p.lane, x: Math.round(p.x - SHIP_EDGE), kind: p.kind })),
  }
}

/** Event as reported to harness clients: engine event minus bulky payloads, plus a sequence number. */
export type HarnessEvent = { seq: number } & (Exclude<GameEvent, { type: 'checkRequested' }> | { type: 'checkRequested'; checkId: number; asteroidId: number; given: string })

export function compactEvent(event: GameEvent, seq: number): HarnessEvent {
  if (event.type === 'checkRequested') return { seq, type: event.type, checkId: event.checkId, asteroidId: event.asteroidId, given: event.given }
  return { seq, ...event }
}

/** Rules + commands + legend, written for an LLM driving the harness. */
export function describe(): string {
  const commands = COMMANDS.map((c) => `  ${c.usage.padEnd(14)} ${c.description}`).join('\n')
  return `SPACE SHOOTER (EduGames) — harness session (unrecorded: scores are never submitted).

RULES
- Your ship sits at its edge (left, or right when the player flies right → left; the state is the same either way:
  x is the distance from the ship's edge) and can be in one of \`lanes\` horizontal lanes (0 = top).
- Asteroids fly toward you, each carrying a problem (\`prompt\`, may contain $…$ TeX math).
- The TARGET is the nearest non-pending asteroid in the ship's lane. Answer it:
    multiple-choice (inputMode "multiple-choice"): "choose <n>" fires choice n;
    freeform (inputMode "freeform"): "type <text>" then "fire" (or "answer <text>").
- A shot flies down the ship's lane and hits the first asteroid there. The asteroid freezes
  (pending) while the answer is checked. Correct → destroyed, points (10×level + streak bonus).
  Wrong → it keeps coming and your streak resets. Some generators check answers on a server, so
  a check can take real time: act() waits for it. A check that fails or takes over
  ${CHECK_TIMEOUT_SECONDS} s is voided without penalty (event checkVoided; the player sees "…lost signal"): the
  asteroid stays and can be answered again, and neither correct nor wrong changes.
- An asteroid reaching the ship (x ≤ 0 in your lane) or getting past it (other lanes) costs a life; a shield absorbs up to
  ${SHIELD_HITS} hits. 0 lives → game over. Max lives ${MAX_LIVES}.
- Powerups drift toward you too; be in their lane when they arrive to collect them: extraLife, scoreBoost (×2 points),
  doubleShots (a hit also destroys the next asteroid in that lane), shield, speedBoost, random.
- Moving lanes takes a moment (~0.15 s per lane); the target follows the ship.
- Level rises every 8 correct answers; asteroids get faster and denser (generators may also get harder,
  e.g. math brings in −, ×, ÷ at later levels).

COMMANDS (one per call; case-insensitive; "c2", "l0", "t 12" also work)
${commands}

STATE LEGEND
  status     playing | paused | over          time    seconds of play
  lives, shield, score, level, streak, correct, wrong
  effects    active powerups [{kind, remaining s}]
  lanes      lane count; ship.lane = ship's lane
  target     id of the asteroid your answer will hit (null = none in your lane)
  inputMode  format of the target's problem; input = allowed characters (kind/maxLength/allow)
  quiver     freeform text typed so far; choices = [{n, text}] for multiple choice
  asteroids  sorted nearest-first: {id, lane, x = distance from ship edge, eta = seconds to
             impact, prompt, format, pending}
  powerups   [{lane, x, kind}]

TIPS: move to the lane of the most urgent asteroid (smallest eta) first, then answer it.
Each act advances time (default 0.5 s); events report hits, wrong answers, lives lost.`
}
