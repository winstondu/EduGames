/**
 * Types for the 'zzfx' package (ships untyped). Note: importing it creates an
 * AudioContext at module evaluation, so load it lazily after a user gesture.
 */
declare module 'zzfx' {
  type Params = (number | undefined)[]

  export const ZZFX: {
    /** Master volume multiplied into built samples (default 0.3). */
    volume: number
    sampleRate: number
    audioContext: AudioContext
    play(...params: Params): AudioBufferSourceNode
    playSamples(channels: number[][], volumeScale?: number, rate?: number, pan?: number, loop?: boolean): AudioBufferSourceNode
    /** Mono samples at `sampleRate` (randomness uses Math.random). */
    buildSamples(...params: Params): number[]
    getNote(semitoneOffset?: number, rootNoteFrequency?: number): number
  }

  export function zzfx(...params: Params): AudioBufferSourceNode

  export class ZZFXSound {
    constructor(params?: Params)
    samples: number[]
    randomness: number
    play(volume?: number, pitch?: number, randomnessScale?: number, pan?: number, loop?: boolean): AudioBufferSourceNode | undefined
  }
}
