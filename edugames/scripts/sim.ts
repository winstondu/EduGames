/**
 * Headless space-shooter simulator (dev tooling; never bundled). Drives the
 * same GameHarness adapter the browser exposes, against the pure engine.
 *
 *   bun run sim -- --gen math --params 'format=mc&ops=add,sub' --bot oracle --games 5
 *   bun run sim -- --gen fixture --params set=long --repl        (one command per stdin line)
 *   bun run sim -- --replay run.json
 *
 * Flags: --gen <id> --params <query> --seed <n> --lanes <3-5> --bot oracle|random|wrong
 *   --games <n> --advance <s> --max-seconds <s> --replay <file> --export <file> --repl
 *
 * --repl prints one JSON line per input line: first {describe, state}, then
 * {state, events[, error]}. Input lines are commands ("choose 2", "lane 0") or
 * JSON {"command": "...", "advance": 1}. Generators load straight from
 * src/generators/<id>/index.ts and run offline (hybrid ones can't).
 */
import { readFile, writeFile } from 'node:fs/promises'
import type { GeneratorPlugin } from '../src/generators/types'
import type { Replay } from '../src/shared/harness/types'
import { DEFAULT_ADVANCE_SECONDS } from '../src/games/space-shooter/harness/adapter'
import { BOT_NAMES, type BotName } from '../src/games/space-shooter/harness/bots'
import { runReplay } from '../src/games/space-shooter/harness/replay'
import { openHeadless, runBotGame, type BotGameResult } from '../src/games/space-shooter/harness/runner'
import { describe } from '../src/games/space-shooter/harness/snapshot'
import { loadPlugin } from './lib/plugins'

interface Flags {
  gen: string
  params: Record<string, string>
  seed: number
  lanes?: number
  bot: BotName
  games: number
  advance: number
  maxSeconds: number
  replay?: string
  export?: string
  repl: boolean
}

function fail(message: string): never {
  console.error(`sim: ${message}`)
  process.exit(1)
}

function number(name: string, raw: string | undefined): number {
  const n = Number(raw)
  if (raw === undefined || !Number.isFinite(n)) fail(`--${name} needs a number`)
  return n
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { gen: 'math', params: {}, seed: 1, bot: 'oracle', games: 1, advance: DEFAULT_ADVANCE_SECONDS, maxSeconds: 120, repl: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => argv[++i]
    switch (arg) {
      case '--gen': flags.gen = value() ?? fail('--gen needs an id'); break
      case '--params': flags.params = Object.fromEntries(new URLSearchParams(value() ?? '')); break
      case '--seed': flags.seed = number('seed', value()); break
      case '--lanes': flags.lanes = number('lanes', value()); break
      case '--bot': {
        const bot = value() as BotName
        if (!BOT_NAMES.includes(bot)) fail(`--bot must be one of ${BOT_NAMES.join(', ')}`)
        flags.bot = bot
        break
      }
      case '--games': flags.games = Math.max(1, Math.floor(number('games', value()))); break
      case '--advance': flags.advance = number('advance', value()); break
      case '--max-seconds': flags.maxSeconds = number('max-seconds', value()); break
      case '--replay': flags.replay = value() ?? fail('--replay needs a file'); break
      case '--export': flags.export = value() ?? fail('--export needs a file'); break
      case '--repl': flags.repl = true; break
      case '--': break
      default: fail(`unknown flag ${arg}`)
    }
  }
  return flags
}

async function requirePlugin(id: string): Promise<GeneratorPlugin<unknown>> {
  const plugin = await loadPlugin(id)
  if (!plugin) fail(`unknown generator "${id}"`)
  if (plugin.kind === 'hybrid') fail(`"${id}" is a hybrid generator; the simulator is offline and never calls upstream services`)
  return plugin
}

async function writeReplay(file: string, replay: Replay): Promise<void> {
  await writeFile(file, JSON.stringify(replay) + '\n')
  console.error(`sim: replay → ${file} (${replay.log.length} log entries)`)
}

async function repl(flags: Flags): Promise<void> {
  const plugin = await requirePlugin(flags.gen)
  const { harness, dispose } = await openHeadless({ plugin, params: flags.params, seed: flags.seed, lanes: flags.lanes })
  const out = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
  out({ describe: describe(), state: harness.state() })
  try {
    for await (const raw of console) {
      const line = raw.trim()
      if (!line) continue
      let command: string | object | null = line
      let advance = flags.advance
      if (line.startsWith('{')) {
        try {
          const parsed = JSON.parse(line) as { command?: string | object | null; advance?: number }
          command = parsed.command ?? null
          if (typeof parsed.advance === 'number') advance = parsed.advance
        } catch {
          out({ state: harness.state(), events: [], error: 'invalid JSON line' })
          continue
        }
      }
      out(await harness.act(command, { advance }))
    }
  } finally {
    if (flags.export) await writeReplay(flags.export, harness.exportReplay())
    dispose()
  }
}

function pct(value: number | null): string {
  return value === null ? '-' : `${Math.round(value * 100)}%`
}

async function bots(flags: Flags): Promise<void> {
  const plugin = await requirePlugin(flags.gen)
  const results: (BotGameResult & { deterministic: boolean })[] = []
  const header = ['game', 'seed', 'score', 'level', 'correct', 'wrong', 'accuracy', 'duration', 'ended', 'replay', 'violations']
  const rows: string[][] = []
  for (let g = 0; g < flags.games; g++) {
    const seed = flags.seed + g
    const result = await runBotGame({ plugin, params: flags.params, seed, lanes: flags.lanes, bot: flags.bot, advance: flags.advance, maxSeconds: flags.maxSeconds })
    const replayed = await runReplay(result.replay, loadPlugin)
    const deterministic = JSON.stringify(replayed.state) === JSON.stringify(result.final)
    results.push({ ...result, deterministic })
    rows.push([
      String(g + 1), String(seed), String(result.score), String(result.level), String(result.correct), String(result.wrong),
      pct(result.accuracy), `${result.duration}s`, result.ended, deterministic ? 'ok' : 'DIVERGED', String(result.violationCount),
    ])
    for (const v of result.violations) console.error(`  game ${g + 1}: ${v}`)
  }
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i])).join('  ')
  console.log(`sim: ${flags.bot} bot × ${flags.games} on ${flags.gen} ${new URLSearchParams(flags.params).toString() || '(defaults)'}, advance ${flags.advance}s, cap ${flags.maxSeconds}s`)
  console.log(line(header))
  for (const row of rows) console.log(line(row))
  const answered = results.reduce((n, r) => n + r.correct + r.wrong, 0)
  const correct = results.reduce((n, r) => n + r.correct, 0)
  const violations = results.reduce((n, r) => n + r.violationCount, 0)
  const avg = results.reduce((n, r) => n + r.score, 0) / results.length
  console.log(`total: avg score ${avg.toFixed(0)}, accuracy ${pct(answered ? correct / answered : null)}, violations ${violations}, replays ${results.every((r) => r.deterministic) ? 'deterministic' : 'DIVERGED'}`)
  if (flags.export) await writeReplay(flags.export, results[results.length - 1].replay)
  if (violations > 0 || !results.every((r) => r.deterministic)) process.exitCode = 1
}

async function replay(flags: Flags): Promise<void> {
  const data = JSON.parse(await readFile(flags.replay!, 'utf8')) as Replay
  const plugin = await loadPlugin(data.generatorId)
  if (plugin?.kind === 'hybrid') fail(`replay uses hybrid generator "${data.generatorId}"; its problems need the network`)
  const result = await runReplay(data, loadPlugin)
  console.log(JSON.stringify({ steps: result.steps, state: result.snapshot }))
}

const flags = parseFlags(process.argv.slice(2))
if (flags.replay) await replay(flags)
else if (flags.repl) await repl(flags)
else await bots(flags)
