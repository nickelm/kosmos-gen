/**
 * kosmos-gen - Procedural world generation
 * 
 * Public API
 */

// Core
export { seededRandom, deriveSeed } from './core/seeds.js';

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
export { createSpine, getHalfCells } from './terrain/spine.js';
export { sampleElevation, computeProfileElevation, getProfileShape } from './terrain/elevation.js';

// World
export { World } from './world/world.js';
export { generateWorld } from './world/generate.js';
export { saveWorld, loadWorld } from './world/storage.js';
