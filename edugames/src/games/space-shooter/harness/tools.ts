/**
 * LLM-facing harness tools (DEV ONLY; verification layer 2). A transport-
 * agnostic tool set over the headless GameHarness: scripts/harness-mcp.ts
 * serves it as a stdio MCP server; a WebMCP bridge could serve the same list.
 *
 * One session at a time: open_session → act / send / state / events / step →
 * export_replay. Sessions are offline (hybrid generators can't open) and
 * never record scores.
 */
import { checkConformance } from '../../../generators/conformance'
import type { GeneratorContext, GeneratorPlugin } from '../../../generators/types'
import { createRng } from '../../../shared/rng'
import type { Replay } from '../../../shared/harness/types'
import { DEFAULT_ADVANCE_SECONDS } from './adapter'
import { BOT_NAMES, type BotName } from './bots'
import { runReplay, type PluginLoader } from './replay'
import { openHeadless, runBotGame, type Headless } from './runner'
import { describe } from './snapshot'

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema of the arguments object. */
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
}

export interface ToolResult {
  /** JSON-safe result (serialized as text by transports). */
  value: unknown
  isError?: boolean
}

export interface HarnessToolsOptions {
  loadPlugin: PluginLoader
  /** Generator ids to list (e.g. the directories under src/generators). */
  generatorIds(): Promise<string[]>
}

export interface HarnessTools {
  readonly tools: readonly ToolSpec[]
  call(name: string, args: unknown): Promise<ToolResult>
  dispose(): void
}

const str = (description: string) => ({ type: 'string', description })
const num = (description: string) => ({ type: 'number', description })
const params = { type: 'object', additionalProperties: { type: 'string' }, description: 'Generator options as URL params, e.g. {"format":"mc","ops":"add,sub"}.' }

export const HARNESS_TOOLS: readonly ToolSpec[] = [
  {
    name: 'list_generators',
    description: 'List generator plugins (id, kind, formats, hidden) with their preset variants. Only client generators can open offline.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'open_session',
    description:
      'Start a headless space-shooter session (replaces any open one). Returns the rules/command help (read it once) and the first state. Same gen + params + seed + lanes replays identically.',
    inputSchema: {
      type: 'object',
      properties: { gen: str('Generator id, e.g. "math" or "fixture".'), params, seed: num('Session seed (default 1).'), lanes: num('Lanes 3..5 (default 4).') },
      required: ['gen'],
      additionalProperties: false,
    },
  },
  {
    name: 'act',
    description:
      'Apply one command (or none), then advance game time and await answer checks. Commands: "lane <n>", "up", "down", "choose <1-4>", "answer <text>", "type <text>", "fire", "backspace", "clear", "pause", "resume", "wait". Returns {state, events, error?}.',
    inputSchema: {
      type: 'object',
      properties: { command: str('Command text; omit to just wait.'), advance: num(`Game seconds to advance afterwards (default ${DEFAULT_ADVANCE_SECONDS}).`) },
      additionalProperties: false,
    },
  },
  {
    name: 'send',
    description: 'Apply one command without advancing time. Returns {state, events, error?}.',
    inputSchema: { type: 'object', properties: { command: str('Command text.') }, required: ['command'], additionalProperties: false },
  },
  {
    name: 'state',
    description: 'Current compact state snapshot (what a player can see).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'events',
    description: 'Events with sequence number > since (default 0), plus the latest sequence number.',
    inputSchema: { type: 'object', properties: { since: num('Sequence number from a previous call.') }, additionalProperties: false },
  },
  {
    name: 'step',
    description: 'Advance exactly n fixed steps (1/60 s each) without a command.',
    inputSchema: { type: 'object', properties: { n: num('Steps, 1..3600.') }, required: ['n'], additionalProperties: false },
  },
  {
    name: 'export_replay',
    description: 'The open session as a replay (seed, generator, params, settings, command log). Replays run with run_replay or `bun run sim -- --replay`.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_replay',
    description: 'Re-run a replay deterministically (offline) and return the final state.',
    inputSchema: { type: 'object', properties: { replay: { type: 'object', description: 'A replay from export_replay.' } }, required: ['replay'], additionalProperties: false },
  },
  {
    name: 'run_bots',
    description: `Play whole games with a scripted bot (${BOT_NAMES.join(' / ')}) and summarize score, accuracy, invariant violations and replay determinism.`,
    inputSchema: {
      type: 'object',
      properties: {
        gen: str('Generator id.'),
        params,
        bot: { type: 'string', enum: [...BOT_NAMES] },
        games: num('Games to play (1..20, default 3).'),
        seed: num('First seed (default 1).'),
        lanes: num('Lanes 3..5.'),
        maxSeconds: num('Cap per game in game seconds (default 120).'),
      },
      required: ['gen'],
      additionalProperties: false,
    },
  },
  {
    name: 'conformance',
    description: 'Run the generator conformance suite against a client generator for the given option sets (default: its preset variants, else defaults). Returns issues (empty = conforms).',
    inputSchema: {
      type: 'object',
      properties: { gen: str('Generator id.'), cases: { type: 'array', items: params, description: 'Option sets to check.' } },
      required: ['gen'],
      additionalProperties: false,
    },
  },
]

const MAX_STEPS = 3600
const MAX_BOT_GAMES = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]))
}

function optNumber(value: unknown): number | undefined {
  const n = Number(value)
  return value === undefined || value === null || !Number.isFinite(n) ? undefined : n
}

class ToolError extends Error {}

export function createHarnessTools(options: HarnessToolsOptions): HarnessTools {
  let session: (Headless & { gen: string }) | null = null

  function close(): void {
    session?.dispose()
    session = null
  }

  async function plugin(id: unknown, { offline }: { offline: boolean }): Promise<GeneratorPlugin<unknown>> {
    if (typeof id !== 'string') throw new ToolError('`gen` must be a generator id')
    const loaded = await options.loadPlugin(id)
    if (!loaded) throw new ToolError(`unknown generator "${id}" (see list_generators)`)
    if (offline && loaded.kind === 'hybrid') throw new ToolError(`"${id}" is a hybrid generator; headless sessions are offline`)
    return loaded
  }

  function open(): Headless {
    if (!session) throw new ToolError('no session: call open_session first')
    return session
  }

  const offlineCtx: GeneratorContext = { rng: createRng(1), signal: new AbortController().signal, api: () => Promise.reject(new Error('offline')) }

  async function run(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'list_generators': {
        const out = []
        for (const id of await options.generatorIds()) {
          const p = await options.loadPlugin(id)
          if (!p) continue
          const variants = p.kind === 'client' && p.listVariants ? await p.listVariants(offlineCtx).catch(() => []) : []
          out.push({ id: p.id, name: p.name, kind: p.kind, formats: p.formats, hidden: !!p.hidden, offline: p.kind === 'client', variants: variants.map((v) => ({ label: v.label, params: v.params })) })
        }
        return out
      }
      case 'open_session': {
        const p = await plugin(args.gen, { offline: true })
        close()
        const params = stringRecord(args.params)
        const seed = (optNumber(args.seed) ?? 1) >>> 0
        const headless = await openHeadless({ plugin: p, params, seed, lanes: optNumber(args.lanes) })
        session = { ...headless, gen: p.id }
        return { session: { gen: p.id, params, seed, lanes: headless.session.lanes }, describe: describe(), state: headless.harness.state() }
      }
      case 'act':
        return open().harness.act(typeof args.command === 'string' ? args.command : null, { advance: optNumber(args.advance) })
      case 'send':
        if (typeof args.command !== 'string') throw new ToolError('`command` must be a string')
        return open().harness.send(args.command)
      case 'state':
        return open().harness.state()
      case 'events':
        return open().harness.events(optNumber(args.since) ?? 0)
      case 'step': {
        const n = Math.floor(optNumber(args.n) ?? 0)
        if (n < 1 || n > MAX_STEPS) throw new ToolError(`n must be 1..${MAX_STEPS}`)
        const h = open().harness
        const from = h.events().seq
        h.time.step(n)
        await h.settle()
        return { state: h.state(), events: h.events(from).events }
      }
      case 'export_replay':
        return open().harness.exportReplay()
      case 'run_replay': {
        if (!isRecord(args.replay)) throw new ToolError('`replay` must be a replay object')
        const result = await runReplay(args.replay as unknown as Replay, options.loadPlugin)
        return { steps: result.steps, state: result.snapshot }
      }
      case 'run_bots': {
        const p = await plugin(args.gen, { offline: true })
        const bot = (args.bot ?? 'oracle') as BotName
        if (!BOT_NAMES.includes(bot)) throw new ToolError(`bot must be one of ${BOT_NAMES.join(', ')}`)
        const games = Math.min(MAX_BOT_GAMES, Math.max(1, Math.floor(optNumber(args.games) ?? 3)))
        const seed = (optNumber(args.seed) ?? 1) >>> 0
        const results = []
        for (let g = 0; g < games; g++) {
          const r = await runBotGame({ plugin: p, params: stringRecord(args.params), seed: seed + g, lanes: optNumber(args.lanes), bot, maxSeconds: optNumber(args.maxSeconds) })
          const replayed = await runReplay(r.replay, options.loadPlugin)
          results.push({
            seed: r.seed,
            score: r.score,
            level: r.level,
            correct: r.correct,
            wrong: r.wrong,
            accuracy: r.accuracy,
            duration: r.duration,
            ended: r.ended,
            commandErrors: r.commandErrors,
            violations: r.violations.slice(0, 5),
            deterministic: JSON.stringify(replayed.state) === JSON.stringify(r.final),
          })
        }
        return results
      }
      case 'conformance': {
        const p = await plugin(args.gen, { offline: true })
        let cases = Array.isArray(args.cases) ? args.cases.map((c) => ({ params: stringRecord(c) })) : []
        if (!cases.length) {
          const variants = p.listVariants ? await p.listVariants(offlineCtx).catch(() => []) : []
          cases = variants.length ? variants.map((v) => ({ params: v.params })) : [{ params: {} }]
        }
        return checkConformance(p, { cases })
      }
    }
    throw new ToolError(`unknown tool "${name}"`)
  }

  return {
    tools: HARNESS_TOOLS,
    async call(name, args) {
      try {
        return { value: await run(name, isRecord(args) ? args : {}) }
      } catch (err) {
        return { value: { error: err instanceof Error ? err.message : String(err) }, isError: true }
      }
    },
    dispose: close,
  }
}
