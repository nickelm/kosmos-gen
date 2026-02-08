/**
 * Texture generation orchestrator.
 *
 * Combines noise generation and palette mapping to produce
 * RGBA pixel data ready for display or export.
 */

import { generateNoiseField, generateMultiLayerField } from './noisegen.js';
import { TEXTURE_PRESETS, samplePalette, applyTint } from './palettes.js';

/**
 * Generate a texture as RGBA pixel data.
 *
 * @param {Object} params
 * @param {string} params.preset - Preset name (e.g. 'grass')
 * @param {number} [params.width=128]
 * @param {number} [params.height=128]
 * @param {number} [params.seed=42]
 * @param {Object} [params.noiseOverrides] - Override base layer noise params
 * @param {Array} [params.paletteOverrides] - Override default color stops
 * @param {[number,number,number]} [params.tint] - Optional biome tint multiplier
 * @returns {{ pixels: Uint8ClampedArray, width: number, height: number }}
 */
export function generateTexture(params) {
  const {
    preset,
    width = 128,
    height = 128,
    seed = 42,
    noiseOverrides,
    paletteOverrides,
    tint,
  } = params;

  const def = TEXTURE_PRESETS[preset];
  if (!def) throw new Error(`Unknown texture preset: ${preset}`);

  // Palette stops
  const stops = paletteOverrides || def.stops;

  // Build layers: apply slider overrides to base layer, keep detail layers from preset
  const presetLayers = def.layers || [def.noise || {}];
  const baseLayer = {
    type: 'perlin',
    octaves: 2,
    frequency: 3.0,
    amplitude: 0.8,
    lacunarity: 2.0,
    persistence: 0.5,
    ...presetLayers[0],
    ...noiseOverrides,
  };
  const layers = [baseLayer, ...presetLayers.slice(1)];

  // Generate noise field
  const field = generateMultiLayerField({ width, height, seed, layers });

  // Map noise to RGBA pixels
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    let color = samplePalette(field[i], stops);

    if (tint) {
      color = applyTint(color, tint);
    }

    const offset = i * 4;
    pixels[offset] = Math.round(color[0] * 255);
    pixels[offset + 1] = Math.round(color[1] * 255);
    pixels[offset + 2] = Math.round(color[2] * 255);
    pixels[offset + 3] = 255;
  }

  return { pixels, width, height };
}

/**
 * Generate all 8 textures with default presets.
 *
 * @param {Object} [options]
 * @param {number} [options.width=128]
 * @param {number} [options.height=128]
 * @param {number} [options.seed=42]
 * @returns {Object<string, { pixels: Uint8ClampedArray, width: number, height: number }>}
 */
export function generateAllTextures(options = {}) {
  const { width = 128, height = 128, seed = 42 } = options;
  const result = {};

  for (const key of Object.keys(TEXTURE_PRESETS)) {
    result[key] = generateTexture({ preset: key, width, height, seed });
  }

  return result;
}
