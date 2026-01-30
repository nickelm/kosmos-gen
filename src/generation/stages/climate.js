/**
 * Stage 4: Climate generation
 *
 * Generates temperature and humidity fields from elevation data.
 * Temperature follows a latitude gradient with elevation cooling.
 * Humidity uses ocean proximity and noise variation.
 */

import { deriveSeed } from '../../core/seeds.js';
import { createFBmNoise, unipolar } from '../../core/noise.js';
import { clamp, smoothstep } from '../../core/math.js';

/** How much elevation reduces temperature (0 = none, 1 = full) */
const ELEV_COOLING = 0.4;

/** Temperature noise amplitude (centered around zero) */
const TEMP_NOISE_AMP = 0.15;

/** Humidity noise amplitude (centered around zero) */
const HUMID_NOISE_AMP = 0.25;

/** Base humidity everywhere */
const BASE_HUMIDITY = 0.4;

/** Max humidity bonus from ocean proximity */
const OCEAN_HUMIDITY_BONUS = 0.35;

/** How far above sea level the ocean moisture bonus reaches */
const OCEAN_MOISTURE_REACH = 0.15;

/**
 * Generate climate fields (temperature and humidity)
 *
 * @param {Object} params - World parameters (from Stage 1)
 * @param {{ width: number, height: number, data: Float32Array, bounds: Object }} elevation
 * @param {number} seed - World seed
 * @returns {{ temperature: Float32Array, humidity: Float32Array, width: number, height: number }}
 */
export function generateClimate(params, elevation, seed) {
  const { seaLevel } = params;
  const { width, height, data: elevData, bounds } = elevation;

  const climateSeed = deriveSeed(seed, 'climate');

  // Temperature noise
  const tempNoise = unipolar(createFBmNoise(deriveSeed(climateSeed, 'temperature'), {
    octaves: 3,
    persistence: 0.5,
    lacunarity: 2.0,
    frequency: 3.0,
  }));

  // Humidity noise
  const humidNoise = unipolar(createFBmNoise(deriveSeed(climateSeed, 'humidity'), {
    octaves: 3,
    persistence: 0.5,
    lacunarity: 2.0,
    frequency: 3.0,
  }));

  const temperature = new Float32Array(width * height);
  const humidity = new Float32Array(width * height);

  const rangeZ = bounds.maxZ - bounds.minZ;
  const rangeX = bounds.maxX - bounds.minX;
  const cellH = rangeZ / height;
  const cellW = rangeX / width;

  for (let row = 0; row < height; row++) {
    // Latitude: row 0 = minZ (south, warm), last row = maxZ (north, cold)
    const worldZ = bounds.minZ + (row + 0.5) * cellH;
    const normalizedZ = (worldZ - bounds.minZ) / rangeZ; // 0 at south, 1 at north
    const baseTemp = 1.0 - normalizedZ; // warm south, cold north

    for (let col = 0; col < width; col++) {
      const worldX = bounds.minX + (col + 0.5) * cellW;
      const idx = row * width + col;
      const elev = elevData[idx];

      // --- Temperature ---
      // Elevation penalty: higher = colder (only above sea level)
      const elevAboveSea = Math.max(0, elev - seaLevel);
      const maxLandElev = 1.0 - seaLevel;
      const elevPenalty = (elevAboveSea / maxLandElev) * ELEV_COOLING;

      // Noise variation (centered around zero)
      const tn = tempNoise(worldX, worldZ) * TEMP_NOISE_AMP - TEMP_NOISE_AMP * 0.5;

      temperature[idx] = clamp(baseTemp - elevPenalty + tn, 0, 1);

      // --- Humidity ---
      // Ocean proximity bonus: cells near or below sea level get moisture
      let oceanBonus;
      if (elev < seaLevel) {
        oceanBonus = OCEAN_HUMIDITY_BONUS;
      } else {
        oceanBonus = smoothstep(0, OCEAN_MOISTURE_REACH, seaLevel + OCEAN_MOISTURE_REACH - elev) * OCEAN_HUMIDITY_BONUS;
      }

      // Noise variation (centered around zero)
      const hn = humidNoise(worldX, worldZ) * HUMID_NOISE_AMP - HUMID_NOISE_AMP * 0.5;

      humidity[idx] = clamp(BASE_HUMIDITY + oceanBonus + hn, 0, 1);
    }
  }

  return { temperature, humidity, width, height };
}
