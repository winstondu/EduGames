import { describe, expect, test } from 'bun:test'
import { compileTrack, loopSteps, midiToFrequency, noteToMidi, parsePattern, scheduleWindow, startSequencer, type Track } from './sequencer'
import { TRACKS, TRACK_NAMES } from './tracks'

const simple: Track = {
  bpm: 120,
  stepsPerBeat: 4, // 16ths at 120 bpm → 0.125 s per step
  voices: [
    { instrument: 'square', gain: 0.5, pattern: 'C4 - . E4', gate: 1 },
    { instrument: 'noise', gain: 0.2, pattern: 'x o' },
  ],
}

describe('pattern parsing', () => {
  test('note names → MIDI → Hz', () => {
    expect(noteToMidi('C4')).toBe(60)
    expect(noteToMidi('A4')).toBe(69)
    expect(noteToMidi('Eb3')).toBe(51)
    expect(noteToMidi('F#5')).toBe(78)
    expect(noteToMidi('H2')).toBeNull()
    expect(midiToFrequency(69)).toBe(440)
    expect(midiToFrequency(81)).toBeCloseTo(880)
  })

  test('holds extend notes, rests break them, bars are ignored', () => {
    const { steps, notes } = parsePattern('C4 - - | . E4 x o -')
    expect(steps).toBe(8)
    expect(notes).toEqual([
      { step: 0, length: 3, midi: 60, velocity: 1 },
      { step: 4, length: 1, midi: 64, velocity: 1 },
      { step: 5, length: 1, midi: null, velocity: 1 },
      { step: 6, length: 2, midi: null, velocity: 0.5 },
    ])
  })

  test('unknown tokens throw', () => {
    expect(() => parsePattern('C4 Q9')).toThrow(/Q9/)
  })

  test('every bundled track parses into whole bars', () => {
    for (const name of TRACK_NAMES) {
      const compiled = compileTrack(TRACKS[name])
      for (const v of compiled.voices) expect(v.steps % 16).toBe(0)
      expect(loopSteps(compiled)).toBe(64)
    }
  })

  test('tracks get faster from menu to intense', () => {
    expect(TRACKS.menu.bpm).toBeLessThan(TRACKS.play.bpm)
    expect(TRACKS.play.bpm).toBeLessThan(TRACKS.intense.bpm)
  })
})

describe('scheduleWindow', () => {
  const compiled = compileTrack(simple)

  test('schedules notes inside the look-ahead window at step times', () => {
    const { notes, state } = scheduleWindow(compiled, startSequencer(1), 1, 0.3)
    // Steps at t = 1, 1.125, 1.25 (< 1.3).
    expect(state).toEqual({ step: 3, time: 1.375 })
    expect(notes.map((n) => [n.voice, n.time, n.midi])).toEqual([
      [0, 1, 60],
      [1, 1, null],
      [1, 1.125, null],
      [1, 1.25, null],
    ])
    expect(notes[0].duration).toBeCloseTo(0.25) // C4 held for 2 steps, gate 1
    expect(notes[0].frequency).toBeCloseTo(261.63, 1)
    expect(notes[0].gain).toBe(0.5)
    expect(notes[2].gain).toBeCloseTo(0.1) // soft 'o' hit
  })

  test('consecutive windows neither drop nor repeat steps; voices loop', () => {
    let state = startSequencer(0)
    const times: number[] = []
    for (let now = 0; now < 2; now += 0.025) {
      const r = scheduleWindow(compiled, state, now, 0.1)
      state = r.state
      for (const n of r.notes) if (n.voice === 0) times.push(Number(n.time.toFixed(6)))
    }
    // Voice 0 has 4 steps: notes at steps 0 and 3 of each 0.5 s loop.
    expect(times.slice(0, 6)).toEqual([0, 0.375, 0.5, 0.875, 1, 1.375])
    expect(new Set(times).size).toBe(times.length)
  })

  test('nothing is due before the window reaches the next step', () => {
    const { notes, state } = scheduleWindow(compiled, startSequencer(5), 4, 0.5)
    expect(notes).toEqual([])
    expect(state).toEqual({ step: 0, time: 5 })
  })

  test('skips steps that are too late instead of bursting them', () => {
    // Timer was throttled: 1 s passed without scheduling.
    const { notes, state } = scheduleWindow(compiled, { step: 0, time: 0 }, 1, 0.1)
    expect(notes.every((n) => n.time >= 1 - 0.05)).toBe(true)
    expect(notes.map((n) => n.time)).toEqual([1, 1]) // step 8 = loop start again: C4 + x
    expect(state.step).toBe(9)
    expect(state.time).toBeCloseTo(1.125)
  })

  test('slightly late steps (within tolerance) still play', () => {
    const { notes } = scheduleWindow(compiled, startSequencer(1), 1.02, 0.05)
    expect(notes[0].time).toBe(1)
  })
})
