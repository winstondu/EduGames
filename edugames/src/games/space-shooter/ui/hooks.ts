/** Small React hooks for the space shooter screen. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { AudioDirector } from '../../../shared/kit/audio'

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
