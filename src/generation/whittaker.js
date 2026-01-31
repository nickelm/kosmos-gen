/**
 * Whittaker biome diagram — backward-compatible re-exports
 *
 * The actual biome definitions and classifier live in config/defaultBiomes.js.
 * This module re-exports them under the original names for existing consumers.
 */

export {
  DEFAULT_BIOMES as BIOMES,
  defaultClassify as getBiome,
  getBiomeColor,
  getBiomeName,
} from '../config/defaultBiomes.js';
