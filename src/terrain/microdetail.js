/**
 * Micro detail noise layer for surface texture
 *
 * Adds high-frequency surface variation for visual interest at close range.
 * This layer is optional and can be computed at chunk-generation time
 * rather than continental time (doesn't affect coastline extraction).
 */

import { createFBmNoise } from '../core/noise.js';
import { deriveSeed } from '../core/seeds.js';

/**
 * Default micro detail configuration
 */
export const DEFAULT_MICRO_DETAIL_CONFIG = {
  enabled: true,
  amplitude: 0.02,      // Strength of micro variation (~5% of primary noise)
  frequency: 8,         // High frequency for ground-level texture (features every ~0.125 units)
  octaves: 2,           // Limited octaves for performance
  persistence: 0.5,
  lacunarity: 2
};

/**
 * Cache for micro detail noise functions, keyed by world object
 */
const detailCache = new WeakMap();

/**
 * Get or create micro detail noise function for a world
 *
 * @param {Object} world - World object
 * @returns {(x: number, z: number) => number} Noise function returning [-1, 1]
 */
function getMicroDetailNoise(world) {
  if (detailCache.has(world)) {
    return detailCache.get(world);
  }

  const seed = world.seed ?? 42;
  const config = world.defaults?.microDetail ?? DEFAULT_MICRO_DETAIL_CONFIG;

  // Create fBm noise with high frequency for small-scale detail
  const noise = createFBmNoise(deriveSeed(seed, 'microDetail'), {
    octaves: config.octaves ?? DEFAULT_MICRO_DETAIL_CONFIG.octaves,
    persistence: config.persistence ?? DEFAULT_MICRO_DETAIL_CONFIG.persistence,
    lacunarity: config.lacunarity ?? DEFAULT_MICRO_DETAIL_CONFIG.lacunarity,
    frequency: config.frequency ?? DEFAULT_MICRO_DETAIL_CONFIG.frequency
  });

  detailCache.set(world, noise);
  return noise;
}

/**
 * Sample micro detail noise at a point
 *
 * Returns a small elevation deviation to add surface texture.
 * Applied uniformly across terrain without cell-boundary blending
 * (too small scale to matter).
 *
 * @param {Object} world - World object
 * @param {number} x - Sample X coordinate
 * @param {number} z - Sample Z coordinate
 * @returns {number} Noise deviation to add to elevation
 */
export function sampleMicroDetail(world, x, z) {
  const config = world.defaults?.microDetail ?? DEFAULT_MICRO_DETAIL_CONFIG;

  if (!config.enabled) return 0;

  const noise = getMicroDetailNoise(world);
  const amplitude = config.amplitude ?? DEFAULT_MICRO_DETAIL_CONFIG.amplitude;

  // Sample noise and scale by amplitude
  // Noise returns [-1, 1], amplitude scales to final deviation
  return noise(x, z) * amplitude;
}

/**
 * Clear the micro detail noise cache
 * Call when world seed changes
 */
export function clearMicroDetailCache() {
  // WeakMap auto-clears when world object is garbage collected
  // This function exists for explicit cache invalidation if needed
}
