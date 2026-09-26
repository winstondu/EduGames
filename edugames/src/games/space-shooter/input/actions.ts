/**
 * Space-shooter key actions for the shared keymap (player setting, per game).
 *
 * Rules:
 * - Codes are physical (KeyboardEvent.code): WASD is ZQSD on AZERTY for free.
 * - Lanes are vertical, so only up/down move. In WASD/both, A and D are never
 *   bound — in particular never to 'choose'; choices use digits (and numpad
 *   in arrows/both) only.
 * - While a freeform (typed) answer is being composed, movement letters (W/S),
 *   P (pause) and digits are suspended so they type; arrows keep moving the
 *   ship. Fire (Space/Enter), backspace and Esc stay active because their
 *   keys are non-printable. No action is `alwaysActive`: a key rebound onto a
 *   letter/digit yields to typing, so every character stays typeable.
 * - Typing characters into the quiver is not an action: unmatched printable
 *   keys go to `typeChar` in the UI layer.
 */
import type { ActionDef, PresetId } from '../../../shared/kit/input/keymap'
import type { Command, GameStatus } from '../engine/types'

export type ShooterActionId = 'moveUp' | 'moveDown' | 'fire' | 'backspace' | 'pause' | 'choose1' | 'choose2' | 'choose3' | 'choose4'

type Presets = Record<Exclude<PresetId, 'both'>, string[]>

/** 'both' is the ordered union of the arrows and WASD defaults. */
function withBoth(defaults: Presets): Record<PresetId, string[]> {
  return { ...defaults, both: [...new Set([...defaults.arrows, ...defaults.wasd])] }
}

function action(id: ShooterActionId, label: string, group: string, defaults: Presets): ActionDef {
  return { id, label, group, defaults: withBoth(defaults) }
}

const FIRE = ['Space', 'Enter', 'NumpadEnter']

const choose = (n: number) =>
  action(`choose${n}` as ShooterActionId, `Choice ${n}`, 'Answer', { arrows: [`Digit${n}`, `Numpad${n}`], wasd: [`Digit${n}`] })

export const SHOOTER_ACTIONS: readonly ActionDef[] = [
  action('moveUp', 'Move up', 'Move', { arrows: ['ArrowUp'], wasd: ['KeyW'] }),
  action('moveDown', 'Move down', 'Move', { arrows: ['ArrowDown'], wasd: ['KeyS'] }),
  action('fire', 'Fire', 'Answer', { arrows: FIRE, wasd: FIRE }),
  action('backspace', 'Delete digit', 'Answer', { arrows: ['Backspace'], wasd: ['Backspace'] }),
  choose(1),
  choose(2),
  choose(3),
  choose(4),
  action('pause', 'Pause', 'Game', { arrows: ['Escape', 'KeyP'], wasd: ['Escape'] }),
]

/**
 * Engine command for an action. `pause` toggles: it resumes when `status` is
 * 'paused'. Returns null for unknown ids.
 */
export function mapActionToCommand(actionId: string, status?: GameStatus): Command | null {
  switch (actionId) {
    case 'moveUp':
      return { type: 'moveUp' }
    case 'moveDown':
      return { type: 'moveDown' }
    case 'fire':
      return { type: 'fire' }
    case 'backspace':
      return { type: 'backspace' }
    case 'pause':
      return status === 'paused' ? { type: 'resume' } : { type: 'pause' }
  }
  const m = /^choose([1-4])$/.exec(actionId)
  return m ? { type: 'choose', index: Number(m[1]) - 1 } : null
}
