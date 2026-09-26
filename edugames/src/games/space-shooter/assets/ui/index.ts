import backUrl from './back.svg?url'
import lifeUrl from './life.svg?url'
import pauseUrl from './pause.svg?url'
import playUrl from './play.svg?url'
import settingsUrl from './settings.svg?url'
import soundOffUrl from './soundOff.svg?url'
import soundOnUrl from './soundOn.svg?url'
import trophyUrl from './trophy.svg?url'

/** 48x48 UI icons (retro comic style, see ../spec.ts). */
export type UiIconName = 'life' | 'pause' | 'play' | 'soundOn' | 'soundOff' | 'settings' | 'trophy' | 'back'

export const UI_ICON_SIZE = 48

export const UI_ICONS: Record<UiIconName, string> = {
  life: lifeUrl,
  pause: pauseUrl,
  play: playUrl,
  soundOn: soundOnUrl,
  soundOff: soundOffUrl,
  settings: settingsUrl,
  trophy: trophyUrl,
  back: backUrl,
}
