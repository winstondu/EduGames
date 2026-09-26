/**
 * Engine and generator rngs from one session seed. Browser sessions and the
 * headless harness (scripts/sim.ts replays) must derive them the same way.
 */
export function deriveSeeds(seed: number): { engine: number; generator: number } {
  const s = seed >>> 0
  return { engine: s, generator: Math.imul(s ^ 0x5bd1e995, 0x9e3779b1) >>> 0 }
}
