/** Small React hooks for the space shooter screen. */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { AudioDirector } from '../../../shared/kit/audio'
import { createKeymap, loadKeymap, type Keymap } from '../../../shared/kit/input/keymap'
import { SHOOTER_ACTIONS } from '../input/actions'
import { GAME_ID } from '../settings'

/** The player's keymap (preset + rebinds, persisted per game); one instance per game screen. */
export function useShooterKeymap(): Keymap {
  const [keymap] = useState(() => createKeymap(SHOOTER_ACTIONS, loadKeymap(GAME_ID)))
  return keymap
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const mql = matchMedia(query)
      mql.addEventListener('change', listener)
      return () => mql.removeEventListener('change', listener)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}

export interface ViewportBox {
  height: number
  top: number
}

/**
 * While `active`, the visual viewport's height and offset in CSS px — the part
 * of the screen a soft keyboard leaves visible (null when inactive, pinch-zoomed
 * or unsupported). Fixed layouts size themselves to it so the keyboard never
 * covers them, whichever `interactive-widget` behaviour the browser uses.
 */
export function useVisualViewport(active: boolean): ViewportBox | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      const vv = window.visualViewport
      if (!active || !vv) return () => {}
      vv.addEventListener('resize', listener)
      vv.addEventListener('scroll', listener)
      return () => {
        vv.removeEventListener('resize', listener)
        vv.removeEventListener('scroll', listener)
      }
    },
    [active],
  )
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      const vv = window.visualViewport
      if (!active || !vv || Math.abs(vv.scale - 1) > 0.01) return ''
      return `${Math.round(vv.height)} ${Math.round(vv.offsetTop)}`
    },
    () => '',
  )
  if (!snapshot) return null
  const [height, top] = snapshot.split(' ').map(Number)
  return { height, top }
}

/** One AudioDirector per game screen, unlocked on the first gesture and disposed on unmount. */
export function useAudioDirector(): AudioDirector | null {
  const [audio, setAudio] = useState<AudioDirector | null>(null)
  useEffect(() => {
    const director = new AudioDirector()
    const stopUnlock = director.unlockOnGesture()
    // Created here (not in render) so StrictMode's mount/unmount/mount never reuses a disposed director.
    // eslint-disable-next-line react/set-state-in-effect
    setAudio(director)
    return () => {
      stopUnlock()
      director.dispose()
    }
  }, [])
  return audio
}

export function useMuted(audio: AudioDirector | null): boolean {
  return useSyncExternalStore(
    (listener) => audio?.subscribe(listener) ?? (() => {}),
    () => audio?.muted ?? false,
    () => false,
  )
}

/** Persisted nickname for score submissions (shared by every game). */
const NICKNAME_KEY = 'edugames.nickname'

export function loadNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveNickname(name: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, name)
  } catch {
    // Storage unavailable; the name just isn't remembered.
  }
}
