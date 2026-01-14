/**
 * World generation pipeline
 */

import { World } from './world.js';
import { computeVoronoi } from '../geometry/voronoi.js';
import { deriveSeed } from '../core/seeds.js';
import { generateHydrology } from '../terrain/hydrology.js';

/**
 * Generate a world from template and seed
 * 
 * @param {Object} template - World template
 * @param {number} seed - Generation seed
 * @param {Object} options - Generation options
 * @param {Function} options.onProgress - Progress callback (stage, percent)
 * @returns {Promise<World>}
 */
export async function generateWorld(template, seed, options = {}) {
  const { onProgress = () => {} } = options;
  
  // Phase 1: Voronoi construction
  onProgress('voronoi', 0);
  const seeds = collectSeeds(template);
  const voronoi = computeVoronoi(seeds);
  onProgress('voronoi', 100);
  
  // Phase 2: Base elevation
  onProgress('elevation', 0);
  // TODO: Compute elevation field
  onProgress('elevation', 100);
  
  // Phase 3: Coastline
  onProgress('coastline', 0);
  // TODO: Extract coastline contour
  onProgress('coastline', 100);
  
  // Phase 4: Noise
  onProgress('noise', 0);
  // TODO: Apply noise to elevation
  onProgress('noise', 100);
  
  // Phase 5: Hydrology
  onProgress('hydrology', 0);

  // Create a temporary world object for hydrology generation
  const tempWorld = {
    seed,
    template,
    voronoi,
    halfCells: template.halfCells || {},
    defaults: template.defaults || {},
    hydrologyConfig: template.hydrologyConfig || {},
    waterSources: template.waterSources || [],
    lakes: template.lakes?.filter(l => l.origin === 'manual') || [],
    rivers: []
  };

  // Generate hydrology (rivers, lakes, water sources)
  const hydrologyResult = generateHydrology(tempWorld, {
    bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }
  });

  const rivers = hydrologyResult.rivers;
  const lakes = hydrologyResult.lakes;
  const waterSources = hydrologyResult.waterSources;
  const flowGrid = hydrologyResult.flowGrid;

  onProgress('hydrology', 100);
  
  // Phase 6: Climate
  onProgress('climate', 0);
  // TODO: Compute temperature, humidity, biomes
  onProgress('climate', 100);
  
  // Phase 7: Zones
  onProgress('zones', 0);
  // TODO: Place zones
  const zones = [];
  onProgress('zones', 100);
  
  // Phase 8: Infrastructure
  onProgress('infrastructure', 0);
  // TODO: Roads, settlements
  onProgress('infrastructure', 100);
  
  // Phase 9: Naming
  onProgress('naming', 0);
  // TODO: Generate names
  onProgress('naming', 100);
  
  // Create world
  const world = new World({
    id: `world_${seed}`,
    seed,
    template,
    voronoi,
    halfCells: template.halfCells || {},
    rivers,
    lakes,
    waterSources,
    flowGrid,
    hydrologyConfig: template.hydrologyConfig || {},
    zones
  });
  
  return world;
}

/**
 * Collect all spine vertices as Voronoi seeds
 * @param {Object} template 
 * @returns {Array<{x: number, z: number, influence: number}>}
 */
function collectSeeds(template) {
  const seeds = [];
  
  for (const spine of (template.spines || [])) {
    for (const v of spine.vertices) {
      seeds.push({
        x: v.x,
        z: v.z,
        influence: v.influence || 300,
        elevation: v.elevation || 0.5,
        spineId: spine.id
      });
    }
  }
  
  return seeds;
}
