/**
 * Voronoi / Power Diagram computation
 *
 * For spine-based terrain, we use a weighted Voronoi (power diagram)
 * where each vertex's `influence` parameter controls cell extent.
 */

import { extractContours } from './contour.js';

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

/**
 * Find which half-cell contains a point
 *
 * @param {number} x - Query X coordinate
 * @param {number} z - Query Z coordinate
 * @param {Array} spines - Array of spine objects
 * @param {Array<{x: number, z: number, influence: number, spineId: string}>} seeds - Voronoi seeds with spine mapping
 * @returns {{spineId: string, vertexIndex: number, side: string} | null}
 */
export function findHalfCellAt(x, z, spines, seeds) {
  if (!seeds || seeds.length === 0) return null;

  // Find owning seed via power diagram
  const seedIndex = findCell(x, z, seeds);
  const seed = seeds[seedIndex];

  const spine = spines.find(s => s.id === seed.spineId);
  if (!spine) return null;

  const vertexIndex = spine.vertices.findIndex(
    v => v.x === seed.x && v.z === seed.z
  );
  if (vertexIndex === -1) return null;

  // Determine side using spine direction
  const currVertex = spine.vertices[vertexIndex];
  let side;

  if (spine.vertices.length === 1) {
    // Single vertex spine: true radial cell (no direction to split by)
    side = 'radial';
  } else {
    // For all vertices (including endpoints), determine side based on spine direction
    let dirX, dirZ;

    if (vertexIndex === 0) {
      // First vertex: use direction toward next vertex
      const nextVertex = spine.vertices[1];
      dirX = nextVertex.x - currVertex.x;
      dirZ = nextVertex.z - currVertex.z;
    } else if (vertexIndex === spine.vertices.length - 1) {
      // Last vertex: use direction from previous vertex
      const prevVertex = spine.vertices[vertexIndex - 1];
      dirX = currVertex.x - prevVertex.x;
      dirZ = currVertex.z - prevVertex.z;
    } else {
      // Interior vertex: use bisector of incoming and outgoing directions
      const prevVertex = spine.vertices[vertexIndex - 1];
      const nextVertex = spine.vertices[vertexIndex + 1];

      // Vector from prev to curr (normalized)
      const d1x = currVertex.x - prevVertex.x;
      const d1z = currVertex.z - prevVertex.z;
      const len1 = Math.sqrt(d1x * d1x + d1z * d1z);
      const n1x = len1 > 0 ? d1x / len1 : 0;
      const n1z = len1 > 0 ? d1z / len1 : 0;

      // Vector from curr to next (normalized)
      const d2x = nextVertex.x - currVertex.x;
      const d2z = nextVertex.z - currVertex.z;
      const len2 = Math.sqrt(d2x * d2x + d2z * d2z);
      const n2x = len2 > 0 ? d2x / len2 : 0;
      const n2z = len2 > 0 ? d2z / len2 : 0;

      // Bisector is average of the two directions
      dirX = n1x + n2x;
      dirZ = n1z + n2z;
    }

    // Use cross product of direction with point-to-vertex to determine side
    const px = x - currVertex.x;
    const pz = z - currVertex.z;

    // Cross product: dir × point
    const cross = dirX * pz - dirZ * px;
    side = cross < 0 ? 'left' : 'right';
  }

  return { spineId: spine.id, vertexIndex, side };
}

/**
 * Extract the boundary polyline for a half-cell using marching squares
 *
 * @param {string} targetSpineId - Spine ID to match
 * @param {number} vertexIndex - Vertex index to match
 * @param {string} side - Side to match ('left', 'right', or 'radial')
 * @param {Array} spines - Array of spine objects
 * @param {Array} seeds - Voronoi seeds
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds - Sampling bounds
 * @param {number} [resolution=0.015] - Sampling resolution
 * @returns {Array<Array<{x: number, z: number}>>} Array of polylines forming the boundary
 */
export function extractHalfCellBoundary(targetSpineId, vertexIndex, side, spines, seeds, bounds, resolution = 0.015) {
  // Create ownership function: returns 1 if point belongs to target half-cell
  const ownershipFn = (x, z) => {
    const cell = findHalfCellAt(x, z, spines, seeds);
    if (!cell) return 0;
    return (cell.spineId === targetSpineId &&
            cell.vertexIndex === vertexIndex &&
            cell.side === side) ? 1 : 0;
  };

  // Extract boundary at threshold 0.5
  return extractContours(ownershipFn, 0.5, bounds, resolution);
}
