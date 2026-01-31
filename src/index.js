/**
 * kosmos-gen - Procedural world generation
 *
 * Public API
 */

// Core
export { seededRandom, deriveSeed } from './core/seeds.js';
export { createSimplexNoise, createFBmNoise, unipolar } from './core/noise.js';
export { createDomainWarp, createCachedDomainWarp, DEFAULT_WARP_CONFIG } from './core/warp.js';
export { lerp, smoothstep, clamp, distance, normalize, remap, pointToSegmentDistance } from './core/math.js';

// Geometry
export {
  computeVoronoi,
  computeVoronoiCells,
  computeBlobCells,
  buildSeeds,
  findNearestBlob,
  findBlobAt,
  getBlobCell,
  clearCellCache,
  clearHalfCellCache  // Legacy alias
} from './geometry/voronoi.js';
export { extractContours, simplifyPolyline, isClosedLoop } from './geometry/contour.js';
export {
  pointInPolygon,
  splitPolygonByLine,
  clipPolygonToBounds,
  polygonArea,
  polygonCentroid
} from './geometry/polygon.js';

// Terrain - Blob system
export {
  createBlob,
  evaluateBlobInfluence,
  weightedAverageCombine,
  evaluateBlobAt,       // Legacy - use evaluateBlobInfluence instead
  softmaxCombine,       // Legacy - use weightedAverageCombine instead
  generateBlobId,
  PROFILES,
  PROFILE_NAMES
} from './terrain/blob.js';

// Terrain - Elevation
export {
  sampleElevation,
  computeProfileElevation,
  getProfileShape,
  SEA_LEVEL
} from './terrain/elevation.js';

// Terrain - Noise
export {
  sampleSurfaceNoise,
  DEFAULT_SURFACE_NOISE_CONFIG
} from './terrain/surfacenoise.js';
export {
  sampleRidgeNoise,
  createRidgedNoise,
  DEFAULT_RIDGE_NOISE_CONFIG
} from './terrain/ridgenoise.js';
export {
  sampleMicroDetail,
  DEFAULT_MICRO_DETAIL_CONFIG
} from './terrain/microdetail.js';

// Terrain - Coastline
export {
  extractCoastline,
  extractBothCoastlines,
  extractRefinedCoastline,
  displaceCoastline,
  displaceAllCoastlines,
  filterSmallIslands,
  getCoastlineStats,
  DEFAULT_COASTLINE_CONFIG
} from './terrain/coastline.js';

// Hydrology
export {
  generateHydrology,
  simplifyRiverPath,
  findNearestRiverPoint,
  DEFAULT_HYDROLOGY_CONFIG
} from './terrain/hydrology.js';
export {
  createFlowGrid,
  sampleElevationsToGrid,
  computeFlowDirections,
  computeFlowAccumulation,
  findHighFlowCells,
  findSinkCells,
  cellToWorld,
  worldToCell,
  getDownstreamCell
} from './terrain/flowgrid.js';
export {
  detectWaterSources,
  mergeNearbySources,
  filterSourcesByElevation,
  createManualSource
} from './terrain/watersources.js';
export {
  detectPotentialLakes,
  computeLakeFill,
  extractLakeBoundary,
  classifyLakeAsEndorheic,
  createManualLake,
  findTerminatingLake
} from './terrain/lakes.js';
export {
  sampleRiverCarving,
  computeRiverCarvingField,
  computeEnhancedCarveProfile,
  ensureRiverSDF,
  sampleRiverSDF,
  isInRiver,
  getRiverInfoAt
} from './terrain/rivercarving.js';

// Settlements
export { generateSettlements } from './generation/stages/settlements.js';
export { generateSettlementName, generateName } from './generation/naming.js';
export { convexHull } from './generation/convexhull.js';

// Roads
export { generateRoads } from './generation/stages/roads.js';
export { buildConnectivityGraph } from './generation/roads/connectivity.js';
export { findPath } from './generation/roads/pathfinding.js';

// POIs
export { generatePOIs } from './generation/stages/pois.js';

// Configuration defaults
export { DEFAULT_BIOMES, defaultClassify } from './config/defaultBiomes.js';
export { DEFAULT_NAMING } from './config/defaultNaming.js';

// World
export { World, DEFAULT_HYDROLOGY_CONFIG as WORLD_HYDROLOGY_CONFIG } from './world/world.js';
export { generateWorld } from './world/generate.js';
export { saveWorld, loadWorld } from './world/storage.js';

// High-level API
export { generateIsland, DEFAULTS, ARCHETYPES, BIOMES, IslandData, FieldSampler } from './api.js';
