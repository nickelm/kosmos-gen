/**
 * Generation pipeline
 *
 * Runs generation stages sequentially and tracks timing.
 */

import { generateParams } from './stages/params.js';
import { generateSpines } from './stages/spines.js';
import { generateElevation } from './stages/elevation.js';
import { generateHydrology } from './stages/hydrology.js';
import { generateClimate } from './stages/climate.js';
import { generateBiomes } from './stages/biomes.js';
import { generateSettlements } from './stages/settlements.js';
import { generateRoads } from './stages/roads.js';
import { generatePOIs } from './stages/pois.js';

/** Stage names in execution order */
export const STAGES = ['params', 'spines', 'elevation', 'hydrology', 'climate', 'biomes', 'settlements', 'roads', 'pois'];

/**
 * Run the generation pipeline
 *
 * @param {number} seed - World seed
 * @param {Object} [options]
 * @param {number} [options.resolution=512] - Elevation grid size
 * @param {string} [options.upToStage='pois'] - Stop after this stage
 * @param {string} [options.archetype] - Force a specific archetype
 * @param {Object} [options.biomes] - Custom biome classifier config
 * @param {Object} [options.pois] - POI types and placement rules
 * @param {Object} [options.naming] - Naming palettes
 * @returns {Object} Generated world data with timing info
 */
export function generate(seed, options = {}) {
  const {
    resolution = 512, upToStage = 'pois', archetype, terrainOverrides,
    biomes: biomesConfig, pois: poisConfig, naming: namingConfig,
  } = options;

  const callerConfig = { biomes: biomesConfig, pois: poisConfig, naming: namingConfig };

  const result = {
    seed,
    _config: callerConfig,
    params: null,
    spines: null,
    elevation: null,
    hydrology: null,
    climate: null,
    biomes: null,
    settlements: null,
    roads: null,
    pois: null,
    timing: {},
  };

  const targetIndex = STAGES.indexOf(upToStage);
  if (targetIndex === -1) {
    throw new Error(`Unknown stage: ${upToStage}. Valid: ${STAGES.join(', ')}`);
  }

  const totalStart = performance.now();

  // Stage 1: Params
  let start = performance.now();
  result.params = generateParams(seed, { archetype, terrainOverrides });
  result.timing.params = performance.now() - start;

  if (targetIndex < 1) {
    result.timing.total = performance.now() - totalStart;
    return result;
  }

  // Stage 2: Spines
  start = performance.now();
  result.spines = generateSpines(result.params, seed);
  result.timing.spines = performance.now() - start;

  if (targetIndex < 2) {
    result.timing.total = performance.now() - totalStart;
    return result;
  }

  // Stage 3: Elevation
  start = performance.now();
  result.elevation = generateElevation(result.params, result.spines, seed, resolution);
  result.timing.elevation = performance.now() - start;

  if (targetIndex < 3) {
    result.timing.total = performance.now() - totalStart;
    return result;
  }

  // Stage 4: Hydrology
  start = performance.now();
  result.hydrology = generateHydrology(result.params, result.elevation, seed, result.spines);
  result.timing.hydrology = performance.now() - start;

  if (targetIndex < 4) {
    result.timing.total = performance.now() - totalStart;
    return result;
  }

  // Stage 5: Climate
  start = performance.now();
  result.climate = generateClimate(result.params, result.elevation, seed);
  result.timing.climate = performance.now() - start;

  if (targetIndex < 5) {
    result.timing.total = performance.now() - totalStart;
    return result;
  }

  // Stage 6: Biomes (accepts caller biome config)
  start = performance.now();
  result.biomes = generateBiomes(result.params, result.elevation, result.climate, seed, biomesConfig);
  result.timing.biomes = performance.now() - start;

  if (targetIndex < 6) {
    result.timing.total = performance.now() - totalStart;
    return result;
  }

  // Stage 7: Settlements (accepts caller naming config)
  start = performance.now();
  result.settlements = generateSettlements(result.params, result.elevation, result.hydrology, result.biomes, seed, namingConfig);
  result.timing.settlements = performance.now() - start;

  if (targetIndex < 7) {
    result.timing.total = performance.now() - totalStart;
    return result;
  }

  // Stage 8: Roads
  start = performance.now();
  result.roads = generateRoads(result.params, result.elevation, result.hydrology, result.settlements, seed);
  result.timing.roads = performance.now() - start;

  if (targetIndex < 8) {
    result.timing.total = performance.now() - totalStart;
    return result;
  }

  // Stage 9: POIs (accepts caller POI and naming config)
  start = performance.now();
  result.pois = generatePOIs(result, poisConfig, seed, namingConfig);
  result.timing.pois = performance.now() - start;

  result.timing.total = performance.now() - totalStart;
  return result;
}
