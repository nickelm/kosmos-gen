/**
 * Stage 6: Biome classification
 *
 * Assigns a biome ID to each grid cell. Supports three modes:
 * 1. Custom classify function (biomesConfig.classify)
 * 2. Declarative thresholds (biomesConfig.thresholds)
 * 3. Default Whittaker classifier (no config)
 *
 * Custom classifiers return string IDs. These are mapped to numeric indices
 * via a registry for efficient Uint8Array storage and FieldSampler compat.
 */

import { defaultClassify } from '../../config/defaultBiomes.js';

/**
 * Generate biome classification grid
 *
 * @param {Object} params - World parameters
 * @param {{ width: number, height: number, data: Float32Array }} elevation
 * @param {{ temperature: Float32Array, humidity: Float32Array, width: number, height: number }} climate
 * @param {number} _seed - Reserved for future biome noise
 * @param {Object} [biomesConfig] - Caller biome configuration
 * @returns {{ data: Uint8Array, width: number, height: number, registry: Object|null }}
 */
export function generateBiomes(params, elevation, climate, _seed, biomesConfig) {
  const { seaLevel } = params;
  const { width, height } = elevation;
  const count = width * height;

  if (biomesConfig?.classify) {
    return classifyWithCustom(biomesConfig.classify, elevation, climate, seaLevel, width, height, count);
  }

  if (biomesConfig?.thresholds) {
    const classifyFn = buildThresholdClassifier(biomesConfig.thresholds, biomesConfig.default || 'grassland');
    return classifyWithCustom(classifyFn, elevation, climate, seaLevel, width, height, count);
  }

  // Default: Whittaker classifier (backward compatible, no registry)
  const data = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = defaultClassify(
      climate.temperature[i],
      climate.humidity[i],
      elevation.data[i],
      seaLevel
    );
  }

  return { data, width, height, registry: null };
}

/**
 * Classify all cells using a custom function that returns string biome IDs.
 * Builds a registry mapping string IDs to numeric indices.
 */
function classifyWithCustom(classifyFn, elevation, climate, seaLevel, width, height, count) {
  const stringToId = new Map();
  const idToString = new Map();
  let nextId = 0;
  const data = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const biomeStr = classifyFn(
      climate.temperature[i],
      climate.humidity[i],
      elevation.data[i],
      seaLevel
    );

    if (!stringToId.has(biomeStr)) {
      stringToId.set(biomeStr, nextId);
      idToString.set(nextId, biomeStr);
      nextId++;
    }
    data[i] = stringToId.get(biomeStr);
  }

  return { data, width, height, registry: { stringToId, idToString } };
}

/**
 * Build a classifier function from declarative thresholds.
 *
 * Each threshold entry: { id, tempMin?, tempMax?, humidityMin?, humidityMax?, elevMin?, elevMax? }
 * Thresholds are checked in order; first match wins.
 */
function buildThresholdClassifier(thresholds, defaultBiome) {
  return function classify(temp, humidity, elevation, seaLevel) {
    for (const t of thresholds) {
      if (t.tempMin !== undefined && temp < t.tempMin) continue;
      if (t.tempMax !== undefined && temp > t.tempMax) continue;
      if (t.humidityMin !== undefined && humidity < t.humidityMin) continue;
      if (t.humidityMax !== undefined && humidity > t.humidityMax) continue;
      if (t.elevMin !== undefined && elevation < t.elevMin) continue;
      if (t.elevMax !== undefined && elevation > t.elevMax) continue;
      return t.id;
    }
    return defaultBiome;
  };
}
