/**
 * Hidden "unrecorded" flag: while on, games must not submit scores or show
 * leaderboard prompts. It is never exposed in any settings UI.
 *
 * - The DEV test harness forces it on for every session it opens.
 * - LLM / automated play-tests MUST set it (open the game with `?unrecorded=1`,
 *   or call setUnrecorded(true)) so bot scores never reach real leaderboards.
 *
 * Sources, any of which turns it on: the URL param `unrecorded=1` (then kept
 * in sessionStorage for the rest of the tab, surviving in-app navigation),
 * that sessionStorage entry, or localStorage `edugames.unrecorded` === '1'.
 */

export const UNRECORDED_PARAM = 'unrecorded'
export const UNRECORDED_KEY = 'edugames.unrecorded'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Injectable environment (tests); defaults to the browser globals. */
export interface UnrecordedEnv {
  search?: string
  local?: StorageLike | null
  session?: StorageLike | null
}

function browserEnv(): UnrecordedEnv {
  const g = globalThis as { location?: { search?: string }; localStorage?: StorageLike; sessionStorage?: StorageLike }
  const env: UnrecordedEnv = {}
  // Each accessor may throw (blocked storage), so read them one by one.
  try {
    env.search = g.location?.search
  } catch {
    // no location
  }
  try {
    env.local = g.localStorage
  } catch {
    // storage blocked
  }
  try {
    env.session = g.sessionStorage
  } catch {
    // storage blocked
  }
  return env
}

function read(storage: StorageLike | null | undefined): string | null {
  try {
    return storage?.getItem(UNRECORDED_KEY) ?? null
  } catch {
    return null
  }
}

function write(storage: StorageLike | null | undefined, on: boolean): void {
  try {
    if (on) storage?.setItem(UNRECORDED_KEY, '1')
    else storage?.removeItem(UNRECORDED_KEY)
  } catch {
    // storage blocked
  }
}

/** True when this session must not record scores. */
export function isUnrecorded(env: UnrecordedEnv = browserEnv()): boolean {
  let fromUrl = false
  try {
    fromUrl = new URLSearchParams(env.search ?? '').get(UNRECORDED_PARAM) === '1'
  } catch {
    // malformed search
  }
  if (fromUrl) {
    write(env.session, true)
    return true
  }
  return read(env.session) === '1' || read(env.local) === '1'
}

/** Turn the flag on (persistently, in localStorage) or off (clears the tab's sticky flag too). */
export function setUnrecorded(on: boolean, env: UnrecordedEnv = browserEnv()): void {
  write(env.local, on)
  if (!on) write(env.session, false)
}

/** Turn the flag on for this tab only (sessionStorage), e.g. when the DEV harness takes over. */
export function markUnrecordedForTab(env: UnrecordedEnv = browserEnv()): void {
  write(env.session, true)
}
