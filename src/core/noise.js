/**
 * Noise generation utilities for terrain
 *
 * Implements 2D Simplex noise with fractal Brownian motion (fBm)
 * for multi-octave detail.
 */

import { deriveSeed, seededRandom } from './seeds.js';

// Simplex noise gradient table (12 directions)
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1]
];

// Skewing factors for 2D simplex
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/**
 * Create a 2D Simplex noise generator
 * @param {number} seed - Seed for permutation table
 * @returns {(x: number, y: number) => number} Noise function returning [-1, 1]
 */
export function createSimplexNoise(seed) {
  // Generate permutation table from seed
  const perm = new Uint8Array(512);
  const rng = seededRandom(seed);

  // Fisher-Yates shuffle for first 256 values
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }

  // Double the table for wraparound
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
  }

  return function simplex2D(x, y) {
    // Skew input space to determine simplex cell
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);

    // Unskew back to (x,y) space
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;

    // Position relative to origin of cell
    const x0 = x - X0;
    const y0 = y - Y0;

    // Determine which simplex we're in
    let i1, j1;
    if (x0 > y0) {
      i1 = 1; j1 = 0;  // Lower triangle
    } else {
      i1 = 0; j1 = 1;  // Upper triangle
    }

    // Offsets for corners
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    // Hash coordinates for gradient indices
    const ii = i & 255;
    const jj = j & 255;
    const gi0 = perm[ii + perm[jj]] % 12;
    const gi1 = perm[ii + i1 + perm[jj + j1]] % 12;
    const gi2 = perm[ii + 1 + perm[jj + 1]] % 12;

    // Calculate contributions from three corners
    let n0 = 0, n1 = 0, n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * (GRAD2[gi0][0] * x0 + GRAD2[gi0][1] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * (GRAD2[gi1][0] * x1 + GRAD2[gi1][1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * (GRAD2[gi2][0] * x2 + GRAD2[gi2][1] * y2);
    }

    // Scale to [-1, 1]
    return 70 * (n0 + n1 + n2);
  };
}

/**
 * Create a fractal Brownian motion (fBm) noise generator
 * Combines multiple octaves of noise for natural-looking detail
 *
 * @param {number} seed - Base seed
 * @param {Object} options
 * @param {number} [options.octaves=4] - Number of noise layers
 * @param {number} [options.persistence=0.5] - Amplitude decay per octave
 * @param {number} [options.lacunarity=2] - Frequency increase per octave
 * @param {number} [options.frequency=1] - Base frequency
 * @returns {(x: number, y: number) => number} Noise function returning [-1, 1]
 */
export function createFBmNoise(seed, options = {}) {
  const {
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2,
    frequency = 1
  } = options;

  // Create separate noise generator for each octave (different seeds)
  const noiseGenerators = [];
  for (let i = 0; i < octaves; i++) {
    const octaveSeed = deriveSeed(seed, `octave${i}`);
    noiseGenerators.push(createSimplexNoise(octaveSeed));
  }

  return function fbm(x, y) {
    let total = 0;
    let amplitude = 1;
    let freq = frequency;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += noiseGenerators[i](x * freq, y * freq) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      freq *= lacunarity;
    }

    // Normalize to [-1, 1]
    return total / maxValue;
  };
}

/**
 * Create noise that returns values in [0, 1] instead of [-1, 1]
 * Useful for elevation and other unipolar values
 *
 * @param {(x: number, y: number) => number} noiseFn
 * @returns {(x: number, y: number) => number}
 */
export function unipolar(noiseFn) {
  return (x, y) => (noiseFn(x, y) + 1) * 0.5;
}
