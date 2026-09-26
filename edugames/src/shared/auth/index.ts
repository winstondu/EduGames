/** Platform auth layer — see docs/AUTH.md. React UI lives in ./ui/. */
export { createAuth, type CreateAuthOptions } from './createAuth'
export { createGuestProvider, NICKNAME_KEY, type GuestProviderOptions } from './guest'
export { normalizeNickname } from './nickname'
export { HighScoreError } from '../highscores/client'
export * from './types'
