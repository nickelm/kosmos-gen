/**
 * Whittaker biome diagram
 *
 * Biome definitions and lookup table for classifying terrain cells
 * based on temperature, humidity, and elevation.
 */

/** Biome definitions with ID, name, display color, and climate ranges */
export const BIOMES = [
  { id: 0,  name: 'ocean',         color: [21, 101, 192] },
  { id: 1,  name: 'beach',         color: [212, 167, 106] },
  { id: 2,  name: 'desert',        color: [210, 180, 100],  minTemp: 0.65, maxTemp: 1.0,  minHumidity: 0.0,  maxHumidity: 0.2 },
  { id: 3,  name: 'grassland',     color: [139, 195, 74],   minTemp: 0.3,  maxTemp: 0.7,  minHumidity: 0.15, maxHumidity: 0.5 },
  { id: 4,  name: 'forest',        color: [56, 142, 60],    minTemp: 0.3,  maxTemp: 0.7,  minHumidity: 0.5,  maxHumidity: 0.85 },
  { id: 5,  name: 'jungle',        color: [27, 94, 32],     minTemp: 0.7,  maxTemp: 1.0,  minHumidity: 0.6,  maxHumidity: 1.0 },
  { id: 6,  name: 'swamp',         color: [85, 107, 47],    minTemp: 0.35, maxTemp: 0.75, minHumidity: 0.85, maxHumidity: 1.0 },
  { id: 7,  name: 'tundra',        color: [176, 190, 197],  minTemp: 0.1,  maxTemp: 0.3,  minHumidity: 0.0,  maxHumidity: 0.5 },
  { id: 8,  name: 'snow',          color: [240, 240, 255] },
  { id: 9,  name: 'mountain_rock', color: [130, 110, 100] },
];

/** Pre-built color lookup */
const BIOME_COLOR_MAP = new Map(BIOMES.map(b => [b.id, b.color]));

/** Pre-built name lookup */
const BIOME_NAME_MAP = new Map(BIOMES.map(b => [b.id, b.name]));

/** Biomes checked via temp/humidity ranges (evaluation order = priority) */
const GRID_BIOMES = [
  BIOMES[2],  // desert  — hot + dry
  BIOMES[5],  // jungle  — hot + wet
  BIOMES[6],  // swamp   — moderate + very wet
  BIOMES[4],  // forest  — moderate + wet
  BIOMES[7],  // tundra  — cold + dry-to-moderate
  BIOMES[3],  // grassland — fallback moderate
];

/**
 * Get the biome ID for a given climate and elevation.
 *
 * Priority: ocean → beach → mountain_rock → snow → grid lookup → grassland fallback
 *
 * @param {number} temp - Temperature [0, 1]
 * @param {number} humidity - Humidity [0, 1]
 * @param {number} elevation - Raw elevation value
 * @param {number} seaLevel - Sea level threshold
 * @returns {number} Biome ID
 */
export function getBiome(temp, humidity, elevation, seaLevel) {
  // Special-case overrides (order matters)
  if (elevation < seaLevel) return 0;          // ocean
  if (elevation < seaLevel + 0.02) return 1;   // beach
  if (elevation > 0.65) return 9;              // mountain_rock
  if (temp < 0.15) return 8;                   // snow

  // Grid biome lookup
  for (const biome of GRID_BIOMES) {
    if (
      temp >= biome.minTemp && temp <= biome.maxTemp &&
      humidity >= biome.minHumidity && humidity <= biome.maxHumidity
    ) {
      return biome.id;
    }
  }

  // Fallback
  return 3; // grassland
}

/**
 * Get RGB color for a biome ID
 * @param {number} biomeId
 * @returns {[number, number, number]} RGB [0-255]
 */
export function getBiomeColor(biomeId) {
  return BIOME_COLOR_MAP.get(biomeId) || [128, 128, 128];
}

/**
 * Get biome name for a biome ID
 * @param {number} biomeId
 * @returns {string}
 */
export function getBiomeName(biomeId) {
  return BIOME_NAME_MAP.get(biomeId) || 'unknown';
}
