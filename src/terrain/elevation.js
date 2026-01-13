/**
 * Elevation sampling from spine-Voronoi terrain
 */

import { findCell } from '../geometry/voronoi.js';
import { getSide, getHalfCellConfig } from './spine.js';

/**
 * Compute distance from a point to a line segment
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
 * Find the spine and vertex index for a given seed
 *
 * @param {Object} world - World object
 * @param {number} seedIndex - Index into world.voronoi.seeds
 * @returns {{spine: Object, vertexIndex: number, seed: Object}}
 */
function findSpineAndVertex(world, seedIndex) {
  const seed = world.voronoi.seeds[seedIndex];
  const spine = world.template.spines.find(s => s.id === seed.spineId);

  // Find vertex index by matching coordinates
  const vertexIndex = spine.vertices.findIndex(
    v => v.x === seed.x && v.z === seed.z
  );

  return { spine, vertexIndex, seed };
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
  const seeds = world.voronoi?.seeds;
  const baseElevation = world.defaults?.baseElevation ?? 0.1;

  // Handle empty world
  if (!seeds || seeds.length === 0) {
    return baseElevation;
  }

  // Collect contributions from all seeds with blending weights
  let totalWeight = 0;
  let weightedElevation = 0;

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const spine = world.template.spines.find(s => s.id === seed.spineId);
    if (!spine) continue;

    const vertexIndex = spine.vertices.findIndex(
      v => v.x === seed.x && v.z === seed.z
    );
    if (vertexIndex === -1) continue;

    // Compute distance to this seed's spine
    const isEndpoint = (vertexIndex === 0 || vertexIndex === spine.vertices.length - 1);
    let distance, side;

    if (isEndpoint) {
      // For endpoints, check if point is "in front of" the spine (not behind it)
      const adjacentVertex = vertexIndex === 0
        ? spine.vertices[1]
        : spine.vertices[spine.vertices.length - 2];

      // Direction from endpoint toward the spine interior
      const spineDir = {
        x: adjacentVertex.x - seed.x,
        z: adjacentVertex.z - seed.z
      };

      // Direction from endpoint to query point
      const pointDir = {
        x: x - seed.x,
        z: z - seed.z
      };

      // Dot product: positive if point is "in front" (toward spine), negative if "behind"
      const dot = spineDir.x * pointDir.x + spineDir.z * pointDir.z;

      if (dot < 0) {
        // Point is behind the endpoint - skip this seed's contribution
        continue;
      }

      distance = Math.sqrt(pointDir.x * pointDir.x + pointDir.z * pointDir.z);
      side = 'radial';
    } else {
      const prevVertex = spine.vertices[vertexIndex - 1];
      const currVertex = spine.vertices[vertexIndex];
      const nextVertex = spine.vertices[vertexIndex + 1];

      const prevSeg = distanceToSegment(x, z, prevVertex, currVertex);
      const nextSeg = distanceToSegment(x, z, currVertex, nextVertex);

      // Radial distance from the vertex itself
      const radialDist = Math.sqrt((x - currVertex.x) ** 2 + (z - currVertex.z) ** 2);

      // Use minimum of segment distances
      const segmentDist = Math.min(prevSeg.distance, nextSeg.distance);

      // Final distance: minimum of segment and radial
      // This ensures smooth circular falloff near the vertex
      distance = Math.min(segmentDist, radialDist);

      // Determine side based on which segment is closer
      if (prevSeg.distance <= nextSeg.distance) {
        side = getSide(x, z, prevVertex, currVertex);
      } else {
        side = getSide(x, z, currVertex, nextVertex);
      }
    }

    // Normalize distance by influence
    const t = distance / seed.influence;

    // Only contribute if within influence range (with some margin for blending)
    if (t > 1.5) continue;

    const config = getHalfCellConfig(world, spine.id, vertexIndex, side);
    const elevation = computeProfileElevation(seed.elevation, config.baseElevation, Math.min(1, t), config.profile);

    // Weight using smooth falloff (inverse distance with smoothing)
    // Closer seeds have more influence
    const weight = Math.max(0, 1 - t * 0.8) ** 2;

    weightedElevation += elevation * weight;
    totalWeight += weight;
  }

  // If no seeds contribute, return base elevation
  if (totalWeight === 0) {
    return baseElevation;
  }

  return weightedElevation / totalWeight;
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
