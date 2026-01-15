/**
 * River and lake carving - modifies elevation along river paths and lake basins
 * Creates realistic river valleys and lake beds in the terrain
 */

import { findNearestRiverPoint } from './hydrology.js';

// Sea level constant
const SEA_LEVEL = 0.1;

/**
 * Sample river carving offset at a point
 * Returns negative value to subtract from elevation
 * @param {Object} world - World object with rivers
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {number} Carving offset (negative value, 0 if no carving)
 */
export function sampleRiverCarving(world, x, z) {
  const config = world.hydrologyConfig || {};
  if (config.carveEnabled === false) return 0;

  let maxCarving = 0;

  // River carving
  const rivers = world.rivers || [];
  for (const river of rivers) {
    if (!river.vertices || river.vertices.length < 2) continue;

    const nearest = findNearestRiverPoint(river, x, z);

    // Only carve within influence radius (2x river width)
    const influenceRadius = nearest.width * 2.0;
    if (nearest.distance >= influenceRadius) continue;

    // Gaussian falloff from river center
    const t = nearest.distance / influenceRadius;
    const falloff = Math.exp(-t * t * 3);

    // Carving amount
    const carving = nearest.carveDepth * falloff;
    maxCarving = Math.max(maxCarving, carving);
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
 * @returns {Object|null} {river, distance, width, flow, carveDepth} or null
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

  if (!bestRiver || bestDist > bestInfo.width * 2) return null;

  return {
    river: bestRiver,
    distance: bestInfo.distance,
    width: bestInfo.width,
    flow: bestRiver.vertices[Math.floor(bestInfo.t * (bestRiver.vertices.length - 1))]?.flow || 0,
    carveDepth: bestInfo.carveDepth
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
 * Compute carve profile perpendicular to river
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
