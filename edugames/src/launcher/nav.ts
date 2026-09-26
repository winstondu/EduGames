/** Minimal History-API navigation: `navigate()` and `useLocation()` (see Link.tsx for anchors). */
import { useSyncExternalStore } from 'react'

const NAV_EVENT = 'edugames:navigate'

export interface AppLocation {
  pathname: string
  search: string
}

/** Push (or replace) a same-origin URL and notify `useLocation` subscribers. */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const current = location.pathname + location.search
  if (to === current && !options.replace) return
  if (options.replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  window.dispatchEvent(new Event(NAV_EVENT))
  if (!options.replace) window.scrollTo(0, 0)
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener)
  window.addEventListener(NAV_EVENT, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(NAV_EVENT, listener)
  }
}

const snapshot = () => location.pathname + location.search

export function useLocation(): AppLocation {
  const href = useSyncExternalStore(subscribe, snapshot, snapshot)
  const url = new URL(href, 'http://local')
  return { pathname: url.pathname, search: url.search }
}
