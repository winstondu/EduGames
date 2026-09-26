/** HUD band: pause/mute, board title, score, level, streak, lives, shield and effect countdowns. */
import { useEffect, useRef } from 'react'
import { POWERUP_ICONS } from '../assets/powerups'
import { UI_ICONS } from '../assets/ui'
import { START_LIVES, type ActiveEffect, type Engine } from '../engine/types'
import type { HudSnapshot } from './session'

export interface HudProps {
  hud: HudSnapshot
  title: string
  muted: boolean
  engine: Engine | null
  onPause(): void
  onToggleMute(): void
}

export function Hud({ hud, title, muted, engine, onPause, onToggleMute }: HudProps) {
  const hearts = Math.max(hud.lives, START_LIVES)
  return (
    <div className="ss-hud">
      <div className="ss-hud-left">
        <button type="button" className="ss-icon-btn" onClick={onPause} aria-label="Pause" title="Pause (Esc)">
          <img src={UI_ICONS.pause} alt="" />
        </button>
        <button
          type="button"
          className="ss-icon-btn"
          onClick={onToggleMute}
          aria-label="Sound"
          aria-pressed={!muted}
          title={muted ? 'Sound is off' : 'Sound is on'}
        >
          <img src={muted ? UI_ICONS.soundOff : UI_ICONS.soundOn} alt="" />
        </button>
        <span className="ss-hud-title" title={title}>
          {title}
        </span>
      </div>

      <div className="ss-hud-score" aria-label={`Score ${hud.score}`}>
        <span key={hud.score} className="ss-score-value">
          {hud.score.toLocaleString()}
        </span>
      </div>

      <div className="ss-hud-right">
        <span className="ss-level" title="Level">
          <small>LV</small>
          {hud.level}
        </span>
        <span className={`ss-streak${hud.streak >= 3 ? ' is-hot' : ''}`} title="Streak" aria-label={`Streak ${hud.streak}`}>
          <Flame />
          {hud.streak}
        </span>
        <span className="ss-lives" role="img" aria-label={`${hud.lives} ${hud.lives === 1 ? 'life' : 'lives'}`}>
          {Array.from({ length: hearts }, (_, i) => (
            <img key={i} src={UI_ICONS.life} alt="" className={i < hud.lives ? undefined : 'is-lost'} />
          ))}
        </span>
        {hud.shield > 0 && (
          <span className="ss-shield" role="img" aria-label={`Shield ${hud.shield}`}>
            <img src={POWERUP_ICONS.shield.url} alt="" />
            <span className="ss-pips">
              {Array.from({ length: hud.shield }, (_, i) => (
                <span key={i} className="ss-pip" />
              ))}
            </span>
          </span>
        )}
        <EffectBadges effects={hud.effects} engine={engine} />
      </div>
    </div>
  )
}

const RING = 2 * Math.PI * 17

/** Active powerup effects; the countdown rings are driven per frame from live engine state (no React renders). */
function EffectBadges({ effects, engine }: { effects: readonly ActiveEffect[]; engine: Engine | null }) {
  const rings = useRef(new Map<ActiveEffect['kind'], SVGCircleElement>())

  useEffect(() => {
    if (!engine || !effects.length) return
    let raf = requestAnimationFrame(function tick() {
      for (const e of engine.state.effects) {
        const ring = rings.current.get(e.kind)
        if (ring) ring.style.strokeDashoffset = String(RING * (1 - Math.max(0, e.remaining) / e.duration))
      }
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [engine, effects.length])

  return (
    <>
      {effects.map((e) => (
        <span key={e.kind} className="ss-effect" title={`${POWERUP_ICONS[e.kind].label}: ${Math.ceil(e.remaining)}s`}>
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle className="ss-effect-track" cx="20" cy="20" r="17" />
            <circle
              ref={(el) => {
                if (el) rings.current.set(e.kind, el)
                else rings.current.delete(e.kind)
              }}
              className="ss-effect-ring"
              cx="20"
              cy="20"
              r="17"
              strokeDasharray={RING}
              strokeDashoffset={RING * (1 - e.remaining / e.duration)}
            />
          </svg>
          <img src={POWERUP_ICONS[e.kind].url} alt={`${POWERUP_ICONS[e.kind].label}, ${Math.ceil(e.remaining)} seconds`} />
        </span>
      ))}
    </>
  )
}

function Flame() {
  return (
    <svg viewBox="0 0 24 28" className="ss-flame" aria-hidden="true">
      <path
        d="M12 2c1 5 7 7 7 14a7 7 0 0 1-14 0c0-4 2-6 3-8 .5 2 1.5 3 3 3-1-3-.5-6 1-9z"
        fill="#ff8a3d"
        stroke="#1b1b2f"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M12 13c.5 2.5 3.5 3.5 3.5 7a3.5 3.5 0 0 1-7 0c0-2 1-3 1.5-4 .5 1 1 1.5 2 1.5-.5-1.5 0-3 0-4.5z" fill="#ffd23f" />
    </svg>
  )
}
