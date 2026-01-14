/**
 * Domain warping utilities
 *
 * Domain warping distorts sample coordinates before querying the elevation field,
 * making geometric features (ridges, coastlines, cell boundaries) appear organic.
 */

import { createFBmNoise } from './noise.js';
import { deriveSeed } from './seeds.js';

/**
 * Default warp configuration
 */
export const DEFAULT_WARP_CONFIG = {
  strength: 0.05,    // Maximum displacement in normalized units
  scale: 0.015,      // Frequency (lower = larger features)
  octaves: 2,        // Noise complexity
  persistence: 0.5,  // Amplitude decay between octaves
  enabled: true
};

/**
 * Create a domain warping function
 *
 * Generates two noise fields (for X and Z displacement) and returns
 * a function that warps input coordinates.
 *
 * @param {number} seed - World seed
 * @param {Object} config - Warp parameters
 * @param {number} [config.strength=0.05] - Maximum displacement
 * @param {number} [config.scale=0.015] - Noise frequency
 * @param {number} [config.octaves=2] - Noise octaves
 * @param {number} [config.persistence=0.5] - Amplitude decay
 * @param {boolean} [config.enabled=true] - Whether warping is active
 * @returns {(x: number, z: number) => [number, number]} Warped coordinates
 */
export function createDomainWarp(seed, config = {}) {
  const {
    strength = DEFAULT_WARP_CONFIG.strength,
    scale = DEFAULT_WARP_CONFIG.scale,
    octaves = DEFAULT_WARP_CONFIG.octaves,
    persistence = DEFAULT_WARP_CONFIG.persistence,
    enabled = DEFAULT_WARP_CONFIG.enabled
  } = config;

  // Early return for disabled warping
  if (!enabled || strength === 0) {
    return (x, z) => [x, z];
  }

  // Create separate noise fields for X and Z displacement
  const warpX = createFBmNoise(deriveSeed(seed, 'warpX'), {
    octaves,
    persistence,
    frequency: 1 / scale  // Convert scale to frequency
  });

  const warpZ = createFBmNoise(deriveSeed(seed, 'warpZ'), {
    octaves,
    persistence,
    frequency: 1 / scale
  });

  return function warp(x, z) {
    // Sample displacement at this position
    // Noise returns [-1, 1], multiply by strength for final offset
    const dx = warpX(x, z) * strength;
    const dz = warpZ(x, z) * strength;

    return [x + dx, z + dz];
  };
}

/**
 * Create a cached domain warp for performance
 * Useful when the same warp is queried many times
 *
 * @param {number} seed
 * @param {Object} config
 * @param {number} [cacheResolution=0.001] - Grid size for cache keys
 * @returns {(x: number, z: number) => [number, number]}
 */
export function createCachedDomainWarp(seed, config = {}, cacheResolution = 0.001) {
  const warp = createDomainWarp(seed, config);
  const cache = new Map();

  return function cachedWarp(x, z) {
    // Quantize to cache grid
    const kx = Math.round(x / cacheResolution);
    const kz = Math.round(z / cacheResolution);
    const key = `${kx},${kz}`;

    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = warp(x, z);
    cache.set(key, result);

    // Limit cache size (LRU would be better but this is simpler)
    if (cache.size > 100000) {
      // Clear oldest half of cache
      const keys = Array.from(cache.keys());
      for (let i = 0; i < 50000; i++) {
        cache.delete(keys[i]);
      }
    }

    return result;
  };
}
