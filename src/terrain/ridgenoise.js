/**
 * Ridge/Erosion noise for drainage patterns radiating from spines
 *
 * Creates erosion-like channels perpendicular to mountain spines without
 * hydraulic simulation. Uses ridged multifractal noise oriented to flow
 * away from ridge lines.
 */

import { createSimplexNoise } from '../core/noise.js';
import { deriveSeed } from '../core/seeds.js';

/**
 * Default ridge noise configuration
 */
export const DEFAULT_RIDGE_NOISE_CONFIG = {
  ridgeIntensity: 0.3,    // Strength of erosion features (0-1)
  ridgeAlignment: 0.7,    // How strongly features align perpendicular to spine (0=random, 1=strict)
  ridgeScale: 0.05,       // Base wavelength of ridge features in world units
  octaves: 4,             // Number of ridge noise layers
  persistence: 0.5,       // Amplitude decay per octave
  lacunarity: 2.2,        // Frequency increase per octave
  maxDistance: 0.3,       // Maximum distance from spine where ridges apply (in world units)
  enabled: true
};

/**
 * Maximum elevation reduction from ridge erosion (in normalized 0-1 space)
 * ridgeIntensity=1.0 maps to this value at full effect
 */
const MAX_RIDGE_DEPTH = 0.15;

/**
 * Cache for ridge noise functions, keyed by world
 */
const ridgeNoiseCache = new WeakMap();

/**
 * Create a ridged multifractal noise generator
 *
 * Ridged noise creates sharp ridges/valleys by taking the absolute value
 * of noise and inverting it: ridged(x) = 1.0 - abs(2.0 * noise(x) - 1.0)
 *
 * When layered, this creates branching patterns reminiscent of drainage networks.
 *
 * @param {number} seed - Base seed
 * @param {Object} options
 * @param {number} [options.octaves=4] - Number of noise layers
 * @param {number} [options.persistence=0.5] - Amplitude decay per octave
 * @param {number} [options.lacunarity=2.2] - Frequency increase per octave
 * @param {number} [options.frequency=1] - Base frequency
 * @returns {(x: number, y: number) => number} Noise function returning [0, 1]
 */
export function createRidgedNoise(seed, options = {}) {
  const {
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2.2,
    frequency = 1
  } = options;

  // Create separate noise generator for each octave
  const noiseGenerators = [];
  for (let i = 0; i < octaves; i++) {
    const octaveSeed = deriveSeed(seed, `ridge${i}`);
    noiseGenerators.push(createSimplexNoise(octaveSeed));
  }

  return function ridgedMultifractal(x, y) {
    let total = 0;
    let amplitude = 1;
    let freq = frequency;
    let maxValue = 0;

    // Weight factor for ridged noise - previous octave's signal affects current
    let weight = 1;

    for (let i = 0; i < octaves; i++) {
      // Get base noise value
      const noiseVal = noiseGenerators[i](x * freq, y * freq);

      // Apply ridged transform: 1 - |2*noise - 1| = 1 - |noise * 2 - 1|
      // Since simplex returns [-1, 1], we remap: abs(noise) gives [0, 1]
      // Then ridge = 1 - abs(noise)
      const ridge = 1.0 - Math.abs(noiseVal);

      // Square the ridge value to sharpen the ridges
      const ridgeSquared = ridge * ridge;

      // Apply weight from previous octave (creates more detail in valleys)
      const weighted = ridgeSquared * weight;

      total += weighted * amplitude;
      maxValue += amplitude;

      // Update weight for next octave based on current signal
      // This makes subsequent octaves add detail where current octave has valleys
      weight = Math.min(1.0, Math.max(0.0, ridgeSquared * 2));

      amplitude *= persistence;
      freq *= lacunarity;
    }

    // Normalize to [0, 1]
    return total / maxValue;
  };
}

/**
 * Get or create ridge noise function for a world
 *
 * @param {Object} world - World object
 * @returns {(x: number, y: number) => number} Ridge noise function
 */
function getRidgeNoise(world) {
  if (ridgeNoiseCache.has(world)) {
    return ridgeNoiseCache.get(world);
  }

  const seed = world.seed ?? 42;
  const config = world.defaults?.ridgeNoise ?? DEFAULT_RIDGE_NOISE_CONFIG;

  const noise = createRidgedNoise(deriveSeed(seed, 'ridgeNoise'), {
    octaves: config.octaves ?? DEFAULT_RIDGE_NOISE_CONFIG.octaves,
    persistence: config.persistence ?? DEFAULT_RIDGE_NOISE_CONFIG.persistence,
    lacunarity: config.lacunarity ?? DEFAULT_RIDGE_NOISE_CONFIG.lacunarity,
    frequency: 1 / (config.ridgeScale ?? DEFAULT_RIDGE_NOISE_CONFIG.ridgeScale)
  });

  ridgeNoiseCache.set(world, noise);
  return noise;
}

/**
 * Find the closest point on any spine and return spine info
 *
 * @param {number} x - Query X coordinate
 * @param {number} z - Query Z coordinate
 * @param {Array} spines - Array of spine objects
 * @returns {{distance: number, perpX: number, perpZ: number, spineId: string, vertexIndex: number} | null}
 */
function findClosestSpineInfo(x, z, spines) {
  let bestDist = Infinity;
  let bestPerpX = 0;
  let bestPerpZ = 1;
  let bestSpineId = null;
  let bestVertexIndex = 0;

  for (const spine of spines) {
    const vertices = spine.vertices;
    if (!vertices || vertices.length === 0) continue;

    // Single vertex: radial direction
    if (vertices.length === 1) {
      const v = vertices[0];
      const dx = x - v.x;
      const dz = z - v.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < bestDist && dist > 0.0001) {
        bestDist = dist;
        // Perpendicular is actually radial for single vertex
        bestPerpX = dx / dist;
        bestPerpZ = dz / dist;
        bestSpineId = spine.id;
        bestVertexIndex = 0;
      }
      continue;
    }

    // Multi-vertex: find closest segment
    for (let i = 0; i < vertices.length - 1; i++) {
      const v0 = vertices[i];
      const v1 = vertices[i + 1];

      const segDx = v1.x - v0.x;
      const segDz = v1.z - v0.z;
      const segLenSq = segDx * segDx + segDz * segDz;

      if (segLenSq === 0) continue;

      // Project point onto segment
      const t = Math.max(0, Math.min(1,
        ((x - v0.x) * segDx + (z - v0.z) * segDz) / segLenSq
      ));

      const closestX = v0.x + t * segDx;
      const closestZ = v0.z + t * segDz;
      const dist = Math.sqrt((x - closestX) ** 2 + (z - closestZ) ** 2);

      if (dist < bestDist) {
        bestDist = dist;

        // Compute perpendicular direction (away from spine)
        const segLen = Math.sqrt(segLenSq);
        // Perpendicular: rotate segment direction by 90 degrees
        // Then point in the direction from spine toward query point
        const perpX = -segDz / segLen;
        const perpZ = segDx / segLen;

        // Determine which side of the spine we're on
        const toPointX = x - closestX;
        const toPointZ = z - closestZ;
        const side = perpX * toPointX + perpZ * toPointZ;

        if (side >= 0) {
          bestPerpX = perpX;
          bestPerpZ = perpZ;
        } else {
          bestPerpX = -perpX;
          bestPerpZ = -perpZ;
        }

        bestSpineId = spine.id;
        bestVertexIndex = t < 0.5 ? i : i + 1;
      }
    }
  }

  if (bestSpineId === null) return null;

  return {
    distance: bestDist,
    perpX: bestPerpX,
    perpZ: bestPerpZ,
    spineId: bestSpineId,
    vertexIndex: bestVertexIndex
  };
}

/**
 * Get ridge noise parameters for a half-cell
 *
 * @param {Object} world - World object
 * @param {string} spineId - Spine identifier
 * @param {number} vertexIndex - Vertex index
 * @param {string} side - Side ('left', 'right', 'radial')
 * @returns {{ridgeIntensity: number, ridgeAlignment: number}}
 */
export function getHalfCellRidgeConfig(world, spineId, vertexIndex, side) {
  const id = `${spineId}:${vertexIndex}:${side}`;
  const cellOverride = world.halfCells?.[id] || {};
  const defaults = world.defaults?.ridgeNoise ?? DEFAULT_RIDGE_NOISE_CONFIG;

  return {
    ridgeIntensity: cellOverride.ridgeIntensity ?? defaults.ridgeIntensity ?? DEFAULT_RIDGE_NOISE_CONFIG.ridgeIntensity,
    ridgeAlignment: cellOverride.ridgeAlignment ?? defaults.ridgeAlignment ?? DEFAULT_RIDGE_NOISE_CONFIG.ridgeAlignment
  };
}

/**
 * Sample ridge/erosion noise at a point
 *
 * Creates erosion-like valleys that radiate perpendicular to mountain spines.
 * The effect is strongest near spines and fades with distance.
 *
 * @param {Object} world - World object
 * @param {number} x - Sample X coordinate
 * @param {number} z - Sample Z coordinate
 * @param {number} baseElevation - Current elevation before ridge noise
 * @returns {number} Negative deviation to subtract from elevation (creates valleys)
 */
export function sampleRidgeNoise(world, x, z, baseElevation) {
  const config = world.defaults?.ridgeNoise ?? DEFAULT_RIDGE_NOISE_CONFIG;
  if (!config.enabled) return 0;

  const spines = world.template?.spines;
  if (!spines || spines.length === 0) return 0;

  // Find closest spine and get perpendicular direction
  const spineInfo = findClosestSpineInfo(x, z, spines);
  if (!spineInfo) return 0;

  const maxDist = config.maxDistance ?? DEFAULT_RIDGE_NOISE_CONFIG.maxDistance;

  // Only apply ridge noise within influence distance of spines
  if (spineInfo.distance > maxDist) return 0;

  // Get per-cell configuration
  // Determine side based on perpendicular direction
  const side = spineInfo.perpX !== 0 || spineInfo.perpZ !== 0 ? 'left' : 'radial';
  const cellConfig = getHalfCellRidgeConfig(world, spineInfo.spineId, spineInfo.vertexIndex, side);

  const ridgeIntensity = cellConfig.ridgeIntensity;
  const ridgeAlignment = cellConfig.ridgeAlignment;

  if (ridgeIntensity <= 0) return 0;

  // Get ridge noise function
  const ridgeNoise = getRidgeNoise(world);
  const ridgeScale = config.ridgeScale ?? DEFAULT_RIDGE_NOISE_CONFIG.ridgeScale;
  const frequency = 1 / ridgeScale;

  // Warp sample coordinates to align features perpendicular to spine
  // Mix between random orientation (0) and strict perpendicular (1)
  // When aligned, we sample along the perpendicular direction
  const alignedX = x * (1 - ridgeAlignment) + (x * spineInfo.perpX + z * spineInfo.perpZ) * ridgeAlignment;
  const alignedZ = z * (1 - ridgeAlignment) + (-x * spineInfo.perpZ + z * spineInfo.perpX) * ridgeAlignment;

  // Sample ridge noise
  const noiseValue = ridgeNoise(alignedX * frequency, alignedZ * frequency);

  // Ridge noise returns [0, 1] where 1 = ridge peak, 0 = valley
  // We want to create valleys (erosion), so invert: 1 - noiseValue
  // This makes valleys where the noise had ridges
  const erosionFactor = 1.0 - noiseValue;

  // Distance falloff: strongest near spine, zero at maxDistance
  // Use smooth falloff curve
  const distT = spineInfo.distance / maxDist;
  const falloff = 1.0 - distT * distT; // Quadratic falloff

  // Scale by intensity and max depth
  const erosionDepth = erosionFactor * ridgeIntensity * MAX_RIDGE_DEPTH * falloff;

  // Also reduce erosion at low elevations (don't carve below sea level much)
  const elevationFactor = Math.min(1.0, baseElevation * 3);

  // Return negative value (erosion subtracts from elevation)
  return -erosionDepth * elevationFactor;
}

/**
 * Clear the ridge noise cache
 */
export function clearRidgeNoiseCache() {
  // WeakMap auto-clears when world object is garbage collected
}
