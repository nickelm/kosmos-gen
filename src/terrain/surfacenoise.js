/**
 * Primary surface noise for terrain variation within half-cells
 *
 * Adds large-scale terrain detail using multi-octave noise with per-cell
 * roughness and feature scale parameters. Noise is blended smoothly across
 * cell boundaries to prevent hard edges.
 */

import { createFBmNoise } from '../core/noise.js';
import { deriveSeed } from '../core/seeds.js';
import { findHalfCellAt, computeHalfCellPolygons } from '../geometry/voronoi.js';
import { getHalfCellId, getHalfCellConfig } from './spine.js';

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
 * Blend zone width for parameter interpolation near cell boundaries
 * Expressed as fraction of average influence radius
 */
const BOUNDARY_BLEND_FRACTION = 0.15;

/**
 * Cache for surface noise functions, keyed by world seed
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
 * Get noise parameters for a half-cell
 *
 * @param {Object} world - World object
 * @param {string} spineId - Spine identifier
 * @param {number} vertexIndex - Vertex index
 * @param {string} side - Side ('left', 'right', 'radial')
 * @returns {{roughness: number, featureScale: number}}
 */
export function getHalfCellNoiseConfig(world, spineId, vertexIndex, side) {
  const id = getHalfCellId(spineId, vertexIndex, side);
  const cellOverride = world.halfCells?.[id] || {};
  const defaults = world.defaults?.surfaceNoise ?? DEFAULT_SURFACE_NOISE_CONFIG;

  return {
    roughness: cellOverride.roughness ?? defaults.roughness ?? DEFAULT_SURFACE_NOISE_CONFIG.roughness,
    featureScale: cellOverride.featureScale ?? defaults.featureScale ?? DEFAULT_SURFACE_NOISE_CONFIG.featureScale
  };
}

/**
 * Compute distance from point to polygon boundary
 * Used for blending near cell edges
 *
 * @param {number} x - Point X
 * @param {number} z - Point Z
 * @param {Array<{x: number, z: number}>} polygon - Cell polygon
 * @returns {number} Distance to nearest edge
 */
function distanceToPolygonBoundary(x, z, polygon) {
  let minDist = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];

    // Distance to line segment
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const lenSq = dx * dx + dz * dz;

    if (lenSq === 0) {
      // Degenerate segment
      const dist = Math.sqrt((x - p1.x) ** 2 + (z - p1.z) ** 2);
      minDist = Math.min(minDist, dist);
      continue;
    }

    // Project point onto line
    const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (z - p1.z) * dz) / lenSq));
    const projX = p1.x + t * dx;
    const projZ = p1.z + t * dz;
    const dist = Math.sqrt((x - projX) ** 2 + (z - projZ) ** 2);

    minDist = Math.min(minDist, dist);
  }

  return minDist;
}

/**
 * Estimate average influence radius for blend zone calculation
 *
 * @param {Object} world - World object
 * @returns {number} Average influence radius
 */
function getAverageInfluence(world) {
  const spines = world.template?.spines;
  if (!spines || spines.length === 0) return 0.1;

  let total = 0;
  let count = 0;

  for (const spine of spines) {
    for (const v of spine.vertices) {
      // Influence stored as percentage (0-100), convert to normalized (0-1)
      total += (v.influence ?? 50) / 100;
      count++;
    }
  }

  return count > 0 ? total / count : 0.1;
}

/**
 * Find neighboring half-cells for boundary blending
 *
 * @param {number} x - Sample point X
 * @param {number} z - Sample point Z
 * @param {Object} world - World object
 * @param {number} searchRadius - Radius to search for neighbors
 * @returns {Array<{spineId: string, vertexIndex: number, side: string, distance: number}>}
 */
function findNeighborCells(x, z, world, searchRadius) {
  const spines = world.template?.spines;
  if (!spines || spines.length === 0) return [];

  const bounds = world.bounds ?? { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
  const neighbors = [];

  // Sample points in a small grid around the query point
  const offsets = [
    { dx: searchRadius, dz: 0 },
    { dx: -searchRadius, dz: 0 },
    { dx: 0, dz: searchRadius },
    { dx: 0, dz: -searchRadius },
    { dx: searchRadius * 0.7, dz: searchRadius * 0.7 },
    { dx: -searchRadius * 0.7, dz: searchRadius * 0.7 },
    { dx: searchRadius * 0.7, dz: -searchRadius * 0.7 },
    { dx: -searchRadius * 0.7, dz: -searchRadius * 0.7 }
  ];

  const seen = new Set();

  for (const offset of offsets) {
    const cell = findHalfCellAt(x + offset.dx, z + offset.dz, spines, null, bounds);
    if (!cell) continue;

    const id = `${cell.spineId}:${cell.vertexIndex}:${cell.side}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const dist = Math.sqrt(offset.dx ** 2 + offset.dz ** 2);
    neighbors.push({
      ...cell,
      distance: dist
    });
  }

  return neighbors;
}

/**
 * Sample surface noise at a point with boundary blending
 *
 * Near cell boundaries, noise parameters (roughness, featureScale) are
 * interpolated between neighboring cells to prevent hard edges.
 *
 * @param {Object} world - World object
 * @param {number} x - Sample X coordinate
 * @param {number} z - Sample Z coordinate
 * @param {number} baseElevation - Current elevation before noise (for amplitude scaling)
 * @returns {number} Noise deviation to add to elevation
 */
export function sampleSurfaceNoise(world, x, z, baseElevation) {
  const config = world.defaults?.surfaceNoise ?? DEFAULT_SURFACE_NOISE_CONFIG;
  if (!config.enabled) return 0;

  const spines = world.template?.spines;
  if (!spines || spines.length === 0) return 0;

  const bounds = world.bounds ?? { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };

  // Find owning half-cell
  const cell = findHalfCellAt(x, z, spines, null, bounds);
  if (!cell) return 0;

  // Get noise function
  const noise = getSurfaceNoise(world);

  // Get cell's noise config
  const cellConfig = getHalfCellNoiseConfig(world, cell.spineId, cell.vertexIndex, cell.side);

  // Get half-cell polygon for boundary distance
  const polygons = computeHalfCellPolygons(spines, bounds);
  const cellId = getHalfCellId(cell.spineId, cell.vertexIndex, cell.side);
  const polygon = polygons.get(cellId);

  // Calculate blend zone width
  const avgInfluence = getAverageInfluence(world);
  const blendZone = avgInfluence * BOUNDARY_BLEND_FRACTION;

  // Check distance to boundary
  let roughness = cellConfig.roughness;
  let featureScale = cellConfig.featureScale;

  if (polygon && blendZone > 0) {
    const boundaryDist = distanceToPolygonBoundary(x, z, polygon);

    // If within blend zone, interpolate with neighbors
    if (boundaryDist < blendZone) {
      const neighbors = findNeighborCells(x, z, world, blendZone);

      if (neighbors.length > 0) {
        // Distance-weighted average of noise parameters
        let totalWeight = 0;
        let weightedRoughness = 0;
        let weightedScale = 0;

        // Add current cell's contribution
        const currentWeight = boundaryDist / blendZone; // 0 at boundary, 1 at zone edge
        weightedRoughness += roughness * currentWeight;
        weightedScale += featureScale * currentWeight;
        totalWeight += currentWeight;

        // Add neighbors' contributions
        for (const neighbor of neighbors) {
          const neighborConfig = getHalfCellNoiseConfig(
            world,
            neighbor.spineId,
            neighbor.vertexIndex,
            neighbor.side
          );

          // Weight inversely proportional to distance
          const weight = Math.max(0, 1 - neighbor.distance / blendZone);
          weightedRoughness += neighborConfig.roughness * weight;
          weightedScale += neighborConfig.featureScale * weight;
          totalWeight += weight;
        }

        if (totalWeight > 0) {
          roughness = weightedRoughness / totalWeight;
          featureScale = weightedScale / totalWeight;
        }
      }
    }
  }

  // Sample noise at appropriate frequency
  const frequency = 1 / featureScale;
  const noiseValue = noise(x * frequency, z * frequency);

  // Scale amplitude by roughness
  // roughness 0-1 maps to 0 to MAX_NOISE_AMPLITUDE of elevation range
  const amplitude = roughness * MAX_NOISE_AMPLITUDE;

  return noiseValue * amplitude;
}

/**
 * Clear the surface noise cache
 * Call when world seed changes
 */
export function clearSurfaceNoiseCache() {
  // WeakMap auto-clears when world object is garbage collected
  // This function exists for explicit cache invalidation if needed
}
