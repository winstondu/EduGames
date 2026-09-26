/**
 * Placement of the play-stage overlays (feedback toast, reserved top band).
 * Pure: no DOM or React, so it is unit-tested.
 */
import { WORLD } from '../engine/types'

/** Where the wrong-answer toast docks: the stage half away from the ship's lane. */
export type ToastAnchor = 'top' | 'bottom'

/** Ship in the upper half of the lanes → toast at the bottom; otherwise at the top (under the HUD). */
export function toastAnchor(shipLane: number, lanes: number): ToastAnchor {
  return shipLane < (lanes - 1) / 2 ? 'bottom' : 'top'
}

/**
 * World y covered by overlays docked at the top of the stage, from their bottom
 * edge in CSS px below the layer's top and the layer's CSS height (null when
 * nothing is measured, so the view falls back to its HUD band).
 */
export function reservedTopWorld(bottomPx: number, layerHeightPx: number): number | null {
  if (!(bottomPx > 0) || !(layerHeightPx > 0)) return null
  return Math.min(WORLD.height, Math.round((bottomPx / layerHeightPx) * WORLD.height))
}
