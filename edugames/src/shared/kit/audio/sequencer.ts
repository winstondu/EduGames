/**
 * Pure step-sequencer logic (no Web Audio): pattern parsing and look-ahead
 * scheduling on an abstract clock. AudioDirector turns ScheduledNotes into
 * oscillators; tests drive it with plain numbers.
 *
 * Pattern syntax: one whitespace-separated token per step (usually a 16th):
 *   C4  Eb3  F#5   note (octave 0..8, middle C = C4 = MIDI 60)
 *   x   o          unpitched hit, loud / soft (noise, kick)
 *   -              hold: extends the previous note by one step
 *   .              rest
 *   |              bar line, ignored
 */

/** Pitched: square/triangle/sawtooth. Unpitched hits: noise (hi-hat), snare, kick. */
export type Instrument = 'square' | 'triangle' | 'sawtooth' | 'noise' | 'snare' | 'kick'

export interface Voice {
  instrument: Instrument
  /** Linear gain 0..1 for this voice. */
  gain: number
  /** Loops independently; its step count may differ from other voices'. */
  pattern: string
  /** Fraction of the note's length that sounds before release (default 0.85). */
  gate?: number
}

export interface Track {
  bpm: number
  /** Steps per beat; 4 = 16th notes. */
  stepsPerBeat: number
  voices: Voice[]
}

export interface PatternNote {
  step: number
  /** Length in steps (≥ 1, grows with '-'). */
  length: number
  /** MIDI note number, or null for unpitched hits. */
  midi: number | null
  velocity: number
}

export interface CompiledVoice {
  voice: Voice
  steps: number
  /** step index → note starting there. */
  byStep: (PatternNote | undefined)[]
}

export interface CompiledTrack {
  track: Track
  stepSeconds: number
  voices: CompiledVoice[]
}

export interface ScheduledNote {
  voice: number
  instrument: Instrument
  /** Clock time the note starts (seconds). */
  time: number
  /** Seconds the note sounds before release. */
  duration: number
  midi: number | null
  /** Hz for pitched notes, 0 for hits. */
  frequency: number
  /** voice.gain × note velocity. */
  gain: number
}

export interface SequencerState {
  /** Global step counter of the next unscheduled step. */
  step: number
  /** Clock time of that step. */
  time: number
}

const NOTE_OFFSETS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** "C4" → 60, "Eb3" → 51, "F#5" → 78; null if not a note name. */
export function noteToMidi(name: string): number | null {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name)
  if (!m) return null
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return 12 * (Number(m[3]) + 1) + NOTE_OFFSETS[m[1]] + accidental
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/** Parse a pattern into notes; throws on unknown tokens so typos in tracks fail tests. */
export function parsePattern(pattern: string): { steps: number; notes: PatternNote[] } {
  const tokens = pattern.split(/\s+/).filter((t) => t && t !== '|')
  const notes: PatternNote[] = []
  let last: PatternNote | null = null
  tokens.forEach((token, step) => {
    if (token === '.') {
      last = null
    } else if (token === '-') {
      if (last) last.length++
    } else if (token === 'x' || token === 'o') {
      last = { step, length: 1, midi: null, velocity: token === 'x' ? 1 : 0.5 }
      notes.push(last)
    } else {
      const midi = noteToMidi(token)
      if (midi === null) throw new Error(`Bad pattern token "${token}" at step ${step}`)
      last = { step, length: 1, midi, velocity: 1 }
      notes.push(last)
    }
  })
  return { steps: tokens.length, notes }
}

export function compileTrack(track: Track): CompiledTrack {
  const voices = track.voices.map((voice) => {
    const { steps, notes } = parsePattern(voice.pattern)
    const byStep: (PatternNote | undefined)[] = new Array(steps)
    for (const note of notes) byStep[note.step] = note
    return { voice, steps, byStep }
  })
  return { track, stepSeconds: 60 / track.bpm / track.stepsPerBeat, voices }
}

/** Length of one full loop in steps (LCM of the voices' lengths). */
export function loopSteps(compiled: CompiledTrack): number {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  return compiled.voices.reduce((acc, v) => (v.steps ? (acc * v.steps) / gcd(acc, v.steps) : acc), 1)
}

export function startSequencer(startTime: number): SequencerState {
  return { step: 0, time: startTime }
}

/**
 * Look-ahead scheduling: returns every note whose step starts before
 * `now + lookAhead`, plus the advanced state. Steps that are already more
 * than `lateTolerance` seconds in the past (e.g. the timer was throttled in a
 * background tab) are skipped silently instead of played in a burst.
 */
export function scheduleWindow(
  compiled: CompiledTrack,
  state: SequencerState,
  now: number,
  lookAhead: number,
  lateTolerance = 0.05,
): { notes: ScheduledNote[]; state: SequencerState } {
  const dt = compiled.stepSeconds
  let { step, time } = state
  if (time < now - lateTolerance) {
    const skip = Math.ceil((now - lateTolerance - time) / dt - 1e-9)
    step += skip
    time += skip * dt
  }
  const notes: ScheduledNote[] = []
  const until = now + lookAhead
  while (time < until) {
    compiled.voices.forEach((cv, index) => {
      if (!cv.steps) return
      const note = cv.byStep[step % cv.steps]
      if (!note) return
      const gate = cv.voice.gate ?? 0.85
      notes.push({
        voice: index,
        instrument: cv.voice.instrument,
        time,
        duration: note.length * dt * gate,
        midi: note.midi,
        frequency: note.midi === null ? 0 : midiToFrequency(note.midi),
        gain: cv.voice.gain * note.velocity,
      })
    })
    step++
    time += dt
  }
  return { notes, state: { step, time } }
}
