/**
 * Auth UI (React). Not wired in yet — see docs/AUTH.md "Migration". Uses the app's shared
 * classes (chip, btn, input, field). Never collects credentials: sign-in is the provider's
 * own flow behind `login()`, and the button only appears when the provider offers it.
 */
import { useId, useState, type FormEvent } from 'react'
import { NAME_MAX_LENGTH } from '../../highscores/types'
import type { GameAuth, NicknameResult } from '../types'
import { usePlayer } from './usePlayer'

/** "Playing as …" chip plus a Sign in / Sign out affordance when the provider has accounts. */
export function PlayerBadge({ auth, onLogout }: { auth: GameAuth; onLogout?: () => void }) {
  const player = usePlayer(auth)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function login() {
    setBusy(true)
    setError(null)
    try {
      const res = await auth.login()
      if (!res.ok) setError(res.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-row">
        <span className={player.kind === 'account' ? 'chip chip--good' : 'chip'}>
          {player.kind === 'account'
            ? `Signed in as ${player.displayName}`
            : player.displayName
              ? `Playing as ${player.displayName} (guest)`
              : 'Playing as a guest'}
        </span>
        {auth.canLogin && player.kind === 'guest' && (
          <button type="button" className="btn btn--small" onClick={login} disabled={busy}>
            Sign in
          </button>
        )}
        {player.kind === 'account' && onLogout && (
          <button type="button" className="btn btn--small" onClick={onLogout}>
            Sign out
          </button>
        )}
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Guest nickname field for a game-over screen. Calls `onSaved(name)` once the name is set,
 * so the game can then call `auth.submitScore(run)`.
 */
export function NicknameForm({
  auth,
  busy,
  submitLabel = 'Save',
  onSaved,
}: {
  auth: GameAuth
  busy?: boolean
  submitLabel?: string
  onSaved(name: string): void
}) {
  const player = usePlayer(auth)
  const [name, setName] = useState(player.displayName ?? '')
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  function submit(e: FormEvent) {
    e.preventDefault()
    const res: NicknameResult = auth.setNickname(name)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    onSaved(res.name)
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field" htmlFor={id}>
        Your name for the leaderboard
      </label>
      <div className="auth-row">
        <input
          id={id}
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="nickname"
          placeholder="Nickname"
          required
        />
        <button type="submit" className="btn btn--accent" disabled={busy}>
          {submitLabel}
        </button>
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <p className="auth-note muted">Just a nickname — no account needed.</p>
    </form>
  )
}
