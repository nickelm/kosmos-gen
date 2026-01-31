/**
 * kosmos-gen high-level API
 *
 * Simple interface for generating and querying island data.
 *
 * @example
 * import { generateIsland, DEFAULTS, ARCHETYPES, BIOMES } from 'kosmos-gen'
 *
 * const island = generateIsland(42)
 * island.getElevation(0, 0)
 * island.getBiomeName(0.3, -0.2)
 * island.isOnRoad(0.1, 0.5)
 */

import { generate } from './generation/pipeline.js';
import { IslandData } from './api/islanddata.js';
import { FieldSampler } from './api/fieldsampler.js';
import { DEFAULTS } from './api/defaults.js';
import { ARCHETYPES } from './api/archetypes.js';
import { BIOMES } from './generation/whittaker.js';

export { DEFAULTS, ARCHETYPES, BIOMES, IslandData, FieldSampler };

/**
 * Generate an island and return a queryable IslandData object.
 *
 * @param {number} seed - World seed (integer recommended)
 * @param {Object} [options] - Override defaults selectively
 * @param {string} [options.archetype] - Force archetype ('ridge','arc','crescent','ring','star','scattered')
 * @param {number} [options.resolution] - Grid resolution (default 512)
 * @param {string} [options.upToStage] - Stop after this pipeline stage
 * @param {Object} [options.noise] - Override noise config (partial OK)
 * @param {Object} [options.warp] - Override warp config (partial OK)
 * @param {Object} [options.elevation] - Override elevation config (partial OK)
 * @param {Object} [options.biomes] - Biome classifier config (function or thresholds)
 * @param {Object} [options.pois] - POI types and placement rules
 * @param {Object} [options.naming] - Naming palettes for settlements, islands, POIs, rivers
 * @returns {IslandData} Queryable island data
 */
export function generateIsland(seed, options = {}) {
  const pipelineOptions = {
    resolution: options.resolution ?? DEFAULTS.resolution,
    upToStage: options.upToStage ?? DEFAULTS.upToStage,
    archetype: options.archetype,
    biomes: options.biomes ?? null,
    pois: options.pois ?? null,
    naming: options.naming ?? null,
  };

  // Only forward terrain overrides that were explicitly provided
  const terrainOverrides = {};
  if (options.noise) terrainOverrides.noise = options.noise;
  if (options.warp) terrainOverrides.warp = options.warp;
  if (options.elevation) terrainOverrides.elevation = options.elevation;

  if (Object.keys(terrainOverrides).length > 0) {
    pipelineOptions.terrainOverrides = terrainOverrides;
  }

  const result = generate(seed, pipelineOptions);
  return new IslandData(result, { seed, ...options });
}
