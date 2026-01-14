/**
 * Surface noise for terrain variation
 *
 * Adds terrain detail using multi-octave fBm noise.
 * With blob-based terrain, blobs have smooth natural falloff so no
 * boundary blending is needed.
 */

import { createFBmNoise } from '../core/noise.js';
import { deriveSeed } from '../core/seeds.js';

/**
 * Default surface noise configuration
 */
export const DEFAULT_SURFACE_NOISE_CONFIG = {
  roughness: 0.3,       // Noise amplitude as fraction of elevation range (0-1)
  featureScale: 0.1,    // Base wavelength of features in world units
  octaves: 4,           // Number of noise layers
  persistence: 0.5,     // Amplitude decay per octave
  lacunarity: 2,        // Frequency increase per octave
  enabled: true
};

/**
 * Maximum elevation deviation from base terrain (in normalized 0-1 space)
 * roughness=1.0 maps to this value
 */
const MAX_NOISE_AMPLITUDE = 0.1;

/**
 * Cache for surface noise functions, keyed by world
 */
const noiseCache = new WeakMap();

/**
 * Get or create surface noise function for a world
 *
 * @param {Object} world - World object
 * @returns {(x: number, z: number) => number} Noise function returning [-1, 1]
 */
function getSurfaceNoise(world) {
  if (noiseCache.has(world)) {
    return noiseCache.get(world);
  }

  const seed = world.seed ?? 42;
  const config = world.defaults?.surfaceNoise ?? DEFAULT_SURFACE_NOISE_CONFIG;

  // Create fBm noise with base frequency of 1 (frequency controlled at sample time)
  const noise = createFBmNoise(deriveSeed(seed, 'surfaceNoise'), {
    octaves: config.octaves ?? DEFAULT_SURFACE_NOISE_CONFIG.octaves,
    persistence: config.persistence ?? DEFAULT_SURFACE_NOISE_CONFIG.persistence,
    lacunarity: config.lacunarity ?? DEFAULT_SURFACE_NOISE_CONFIG.lacunarity,
    frequency: 1
  });

  noiseCache.set(world, noise);
  return noise;
}

/**
 * Sample surface noise at a point
 *
 * @param {Object} world - World object
 * @param {number} x - Sample X coordinate
 * @param {number} z - Sample Z coordinate
 * @param {number} baseElevation - Current elevation before noise (unused, kept for API)
 * @returns {number} Noise deviation to add to elevation
 */
export function sampleSurfaceNoise(world, x, z, baseElevation) {
  const config = world.defaults?.surfaceNoise ?? DEFAULT_SURFACE_NOISE_CONFIG;
  if (!config.enabled) return 0;

  // Get noise function
  const noise = getSurfaceNoise(world);

  // Get global noise parameters
  const roughness = config.roughness ?? DEFAULT_SURFACE_NOISE_CONFIG.roughness;
  const featureScale = config.featureScale ?? DEFAULT_SURFACE_NOISE_CONFIG.featureScale;

  // Sample noise at appropriate frequency
  const frequency = 1 / featureScale;
  const noiseValue = noise(x * frequency, z * frequency);

  // Scale amplitude by roughness
  const amplitude = roughness * MAX_NOISE_AMPLITUDE;

  return noiseValue * amplitude;
}

/**
 * Clear the surface noise cache
 */
export function clearSurfaceNoiseCache() {
  // WeakMap auto-clears when world object is garbage collected
}

// Legacy export for backward compatibility (returns global config)
export function getHalfCellNoiseConfig(world, spineId, vertexIndex, side) {
  const defaults = world.defaults?.surfaceNoise ?? DEFAULT_SURFACE_NOISE_CONFIG;
  return {
    roughness: defaults.roughness ?? DEFAULT_SURFACE_NOISE_CONFIG.roughness,
    featureScale: defaults.featureScale ?? DEFAULT_SURFACE_NOISE_CONFIG.featureScale
  };
}
