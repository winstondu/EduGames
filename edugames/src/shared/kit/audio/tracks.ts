/**
 * Original chiptune loops (4 bars each, 16th-note steps). Pattern syntax is
 * documented in sequencer.ts. Any game may use them; names describe mood, not
 * a game screen.
 */
import type { Track } from './sequencer'

export type TrackName = 'menu' | 'play' | 'intense'

export const TRACK_NAMES: readonly TrackName[] = ['menu', 'play', 'intense']

export const TRACKS: Record<TrackName, Track> = {
  /** Calm: slow triangle arpeggios over Cmaj7 – Am7 – Fmaj7 – G. */
  menu: {
    bpm: 88,
    stepsPerBeat: 4,
    voices: [
      {
        instrument: 'triangle',
        gain: 0.32,
        gate: 0.9,
        pattern: `
          C5 - E5 - G5 - B5 - G5 - E5 - D5 - E5 - |
          A4 - C5 - E5 - G5 - E5 - C5 - B4 - C5 - |
          F4 - A4 - C5 - E5 - C5 - A4 - G4 - A4 - |
          G4 - B4 - D5 - G5 - - - F5 - E5 - D5 -`,
      },
      {
        instrument: 'square',
        gain: 0.07,
        gate: 0.95,
        pattern: `
          C3 - - - - - - - G2 - - - - - - - |
          A2 - - - - - - - E2 - - - - - - - |
          F2 - - - - - - - C3 - - - - - - - |
          G2 - - - - - - - D3 - - - B2 - - -`,
      },
      { instrument: 'noise', gain: 0.05, pattern: '. . o . . . o . . . o . . . o o' },
    ],
  },

  /** Upbeat: square lead over I–V–vi–IV (C – G – Am – F), octave bass, four-on-the-floor. */
  play: {
    bpm: 128,
    stepsPerBeat: 4,
    voices: [
      {
        instrument: 'square',
        gain: 0.13,
        gate: 0.7,
        pattern: `
          E5 - G5 . C6 - G5 . E5 - D5 . C5 - D5 . |
          D5 - G5 . B5 - G5 . D5 - - . B4 - D5 . |
          C5 - E5 . A5 - E5 . C5 - E5 . G5 - E5 . |
          F5 - E5 . C5 - A4 . C5 - D5 . E5 - - .`,
      },
      {
        instrument: 'triangle',
        gain: 0.38,
        gate: 0.8,
        pattern: `
          C3 . C4 . C3 . C4 . C3 . C4 . C3 . G3 . |
          G2 . G3 . G2 . G3 . G2 . G3 . G2 . D3 . |
          A2 . A3 . A2 . A3 . A2 . A3 . A2 . E3 . |
          F2 . F3 . F2 . F3 . F2 . F3 . G2 . G3 .`,
      },
      { instrument: 'kick', gain: 0.5, pattern: 'x . . . x . . . x . . . x . . .' },
      { instrument: 'noise', gain: 0.05, pattern: '. . x . . . x . . . x . . . x o' },
    ],
  },

  /** Intense: fast 16th arpeggios in A minor (Am – F – G – E), driving bass, snare backbeat. */
  intense: {
    bpm: 156,
    stepsPerBeat: 4,
    voices: [
      {
        instrument: 'square',
        gain: 0.09,
        gate: 0.6,
        pattern: `
          A4 C5 E5 A5 E5 C5 A4 C5 E5 A5 C6 A5 E5 C5 E5 C5 |
          F4 A4 C5 F5 C5 A4 F4 A4 C5 F5 A5 F5 C5 A4 C5 A4 |
          G4 B4 D5 G5 D5 B4 G4 B4 D5 G5 B5 G5 D5 B4 D5 B4 |
          E4 G#4 B4 E5 B4 G#4 E4 G#4 B4 E5 G#5 E5 B4 G#4 B4 G#4`,
      },
      {
        instrument: 'triangle',
        gain: 0.26,
        gate: 0.95,
        pattern: `
          E5 - - - - - - - A5 - - - G5 - - - |
          F5 - - - - - - - C5 - - - A4 - - - |
          G5 - - - - - - - B5 - - - D6 - - - |
          E5 - - - - - - - G#5 - - - B5 - - -`,
      },
      {
        instrument: 'square',
        gain: 0.08,
        gate: 0.5,
        pattern: `
          A2 . A2 A3 A2 . A2 A3 A2 . A2 A3 A2 . A2 A3 |
          F2 . F2 F3 F2 . F2 F3 F2 . F2 F3 F2 . F2 F3 |
          G2 . G2 G3 G2 . G2 G3 G2 . G2 G3 G2 . G2 G3 |
          E2 . E2 E3 E2 . E2 E3 E2 . E2 E3 E2 . E2 E3`,
      },
      { instrument: 'kick', gain: 0.55, pattern: 'x . . . x . . . x . . . x . x .' },
      { instrument: 'snare', gain: 0.18, pattern: '. . . . x . . . . . . . x . . o' },
      { instrument: 'noise', gain: 0.04, pattern: 'o o x o o o x o o o x o o o x o' },
    ],
  },
}
