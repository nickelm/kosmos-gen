/**
 * Shared biome color utilities
 *
 * Single source of truth for biome colors used by both 2D and 3D views.
 * Re-exports from whittaker.js and provides normalized helpers for Three.js.
 */

export { BIOMES, getBiomeColor, getBiomeName } from '../src/generation/whittaker.js';

import { getBiomeColor } from '../src/generation/whittaker.js';

/**
 * Get biome color normalized to [0, 1] for Three.js vertex colors
 * @param {number} biomeId
 * @returns {{ r: number, g: number, b: number }}
 */
export function getBiomeColorNormalized(biomeId) {
  const c = getBiomeColor(biomeId);
  return { r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 };
}
