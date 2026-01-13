/**
 * Elevation sampling from spine-Voronoi terrain
 */

import { findCell } from '../geometry/voronoi.js';
import { getSide, getHalfCellConfig } from './spine.js';

/**
 * Compute distance from a point to a line segment (clamped)
 *
 * @param {number} px - Point X coordinate
 * @param {number} pz - Point Z coordinate
 * @param {Object} v1 - Segment start {x, z}
 * @param {Object} v2 - Segment end {x, z}
 * @returns {{distance: number, t: number}} Distance and parameter along segment
 */
function distanceToSegment(px, pz, v1, v2) {
  const dx = v2.x - v1.x;
  const dz = v2.z - v1.z;
  const segLengthSq = dx * dx + dz * dz;

  // Degenerate segment (single point)
  if (segLengthSq === 0) {
    const dist = Math.sqrt((px - v1.x) ** 2 + (pz - v1.z) ** 2);
    return { distance: dist, t: 0 };
  }

  // Project point onto line, clamp to segment
  const t = Math.max(0, Math.min(1,
    ((px - v1.x) * dx + (pz - v1.z) * dz) / segLengthSq
  ));

  // Closest point on segment
  const closestX = v1.x + t * dx;
  const closestZ = v1.z + t * dz;

  const distance = Math.sqrt((px - closestX) ** 2 + (pz - closestZ) ** 2);

  return { distance, t };
}

/**
 * Profile functions for elevation falloff
 */
const PROFILES = {
  /**
   * Linear slope from spine to boundary
   */
  ramp: (t) => 1 - t,

  /**
   * Flat top with steep edges
   */
  plateau: (t) => t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6,

  /**
   * Concave, collects water
   */
  bowl: (t) => 1 - t * t,

  /**
   * Convex, sheds water
   */
  shield: (t) => Math.sqrt(1 - t * t)
};

/**
 * Sample elevation at a world position with smooth blending
 *
 * @param {Object} world - Generated world data
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {number} Elevation in [0, 1]
 */
export function sampleElevation(world, x, z) {
  const spines = world.template?.spines;
  const baseElevation = world.defaults?.baseElevation ?? 0.1;

  // Handle empty world
  if (!spines || spines.length === 0) {
    return baseElevation;
  }

  // Collect contributions from all spines
  let totalWeight = 0;
  let weightedElevation = 0;

  for (const spine of spines) {
    if (!spine.vertices || spine.vertices.length === 0) continue;

    // Find closest point on spine and compute elevation contribution
    const result = getSpineContribution(x, z, spine, world, baseElevation);
    if (!result) continue;

    const { elevation, weight } = result;
    weightedElevation += elevation * weight;
    totalWeight += weight;
  }

  // If no spines contribute, return ocean floor (below sea level)
  // baseElevation is the shoreline elevation, not open ocean
  if (totalWeight === 0) {
    return 0;
  }

  return weightedElevation / totalWeight;
}

/**
 * Get elevation contribution from a single spine
 *
 * @param {number} x - Query X
 * @param {number} z - Query Z
 * @param {Object} spine - Spine object
 * @param {Object} world - World object (for half-cell config)
 * @param {number} baseElevation - Default base elevation
 * @returns {{elevation: number, weight: number} | null}
 */
function getSpineContribution(x, z, spine, world, baseElevation) {
  const vertices = spine.vertices;

  // Single vertex: pure radial
  if (vertices.length === 1) {
    const v = vertices[0];
    const dist = Math.sqrt((x - v.x) ** 2 + (z - v.z) ** 2);
    // Influence stored as percentage (0-100), convert to normalized (0-1)
    const influence = v.influence / 100;
    const t = dist / influence;

    if (t > 1.5) return null;

    const config = getHalfCellConfig(world, spine.id, 0, 'radial');
    const elevation = computeProfileElevation(v.elevation, config.baseElevation, Math.min(1, t), config.profile);
    const weight = Math.max(0, 1 - t * 0.8) ** 2;

    return { elevation, weight };
  }

  // Multi-vertex: find closest point on spine polyline
  let bestDist = Infinity;
  let bestT = 0;
  let bestSegIndex = 0;
  let bestSpineElevation = vertices[0].elevation;
  // Influence stored as percentage (0-100), convert to normalized (0-1)
  let bestInfluence = vertices[0].influence / 100;

  for (let i = 0; i < vertices.length - 1; i++) {
    const v0 = vertices[i];
    const v1 = vertices[i + 1];

    const seg = distanceToSegment(x, z, v0, v1);

    if (seg.distance < bestDist) {
      bestDist = seg.distance;
      bestT = seg.t;
      bestSegIndex = i;
      // Interpolate elevation and influence along segment
      bestSpineElevation = v0.elevation + seg.t * (v1.elevation - v0.elevation);
      // Convert influence from percentage to normalized
      bestInfluence = (v0.influence + seg.t * (v1.influence - v0.influence)) / 100;
    }
  }

  // Normalize distance by interpolated influence
  const normalizedDist = bestDist / bestInfluence;

  if (normalizedDist > 1.5) return null;

  // Determine side and vertex index for config lookup
  const v0 = vertices[bestSegIndex];
  const v1 = vertices[bestSegIndex + 1];
  const side = getSide(x, z, v0, v1);

  // Use the vertex closer to the projection point for config
  const vertexIndex = bestT < 0.5 ? bestSegIndex : bestSegIndex + 1;

  const config = getHalfCellConfig(world, spine.id, vertexIndex, side);
  const elevation = computeProfileElevation(bestSpineElevation, config.baseElevation, Math.min(1, normalizedDist), config.profile);
  const weight = Math.max(0, 1 - normalizedDist * 0.8) ** 2;

  return { elevation, weight };
}

/**
 * Get profile function by name
 * @param {string} name - Profile name
 * @returns {Function} Profile function (t) => elevation
 */
export function getProfile(name) {
  return PROFILES[name] || PROFILES.ramp;
}

/**
 * Compute elevation from profile
 *
 * @param {number} spineElevation - Elevation at spine vertex
 * @param {number} baseElevation - Elevation at cell boundary
 * @param {number} distance - Distance from spine (normalized 0-1)
 * @param {string} profile - Profile type
 * @returns {number} Elevation at this point
 */
export function computeProfileElevation(spineElevation, baseElevation, distance, profile) {
  const profileFn = getProfile(profile);
  const t = Math.min(1, Math.max(0, distance));
  const factor = profileFn(t);
  return baseElevation + (spineElevation - baseElevation) * factor;
}
