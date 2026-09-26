/**
 * Harness runtime (DEV ONLY; main.tsx imports it behind `import.meta.env.DEV`).
 * Game-agnostic: games register their GameHarness adapter per session; the
 * runtime exposes it on `window.__edugames` and in the meta panel, and runs
 * `open()` requests (navigate → the game claims the request → registers).
 *
 * Anything automated that touches `window.__edugames` turns the hidden
 * unrecorded flag on for the tab, so harness play never reaches a leaderboard.
 */
import { markUnrecordedForTab, UNRECORDED_PARAM } from '../unrecorded'
import type { GameHarness, HarnessGlobal, HarnessOpenOptions, HarnessSessionInfo } from './types'

export interface HarnessEntry extends HarnessSessionInfo {
  harness: GameHarness
  /** The open() request this session was started for (from takeOpenRequest), if any. */
  requestId?: string
}

/** A pending open() the game claims on mount (seed and one-run settings). */
export interface OpenRequest extends HarnessOpenOptions {
  id: string
}

/** URL param that makes each open() a fresh route (and identifies the request). */
export const OPEN_PARAM = 'harness'
const OPEN_TIMEOUT_MS = 30_000

interface Pending {
  request: OpenRequest
  resolve(info: HarnessSessionInfo): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

let current: HarnessEntry | null = null
let pending: Pending | null = null
let requestCount = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

function infoOf(entry: HarnessEntry): HarnessSessionInfo {
  const { game, generatorId, params, seed, settings } = entry
  return { game, generatorId, params: { ...params }, seed, settings: { ...settings } }
}

function settle(fn: (p: Pending) => void): void {
  const p = pending
  if (!p) return
  pending = null
  clearTimeout(p.timer)
  fn(p)
}

/** The mounted session (for the meta panel). */
export function currentHarness(): HarnessEntry | null {
  return current
}

export function subscribeHarness(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * A game registers its adapter once its session runs; returns unregister.
 * A pending open() for this game + generator resolves here, after its time
 * settings are applied.
 */
export function registerHarness(entry: HarnessEntry): () => void {
  current = entry
  const request = pending?.request
  // Only the session built for this request resolves it (not a stale one still finishing its load).
  if (request && entry.requestId === request.id) {
    if (request.speed !== undefined) entry.harness.time.setScale(request.speed)
    if (request.lockstep !== undefined) entry.harness.time.setLockstep(request.lockstep)
    settle((p) => p.resolve(infoOf(entry)))
  }
  notify()
  return () => {
    if (current !== entry) return
    current = null
    notify()
  }
}

/**
 * The open() request still waiting for its session, if the route was opened
 * for it: `params` must carry its id in OPEN_PARAM (idempotent: remounts see
 * it again until it resolves; back/forward to an older open URL doesn't).
 */
export function takeOpenRequest(game: string, generatorId: string, params: URLSearchParams): OpenRequest | null {
  const request = pending?.request
  if (!request || request.game !== game || request.gen !== generatorId) return null
  return params.get(OPEN_PARAM) === request.id ? request : null
}

/** The game couldn't start the requested session (bad generator, plugin error). */
export function reportOpenFailure(game: string, message: string): void {
  if (pending?.request.game !== game) return
  settle((p) => p.reject(new Error(message)))
}

export interface InstallOptions {
  navigate(to: string): void
  /** Meta panel data (games, generator list), or false for no panel. */
  panel?: false | { games?: readonly { id: string; name: string }[]; generators?(): Promise<readonly { id: string; name: string; hidden?: boolean }[]> }
}

function openUrl(request: OpenRequest): string {
  const params = new URLSearchParams({ gen: request.gen })
  for (const [key, value] of Object.entries(request.params ?? {})) params.set(key, String(value))
  params.set(UNRECORDED_PARAM, '1')
  params.set(OPEN_PARAM, request.id)
  return `/${encodeURIComponent(request.game)}?${params}`
}

let installed = false

export function installHarnessRuntime(options: InstallOptions): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const api: HarnessGlobal = {
    version: 1,
    get harness() {
      if (current) markUnrecordedForTab()
      return current?.harness ?? null
    },
    get session() {
      return current ? infoOf(current) : null
    },
    open(opts) {
      if (!opts || typeof opts.game !== 'string' || typeof opts.gen !== 'string') {
        return Promise.reject(new Error('open({ game, gen, params?, seed?, speed?, lockstep?, settings? })'))
      }
      markUnrecordedForTab()
      settle((p) => p.reject(new Error('superseded by another open()')))
      const request: OpenRequest = { ...opts, id: `${Date.now().toString(36)}${++requestCount}` }
      return new Promise<HarnessSessionInfo>((resolve, reject) => {
        pending = {
          request,
          resolve,
          reject,
          timer: setTimeout(() => settle((p) => p.reject(new Error(`open(): no session after ${OPEN_TIMEOUT_MS / 1000}s`))), OPEN_TIMEOUT_MS),
        }
        options.navigate(openUrl(request))
      })
    },
    close() {
      settle((p) => p.reject(new Error('closed')))
      options.navigate('/')
    },
  }
  Object.defineProperty(window, '__edugames', { value: api, configurable: true })

  const panel = options.panel
  if (panel !== false) {
    void import('./mountMetaPanel').then((m) => m.mountMetaPanel({ ...panel, open: (opts) => api.open(opts) }))
  }
}
