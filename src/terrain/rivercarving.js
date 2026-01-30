/**
 * River and lake carving - modifies elevation along river paths and lake basins
 * Creates realistic river valleys and lake beds with multi-zone profiles,
 * organic shoreline noise, and meander-dependent erosion.
 *
 * Uses a lazily-initialized SDF grid for O(1) distance rejection.
 */

import { findNearestRiverPoint } from './hydrology.js';
import { createSimplexNoise } from '../core/noise.js';
import { deriveSeed } from '../core/seeds.js';
import { smoothstep, lerp } from '../core/math.js';

// Sea level constant
const SEA_LEVEL = 0.1;

// Maximum valley radius as multiplier of river width
const MAX_VALLEY_WIDTH_MUL = 6;

// ---------------------------------------------------------------------------
// Shore noise cache (per-world, auto-cleaned via WeakMap)
// ---------------------------------------------------------------------------

const shoreNoiseCache = new WeakMap();

/**
 * Get or create shore noise function for a world
 * @param {Object} world - World object
 * @returns {Function} Simplex noise function
 */
function getShoreNoise(world) {
  if (shoreNoiseCache.has(world)) return shoreNoiseCache.get(world);
  const seed = deriveSeed(world.seed ?? 42, 'rivershore');
  const noise = createSimplexNoise(seed);
  shoreNoiseCache.set(world, noise);
  return noise;
}

// ---------------------------------------------------------------------------
// River SDF Grid - Chamfer distance transform for fast rejection
// ---------------------------------------------------------------------------

/**
 * Build or retrieve the cached river SDF grid for a world
 * Uses a 2-pass chamfer distance transform over a binary mask of river cells.
 * @param {Object} world - World object with rivers
 * @returns {Object} {width, height, data: Float32Array, bounds, resolution}
 */
export function ensureRiverSDF(world) {
  if (world._riverSDF && !world._riverSDFDirty) return world._riverSDF;

  const rivers = world.rivers || [];
  const config = world.hydrologyConfig || {};
  const resolution = config.gridResolution || 0.01;
  const bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const width = Math.ceil((bounds.maxX - bounds.minX) / resolution);
  const height = Math.ceil((bounds.maxZ - bounds.minZ) / resolution);
  const n = width * height;

  // Build binary mask: mark cells containing river vertices
  const mask = new Uint8Array(n);
  for (const river of rivers) {
    if (!river.vertices || river.vertices.length < 2) continue;
    for (let i = 0; i < river.vertices.length - 1; i++) {
      const v0 = river.vertices[i];
      const v1 = river.vertices[i + 1];
      // Rasterize segment into mask using Bresenham-like stepping
      const steps = Math.max(
        Math.abs(v1.x - v0.x) / resolution,
        Math.abs(v1.z - v0.z) / resolution,
        1
      );
      const numSteps = Math.ceil(steps);
      for (let s = 0; s <= numSteps; s++) {
        const t = s / numSteps;
        const px = v0.x + t * (v1.x - v0.x);
        const pz = v0.z + t * (v1.z - v0.z);
        const cx = Math.floor((px - bounds.minX) / resolution);
        const cz = Math.floor((pz - bounds.minZ) / resolution);
        if (cx >= 0 && cx < width && cz >= 0 && cz < height) {
          mask[cz * width + cx] = 1;
        }
      }
    }
  }

  // Chamfer distance transform (2-pass: forward + backward)
  const data = new Float32Array(n);
  const INF = 1e6;
  const diag = resolution * Math.SQRT2;

  // Initialize: 0 for river cells, INF for everything else
  for (let i = 0; i < n; i++) data[i] = mask[i] ? 0 : INF;

  // Forward pass (top-left to bottom-right)
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      if (c > 0) data[i] = Math.min(data[i], data[i - 1] + resolution);
      if (r > 0) {
        data[i] = Math.min(data[i], data[(r - 1) * width + c] + resolution);
        if (c > 0) data[i] = Math.min(data[i], data[(r - 1) * width + c - 1] + diag);
        if (c < width - 1) data[i] = Math.min(data[i], data[(r - 1) * width + c + 1] + diag);
      }
    }
  }

  // Backward pass (bottom-right to top-left)
  for (let r = height - 1; r >= 0; r--) {
    for (let c = width - 1; c >= 0; c--) {
      const i = r * width + c;
      if (c < width - 1) data[i] = Math.min(data[i], data[i + 1] + resolution);
      if (r < height - 1) {
        data[i] = Math.min(data[i], data[(r + 1) * width + c] + resolution);
        if (c < width - 1) data[i] = Math.min(data[i], data[(r + 1) * width + c + 1] + diag);
        if (c > 0) data[i] = Math.min(data[i], data[(r + 1) * width + c - 1] + diag);
      }
    }
  }

  const sdf = { width, height, data, bounds, resolution };
  world._riverSDF = sdf;
  world._riverSDFDirty = false;
  return sdf;
}

/**
 * Sample the river SDF grid at a world position using bilinear interpolation
 * @param {Object} sdf - SDF grid from ensureRiverSDF
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {number} Approximate distance to nearest river cell
 */
export function sampleRiverSDF(sdf, x, z) {
  const fx = (x - sdf.bounds.minX) / sdf.resolution - 0.5;
  const fz = (z - sdf.bounds.minZ) / sdf.resolution - 0.5;

  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;

  // Clamp to grid bounds
  const cx0 = Math.max(0, Math.min(sdf.width - 1, x0));
  const cx1 = Math.max(0, Math.min(sdf.width - 1, x0 + 1));
  const cz0 = Math.max(0, Math.min(sdf.height - 1, z0));
  const cz1 = Math.max(0, Math.min(sdf.height - 1, z0 + 1));

  const d00 = sdf.data[cz0 * sdf.width + cx0];
  const d10 = sdf.data[cz0 * sdf.width + cx1];
  const d01 = sdf.data[cz1 * sdf.width + cx0];
  const d11 = sdf.data[cz1 * sdf.width + cx1];

  return lerp(lerp(d00, d10, tx), lerp(d01, d11, tx), tz);
}

// ---------------------------------------------------------------------------
// Enhanced multi-zone carving profile
// ---------------------------------------------------------------------------

/**
 * Compute enhanced carving profile with channel/floodplain/valley zones
 * Supports curvature-dependent asymmetry and noise-perturbed zone boundaries.
 *
 * @param {number} distance - Distance from river center
 * @param {number} width - River width at this point
 * @param {number} carveDepth - Max carve depth at river center
 * @param {number} curvature - Signed curvature at this point
 * @param {number} side - +1 or -1 indicating which side of the river
 * @param {number} noiseVal - Shore noise value at query point [-1, 1]
 * @param {Object} config - Hydrology config
 * @returns {number} Carve depth at this distance (positive = lower terrain)
 */
export function computeEnhancedCarveProfile(distance, width, carveDepth, curvature, side, noiseVal, config) {
  const floodMul = config.floodplainMultiplier || 3;
  const valleyMul = config.valleyWidthMultiplier || MAX_VALLEY_WIDTH_MUL;
  const shoreAmp = config.shoreNoiseAmplitude || 0.3;

  // Base zone radii
  let channelRadius = width;
  let floodplainRadius = width * floodMul;
  let valleyRadius = width * valleyMul;

  // Curvature-dependent asymmetry:
  // If sign(curvature) == sign(side): outer bank → expand zones
  // If sign(curvature) != sign(side): inner bank → contract zones
  const absCurv = Math.min(Math.abs(curvature) * 200, 3);
  const isOuterBank = (curvature * side) > 0;
  if (absCurv > 0.01) {
    const bankFactor = isOuterBank ? (1 + absCurv * 0.2) : (1 - absCurv * 0.1);
    channelRadius *= bankFactor;
    floodplainRadius *= bankFactor;
    valleyRadius *= bankFactor;
  }

  // Noise perturbation of zone boundaries for organic edges
  channelRadius *= (1 + noiseVal * shoreAmp * 0.2);
  floodplainRadius *= (1 + noiseVal * shoreAmp * 0.3);
  valleyRadius *= (1 + noiseVal * shoreAmp * 0.25);

  // Ensure minimum zone sizes
  channelRadius = Math.max(channelRadius, 0.001);
  floodplainRadius = Math.max(floodplainRadius, channelRadius * 1.5);
  valleyRadius = Math.max(valleyRadius, floodplainRadius * 1.5);

  if (distance >= valleyRadius) return 0;

  if (distance < channelRadius) {
    // Channel zone: V/U-shaped cross-section
    const t = distance / channelRadius;
    // Wider rivers have flatter (U-shaped) beds, narrow rivers are V-shaped
    const flatness = smoothstep(0.003, 0.015, width);
    const vShape = 1.0 - t * t;
    const uShape = 1.0 - smoothstep(0, 1, t) * smoothstep(0, 1, t);
    const profile = lerp(vShape, uShape, flatness);
    return carveDepth * profile;
  }

  if (distance < floodplainRadius) {
    // Floodplain: gentle slope from channel edge
    const t = (distance - channelRadius) / (floodplainRadius - channelRadius);
    const profile = (1 - smoothstep(0, 1, t)) * 0.4;
    return carveDepth * profile;
  }

  // Valley walls: gradual blend to natural terrain
  const t = (distance - floodplainRadius) / (valleyRadius - floodplainRadius);
  const profile = (1 - smoothstep(0, 1, t)) * 0.15;
  return carveDepth * profile;
}

// ---------------------------------------------------------------------------
// Main carving functions
// ---------------------------------------------------------------------------

/**
 * Sample river carving offset at a point
 * Returns negative value to subtract from elevation.
 * Uses SDF grid for fast rejection, then detailed multi-zone profile.
 *
 * @param {Object} world - World object with rivers
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {number} Carving offset (negative value, 0 if no carving)
 */
export function sampleRiverCarving(world, x, z) {
  const config = world.hydrologyConfig || {};
  if (config.carveEnabled === false) return 0;

  let maxCarving = 0;

  // River carving with SDF fast rejection
  const rivers = world.rivers || [];
  if (rivers.length > 0) {
    // Estimate max influence radius for SDF rejection
    let maxWidth = 0;
    for (const river of rivers) {
      if (!river.vertices || river.vertices.length < 2) continue;
      for (const v of river.vertices) {
        if (v.width > maxWidth) maxWidth = v.width;
      }
    }
    const maxInfluence = maxWidth * (config.valleyWidthMultiplier || MAX_VALLEY_WIDTH_MUL);

    // SDF fast rejection: skip detailed queries if far from all rivers
    let passedSDF = true;
    if (maxInfluence > 0) {
      const sdf = ensureRiverSDF(world);
      const approxDist = sampleRiverSDF(sdf, x, z);
      if (approxDist > maxInfluence + sdf.resolution * 2) {
        passedSDF = false;
      }
    }

    if (passedSDF) {
      const shoreNoise = getShoreNoise(world);
      const shoreFreq = config.shoreNoiseFrequency || 40;
      const noiseVal = shoreNoise(x * shoreFreq, z * shoreFreq);

      for (const river of rivers) {
        if (!river.vertices || river.vertices.length < 2) continue;

        const nearest = findNearestRiverPoint(river, x, z);
        const valleyRadius = nearest.width * (config.valleyWidthMultiplier || MAX_VALLEY_WIDTH_MUL);
        if (nearest.distance >= valleyRadius * 1.5) continue;

        const carving = computeEnhancedCarveProfile(
          nearest.distance,
          nearest.width,
          nearest.carveDepth,
          nearest.curvature,
          nearest.side,
          noiseVal,
          config
        );
        maxCarving = Math.max(maxCarving, carving);
      }
    }
  }

  // Lake carving - carve out lake basins
  const lakes = world.lakes || [];
  for (const lake of lakes) {
    if (!lake.boundary || lake.boundary.length < 3) continue;
    if (!lake.waterLevel) continue;

    // Check if point is inside lake boundary
    if (isPointInLakeBoundary(x, z, lake.boundary)) {
      // Carve down to water level with some depth
      const lakeCarveDepth = config.carveFactor * 2 || 0.04;
      maxCarving = Math.max(maxCarving, lakeCarveDepth);
    } else {
      // Check distance to lake boundary for smooth edge carving
      const distToBoundary = distanceToPolygon(x, z, lake.boundary);
      const edgeRadius = 0.05; // Smooth transition zone
      if (distToBoundary < edgeRadius) {
        const t = distToBoundary / edgeRadius;
        const falloff = Math.exp(-t * t * 2);
        const lakeCarveDepth = (config.carveFactor * 2 || 0.04) * falloff;
        maxCarving = Math.max(maxCarving, lakeCarveDepth);
      }
    }
  }

  // Return as negative (to lower elevation)
  return -maxCarving;
}

/**
 * Check if a point is inside a lake boundary polygon
 */
function isPointInLakeBoundary(x, z, boundary) {
  if (!boundary || boundary.length < 3) return false;

  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const xi = boundary[i].x, zi = boundary[i].z;
    const xj = boundary[j].x, zj = boundary[j].z;

    if (((zi > z) !== (zj > z)) &&
        (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Calculate minimum distance from point to polygon boundary
 */
function distanceToPolygon(x, z, polygon) {
  let minDist = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];

    // Distance to line segment
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const lenSq = dx * dx + dz * dz;

    let t = 0;
    if (lenSq > 0) {
      t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (z - p1.z) * dz) / lenSq));
    }

    const closestX = p1.x + t * dx;
    const closestZ = p1.z + t * dz;
    const dist = Math.sqrt((x - closestX) ** 2 + (z - closestZ) ** 2);

    minDist = Math.min(minDist, dist);
  }

  return minDist;
}

/**
 * Compute river carving field for visualization
 * Returns a grid of carving values
 * @param {Object} world - World object with rivers
 * @param {Object} bounds - {minX, maxX, minZ, maxZ}
 * @param {number} resolution - Grid resolution
 * @returns {Object} {width, height, data: Float32Array}
 */
export function computeRiverCarvingField(world, bounds, resolution) {
  const width = Math.ceil((bounds.maxX - bounds.minX) / resolution);
  const height = Math.ceil((bounds.maxZ - bounds.minZ) / resolution);
  const data = new Float32Array(width * height);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const worldX = bounds.minX + (x + 0.5) * resolution;
      const worldZ = bounds.minZ + (z + 0.5) * resolution;
      data[z * width + x] = -sampleRiverCarving(world, worldX, worldZ);
    }
  }

  return { width, height, data };
}

/**
 * Check if a point is within any river channel
 * @param {Object} world - World object with rivers
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {boolean} True if point is in a river
 */
export function isInRiver(world, x, z) {
  const rivers = world.rivers || [];

  for (const river of rivers) {
    if (!river.vertices || river.vertices.length < 2) continue;

    const nearest = findNearestRiverPoint(river, x, z);
    if (nearest.distance < nearest.width) {
      return true;
    }
  }

  return false;
}

/**
 * Get river info at a point
 * @param {Object} world - World object with rivers
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {Object|null} {river, distance, width, flow, carveDepth, curvature, side} or null
 */
export function getRiverInfoAt(world, x, z) {
  const rivers = world.rivers || [];
  let bestRiver = null;
  let bestInfo = null;
  let bestDist = Infinity;

  for (const river of rivers) {
    if (!river.vertices || river.vertices.length < 2) continue;

    const nearest = findNearestRiverPoint(river, x, z);
    if (nearest.distance < bestDist) {
      bestDist = nearest.distance;
      bestRiver = river;
      bestInfo = nearest;
    }
  }

  const maxRange = bestInfo ? bestInfo.width * (world.hydrologyConfig?.valleyWidthMultiplier || MAX_VALLEY_WIDTH_MUL) : 0;
  if (!bestRiver || bestDist > maxRange) return null;

  return {
    river: bestRiver,
    distance: bestInfo.distance,
    width: bestInfo.width,
    flow: bestRiver.vertices[Math.floor(bestInfo.t * (bestRiver.vertices.length - 1))]?.flow || 0,
    carveDepth: bestInfo.carveDepth,
    curvature: bestInfo.curvature,
    side: bestInfo.side
  };
}

/**
 * Calculate the maximum carve depth for a given flow
 * Ensures rivers don't carve below sea level
 * @param {number} flow - Flow accumulation
 * @param {number} baseElevation - Current elevation before carving
 * @param {Object} config - Hydrology config with carveFactor
 * @returns {number} Maximum safe carve depth
 */
export function calculateSafeCarveDepth(flow, baseElevation, config) {
  const { carveFactor = 0.02, riverThreshold = 50 } = config;
  const normalizedFlow = flow / riverThreshold;
  const desiredCarve = normalizedFlow * carveFactor;

  // Don't carve below sea level
  const maxCarve = Math.max(0, baseElevation - SEA_LEVEL - 0.01);

  return Math.min(desiredCarve, maxCarve);
}

/**
 * Compute carve profile perpendicular to river (legacy simple Gaussian)
 * @param {number} distance - Distance from river center
 * @param {number} width - River width
 * @param {number} maxDepth - Maximum carve depth at center
 * @returns {number} Carve depth at this distance
 */
export function computeCarveProfile(distance, width, maxDepth) {
  if (distance >= width * 2) return 0;

  // Gaussian profile for smooth valley shape
  const t = distance / (width * 2);
  return maxDepth * Math.exp(-t * t * 3);
}
