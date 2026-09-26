/**
 * Game-agnostic keymap over `KeyboardEvent.code` (physical keys), so the
 * WASD preset is automatically ZQSD on AZERTY. Each game declares its actions
 * with per-preset defaults; the player picks a preset and may rebind keys.
 *
 *   const keymap = createKeymap(ACTIONS, loadKeymap(gameId))
 *   const action = keymap.match(event, { textEntry: state.inputMode === 'freeform' })
 *
 * While a game collects TEXT answers (`ctx.textEntry`), bindings on printable
 * codes (letters, digits, punctuation) are suspended so those keys type
 * instead — except for actions flagged `alwaysActive`.
 */

export type PresetId = 'arrows' | 'wasd' | 'both'

export const PRESET_IDS: readonly PresetId[] = ['arrows', 'wasd', 'both']

export const PRESET_LABELS: Record<PresetId, string> = {
  arrows: 'Arrows',
  wasd: 'WASD',
  both: 'Both',
}

export const DEFAULT_PRESET: PresetId = 'both'

/** Most keys one action may hold. */
export const MAX_KEYS_PER_ACTION = 4

export interface ActionDef {
  id: string
  label: string
  /** Optional heading for editors, e.g. "Move", "Answer". */
  group?: string
  /** Stays bound while typing a text answer, even on a printable key. */
  alwaysActive?: boolean
  defaults: Record<PresetId, string[]>
}

export interface MatchContext {
  /** The game is collecting a typed answer: printable keys go to typing. */
  textEntry: boolean
}

/** The subset of KeyboardEvent the keymap reads. */
export interface KeyLike {
  code: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export interface KeyConflict {
  code: string
  /** Action ids bound to `code`, in declaration order. */
  actions: string[]
}

/** Persisted form: the preset plus only the actions rebound away from it. */
export interface KeymapState {
  version: 1
  preset: PresetId
  custom: Record<string, string[]>
}

export interface Keymap {
  readonly actions: readonly ActionDef[]
  readonly preset: PresetId
  /** Current keys per action id. */
  readonly bindings: Readonly<Record<string, readonly string[]>>
  /** Any action differs from the preset. */
  readonly customized: boolean
  /** Bumps on every change (for useSyncExternalStore). */
  readonly revision: number
  /** Switch preset; drops custom bindings. */
  setPreset(preset: PresetId): void
  /**
   * Bind `code` to `slot` of an action (default 0; slot ≥ length appends).
   * `null` clears the slot. The same code twice on one action collapses.
   */
  rebind(actionId: string, code: string | null, slot?: number): void
  /** Back to the current preset's defaults. */
  reset(): void
  /** The action a key triggers, or null (modifier chords are never matched). */
  match(event: KeyLike, ctx?: MatchContext): string | null
  /** Codes bound to more than one action. */
  conflicts(): KeyConflict[]
  serialize(): KeymapState
  subscribe(listener: () => void): () => void
}

const CODE = /^[A-Za-z0-9]{1,32}$/
const PRINTABLE =
  /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Numpad(Decimal|Add|Subtract|Multiply|Divide|Comma|Equal)|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen)$/

/**
 * A code that produces a character when typing text. Space is deliberately
 * excluded: games bind it to fire even while typing.
 */
export function isPrintableCode(code: string): boolean {
  return PRINTABLE.test(code)
}

function isPreset(value: unknown): value is PresetId {
  return PRESET_IDS.includes(value as PresetId)
}

function cleanCodes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const codes = value.filter((c): c is string => typeof c === 'string' && CODE.test(c))
  return [...new Set(codes)].slice(0, MAX_KEYS_PER_ACTION)
}

function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i])
}

/** Validate an untrusted (stored) keymap state against `actions`. */
export function sanitizeKeymapState(actions: readonly ActionDef[], value: unknown): KeymapState {
  const v = (value ?? {}) as Partial<KeymapState>
  const preset = isPreset(v.preset) ? v.preset : DEFAULT_PRESET
  const custom: Record<string, string[]> = {}
  const raw = v.custom && typeof v.custom === 'object' ? v.custom : {}
  for (const action of actions) {
    const codes = cleanCodes((raw as Record<string, unknown>)[action.id])
    if (codes && !sameCodes(codes, action.defaults[preset])) custom[action.id] = codes
  }
  return { version: 1, preset, custom }
}

export function createKeymap(actions: readonly ActionDef[], stored?: unknown): Keymap {
  const ids = new Set(actions.map((a) => a.id))
  const initial = sanitizeKeymapState(actions, stored)
  let preset = initial.preset
  let bindings: Record<string, string[]> = { ...defaultsFor(preset), ...initial.custom }
  let revision = 0
  const listeners = new Set<() => void>()

  function defaultsFor(p: PresetId): Record<string, string[]> {
    return Object.fromEntries(actions.map((a) => [a.id, a.defaults[p].slice(0, MAX_KEYS_PER_ACTION)]))
  }

  function changed(): void {
    revision++
    for (const listener of [...listeners]) listener()
  }

  return {
    actions,
    get preset() {
      return preset
    },
    get bindings() {
      return bindings
    },
    get customized() {
      return actions.some((a) => !sameCodes(bindings[a.id], a.defaults[preset]))
    },
    get revision() {
      return revision
    },
    setPreset(next) {
      if (!isPreset(next)) return
      preset = next
      bindings = defaultsFor(preset)
      changed()
    },
    rebind(actionId, code, slot = 0) {
      if (!ids.has(actionId)) return
      if (code !== null && !CODE.test(code)) return
      const codes = [...bindings[actionId]]
      const i = Math.max(0, Math.floor(slot))
      if (code === null) {
        if (i >= codes.length) return
        codes.splice(i, 1)
      } else if (i < codes.length) {
        codes[i] = code
      } else {
        codes.push(code)
      }
      const next = [...new Set(codes)].slice(0, MAX_KEYS_PER_ACTION)
      if (sameCodes(next, bindings[actionId])) return
      bindings = { ...bindings, [actionId]: next }
      changed()
    },
    reset() {
      bindings = defaultsFor(preset)
      changed()
    },
    match(event, ctx) {
      if (event.ctrlKey || event.metaKey || event.altKey) return null
      const suspended = ctx?.textEntry === true && isPrintableCode(event.code)
      for (const action of actions) {
        if (suspended && !action.alwaysActive) continue
        if (bindings[action.id].includes(event.code)) return action.id
      }
      return null
    },
    conflicts() {
      const byCode = new Map<string, string[]>()
      for (const action of actions) {
        for (const code of bindings[action.id]) byCode.set(code, [...(byCode.get(code) ?? []), action.id])
      }
      return [...byCode].filter(([, a]) => a.length > 1).map(([code, a]) => ({ code, actions: a }))
    },
    serialize() {
      const custom: Record<string, string[]> = {}
      for (const action of actions) {
        if (!sameCodes(bindings[action.id], action.defaults[preset])) custom[action.id] = [...bindings[action.id]]
      }
      return { version: 1, preset, custom }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const NAMED: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  MetaLeft: 'Left ⌘',
  MetaRight: 'Right ⌘',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadDecimal: 'Num .',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
}

/** Physical code → layout character, from `navigator.keyboard.getLayoutMap()`. */
export type KeyboardLayout = ReadonlyMap<string, string>

/**
 * Display label for a code: "W", "↑", "Space", "Num 1". With a `layout`
 * (see loadKeyboardLayout) printable keys show the player's own layout,
 * e.g. KeyW → "Z" on AZERTY.
 */
export function keyLabel(code: string, layout?: KeyboardLayout | null): string {
  const local = layout?.get(code)
  if (local && local.trim() && isPrintableCode(code) && !code.startsWith('Numpad')) return local.toUpperCase()
  if (NAMED[code]) return NAMED[code]
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]
  m = /^Digit([0-9])$/.exec(code)
  if (m) return m[1]
  m = /^Numpad([0-9])$/.exec(code)
  if (m) return `Num ${m[1]}`
  return code
}

/** The player's keyboard layout where the browser exposes it (Chromium), else null. */
export async function loadKeyboardLayout(): Promise<KeyboardLayout | null> {
  try {
    const keyboard = (globalThis.navigator as { keyboard?: { getLayoutMap?: () => Promise<KeyboardLayout> } } | undefined)?.keyboard
    return (await keyboard?.getLayoutMap?.()) ?? null
  } catch {
    return null
  }
}

function storageKey(gameId: string): string {
  return `edugames.${gameId}.keymap`
}

/** Stored keymap state for a game (unvalidated; pass it to createKeymap), or undefined. */
export function loadKeymap(gameId: string): unknown {
  try {
    const raw = localStorage.getItem(storageKey(gameId))
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

export function saveKeymap(gameId: string, state: KeymapState): void {
  try {
    localStorage.setItem(storageKey(gameId), JSON.stringify(state))
  } catch {
    // Storage unavailable (private mode); bindings just won't persist.
  }
}
