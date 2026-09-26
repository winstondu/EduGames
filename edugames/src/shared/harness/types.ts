/**
 * Test-harness contract (DEV ONLY). Game-agnostic: every game provides a
 * GameHarness adapter; the harness runtime exposes it on `window.__edugames`
 * and in the meta panel. The headless simulator (scripts/sim.ts) drives the
 * same adapter shape against the pure engine without a browser.
 *
 * Nothing here ships to production: the runtime and panel are only imported
 * behind `import.meta.env.DEV`. Harness sessions always run UNRECORDED (no
 * score submission).
 */

/** One command a game accepts from the harness, for LLM-readable help. */
export interface CommandSpec {
  /** Verb, e.g. "up", "lane", "type", "fire", "choose". */
  name: string
  /** Usage, e.g. "lane <0-4>", "type <text>", "choose <1-4>". */
  usage: string
  description: string
}

export interface HarnessTime {
  /** Real-time multiplier for fixed-step pacing (0.1..2). Engine stays deterministic. */
  scale: number
  /** When true the game is frozen until act()/step() advances it. */
  lockstep: boolean
  setScale(scale: number): void
  setLockstep(on: boolean): void
  /** Advance exactly n fixed steps (works in lockstep or paused). */
  step(n: number): void
}

export interface ActResult<State = unknown, Event = unknown> {
  state: State
  events: Event[]
  /** Parse/validation error for the command, if any (state unchanged). */
  error?: string
}

export interface GameHarness<State = unknown, Event = unknown> {
  gameId: string
  /** Rules + command list + state legend, written for an LLM. */
  describe(): string
  commands: CommandSpec[]
  /** Compact JSON-safe snapshot (keep it ~1 KB): only what a player can see. */
  state(): State
  /** Apply a text ("choose 3", "type 12", "lane 2") or structured command; returns events it caused. */
  send(command: string | object): ActResult<State, Event>
  /**
   * Apply a command (or null for none), then advance `advance` seconds of game
   * time (default 0.5), awaiting any in-flight answer checks, and return the
   * resulting state + all events. The primary LLM entry point.
   */
  act(command: string | object | null, opts?: { advance?: number }): Promise<ActResult<State, Event>>
  /** Events since sequence number `since` (monotonic), for polling. */
  events(since?: number): { seq: number; events: Event[] }
  time: HarnessTime
  /** Seed + generator + options + command log with step indices — replayable in scripts/sim.ts. */
  exportReplay(): Replay
}

export interface Replay {
  version: 1
  gameId: string
  generatorId: string
  params: Record<string, string>
  seed: number
  settings: Record<string, string | number | boolean>
  /** Commands with the fixed-step index at which they were applied. */
  log: { step: number; command: unknown }[]
  /** Results of async checks by checkId (hybrid generators), so replays don't hit the network. */
  checks: Record<number, unknown>
}

/** `window.__edugames` (DEV only). */
export interface HarnessGlobal {
  version: 1
  /** The mounted game's adapter, or null on the launcher. */
  harness: GameHarness | null
  /** Navigate to a game with meta controls: generator id, variant params, seed, time scale, lockstep. */
  open(opts: { game: string; gen: string; params?: Record<string, string>; seed?: number; speed?: number; lockstep?: boolean }): Promise<void>
}
