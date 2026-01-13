/**
 * Voronoi / Power Diagram computation
 * 
 * For spine-based terrain, we use a weighted Voronoi (power diagram)
 * where each vertex's `influence` parameter controls cell extent.
 */

/**
 * Compute power diagram from weighted seeds
 * 
 * @param {Array<{x: number, z: number, influence: number}>} seeds - Weighted seed points
 * @returns {Object} Voronoi diagram with cells and edges
 */
export function computeVoronoi(seeds) {
  // TODO: Implement Fortune's algorithm adapted for power diagram
  // For now, return a simple structure for testing
  
  return {
    seeds,
    cells: seeds.map((seed, i) => ({
      index: i,
      seed,
      // vertices and edges computed by algorithm
    })),
    edges: []
  };
}

/**
 * Find which cell contains a point (power diagram query)
 * 
 * @param {number} x - Query X
 * @param {number} z - Query Z  
 * @param {Array<{x: number, z: number, influence: number}>} seeds - Weighted seeds
 * @returns {number} Index of owning cell
 */
export function findCell(x, z, seeds) {
  let minPower = Infinity;
  let minIndex = 0;
  
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const dx = x - s.x;
    const dz = z - s.z;
    // Power distance: dist² - influence²
    const power = dx * dx + dz * dz - s.influence * s.influence;
    
    if (power < minPower) {
      minPower = power;
      minIndex = i;
    }
  }
  
  return minIndex;
}
