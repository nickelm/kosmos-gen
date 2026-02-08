/**
 * Texture color palettes and biome tint definitions.
 *
 * Each preset maps noise values [0, 1] to a color gradient
 * via 3-5 color stops. Colors are muted/desaturated since
 * GolemCraft's biome tint system multiplies color on top.
 */

import { lerp } from '../core/math.js';

/**
 * 9 base texture presets.
 * Each has: name, stops (color gradient), layers (noise layer definitions).
 */
export const TEXTURE_PRESETS = {
  grass: {
    name: 'Grass',
    // Richer green tones — visible between billboard blades
    stops: [
      { t: 0.0, color: [0.22, 0.35, 0.12] },
      { t: 0.3, color: [0.30, 0.48, 0.16] },
      { t: 0.6, color: [0.36, 0.54, 0.18] },
      { t: 1.0, color: [0.42, 0.58, 0.22] },
    ],
    layers: [
      { type: 'perlin', octaves: 3, frequency: 3.0, amplitude: 0.75, persistence: 0.5 },
      { type: 'perlin', octaves: 1, frequency: 8.0, amplitude: 0.15 },
    ],
  },
  forest_floor: {
    name: 'Forest Floor',
    stops: [
      { t: 0.0, color: [0.18, 0.14, 0.10] },
      { t: 0.3, color: [0.25, 0.20, 0.14] },
      { t: 0.7, color: [0.30, 0.26, 0.18] },
      { t: 1.0, color: [0.28, 0.30, 0.18] },
    ],
    layers: [
      { type: 'perlin', octaves: 3, frequency: 4.0, amplitude: 0.65, persistence: 0.45 },
      { type: 'worley', octaves: 1, frequency: 6.0, amplitude: 0.2 },
      { type: 'perlin', octaves: 1, frequency: 10.0, amplitude: 0.1 },
    ],
  },
  dirt: {
    name: 'Dirt',
    stops: [
      { t: 0.0, color: [0.30, 0.22, 0.14] },
      { t: 0.4, color: [0.42, 0.32, 0.20] },
      { t: 0.7, color: [0.48, 0.38, 0.24] },
      { t: 1.0, color: [0.52, 0.42, 0.28] },
    ],
    layers: [
      { type: 'perlin', octaves: 3, frequency: 3.0, amplitude: 0.7, persistence: 0.5 },
      { type: 'perlin', octaves: 1, frequency: 9.0, amplitude: 0.15 },
    ],
  },
  sand: {
    name: 'Sand',
    // Warmer golden yellow with visible grain detail
    stops: [
      { t: 0.0, color: [0.66, 0.68, 0.42] },
      { t: 0.3, color: [0.84, 0.76, 0.48] },
      { t: 0.7, color: [0.90, 0.82, 0.52] },
      { t: 1.0, color: [0.94, 0.88, 0.58] },
    ],
    layers: [
      { type: 'perlin', octaves: 3, frequency: 3.0, amplitude: 0.65, persistence: 0.45 },
      { type: 'worley', octaves: 1, frequency: 8.0, amplitude: 0.2 },
      { type: 'perlin', octaves: 1, frequency: 12.0, amplitude: 0.1 },
    ],
  },
  rock: {
    name: 'Rock',
    // Wider contrast range for visible veins and cracks
    stops: [
      { t: 0.0, color: [0.26, 0.26, 0.28] },
      { t: 0.3, color: [0.38, 0.38, 0.40] },
      { t: 0.6, color: [0.48, 0.47, 0.50] },
      { t: 1.0, color: [0.58, 0.56, 0.60] },
    ],
    layers: [
      { type: 'perlin', octaves: 2, frequency: 2.0, amplitude: 0.5, persistence: 0.5 },
      { type: 'ridged', octaves: 3, frequency: 4.0, amplitude: 0.35 },
      { type: 'perlin', octaves: 1, frequency: 12.0, amplitude: 0.12 },
    ],
  },
  snow: {
    name: 'Snow',
    // Pure white with subtle blue-tinted shadows in crevices
    stops: [
      { t: 0.0, color: [0.88, 0.92, 1.00] },
      { t: 0.15, color: [0.96, 0.97, 1.00] },
      { t: 0.4, color: [0.99, 0.99, 1.00] },
      { t: 1.0, color: [1.00, 1.00, 1.00] },
    ],
    layers: [
      { type: 'perlin', octaves: 2, frequency: 3.0, amplitude: 0.8, persistence: 0.3 },
    ],
  },
  ice: {
    name: 'Ice',
    // Strong cyan-blue with crystal structure, minimal gray
    stops: [
      { t: 0.0, color: [0.45, 0.72, 0.92] },
      { t: 0.3, color: [0.55, 0.80, 0.96] },
      { t: 0.7, color: [0.70, 0.88, 1.00] },
      { t: 1.0, color: [0.82, 0.94, 1.00] },
    ],
    layers: [
      { type: 'perlin', octaves: 2, frequency: 2.0, amplitude: 0.7, persistence: 0.4 },
      { type: 'worley', octaves: 1, frequency: 4.0, amplitude: 0.2 },
    ],
  },
  gravel: {
    name: 'Gravel',
    // Wider contrast, more prominent pebble stipple
    stops: [
      { t: 0.0, color: [0.28, 0.25, 0.22] },
      { t: 0.3, color: [0.40, 0.36, 0.32] },
      { t: 0.6, color: [0.52, 0.48, 0.42] },
      { t: 1.0, color: [0.60, 0.55, 0.48] },
    ],
    layers: [
      { type: 'perlin', octaves: 2, frequency: 3.0, amplitude: 0.45, persistence: 0.5 },
      { type: 'worley', octaves: 1, frequency: 10.0, amplitude: 0.38 },
      { type: 'perlin', octaves: 1, frequency: 14.0, amplitude: 0.12 },
    ],
  },
  water: {
    name: 'Water',
    // Deep blue-teal surface with subtle caustic variation
    stops: [
      { t: 0.0, color: [0.12, 0.28, 0.45] },
      { t: 0.3, color: [0.16, 0.35, 0.52] },
      { t: 0.7, color: [0.22, 0.42, 0.58] },
      { t: 1.0, color: [0.28, 0.50, 0.65] },
    ],
    layers: [
      { type: 'perlin', octaves: 2, frequency: 2.5, amplitude: 0.7, persistence: 0.45 },
      { type: 'worley', octaves: 1, frequency: 5.0, amplitude: 0.18 },
      { type: 'perlin', octaves: 1, frequency: 8.0, amplitude: 0.1 },
    ],
  },
};

/**
 * Biome tint colors for preview.
 * Values are [r, g, b] multipliers in [0, 1].
 */
export const BIOME_TINTS = {
  plains:           [0.30, 0.80, 0.25],
  meadow:           [0.25, 0.90, 0.30],
  autumn_forest:    [0.85, 0.50, 0.20],
  deciduous_forest: [0.40, 0.35, 0.25],
  swamp:            [0.30, 0.40, 0.25],
  desert:           [1.00, 0.95, 0.80],
  red_desert:       [0.95, 0.55, 0.35],
  savanna:          [0.80, 0.70, 0.30],
  badlands:         [0.75, 0.35, 0.20],
  jungle:           [0.20, 0.40, 0.15],
  beach:            [1.00, 0.98, 0.90],
  taiga:            [0.35, 0.40, 0.35],
  tundra:           [1.00, 1.00, 1.00],
  glacier:          [1.00, 1.00, 1.00],
  mountains:        [0.60, 0.60, 0.60],
  volcanic:         [0.25, 0.25, 0.25],
};

/**
 * Map a noise value [0,1] to an RGB color using palette color stops.
 *
 * @param {number} t - Value in [0, 1]
 * @param {Array<{t: number, color: [number, number, number]}>} stops
 * @returns {[number, number, number]} RGB in [0, 1]
 */
export function samplePalette(t, stops) {
  if (t <= stops[0].t) return [...stops[0].color];
  if (t >= stops[stops.length - 1].t) return [...stops[stops.length - 1].color];

  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      const range = stops[i + 1].t - stops[i].t;
      const f = range > 0 ? (t - stops[i].t) / range : 0;
      return [
        lerp(stops[i].color[0], stops[i + 1].color[0], f),
        lerp(stops[i].color[1], stops[i + 1].color[1], f),
        lerp(stops[i].color[2], stops[i + 1].color[2], f),
      ];
    }
  }

  return [...stops[stops.length - 1].color];
}

/**
 * Apply a biome tint to an RGB color (component-wise multiplication).
 *
 * @param {[number, number, number]} color - Base RGB in [0, 1]
 * @param {[number, number, number]} tint - Tint multiplier in [0, 1]
 * @returns {[number, number, number]} Tinted RGB
 */
export function applyTint(color, tint) {
  return [
    color[0] * tint[0],
    color[1] * tint[1],
    color[2] * tint[2],
  ];
}
