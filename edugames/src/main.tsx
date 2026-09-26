import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/comic-neue/400.css'
import '@fontsource/comic-neue/700.css'
import './index.css'
import App from './App.tsx'
import { isUnrecorded } from './shared/unrecorded'

// Latch `?unrecorded=1` for the tab now: in-app navigation drops it from the URL.
isUnrecorded()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// DEV-only test harness: window.__edugames + meta panel (never in production builds).
if (import.meta.env.DEV) {
  void Promise.all([import('./shared/harness/runtime'), import('./launcher/nav'), import('./games/registry'), import('./generators/registry')]).then(
    ([runtime, nav, games, generators]) =>
      runtime.installHarnessRuntime({
        navigate: (to) => nav.navigate(to),
        panel: {
          games: games.GAMES.map((g) => ({ id: g.id, name: g.name })),
          generators: () => generators.fetchManifest().then((m) => m.generators),
        },
      }),
  )
}
