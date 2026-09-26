/** Audio cues: which shared sound / music track each engine event triggers. */
import type { AudioDirector, SfxName, TrackName } from '../../../shared/kit/audio'
import type { GameEvent } from '../engine/types'

/** Music switches to the 'intense' track from this level on. */
export const INTENSE_LEVEL = 5

export interface Cue {
  sfx?: SfxName
  volume?: number
  pitch?: number
  /** Switch music; null = silence. Absent = leave the music alone. */
  music?: TrackName | null
}

export function cueFor(event: GameEvent): Cue | null {
  switch (event.type) {
    case 'fired':
      return { sfx: 'blip', volume: 0.5 }
    case 'hit':
      return { sfx: 'zap', pitch: event.bonus ? 1.25 : 1 }
    case 'wrongAnswer':
      return { sfx: 'boing' }
    case 'shipHit':
    case 'asteroidPassed':
      return { sfx: event.absorbedByShield ? 'clang' : 'crunch' }
    case 'powerupCollected':
      return { sfx: 'powerup' }
    case 'levelUp':
      return event.level >= INTENSE_LEVEL ? { sfx: 'levelUp', music: 'intense' } : { sfx: 'levelUp' }
    case 'gameOver':
      return { sfx: 'gameOver', music: null }
    default:
      return null
  }
}

/** Play the cues for one batch of events; each sound plays at most once per batch. */
export function playCues(audio: Pick<AudioDirector, 'sfx' | 'music'>, events: readonly GameEvent[]): void {
  const played = new Set<SfxName>()
  for (const event of events) {
    const cue = cueFor(event)
    if (!cue) continue
    if (cue.sfx && !played.has(cue.sfx)) {
      played.add(cue.sfx)
      audio.sfx(cue.sfx, { volume: cue.volume, pitch: cue.pitch })
    }
    if (cue.music !== undefined) audio.music(cue.music)
  }
}
