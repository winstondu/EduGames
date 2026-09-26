/**
 * Headless harness sessions and bot games (DEV ONLY), shared by
 * scripts/sim.ts and the soak tests.
 */
import type { Replay } from '../../../shared/harness/types'
import type { GameState } from '../engine/types'
import { createShooterHarness, DEFAULT_ADVANCE_SECONDS, type ShooterHarness } from './adapter'
import { createBot, type BotName } from './bots'
import { createInvariantChecker } from './invariants'
import { createShooterSession, type ShooterSession, type ShooterSessionOptions } from './session'

export interface HeadlessOptions extends ShooterSessionOptions {
  checkTimeoutMs?: number
}

export interface Headless {
  session: ShooterSession
  harness: ShooterHarness
  dispose(): void
}

/** Session + lockstep harness, stepping itself. */
export async function openHeadless(opts: HeadlessOptions): Promise<Headless> {
  const session = await createShooterSession(opts)
  const harness = createShooterHarness({
    engine: session.engine,
    source: session.source,
    checkTimeoutMs: opts.checkTimeoutMs,
    meta: { generatorId: opts.plugin.id, params: { ...opts.params }, seed: opts.seed, settings: { lanes: session.lanes } },
  })
  return {
    session,
    harness,
    dispose() {
      harness.dispose()
      session.dispose()
    },
  }
}

export interface BotGameOptions extends HeadlessOptions {
  bot: BotName
  /** Game seconds per decision (default 0.5). */
  advance?: number
  /** Stop after this much play time (default 120 s). */
  maxSeconds?: number
}

export interface BotGameResult {
  bot: BotName
  seed: number
  score: number
  level: number
  correct: number
  wrong: number
  /** correct / (correct + wrong); null before any answer. */
  accuracy: number | null
  /** Seconds of play. */
  duration: number
  ended: 'over' | 'timeout'
  commandErrors: number
  violations: string[]
  violationCount: number
  replay: Replay
  /** Final engine state (compare with a replay's for determinism). */
  final: GameState
}

export async function runBotGame(opts: BotGameOptions): Promise<BotGameResult> {
  const bot = createBot(opts.bot, { plugin: opts.plugin, seed: opts.seed })
  const { harness, session, dispose } = await openHeadless(opts)
  const invariants = createInvariantChecker()
  harness.subscribe((events, state) => invariants.observe(events, state))
  const advance = opts.advance ?? DEFAULT_ADVANCE_SECONDS
  const maxSeconds = opts.maxSeconds ?? 120
  let commandErrors = 0
  try {
    while (session.engine.state.status !== 'over' && session.engine.state.time < maxSeconds) {
      const commands = await bot.decide({ state: session.engine.state, source: session.source })
      for (const c of commands.slice(0, -1)) if (harness.send(c).error) commandErrors++
      const result = await harness.act(commands.at(-1) ?? null, { advance })
      if (result.error) commandErrors++
    }
    if (!(await harness.settle()) || harness.pendingChecks() > 0) invariants.fail('checks still in flight after settle()')
  } finally {
    dispose()
  }
  const s = session.engine.state
  const answered = s.correct + s.wrong
  return {
    bot: opts.bot,
    seed: opts.seed,
    score: s.score,
    level: s.level,
    correct: s.correct,
    wrong: s.wrong,
    accuracy: answered ? s.correct / answered : null,
    duration: Math.round(s.time * 10) / 10,
    ended: s.status === 'over' ? 'over' : 'timeout',
    commandErrors,
    violations: invariants.violations,
    violationCount: invariants.count,
    replay: harness.exportReplay(),
    final: s,
  }
}
