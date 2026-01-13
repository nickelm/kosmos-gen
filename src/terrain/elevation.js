/**
 * Elevation sampling from spine-Voronoi terrain
 */

import { findCell } from '../geometry/voronoi.js';

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
 * Sample elevation at a world position
 * 
 * @param {Object} world - Generated world data
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {number} Elevation in [0, 1]
 */
export function sampleElevation(world, x, z) {
  // TODO: Implement full sampling with:
  // 1. Find owning Voronoi cell
  // 2. Determine which half-cell
  // 3. Get half-cell's profile
  // 4. Compute distance to spine
  // 5. Apply profile function
  // 6. Blend at cell boundaries
  
  // Placeholder: return 0
  return 0;
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
