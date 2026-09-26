/**
 * Default ScoresTransport over the existing highscores client. The client can't forward
 * credentials yet (migration step in docs/AUTH.md), so this refuses a non-empty RequestAuth
 * rather than silently submitting an account's score as a guest.
 */
import { fetchLeaderboard, submitScore } from '../highscores/client'
import type { RequestAuth, ScoresTransport } from './types'

function isEmpty(auth: RequestAuth): boolean {
  return !auth.credentials && Object.keys(auth.headers ?? {}).length === 0
}

export const highscoresTransport: ScoresTransport = {
  submit(submission, { signal, auth }) {
    if (!isEmpty(auth)) {
      return Promise.reject(new Error('highscores client does not forward credentials yet (docs/AUTH.md).'))
    }
    return submitScore(submission, { signal })
  },
  leaderboard(gameId, boardKey, limit, { signal }) {
    return fetchLeaderboard(gameId, boardKey, limit, { signal })
  },
}
