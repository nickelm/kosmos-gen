/**
 * Math utilities for terrain generation
 */

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor [0, 1]
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Smooth Hermite interpolation between two edges
 * @param {number} edge0 - Lower edge
 * @param {number} edge1 - Upper edge
 * @param {number} x - Input value
 * @returns {number} Value in [0, 1]
 */
export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Clamp a value between min and max
 * @param {number} v - Input value
 * @param {number} min - Minimum
 * @param {number} max - Maximum
 * @returns {number}
 */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Euclidean distance between two 2D points
 * @param {number} x1
 * @param {number} z1
 * @param {number} x2
 * @param {number} z2
 * @returns {number}
 */
export function distance(x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Normalize a value from [min, max] to [0, 1]
 * @param {number} v - Input value
 * @param {number} min - Input minimum
 * @param {number} max - Input maximum
 * @returns {number}
 */
export function normalize(v, min, max) {
  if (max === min) return 0;
  return (v - min) / (max - min);
}

/**
 * Remap a value from one range to another
 * @param {number} v - Input value
 * @param {number} inMin - Input range minimum
 * @param {number} inMax - Input range maximum
 * @param {number} outMin - Output range minimum
 * @param {number} outMax - Output range maximum
 * @returns {number}
 */
export function remap(v, inMin, inMax, outMin, outMax) {
  const t = normalize(v, inMin, inMax);
  return lerp(outMin, outMax, t);
}

/**
 * Distance from a point to a line segment
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {number} ax - Segment start X
 * @param {number} az - Segment start Z
 * @param {number} bx - Segment end X
 * @param {number} bz - Segment end Z
 * @returns {{ distance: number, t: number }} Distance and parameter along segment [0, 1]
 */
export function pointToSegmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;

  if (lengthSq === 0) {
    return { distance: distance(px, pz, ax, az), t: 0 };
  }

  let t = ((px - ax) * dx + (pz - az) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = ax + t * dx;
  const closestZ = az + t * dz;

  return {
    distance: distance(px, pz, closestX, closestZ),
    t
  };
}
