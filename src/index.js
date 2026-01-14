/**
 * kosmos-gen - Procedural world generation
 * 
 * Public API
 */

// Core
export { seededRandom, deriveSeed } from './core/seeds.js';
export { createSimplexNoise, createFBmNoise, unipolar } from './core/noise.js';
export { createDomainWarp, createCachedDomainWarp, DEFAULT_WARP_CONFIG } from './core/warp.js';

// Geometry
export {
  computeVoronoi,
  computeVoronoiCells,
  computeHalfCellPolygons,
  findHalfCellAt,
  extractHalfCellBoundary,
  clearHalfCellCache,
  buildSeeds
} from './geometry/voronoi.js';
export { extractContours, simplifyPolyline, isClosedLoop } from './geometry/contour.js';
export {
  pointInPolygon,
  splitPolygonByLine,
  clipPolygonToBounds,
  polygonArea,
  polygonCentroid
} from './geometry/polygon.js';

// Terrain
export { createSpine, getHalfCells, getHalfCellConfig } from './terrain/spine.js';
export { sampleElevation, computeProfileElevation, getProfileShape } from './terrain/elevation.js';
export {
  sampleSurfaceNoise,
  getHalfCellNoiseConfig,
  DEFAULT_SURFACE_NOISE_CONFIG
} from './terrain/surfacenoise.js';

// World
export { World } from './world/world.js';
export { generateWorld } from './world/generate.js';
export { saveWorld, loadWorld } from './world/storage.js';
