/** Game over: run stats, nickname + score submission, rank and the board's top 10. */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { HighScoreError, fetchLeaderboard, submitScore } from '../../../shared/highscores/client'
import {
  BOARD_KEY_PATTERN,
  LEADERBOARD_DEFAULT_LIMIT,
  NAME_MAX_LENGTH,
  type LeaderboardResponse,
  type ScoreSubmission,
} from '../../../shared/highscores/types'
import { isUnrecorded } from '../../../shared/unrecorded'
import { UI_ICONS } from '../assets/ui'
import { accuracyPercent, isSlowMotion } from './controls'
import { loadNickname, saveNickname } from './hooks'
import { Modal } from './Screens'

const NAME_PATTERN = /^[\p{L}\p{M}\p{N} _-]+$/u

export interface RunResult {
  score: number
  correct: number
  wrong: number
  bestStreak: number
  level: number
  durationMs: number
}

export interface GameOverProps {
  result: RunResult
  gameId: string
  generatorId: string
  boardKey: string
  boardTitle: string
  meta: ScoreSubmission['meta']
  onPlayAgain(): void
  onChangeGenerator(): void
}

type Submit =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'done'; rank: number; entryId: number }
  | { state: 'error'; message: string }

type Board = { state: 'loading' } | { state: 'ready'; data: LeaderboardResponse } | { state: 'error'; message: string }

function errorMessage(err: unknown): string {
  if (err instanceof HighScoreError) return err.message
  return 'Something went wrong. Please try again.'
}

export function GameOver({ result, gameId, generatorId, boardKey, boardTitle, meta, onPlayAgain, onChangeGenerator }: GameOverProps) {
  const [name, setName] = useState(loadNickname)
  const [submit, setSubmit] = useState<Submit>({ state: 'idle' })
  const [board, setBoard] = useState<Board>({ state: 'loading' })
  const nameId = useId()
  // Hidden flag for harness / automated play: show the board, never the name prompt.
  const [unrecorded] = useState(() => isUnrecorded())
  const canSubmit = BOARD_KEY_PATTERN.test(boardKey)
  const accuracy = accuracyPercent(result.correct, result.wrong)

  const loadBoard = useCallback(
    (signal?: AbortSignal) => {
      if (!canSubmit) return
      fetchLeaderboard(gameId, boardKey, LEADERBOARD_DEFAULT_LIMIT, { signal }).then(
        (data) => setBoard({ state: 'ready', data }),
        (err: unknown) => {
          if (!signal?.aborted) setBoard({ state: 'error', message: errorMessage(err) })
        },
      )
    },
    [gameId, boardKey, canSubmit],
  )

  useEffect(() => {
    const controller = new AbortController()
    loadBoard(controller.signal)
    return () => controller.abort()
  }, [loadBoard])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.normalize('NFC').replace(/\s+/g, ' ').trim()
    if (!trimmed || !NAME_PATTERN.test(trimmed)) {
      setSubmit({ state: 'error', message: 'Use letters, numbers, spaces, _ or - for your name.' })
      return
    }
    setSubmit({ state: 'sending' })
    saveNickname(trimmed)
    try {
      const res = await submitScore({
        gameId,
        generatorId,
        boardKey,
        name: trimmed,
        score: result.score,
        durationMs: Math.max(1000, Math.round(result.durationMs)),
        meta,
      })
      setSubmit({ state: 'done', rank: res.rank, entryId: res.entry.id })
      loadBoard()
    } catch (err) {
      setSubmit({ state: 'error', message: errorMessage(err) })
    }
  }

  const highlight = submit.state === 'done' ? submit.entryId : null

  return (
    <Modal label="Game over" className="ss-modal--wide">
      <div className="ss-over">
        <h2 className="ss-over-title comic-title" tabIndex={-1} data-autofocus>
          Game over!
        </h2>
        <p className="ss-over-board">{boardTitle}</p>

        <dl className="ss-stats">
          <div className="ss-stat ss-stat--score">
            <dt>Score</dt>
            <dd>{result.score.toLocaleString()}</dd>
          </div>
          <div className="ss-stat">
            <dt>Accuracy</dt>
            <dd>{accuracy}%</dd>
          </div>
          <div className="ss-stat">
            <dt>Best streak</dt>
            <dd>{result.bestStreak}</dd>
          </div>
          <div className="ss-stat">
            <dt>Level</dt>
            <dd>{result.level}</dd>
          </div>
        </dl>

        {canSubmit && (
          <div className="ss-over-grid">
            <div className="ss-submit">
              {unrecorded ? (
                <p className="ss-note">This run isn't recorded.</p>
              ) : submit.state === 'done' ? (
                <div className="ss-rank" role="status">
                  <img src={UI_ICONS.trophy} alt="" width={56} height={56} />
                  <div>
                    <strong>You're #{submit.rank}!</strong>
                    <p className="muted">on this board</p>
                  </div>
                </div>
              ) : (
                <form className="ss-submit-form" onSubmit={onSubmit}>
                  <label className="field" htmlFor={nameId}>
                    Your name for the leaderboard
                  </label>
                  <div className="ss-submit-row">
                    <input
                      id={nameId}
                      className="input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={NAME_MAX_LENGTH}
                      autoComplete="nickname"
                      placeholder="Nickname"
                      required
                    />
                    <button type="submit" className="btn btn--accent" disabled={submit.state === 'sending'}>
                      {submit.state === 'sending' ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {submit.state === 'error' && (
                    <p className="ss-error" role="alert">
                      {submit.message}
                    </p>
                  )}
                  <p className="ss-note">Just a nickname — no account needed.</p>
                </form>
              )}
            </div>

            <div className="ss-board">
              <h3 className="ss-board-title">
                <img src={UI_ICONS.trophy} alt="" width={28} height={28} /> Top {LEADERBOARD_DEFAULT_LIMIT}
              </h3>
              {board.state === 'loading' && <p className="muted">Loading scores…</p>}
              {board.state === 'error' && (
                <p className="ss-error">
                  {board.message}{' '}
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => {
                      setBoard({ state: 'loading' })
                      loadBoard()
                    }}
                  >
                    Retry
                  </button>
                </p>
              )}
              {board.state === 'ready' && board.data.entries.length === 0 && (
                <p className="muted">No scores yet. Be the first!</p>
              )}
              {board.state === 'ready' && board.data.entries.length > 0 && (
                <ol className="ss-board-list">
                  {board.data.entries.map((entry, i) => (
                    <li key={entry.id} className={entry.id === highlight ? 'is-you' : undefined}>
                      <span className="ss-board-rank">{i + 1}</span>
                      <span className="ss-board-name">
                        {entry.name}
                        {isSlowMotion(entry.meta) && (
                          <span className="ss-board-slow" title="Played in slow motion" aria-label="slow motion">
                            {' '}
                            🐢
                          </span>
                        )}
                      </span>
                      <span className="ss-board-score">{entry.score.toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        <div className="ss-actions">
          <button type="button" className="btn btn--primary btn--big" onClick={onPlayAgain}>
            Play again
          </button>
          <button type="button" className="btn" onClick={onChangeGenerator}>
            Change practice
          </button>
        </div>
      </div>
    </Modal>
  )
}
