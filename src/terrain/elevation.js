/**
 * Elevation sampling from blob-based terrain
 *
 * Uses softmax blending of circular blob influences.
 */

import { evaluateBlobAt, softmaxCombine, PROFILES } from './blob.js';
import { createDomainWarp, DEFAULT_WARP_CONFIG } from '../core/warp.js';
import { sampleSurfaceNoise, DEFAULT_SURFACE_NOISE_CONFIG } from './surfacenoise.js';
import { sampleRidgeNoise, DEFAULT_RIDGE_NOISE_CONFIG } from './ridgenoise.js';
import { sampleMicroDetail, DEFAULT_MICRO_DETAIL_CONFIG } from './microdetail.js';
import { sampleRiverCarving } from './rivercarving.js';

/** Sea level constant */
export const SEA_LEVEL = 0.10;

/**
 * Cache for domain warp functions, keyed by world object
 * Uses WeakMap for automatic cleanup
 */
const warpCache = new WeakMap();

/**
 * Get or create a domain warp function for a world
 *
 * @param {Object} world - World object
 * @returns {(x: number, z: number) => [number, number]} Warp function
 */
function getWarpFunction(world) {
  if (warpCache.has(world)) {
    return warpCache.get(world);
  }

  const warpConfig = world.defaults?.warp ?? DEFAULT_WARP_CONFIG;
  const seed = world.seed ?? 42;
  const warp = createDomainWarp(seed, warpConfig);

  warpCache.set(world, warp);
  return warp;
}

/**
 * Sample elevation at a world position
 *
 * Computes base elevation from blob contributions using softmax blending,
 * then optionally adds noise layers and river carving.
 *
 * @param {Object} world - World data containing blobs
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {Object} options - Sampling options
 * @param {boolean} [options.includeNoise=false] - Add surface/ridge/micro noise
 * @param {boolean} [options.includeHydrology=false] - Apply river carving
 * @returns {number} Elevation in [0, 1]
 */
export function sampleElevation(world, x, z, options = {}) {
  const { includeNoise = false, includeHydrology = false } = options;
  const blobs = world.template?.blobs;

  // Empty world = ocean floor
  if (!blobs || blobs.length === 0) {
    return 0;
  }

  // Apply domain warping to coordinates
  const warp = getWarpFunction(world);
  const [wx, wz] = warp(x, z);

  // Collect elevation contributions from all blobs
  const contributions = [];
  for (const blob of blobs) {
    const e = evaluateBlobAt(blob, wx, wz);
    if (e > 0) {
      contributions.push(e);
    }
  }

  // Combine using softmax
  let elevation = softmaxCombine(contributions);

  // Add ridge/erosion noise (drainage patterns)
  if (includeNoise) {
    const ridgeConfig = world.defaults?.ridgeNoise ?? DEFAULT_RIDGE_NOISE_CONFIG;
    if (ridgeConfig.enabled !== false && elevation > SEA_LEVEL) {
      const ridgeDeviation = sampleRidgeNoise(world, x, z, elevation);
      elevation += ridgeDeviation;
    }
  }

  // Add surface noise (terrain variation)
  if (includeNoise) {
    const noiseConfig = world.defaults?.surfaceNoise ?? DEFAULT_SURFACE_NOISE_CONFIG;
    if (noiseConfig.enabled !== false) {
      const noiseDeviation = sampleSurfaceNoise(world, x, z, elevation);
      elevation += noiseDeviation;
    }
  }

  // Add micro detail (high-frequency surface texture)
  if (includeNoise) {
    const microConfig = world.defaults?.microDetail ?? DEFAULT_MICRO_DETAIL_CONFIG;
    if (microConfig.enabled !== false) {
      const microDeviation = sampleMicroDetail(world, x, z);
      elevation += microDeviation;
    }
  }

  // Apply river carving (lowers elevation along channels)
  if (includeHydrology && world.rivers && world.rivers.length > 0) {
    const carving = sampleRiverCarving(world, x, z);
    elevation += carving;
  }

  // Clamp to valid range
  if (includeNoise || includeHydrology) {
    elevation = Math.max(0, Math.min(1, elevation));
  }

  return elevation;
}

/**
 * Get profile shape value from name
 *
 * @param {string} profile - Profile name
 * @returns {number} Shape value (for compatibility)
 */
export function getProfileShape(profile) {
  // Map profile names to shape values for Hermite curve compatibility
  const shapes = {
    cone: 0,
    plateau: -0.6,
    bowl: 0.5,
    shield: -0.3
  };
  return shapes[profile] ?? 0;
}

/**
 * Compute profile elevation (compatibility function)
 *
 * @param {number} peakElevation - Elevation at center
 * @param {number} baseElevation - Elevation at boundary
 * @param {number} distance - Normalized distance [0, 1]
 * @param {string} profile - Profile name
 * @returns {number} Elevation at this point
 */
export function computeProfileElevation(peakElevation, baseElevation, distance, profile) {
  const t = Math.max(0, Math.min(1, distance));
  const profileFn = PROFILES[profile] || PROFILES.cone;
  const factor = profileFn(t);
  return baseElevation + (peakElevation - baseElevation) * factor;
}
