/**
 * Elevation sampling from spine-Voronoi terrain
 */

import { getSide, getHalfCellConfig } from './spine.js';

/** Default blend width as fraction of influence radius */
const DEFAULT_BLEND_WIDTH = 0.15;

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
 * Profile shape presets
 *
 * Maps named profiles to shape values for the Hermite curve.
 * Negative shape: holds elevation longer (plateau-like)
 * Zero shape: symmetric S-curve
 * Positive shape: drops faster initially (bowl-like)
 */
const PROFILE_SHAPES = {
  ramp: 0,       // Symmetric S-curve, smooth transition
  plateau: -0.6, // Holds high, drops late
  bowl: 0.5,     // Drops early, flattens at bottom
  shield: -0.3   // Gentle dome, gradual descent
};

/**
 * Hermite interpolation with zero slopes at both ends
 *
 * Uses cubic Hermite basis functions to create a smooth curve from
 * elevation 1 (at spine, t=0) to elevation 0 (at boundary, t=1).
 * Both endpoints have zero slope, guaranteeing C1 continuity at cell boundaries.
 *
 * The shape parameter biases the curve:
 * - Negative: curve stays high longer before dropping (plateau-like)
 * - Zero: symmetric S-curve
 * - Positive: curve drops quickly then levels out (bowl-like)
 *
 * @param {number} t - Distance from spine, normalized [0, 1]
 * @param {number} shape - Shape bias, typically [-1, 1]
 * @returns {number} Elevation factor [0, 1]
 */
function hermiteProfile(t, shape) {
  // Clamp t to valid range
  const s = Math.max(0, Math.min(1, t));

  // Apply shape bias by remapping t through a power curve
  // This shifts where the steepest part of the curve occurs
  let biasedT;
  if (shape < 0) {
    // Negative shape: t grows slowly at first (stays high longer)
    biasedT = Math.pow(s, 1 / (1 - shape));
  } else if (shape > 0) {
    // Positive shape: t grows quickly at first (drops faster)
    biasedT = Math.pow(s, 1 + shape);
  } else {
    biasedT = s;
  }

  // Cubic Hermite interpolation from 1 to 0 with zero slopes at both ends
  // Using smoothstep: 3t² - 2t³ (derivative is 6t - 6t² which is 0 at t=0 and t=1)
  const t2 = biasedT * biasedT;
  const t3 = t2 * biasedT;

  // smoothstep goes from 0 to 1, we want 1 to 0
  return 1 - (3 * t2 - 2 * t3);
}

/**
 * Get shape value from profile name or numeric value
 * @param {string|number} profile - Profile name or shape value
 * @returns {number} Shape value
 */
function getShapeValue(profile) {
  if (typeof profile === 'number') {
    return profile;
  }
  return PROFILE_SHAPES[profile] ?? PROFILE_SHAPES.ramp;
}

/**
 * Smoothstep interpolation for blend transitions
 *
 * Maps input from [0, 1] to a smooth curve with zero derivatives at endpoints.
 * Used to avoid discontinuities at blend zone edges.
 *
 * @param {number} t - Input value [0, 1]
 * @returns {number} Smoothly interpolated value [0, 1]
 */
function smoothstep(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

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
  const blendWidth = world.defaults?.blendWidth ?? DEFAULT_BLEND_WIDTH;

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
    const result = getSpineContribution(x, z, spine, world, baseElevation, blendWidth);
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
 * Compute signed distance to the spine line (for left/right blending)
 *
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {Object} v0 - Segment start vertex
 * @param {Object} v1 - Segment end vertex
 * @returns {number} Signed distance (negative = left, positive = right)
 */
function signedDistanceToSpine(px, pz, v0, v1) {
  const dx = v1.x - v0.x;
  const dz = v1.z - v0.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len === 0) return 0;

  // Perpendicular vector (pointing right when walking from v0 to v1)
  const perpX = -dz / len;
  const perpZ = dx / len;

  // Signed distance: positive = right side, negative = left side
  return (px - v0.x) * perpX + (pz - v0.z) * perpZ;
}

/**
 * Get elevation contribution from a single spine
 *
 * @param {number} x - Query X
 * @param {number} z - Query Z
 * @param {Object} spine - Spine object
 * @param {Object} world - World object (for half-cell config)
 * @param {number} baseElevation - Default base elevation (unused, kept for API)
 * @param {number} blendWidth - Blend zone width as fraction of influence
 * @returns {{elevation: number, weight: number} | null}
 */
function getSpineContribution(x, z, spine, world, baseElevation, blendWidth) {
  const vertices = spine.vertices;

  // Single vertex: pure radial (no blending needed - single cell)
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
  const primarySide = getSide(x, z, v0, v1);

  // Use the vertex closer to the projection point for config
  const vertexIndex = bestT < 0.5 ? bestSegIndex : bestSegIndex + 1;

  // Compute primary cell elevation
  const primaryConfig = getHalfCellConfig(world, spine.id, vertexIndex, primarySide);
  const primaryElevation = computeProfileElevation(
    bestSpineElevation,
    primaryConfig.baseElevation,
    Math.min(1, normalizedDist),
    primaryConfig.profile
  );

  // Check if we need to blend with the opposite side (left/right boundary)
  let elevation = primaryElevation;

  if (blendWidth > 0) {
    // Compute signed distance to spine (the left/right boundary)
    const signedDist = signedDistanceToSpine(x, z, v0, v1);
    const absSignedDist = Math.abs(signedDist);

    // Blend zone is defined as fraction of the local influence radius
    const blendZone = bestInfluence * blendWidth;

    // If within blend zone of the spine centerline, blend left/right
    if (absSignedDist < blendZone) {
      const neighborSide = primarySide === 'left' ? 'right' : 'left';
      const neighborConfig = getHalfCellConfig(world, spine.id, vertexIndex, neighborSide);
      const neighborElevation = computeProfileElevation(
        bestSpineElevation,
        neighborConfig.baseElevation,
        Math.min(1, normalizedDist),
        neighborConfig.profile
      );

      // Blend factor: 0.5 at spine centerline, 0 at blend zone edge
      // absSignedDist / blendZone goes from 0 (at spine) to 1 (at edge)
      const blendT = absSignedDist / blendZone;
      const blendFactor = smoothstep(blendT);

      // blendFactor=0 means we're at spine center, equal mix
      // blendFactor=1 means we're at edge, use primary only
      elevation = primaryElevation * blendFactor + neighborElevation * (1 - blendFactor);

      // At the exact spine (blendT=0), we want 50/50 mix
      // As we move toward primary side (blendT->1), we want 100% primary
      // smoothstep(0) = 0, smoothstep(1) = 1
      // So: elevation = primary * smoothstep(t) + neighbor * (1 - smoothstep(t))
      // This gives 50/50 at center, 100% primary at edge
    }

    // Also blend across vertex boundaries (when bestT is near 0 or 1)
    // This handles transitions between adjacent vertices on the same side
    const vertexBlendThreshold = blendWidth;

    if (bestT < vertexBlendThreshold && bestSegIndex > 0) {
      // Near the start vertex, blend with previous segment's config
      const prevVertexIndex = bestSegIndex;
      const prevConfig = getHalfCellConfig(world, spine.id, prevVertexIndex, primarySide);

      // Only blend if configs differ
      if (prevConfig.profile !== primaryConfig.profile ||
          prevConfig.baseElevation !== primaryConfig.baseElevation) {
        const prevElevation = computeProfileElevation(
          bestSpineElevation,
          prevConfig.baseElevation,
          Math.min(1, normalizedDist),
          prevConfig.profile
        );

        const vertexBlendT = bestT / vertexBlendThreshold;
        const vertexBlendFactor = smoothstep(vertexBlendT);
        elevation = elevation * vertexBlendFactor + prevElevation * (1 - vertexBlendFactor);
      }
    } else if (bestT > (1 - vertexBlendThreshold) && bestSegIndex < vertices.length - 2) {
      // Near the end vertex, blend with next segment's config
      const nextVertexIndex = bestSegIndex + 1;
      const nextConfig = getHalfCellConfig(world, spine.id, nextVertexIndex, primarySide);

      // Only blend if configs differ
      if (nextConfig.profile !== primaryConfig.profile ||
          nextConfig.baseElevation !== primaryConfig.baseElevation) {
        const nextElevation = computeProfileElevation(
          bestSpineElevation,
          nextConfig.baseElevation,
          Math.min(1, normalizedDist),
          nextConfig.profile
        );

        const vertexBlendT = (1 - bestT) / vertexBlendThreshold;
        const vertexBlendFactor = smoothstep(vertexBlendT);
        elevation = elevation * vertexBlendFactor + nextElevation * (1 - vertexBlendFactor);
      }
    }
  }

  const weight = Math.max(0, 1 - normalizedDist * 0.8) ** 2;

  return { elevation, weight };
}

/**
 * Get shape value for a profile
 * @param {string|number} profile - Profile name or shape value
 * @returns {number} Shape value
 */
export function getProfileShape(profile) {
  return getShapeValue(profile);
}

/**
 * Compute elevation from profile using Hermite interpolation
 *
 * Uses cubic Hermite curves with zero slopes at both endpoints,
 * guaranteeing C1 continuity at cell boundaries.
 *
 * @param {number} spineElevation - Elevation at spine vertex
 * @param {number} baseElevation - Elevation at cell boundary
 * @param {number} distance - Distance from spine (normalized 0-1)
 * @param {string|number} profile - Profile preset name or shape value
 * @returns {number} Elevation at this point
 */
export function computeProfileElevation(spineElevation, baseElevation, distance, profile) {
  const shape = getShapeValue(profile);
  const t = Math.min(1, Math.max(0, distance));
  const factor = hermiteProfile(t, shape);
  return baseElevation + (spineElevation - baseElevation) * factor;
}
