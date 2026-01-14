/**
 * Coastline extraction and refinement
 *
 * Extracts coastline polylines from elevation data using marching squares,
 * with optional edge displacement for detail.
 *
 * Implements Spec 2.5: Coastline Refinement
 */

import { extractContours, simplifyPolyline, isClosedLoop } from '../geometry/contour.js';
import { sampleElevation } from './elevation.js';
import { createFBmNoise, unipolar } from '../core/noise.js';
import { deriveSeed } from '../core/seeds.js';

/** Default sea level threshold */
export const SEA_LEVEL = 0.1;

/** Default coastline extraction configuration */
export const DEFAULT_COASTLINE_CONFIG = {
  resolution: 0.015,        // Sample spacing for marching squares
  simplifyEpsilon: 0.003,   // Douglas-Peucker simplification tolerance
  displacement: {
    enabled: false,         // Edge displacement for detail
    amplitude: 0.01,        // Maximum displacement in world units
    frequency: 20,          // Noise frequency along coastline
    octaves: 2
  },
  filtering: {
    minIslandArea: 0,       // Minimum area to keep (0 = keep all)
    minIslandVertices: 0    // Minimum vertices to keep (0 = keep all)
  }
};

/**
 * Extract coastline polylines from a world
 *
 * @param {Object} world - World object with spines and elevation data
 * @param {Object} bounds - Sampling bounds {minX, maxX, minZ, maxZ}
 * @param {Object} options - Extraction options
 * @param {boolean} [options.includeNoise=false] - Sample with noise layers
 * @param {number} [options.resolution] - Sample spacing
 * @param {number} [options.simplifyEpsilon] - Simplification tolerance
 * @returns {Array<Array<{x: number, z: number}>>} Coastline polylines
 */
export function extractCoastline(world, bounds, options = {}) {
  const {
    includeNoise = false,
    resolution = DEFAULT_COASTLINE_CONFIG.resolution,
    simplifyEpsilon = DEFAULT_COASTLINE_CONFIG.simplifyEpsilon
  } = options;

  // Sample function
  const sampleFn = (x, z) => sampleElevation(world, x, z, { includeNoise });

  // Extract contours at sea level
  let polylines = extractContours(sampleFn, SEA_LEVEL, bounds, resolution);

  // Simplify polylines
  polylines = polylines.map(pl => simplifyPolyline(pl, simplifyEpsilon));

  return polylines;
}

/**
 * Extract both smooth and noisy coastlines
 *
 * Returns coastlines extracted from clean elevation (Phase 1) and
 * noisy elevation (Phase 2) for different use cases.
 *
 * @param {Object} world - World object
 * @param {Object} bounds - Sampling bounds
 * @param {Object} options - Extraction options
 * @returns {{smooth: Array, noisy: Array}} Both coastline versions
 */
export function extractBothCoastlines(world, bounds, options = {}) {
  const {
    resolution = DEFAULT_COASTLINE_CONFIG.resolution,
    simplifyEpsilon = DEFAULT_COASTLINE_CONFIG.simplifyEpsilon
  } = options;

  // Extract smooth coastline (no noise)
  const smooth = extractCoastline(world, bounds, {
    includeNoise: false,
    resolution,
    simplifyEpsilon
  });

  // Extract noisy coastline (with all noise layers)
  const noisy = extractCoastline(world, bounds, {
    includeNoise: true,
    resolution,
    simplifyEpsilon
  });

  return { smooth, noisy };
}

/**
 * Apply displacement to coastline vertices for additional detail
 *
 * Displaces vertices perpendicular to the coastline using noise,
 * creating more organic-looking edges without changing the underlying terrain.
 *
 * @param {Array<{x: number, z: number}>} polyline - Input coastline
 * @param {number} seed - Random seed for noise
 * @param {Object} config - Displacement configuration
 * @returns {Array<{x: number, z: number}>} Displaced coastline
 */
export function displaceCoastline(polyline, seed, config = {}) {
  const {
    amplitude = DEFAULT_COASTLINE_CONFIG.displacement.amplitude,
    frequency = DEFAULT_COASTLINE_CONFIG.displacement.frequency,
    octaves = DEFAULT_COASTLINE_CONFIG.displacement.octaves
  } = config;

  if (polyline.length < 2 || amplitude <= 0) {
    return polyline;
  }

  // Create noise function for displacement
  const noiseSeed = deriveSeed(seed, 'coastlineDisplacement');
  const baseNoise = createFBmNoise(noiseSeed, {
    octaves,
    persistence: 0.5,
    lacunarity: 2.0,
    frequency
  });
  const noise = unipolar(baseNoise);

  const result = [];

  // Track cumulative arc length for consistent noise sampling
  let arcLength = 0;

  for (let i = 0; i < polyline.length; i++) {
    const p = polyline[i];

    // First point: no displacement (keep endpoints stable)
    if (i === 0) {
      result.push({ x: p.x, z: p.z });
      continue;
    }

    // Calculate segment length and update arc length
    const prev = polyline[i - 1];
    const dx = p.x - prev.x;
    const dz = p.z - prev.z;
    const segLen = Math.sqrt(dx * dx + dz * dz);
    arcLength += segLen;

    // Last point: no displacement (keep endpoints stable)
    if (i === polyline.length - 1) {
      result.push({ x: p.x, z: p.z });
      continue;
    }

    // Calculate perpendicular direction (normal to coastline)
    const next = polyline[i + 1];
    const tangentX = next.x - prev.x;
    const tangentZ = next.z - prev.z;
    const tangentLen = Math.sqrt(tangentX * tangentX + tangentZ * tangentZ);

    if (tangentLen < 0.0001) {
      result.push({ x: p.x, z: p.z });
      continue;
    }

    // Normal is perpendicular to tangent
    const normalX = -tangentZ / tangentLen;
    const normalZ = tangentX / tangentLen;

    // Sample noise at arc length position (gives consistent displacement along curve)
    // Use both position and arc length for variation
    const noiseValue = noise(arcLength, 0) * 2 - 1; // Map to [-1, 1]

    // Apply displacement
    const displacement = noiseValue * amplitude;
    result.push({
      x: p.x + normalX * displacement,
      z: p.z + normalZ * displacement
    });
  }

  return result;
}

/**
 * Apply displacement to all coastline polylines
 *
 * @param {Array<Array<{x: number, z: number}>>} polylines - Input coastlines
 * @param {number} seed - Random seed
 * @param {Object} config - Displacement configuration
 * @returns {Array<Array<{x: number, z: number}>>} Displaced coastlines
 */
export function displaceAllCoastlines(polylines, seed, config = {}) {
  return polylines.map((pl, i) =>
    displaceCoastline(pl, deriveSeed(seed, `coastline_${i}`), config)
  );
}

/**
 * Calculate the area of a closed polyline using the shoelace formula
 *
 * @param {Array<{x: number, z: number}>} polyline - Closed polyline
 * @returns {number} Area (positive for CCW, negative for CW)
 */
function polylineArea(polyline) {
  if (polyline.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < polyline.length; i++) {
    const j = (i + 1) % polyline.length;
    area += polyline[i].x * polyline[j].z;
    area -= polyline[j].x * polyline[i].z;
  }

  return area / 2;
}

/**
 * Filter out small islands from coastline polylines
 *
 * Small islands can appear from noise creating elevation above sea level
 * in isolated spots. This function removes islands below a threshold.
 *
 * @param {Array<Array<{x: number, z: number}>>} polylines - Input coastlines
 * @param {Object} options - Filtering options
 * @param {number} [options.minArea=0] - Minimum area to keep
 * @param {number} [options.minVertices=0] - Minimum vertices to keep
 * @returns {Array<Array<{x: number, z: number}>>} Filtered coastlines
 */
export function filterSmallIslands(polylines, options = {}) {
  const {
    minArea = DEFAULT_COASTLINE_CONFIG.filtering.minIslandArea,
    minVertices = DEFAULT_COASTLINE_CONFIG.filtering.minIslandVertices
  } = options;

  // No filtering if both thresholds are 0
  if (minArea <= 0 && minVertices <= 0) {
    return polylines;
  }

  return polylines.filter(pl => {
    // Check vertex count
    if (minVertices > 0 && pl.length < minVertices) {
      return false;
    }

    // Check area for closed loops
    if (minArea > 0 && isClosedLoop(pl)) {
      const area = Math.abs(polylineArea(pl));
      if (area < minArea) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Full coastline extraction pipeline
 *
 * Extracts coastline from elevation, optionally applies displacement
 * for detail, and filters small islands.
 *
 * @param {Object} world - World object
 * @param {Object} bounds - Sampling bounds
 * @param {Object} options - Pipeline options
 * @returns {Array<Array<{x: number, z: number}>>} Processed coastlines
 */
export function extractRefinedCoastline(world, bounds, options = {}) {
  const {
    includeNoise = true,
    resolution = DEFAULT_COASTLINE_CONFIG.resolution,
    simplifyEpsilon = DEFAULT_COASTLINE_CONFIG.simplifyEpsilon,
    displacement = DEFAULT_COASTLINE_CONFIG.displacement,
    filtering = DEFAULT_COASTLINE_CONFIG.filtering
  } = options;

  // Step 1: Extract base coastline
  let polylines = extractCoastline(world, bounds, {
    includeNoise,
    resolution,
    simplifyEpsilon
  });

  // Step 2: Apply displacement if enabled
  if (displacement.enabled && displacement.amplitude > 0) {
    const seed = world.seed ?? 42;
    polylines = displaceAllCoastlines(polylines, seed, displacement);
  }

  // Step 3: Filter small islands if configured
  if (filtering.minIslandArea > 0 || filtering.minIslandVertices > 0) {
    polylines = filterSmallIslands(polylines, {
      minArea: filtering.minIslandArea,
      minVertices: filtering.minIslandVertices
    });
  }

  return polylines;
}

/**
 * Get coastline statistics for debugging/display
 *
 * @param {Array<Array<{x: number, z: number}>>} polylines - Coastline polylines
 * @returns {Object} Statistics about the coastlines
 */
export function getCoastlineStats(polylines) {
  let totalVertices = 0;
  let totalLength = 0;
  let closedLoops = 0;
  let openChains = 0;
  const areas = [];

  for (const pl of polylines) {
    totalVertices += pl.length;

    // Calculate length
    for (let i = 1; i < pl.length; i++) {
      const dx = pl[i].x - pl[i - 1].x;
      const dz = pl[i].z - pl[i - 1].z;
      totalLength += Math.sqrt(dx * dx + dz * dz);
    }

    // Check if closed
    if (isClosedLoop(pl)) {
      closedLoops++;
      areas.push(Math.abs(polylineArea(pl)));
    } else {
      openChains++;
    }
  }

  return {
    polylineCount: polylines.length,
    totalVertices,
    totalLength,
    closedLoops,
    openChains,
    areas,
    minArea: areas.length > 0 ? Math.min(...areas) : 0,
    maxArea: areas.length > 0 ? Math.max(...areas) : 0
  };
}
