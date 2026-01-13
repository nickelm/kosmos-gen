/**
 * Deterministic seed utilities
 */

/**
 * Create a seeded random number generator
 * @param {number} seed 
 * @returns {() => number} Function returning values in [0, 1)
 */
export function seededRandom(seed) {
  // Mulberry32 PRNG
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Derive a child seed from parent seed and string key
 * @param {number} parentSeed 
 * @param {string} key 
 * @returns {number}
 */
export function deriveSeed(parentSeed, key) {
  let hash = parentSeed;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash >>> 0; // Ensure unsigned
}

/**
 * Fast hash for coordinates
 * @param {number} x 
 * @param {number} z 
 * @param {number} seed 
 * @returns {number} Value in [0, 1)
 */
export function hash(x, z, seed) {
  const n = Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453;
  return n - Math.floor(n);
}
