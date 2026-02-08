/**
 * Tileable 2D noise for texture generation.
 *
 * Supports three noise types:
 * - perlin: smooth gradient noise (modular coords for tiling)
 * - ridged: 1 - abs(perlin), creates vein-like ridges
 * - worley: cellular/Voronoi distance noise, stippled pebbles
 *
 * All types tile seamlessly at texture boundaries.
 */

import { seededRandom, deriveSeed } from '../core/seeds.js';

// 8 unit-length gradient directions
const GRADIENTS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
];
// Normalize diagonals to unit length
const INV_SQRT2 = 1 / Math.sqrt(2);
for (let i = 4; i < 8; i++) {
  GRADIENTS[i][0] *= INV_SQRT2;
  GRADIENTS[i][1] *= INV_SQRT2;
}

/** Quintic fade curve: 6t^5 - 15t^4 + 10t^3 */
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Create a tileable 2D Perlin noise function.
 *
 * @param {number} seed - Deterministic seed
 * @param {number} periodX - Tile period in X (positive integer)
 * @param {number} periodY - Tile period in Y (positive integer)
 * @returns {(x: number, y: number) => number} Noise function returning [-1, 1]
 */
export function createTileableNoise(seed, periodX, periodY) {
  // Build 256-entry permutation table
  const perm = new Uint8Array(512);
  const rng = seededRandom(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  return function perlin2D(x, y) {
    // Integer cell coordinates (wrapped for tiling)
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    // Wrap to period (handle negative values)
    const ix0 = ((ix % periodX) + periodX) % periodX;
    const iy0 = ((iy % periodY) + periodY) % periodY;
    const ix1 = (ix0 + 1) % periodX;
    const iy1 = (iy0 + 1) % periodY;

    // Gradient indices at 4 corners
    const g00 = perm[ix0 + perm[iy0]] % 8;
    const g10 = perm[ix1 + perm[iy0]] % 8;
    const g01 = perm[ix0 + perm[iy1]] % 8;
    const g11 = perm[ix1 + perm[iy1]] % 8;

    // Dot products of gradient and distance vectors
    const n00 = GRADIENTS[g00][0] * fx + GRADIENTS[g00][1] * fy;
    const n10 = GRADIENTS[g10][0] * (fx - 1) + GRADIENTS[g10][1] * fy;
    const n01 = GRADIENTS[g01][0] * fx + GRADIENTS[g01][1] * (fy - 1);
    const n11 = GRADIENTS[g11][0] * (fx - 1) + GRADIENTS[g11][1] * (fy - 1);

    // Fade curves for interpolation
    const u = fade(fx);
    const v = fade(fy);

    // Bilinear interpolation
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
  };
}

/**
 * Create a tileable ridged noise function: 1 - abs(perlin).
 * Produces vein-like ridge patterns.
 *
 * @param {number} seed
 * @param {number} periodX
 * @param {number} periodY
 * @returns {(x: number, y: number) => number} Noise function returning [-1, 1]
 */
export function createTileableRidgedNoise(seed, periodX, periodY) {
  const perlin = createTileableNoise(seed, periodX, periodY);
  return function ridged2D(x, y) {
    // Map from [0, 1] range to [-1, 1] for consistency with perlin
    return 1.0 - 2.0 * Math.abs(perlin(x, y));
  };
}

/**
 * Create a tileable Worley (cellular) noise function.
 * For each point, computes distance to nearest random cell point.
 * Tiles by checking neighbor cells with wrapped coordinates.
 *
 * @param {number} seed
 * @param {number} periodX
 * @param {number} periodY
 * @returns {(x: number, y: number) => number} Noise function returning [-1, 1]
 */
export function createTileableWorleyNoise(seed, periodX, periodY) {
  // Pre-generate one random point per cell
  const rng = seededRandom(seed);
  const cellPoints = new Float32Array(periodX * periodY * 2);
  for (let cy = 0; cy < periodY; cy++) {
    for (let cx = 0; cx < periodX; cx++) {
      const idx = (cy * periodX + cx) * 2;
      cellPoints[idx] = rng();     // fractional x within cell
      cellPoints[idx + 1] = rng(); // fractional y within cell
    }
  }

  return function worley2D(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let minDist = Infinity;

    // Check 3x3 neighborhood of cells
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ((ix + dx) % periodX + periodX) % periodX;
        const cy = ((iy + dy) % periodY + periodY) % periodY;
        const idx = (cy * periodX + cx) * 2;
        // World-space position of this cell's point
        const px = (ix + dx) + cellPoints[idx];
        const py = (iy + dy) + cellPoints[idx + 1];
        const ddx = x - px;
        const ddy = y - py;
        const dist = ddx * ddx + ddy * ddy;
        if (dist < minDist) minDist = dist;
      }
    }

    // sqrt, clamp to roughly [0, 1], then map to [-1, 1]
    const d = Math.min(Math.sqrt(minDist), 1.0);
    return d * 2.0 - 1.0;
  };
}

/**
 * Create noise function by type name.
 * @param {string} type - 'perlin', 'ridged', or 'worley'
 * @param {number} seed
 * @param {number} periodX
 * @param {number} periodY
 * @returns {(x: number, y: number) => number}
 */
function createNoiseByType(type, seed, periodX, periodY) {
  switch (type) {
    case 'ridged': return createTileableRidgedNoise(seed, periodX, periodY);
    case 'worley': return createTileableWorleyNoise(seed, periodX, periodY);
    default:       return createTileableNoise(seed, periodX, periodY);
  }
}

/**
 * Generate a 2D noise field at the given resolution.
 *
 * @param {Object} params
 * @param {number} params.width - Output width in pixels
 * @param {number} params.height - Output height in pixels
 * @param {number} params.octaves - Number of noise layers (1-4)
 * @param {number} params.frequency - Base frequency (0.5-8.0)
 * @param {number} [params.amplitude=0.8] - Noise strength
 * @param {number} [params.lacunarity=2.0] - Frequency multiplier per octave
 * @param {number} [params.persistence=0.5] - Amplitude multiplier per octave
 * @param {number} params.seed - Deterministic seed
 * @returns {Float32Array} Flat array of values in [0, 1], length = width * height
 */
export function generateNoiseField(params) {
  const {
    width,
    height,
    octaves = 2,
    frequency = 3.0,
    amplitude = 0.8,
    lacunarity = 2.0,
    persistence = 0.5,
    seed = 42,
    type = 'perlin',
  } = params;

  const field = new Float32Array(width * height);
  let maxAmp = 0;
  let amp = amplitude;

  // Accumulate octaves
  for (let o = 0; o < octaves; o++) {
    const freq = frequency * Math.pow(lacunarity, o);
    const period = Math.max(1, Math.round(freq));
    const octaveSeed = deriveSeed(seed, 'oct' + o);
    const noise = createNoiseByType(type, octaveSeed, period, period);

    // Sample using period (not freq) so we span exactly one tiling cycle
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const nx = (px / width) * period;
        const ny = (py / height) * period;
        field[py * width + px] += noise(nx, ny) * amp;
      }
    }

    maxAmp += amp;
    amp *= persistence;
  }

  // Normalize to [0, 1]
  if (maxAmp > 0) {
    for (let i = 0; i < field.length; i++) {
      field[i] = (field[i] / maxAmp + 1) * 0.5;
    }
  }

  return field;
}

/**
 * Generate a multi-layer noise field by blending multiple noise layers additively.
 *
 * Each layer has its own type (perlin/ridged/worley), frequency, octaves, etc.
 * Layers are blended by amplitude weight, then normalized to [0, 1].
 *
 * @param {Object} params
 * @param {number} params.width
 * @param {number} params.height
 * @param {number} params.seed
 * @param {Array<{type?: string, octaves?: number, frequency?: number, amplitude?: number, lacunarity?: number, persistence?: number}>} params.layers
 * @returns {Float32Array} Flat array of values in [0, 1]
 */
export function generateMultiLayerField(params) {
  const { width, height, seed, layers } = params;

  if (!layers || layers.length === 0) {
    return generateNoiseField({ width, height, seed });
  }

  // Single layer: use existing path (backward compatible)
  if (layers.length === 1) {
    const L = layers[0];
    return generateNoiseField({
      width, height, seed,
      type: L.type || 'perlin',
      octaves: L.octaves ?? 2,
      frequency: L.frequency ?? 3.0,
      amplitude: L.amplitude ?? 0.8,
      lacunarity: L.lacunarity ?? 2.0,
      persistence: L.persistence ?? 0.5,
    });
  }

  const field = new Float32Array(width * height);
  let totalWeight = 0;

  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    const type = L.type || 'perlin';
    const octaves = L.octaves ?? 2;
    const frequency = L.frequency ?? 3.0;
    const amplitude = L.amplitude ?? 0.8;
    const lacunarity = L.lacunarity ?? 2.0;
    const persistence = L.persistence ?? 0.5;
    const layerSeed = deriveSeed(seed, 'layer' + li);

    let amp = 1.0;
    let layerMaxAmp = 0;

    for (let o = 0; o < octaves; o++) {
      const freq = frequency * Math.pow(lacunarity, o);
      const period = Math.max(1, Math.round(freq));
      const octaveSeed = deriveSeed(layerSeed, 'oct' + o);
      const noise = createNoiseByType(type, octaveSeed, period, period);

      // Sample using period (not freq) so we span exactly one tiling cycle
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const nx = (px / width) * period;
          const ny = (py / height) * period;
          field[py * width + px] += noise(nx, ny) * amp * amplitude;
        }
      }

      layerMaxAmp += amp;
      amp *= persistence;
    }

    totalWeight += layerMaxAmp * amplitude;
  }

  // Normalize to [0, 1]
  if (totalWeight > 0) {
    for (let i = 0; i < field.length; i++) {
      field[i] = (field[i] / totalWeight + 1) * 0.5;
    }
  }

  return field;
}
