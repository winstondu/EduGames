/**
 * App shell: History-API routing between the launcher (`/`) and lazily
 * loaded game screens (`/<gameId>?gen=<generatorId>&…`).
 */
import { Component, Suspense, lazy, useEffect, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react'
import { findGame } from './games/registry'
import type { GameDefinition, GameProps } from './games/types'
import { Launcher } from './launcher/Launcher'
import { Link } from './launcher/Link'
import { navigate, useLocation } from './launcher/nav'
import { launcherUrl, parseRoute } from './launcher/urls'

const lazyGames = new Map<string, LazyExoticComponent<ComponentType<GameProps>>>()

function lazyGame(game: GameDefinition): LazyExoticComponent<ComponentType<GameProps>> {
  let screen = lazyGames.get(game.id)
  if (!screen) {
    screen = lazy(game.load)
    lazyGames.set(game.id, screen)
  }
  return screen
}

export default function App() {
  const { pathname, search } = useLocation()
  const route = parseRoute(pathname)

  const docTitle = route.kind === 'game' ? `${findGame(route.gameId)?.name ?? 'Lost in space'} · EduGames` : 'EduGames'
  useEffect(() => {
    document.title = docTitle
  }, [docTitle])

  if (route.kind === 'launcher') return <Launcher search={search} />

  const game = route.gameId ? findGame(route.gameId) : undefined
  if (!game) {
    return (
      <AppMessage title="Lost in space!" action={<Link className="btn btn--primary" href="/">Back to games</Link>}>
        We couldn't find that game.
      </AppMessage>
    )
  }

  const params = new URLSearchParams(search)
  const generatorId = params.get('gen')
  if (!generatorId) return <Redirect to={launcherUrl(game.id)} />

  return <GameRoute key={pathname + search} game={game} generatorId={generatorId} params={params} />
}

function GameRoute({ game, generatorId, params }: { game: GameDefinition; generatorId: string; params: URLSearchParams }) {
  // lazyGame() memoizes per game id, so the component identity is stable across renders.
  const Screen = lazyGame(game)
  const exit = () => navigate(launcherUrl(game.id, generatorId))
  return (
    <LoadErrorBoundary onRetry={() => lazyGames.delete(game.id)}>
      <Suspense fallback={<AppLoading label={`Loading ${game.name}…`} />}>
        {/* eslint-disable-next-line react/static-components */}
        <Screen generatorId={generatorId} params={params} onExit={exit} />
      </Suspense>
    </LoadErrorBoundary>
  )
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to])
  return null
}

function AppLoading({ label }: { label: string }) {
  return (
    <div className="screen-center" role="status" aria-live="polite">
      <div className="message-card">
        <div className="loader" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p>{label}</p>
      </div>
    </div>
  )
}

function AppMessage({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <main className="screen-center">
      <div className="panel message-card" role="alert">
        <h1 className="comic-title">{title}</h1>
        <p>{children}</p>
        {action}
      </div>
    </main>
  )
}

/** Catches a failed game-chunk download (offline, new deploy) and offers a retry. */
class LoadErrorBoundary extends Component<{ children: ReactNode; onRetry(): void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  retry = () => {
    this.props.onRetry()
    this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <AppMessage
        title="Houston, a problem!"
        action={
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" className="btn btn--primary" onClick={this.retry}>
              Try again
            </button>
            <Link className="btn" href="/">
              Back to games
            </Link>
          </div>
        }
      >
        The game didn't load. Check your connection and try again.
      </AppMessage>
    )
  }
}
