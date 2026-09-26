/**
 * Game-agnostic audio: one AudioContext, a master gain with separate music and
 * SFX buses, ZzFX sound effects and a look-ahead chiptune sequencer.
 *
 *   const audio = new AudioDirector()
 *   const stop = audio.unlockOnGesture()   // or call audio.unlock() from a click handler
 *   audio.music('menu')                    // remembered until the context is unlocked
 *   audio.sfx('zap')
 *
 * Nothing touches Web Audio until unlock() (browsers block audio before a user
 * gesture). Every method is a safe no-op without Web Audio (tests, SSR).
 */
import { compileTrack, scheduleWindow, startSequencer, type CompiledTrack, type ScheduledNote, type SequencerState } from './sequencer'
import { SFX_BANK, type SfxName } from './sfxBank'
import { TRACKS, type TrackName } from './tracks'

export interface AudioDirectorOptions {
  /** localStorage key for the mute flag. */
  storageKey?: string
  /** Bus levels 0..1. */
  musicVolume?: number
  sfxVolume?: number
  /** Scheduler look-ahead (s) and timer period (ms). */
  lookAhead?: number
  tickMs?: number
}

export interface MusicOptions {
  /** Seconds to fade the old track out and the new one in (0 = cut). Default 0.6. */
  crossfade?: number
}

export interface SfxOptions {
  /** Linear gain multiplier (default 1). */
  volume?: number
  /** Playback-rate multiplier (default 1). */
  pitch?: number
}

type Zzfx = typeof import('zzfx')

interface PlayingTrack {
  name: TrackName
  compiled: CompiledTrack
  state: SequencerState
  gain: GainNode
  /** Clock time scheduling stops (fade-out end); Infinity while current. */
  stopAt: number
}

const DEFAULT_STORAGE_KEY = 'edugames.audio.muted'
const START_DELAY = 0.06
const RELEASE = 0.05

const compiledCache: Partial<Record<TrackName, CompiledTrack>> = {}
function compiled(name: TrackName): CompiledTrack {
  return (compiledCache[name] ??= compileTrack(TRACKS[name]))
}

function readMuted(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeMuted(key: string, muted: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, muted ? '1' : '0')
  } catch {
    // Storage unavailable; the flag lasts for this page only.
  }
}

export class AudioDirector {
  private readonly storageKey: string
  private readonly musicVolume: number
  private readonly sfxVolume: number
  private readonly lookAhead: number
  private readonly tickMs: number

  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private noise: AudioBuffer | null = null
  private zzfx: Zzfx | null = null
  private zzfxLoading: Promise<void> | null = null
  private readonly buffers = new Map<SfxName, AudioBuffer>()

  private mutedFlag: boolean
  private desired: TrackName | null = null
  private current: PlayingTrack | null = null
  private fading: PlayingTrack[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly listeners = new Set<() => void>()
  private disposed = false

  constructor(options: AudioDirectorOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
    this.musicVolume = options.musicVolume ?? 0.55
    this.sfxVolume = options.sfxVolume ?? 0.9
    this.lookAhead = options.lookAhead ?? 0.12
    this.tickMs = options.tickMs ?? 25
    this.mutedFlag = readMuted(this.storageKey)
  }

  get muted(): boolean {
    return this.mutedFlag
  }

  /** True once the AudioContext is running (after a user gesture). */
  get unlocked(): boolean {
    return this.ctx?.state === 'running'
  }

  /** Currently requested music track (may not be audible until unlocked). */
  get track(): TrackName | null {
    return this.desired
  }

  /** Notified when `muted` or `unlocked` changes (for mute buttons). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Create/resume the AudioContext. Call from a user-gesture handler; safe to
   * call repeatedly. Resolves once running (or immediately if audio is unavailable).
   */
  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const ctx = this.ensureContext()
    if (!ctx) return Promise.resolve()
    // resume() must be called synchronously inside the gesture.
    const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume().catch(() => {})
    return Promise.all([resumed, this.loadZzfx()]).then(() => {
      if (this.disposed) return
      this.emit()
      this.applyMusic(0.3)
    })
  }

  /** Unlock on the first pointer/key/touch gesture on `target` (default window). Returns a remover. */
  unlockOnGesture(target: EventTarget | undefined = globalThis.window): () => void {
    if (!target) return () => {}
    const events = ['pointerdown', 'keydown', 'touchend']
    const handler = () => {
      void this.unlock().then(() => {
        if (this.unlocked) remove()
      })
    }
    const remove = () => {
      for (const e of events) target.removeEventListener(e, handler, true)
    }
    for (const e of events) target.addEventListener(e, handler, true)
    return remove
  }

  setMuted(muted: boolean): void {
    if (muted === this.mutedFlag) return
    this.mutedFlag = muted
    writeMuted(this.storageKey, muted)
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.03)
    this.emit()
  }

  toggleMuted(): boolean {
    this.setMuted(!this.mutedFlag)
    return this.mutedFlag
  }

  /** Play a named sound effect. Silently skipped while muted, locked or loading. */
  sfx(name: SfxName, options: SfxOptions = {}): void {
    const ctx = this.ctx
    if (this.disposed || this.mutedFlag || !ctx || ctx.state !== 'running' || !this.sfxBus) return
    const buffer = this.sfxBuffer(name)
    if (!buffer) return
    const randomness = SFX_BANK[name][1] ?? 0.05
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = (options.pitch ?? 1) * (1 + randomness * (Math.random() * 2 - 1))
    let dest: AudioNode = this.sfxBus
    if (options.volume !== undefined && options.volume !== 1) {
      const gain = ctx.createGain()
      gain.gain.value = Math.max(0, options.volume)
      gain.connect(this.sfxBus)
      dest = gain
      source.onended = () => gain.disconnect()
    }
    source.connect(dest)
    source.start()
  }

  /** Switch music (null = silence), crossfading. Same track again is a no-op. */
  music(name: TrackName | null, options: MusicOptions = {}): void {
    if (this.disposed || name === this.desired) return
    this.desired = name
    this.applyMusic(options.crossfade ?? 0.6)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopTimer()
    this.listeners.clear()
    this.current = null
    this.fading = []
    const ctx = this.ctx
    this.ctx = null
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {})
  }

  // ── internals ────────────────────────────────────────────────────────────

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx
    const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    const ctx = new Ctor()
    const master = ctx.createGain()
    master.gain.value = this.mutedFlag ? 0 : 1
    master.connect(ctx.destination)
    const musicBus = ctx.createGain()
    musicBus.gain.value = this.musicVolume
    musicBus.connect(master)
    const sfxBus = ctx.createGain()
    sfxBus.gain.value = this.sfxVolume
    sfxBus.connect(master)
    this.ctx = ctx
    this.master = master
    this.musicBus = musicBus
    this.sfxBus = sfxBus
    ctx.onstatechange = () => this.emit()
    return ctx
  }

  private loadZzfx(): Promise<void> {
    this.zzfxLoading ??= import('zzfx').then(
      (mod) => {
        // The module made its own context; we play through ours instead.
        const own = mod.ZZFX.audioContext
        if (own && own !== this.ctx) void own.close?.().catch(() => {})
        if (this.ctx) mod.ZZFX.audioContext = this.ctx
        this.zzfx = mod
      },
      () => {
        // SFX stay silent; music does not depend on zzfx.
      },
    )
    return this.zzfxLoading
  }

  private sfxBuffer(name: SfxName): AudioBuffer | null {
    const cached = this.buffers.get(name)
    if (cached) return cached
    if (!this.zzfx || !this.ctx) return null
    const params = [...SFX_BANK[name]]
    params[1] = 0 // randomness is applied per play via playbackRate
    const samples = this.zzfx.ZZFX.buildSamples(...params)
    if (!samples.length) return null
    const buffer = this.ctx.createBuffer(1, samples.length, this.zzfx.ZZFX.sampleRate)
    buffer.getChannelData(0).set(samples)
    this.buffers.set(name, buffer)
    return buffer
  }

  private applyMusic(crossfade: number): void {
    const ctx = this.ctx
    if (!ctx || !this.musicBus || ctx.state !== 'running') return
    if (this.current?.name === this.desired) return
    const now = ctx.currentTime
    const fade = Math.max(0.02, crossfade)
    const old = this.current
    if (old) {
      const g = old.gain.gain
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0, now + fade)
      old.stopAt = now + fade
      this.fading.push(old)
    }
    this.current = null
    if (this.desired) {
      const gain = ctx.createGain()
      gain.connect(this.musicBus)
      if (crossfade > 0 && old) {
        gain.gain.setValueAtTime(0, now)
        gain.gain.linearRampToValueAtTime(1, now + fade)
      }
      this.current = {
        name: this.desired,
        compiled: compiled(this.desired),
        state: startSequencer(now + START_DELAY),
        gain,
        stopAt: Infinity,
      }
    }
    this.tick()
    if (!this.timer && (this.current || this.fading.length)) this.timer = setInterval(() => this.tick(), this.tickMs)
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    const ctx = this.ctx
    if (!ctx || this.disposed) return this.stopTimer()
    const now = ctx.currentTime
    for (const t of this.current ? [this.current, ...this.fading] : this.fading) {
      const lookAhead = Math.min(this.lookAhead, t.stopAt - now)
      if (lookAhead <= 0) continue
      const { notes, state } = scheduleWindow(t.compiled, t.state, now, lookAhead)
      t.state = state
      for (const note of notes) this.playNote(note, t.gain)
    }
    this.fading = this.fading.filter((t) => {
      if (now < t.stopAt + 1) return true
      t.gain.disconnect()
      return false
    })
    if (!this.current && !this.fading.length) this.stopTimer()
  }

  private playNote(note: ScheduledNote, dest: AudioNode): void {
    const ctx = this.ctx!
    const t = Math.max(note.time, ctx.currentTime)
    const env = ctx.createGain()
    env.connect(dest)
    let source: AudioScheduledSourceNode
    let end: number

    if (note.instrument === 'noise' || note.instrument === 'snare') {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuffer()
      const filter = ctx.createBiquadFilter()
      const decay = note.instrument === 'snare' ? 0.14 : 0.045
      filter.type = note.instrument === 'snare' ? 'bandpass' : 'highpass'
      filter.frequency.value = note.instrument === 'snare' ? 1800 : 7000
      if (note.instrument === 'snare') filter.Q.value = 0.8
      src.connect(filter).connect(env)
      env.gain.setValueAtTime(note.gain, t)
      env.gain.exponentialRampToValueAtTime(0.0001, t + decay)
      end = t + decay + 0.01
      source = src
    } else if (note.instrument === 'kick') {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(150, t)
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.12)
      osc.connect(env)
      env.gain.setValueAtTime(note.gain, t)
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
      end = t + 0.19
      source = osc
    } else {
      const osc = ctx.createOscillator()
      osc.type = note.instrument
      osc.frequency.setValueAtTime(note.frequency, t)
      osc.connect(env)
      const hold = Math.max(0.01, note.duration)
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(note.gain, t + 0.006)
      env.gain.linearRampToValueAtTime(note.gain * 0.75, t + hold)
      env.gain.linearRampToValueAtTime(0, t + hold + RELEASE)
      end = t + hold + RELEASE + 0.01
      source = osc
    }
    source.onended = () => env.disconnect()
    source.start(t)
    source.stop(end)
  }

  private noiseBuffer(): AudioBuffer {
    if (this.noise) return this.noise
    const ctx = this.ctx!
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // Deterministic LCG noise: no Math.random needed for a static buffer.
    let seed = 0x1234567
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      data[i] = seed / 2147483648 - 1
    }
    return (this.noise = buffer)
  }
}
