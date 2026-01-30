/**
 * Stage 5: Biome classification
 *
 * Assigns a biome ID to each grid cell using Whittaker-style
 * temperature/humidity lookup with elevation overrides.
 */

import { getBiome } from '../whittaker.js';

/**
 * Generate biome classification grid
 *
 * @param {Object} params - World parameters
 * @param {{ width: number, height: number, data: Float32Array }} elevation
 * @param {{ temperature: Float32Array, humidity: Float32Array, width: number, height: number }} climate
 * @param {number} _seed - Reserved for future biome noise
 * @returns {{ data: Uint8Array, width: number, height: number }}
 */
export function generateBiomes(params, elevation, climate, _seed) {
  const { seaLevel } = params;
  const { width, height } = elevation;
  const count = width * height;

  const data = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    data[i] = getBiome(
      climate.temperature[i],
      climate.humidity[i],
      elevation.data[i],
      seaLevel
    );
  }

  return { data, width, height };
}
