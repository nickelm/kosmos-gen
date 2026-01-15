/**
 * Blob-based terrain generation
 *
 * A blob is a circular terrain feature with radial elevation falloff.
 * Multiple blobs combine via softmax blending for smooth terrain.
 */

/**
 * Create a new blob
 *
 * @param {string} id - Unique identifier
 * @param {number} x - X position [-1, 1]
 * @param {number} z - Z position [-1, 1]
 * @param {number} elevation - Peak elevation [0, 1]
 * @param {number} radius - Falloff radius [0, 1]
 * @param {string} profile - Falloff shape: cone, plateau, bowl, shield
 * @param {Object} [noiseOverride] - Optional per-blob noise override
 * @param {number} [noiseOverride.roughness] - Override roughness [0, 1]
 * @param {number} [noiseOverride.featureScale] - Override feature scale [0.05, 0.5]
 * @returns {Object} Blob object
 */
export function createBlob(id, x, z, elevation = 0.5, radius = 0.25, profile = 'cone', noiseOverride = null) {
  const blob = {
    id,
    x,
    z,
    elevation,
    radius,
    profile
  };
  if (noiseOverride) {
    blob.noiseOverride = noiseOverride;
  }
  return blob;
}

/**
 * Profile functions
 *
 * Each profile maps normalized distance t [0, 1] to elevation factor [0, 1].
 * t = 0 at blob center, t = 1 at radius edge.
 */
export const PROFILES = {
  /**
   * Cone: Linear falloff (classic mountain shape)
   * elevation = peak * (1 - t)
   */
  cone: (t) => Math.max(0, 1 - t),

  /**
   * Plateau: Flat top with steep edge
   * Stays at full elevation until 70% of radius, then drops steeply
   */
  plateau: (t) => {
    if (t < 0.7) return 1;
    // Quadratic drop from 0.7 to 1.0
    const s = (t - 0.7) / 0.3;
    return Math.max(0, 1 - s * s);
  },

  /**
   * Bowl: Concave shape (drops fast, collects water)
   * Quadratic falloff: (1 - t)^2
   */
  bowl: (t) => Math.max(0, (1 - t) ** 2),

  /**
   * Shield: Convex dome (gentle slopes, sheds water)
   * Inverse quadratic: 1 - t^2
   */
  shield: (t) => Math.max(0, 1 - t ** 2)
};

/**
 * Profile names for iteration
 */
export const PROFILE_NAMES = Object.keys(PROFILES);

/**
 * Evaluate a blob's influence at a point (weighted average system)
 *
 * Returns the profile-scaled elevation and weight for weighted average blending.
 * The profile controls falloff from blob.elevation at center to 0 at radius edge.
 * The weight (same as falloff) determines how strongly this contributes to the average.
 *
 * @param {Object} blob - Blob object
 * @param {number} x - Query X coordinate
 * @param {number} z - Query Z coordinate
 * @returns {{weight: number, elevation: number}|null} Weight and elevation contribution, or null if outside influence
 */
export function evaluateBlobInfluence(blob, x, z) {
  const dx = x - blob.x;
  const dz = z - blob.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  // Normalize distance to [0, 1] within radius
  const t = dist / blob.radius;

  // Outside influence radius
  if (t >= 1) return null;

  // Profile determines falloff shape from center to edge
  const profileFn = PROFILES[blob.profile] || PROFILES.cone;
  const falloff = profileFn(t);

  return {
    weight: falloff,
    elevation: blob.elevation * falloff  // Profile-scaled elevation (0 at edge, peak at center)
  };
}

/**
 * Evaluate a blob's elevation contribution at a point (legacy)
 *
 * @deprecated Use evaluateBlobInfluence() for weighted average blending
 * @param {Object} blob - Blob object
 * @param {number} x - Query X coordinate
 * @param {number} z - Query Z coordinate
 * @returns {number} Elevation contribution [0, blob.elevation]
 */
export function evaluateBlobAt(blob, x, z) {
  const dx = x - blob.x;
  const dz = z - blob.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  // Normalize distance to [0, 1] within radius
  const t = dist / blob.radius;

  // Outside influence radius
  if (t >= 1) return 0;

  // Apply profile curve and scale by blob's peak elevation
  const profileFn = PROFILES[blob.profile] || PROFILES.cone;
  return blob.elevation * profileFn(t);
}

/**
 * Softmax combination of elevation values
 *
 * Combines multiple elevation contributions using the softmax function,
 * which approximates the maximum while providing smooth blending.
 *
 * Formula: ln(sum(exp(k * e_i))) / k
 *
 * @param {number[]} elevations - Array of elevation values
 * @param {number} k - Sharpness parameter (default 8)
 *   - Higher k: closer to hard max (winner takes all)
 *   - Lower k: smoother blending (approaches average)
 * @returns {number} Combined elevation
 */
export function softmaxCombine(elevations, k = 8) {
  if (elevations.length === 0) return 0;
  if (elevations.length === 1) return elevations[0];

  // Compute sum of exp(k * e) for each elevation
  let sumExp = 0;
  for (const e of elevations) {
    sumExp += Math.exp(k * e);
  }

  // Return ln(sum) / k
  return Math.log(sumExp) / k;
}

/**
 * Weighted average combination of blob influences
 *
 * Produces bounded results: output is always in [min(elevations), max(elevations)]
 * of contributing blobs. Cannot exceed the highest input elevation.
 *
 * @param {{weight: number, elevation: number}[]} contributions - Array of {weight, elevation}
 * @returns {number} Weighted average elevation, or 0 if no contributions
 */
export function weightedAverageCombine(contributions) {
  if (contributions.length === 0) return 0;
  if (contributions.length === 1) return contributions[0].elevation;

  let totalWeight = 0;
  let totalWeightedElevation = 0;

  for (const { weight, elevation } of contributions) {
    totalWeight += weight;
    totalWeightedElevation += weight * elevation;
  }

  if (totalWeight === 0) return 0;

  return totalWeightedElevation / totalWeight;
}

/**
 * Generate a unique blob ID
 *
 * @param {number} index - Optional index hint
 * @returns {string} Unique ID
 */
export function generateBlobId(index = Date.now()) {
  return `blob_${index}_${Math.random().toString(36).substr(2, 4)}`;
}
