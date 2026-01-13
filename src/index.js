/**
 * kosmos-gen - Procedural world generation
 * 
 * Public API
 */

// Core
export { seededRandom, deriveSeed } from './core/seeds.js';

// Geometry
export { computeVoronoi } from './geometry/voronoi.js';
export { extractContours, simplifyPolyline, isClosedLoop } from './geometry/contour.js';

// Terrain
export { createSpine, getHalfCells } from './terrain/spine.js';
export { sampleElevation } from './terrain/elevation.js';

// World
export { World } from './world/world.js';
export { generateWorld } from './world/generate.js';
export { saveWorld, loadWorld } from './world/storage.js';
