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
 * @returns {Object} Blob object
 */
export function createBlob(id, x, z, elevation = 0.5, radius = 0.25, profile = 'cone') {
  return {
    id,
    x,
    z,
    elevation,
    radius,
    profile
  };
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
 * Evaluate a blob's elevation contribution at a point
 *
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
 * Generate a unique blob ID
 *
 * @param {number} index - Optional index hint
 * @returns {string} Unique ID
 */
export function generateBlobId(index = Date.now()) {
  return `blob_${index}_${Math.random().toString(36).substr(2, 4)}`;
}
