/** Guest nickname rules — mirrors api/src/validation.ts normalizeName (the server re-checks). */
import { NAME_MAX_LENGTH } from '../highscores/types'
import type { NicknameResult } from './types'

const NAME_PATTERN = /^[\p{L}\p{M}\p{N} _-]+$/u

/** Trim, NFC-normalize and collapse whitespace, then validate. Messages are player-presentable. */
export function normalizeNickname(raw: string): NicknameResult {
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim()
  const length = Array.from(name).length
  if (length === 0) return { ok: false, error: 'Please enter a name.' }
  if (length > NAME_MAX_LENGTH) return { ok: false, error: `Names can be at most ${NAME_MAX_LENGTH} characters.` }
  if (!NAME_PATTERN.test(name)) return { ok: false, error: 'Use letters, numbers, spaces, _ or - for your name.' }
  return { ok: true, name }
}
