/**
 * Voronoi / Power Diagram computation using d3-delaunay
 *
 * For spine-based terrain, we compute a standard Voronoi diagram from all
 * spine vertices, then split each cell into half-cells using spine geometry.
 */

import { Delaunay } from 'd3-delaunay';
import { pointInPolygon, splitPolygonByLine } from './polygon.js';

/**
 * Default bounds for Voronoi computation (large enough to contain any reasonable world)
 */
const DEFAULT_BOUNDS = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

/**
 * Cache for computed half-cell polygons
 * @type {Map<string, Array<{x: number, z: number}>>}
 */
let halfCellPolygonCache = new Map();
let cachedSpinesHash = null;
let cachedBoundsHash = null;

/**
 * Compute hash for spines to detect changes
 */
function computeSpinesHash(spines) {
  if (!spines || spines.length === 0) return 'empty';
  let hash = '';
  for (const spine of spines) {
    hash += spine.id + ':';
    for (const v of spine.vertices) {
      hash += `${v.x.toFixed(6)},${v.z.toFixed(6)},${v.influence || 0};`;
    }
    hash += '|';
  }
  return hash;
}

/**
 * Compute hash for bounds
 */
function computeBoundsHash(bounds) {
  return `${bounds.minX},${bounds.maxX},${bounds.minZ},${bounds.maxZ}`;
}

/**
 * Clear the half-cell polygon cache
 */
export function clearHalfCellCache() {
  halfCellPolygonCache.clear();
  cachedSpinesHash = null;
  cachedBoundsHash = null;
}

/**
 * Build seeds array from spines
 * @param {Array} spines - Array of spine objects
 * @returns {Array<{x: number, z: number, influence: number, spineId: string, vertexIndex: number}>}
 */
export function buildSeeds(spines) {
  const seeds = [];
  for (const spine of spines) {
    for (let i = 0; i < spine.vertices.length; i++) {
      const v = spine.vertices[i];
      seeds.push({
        x: v.x,
        z: v.z,
        influence: v.influence || 0,
        elevation: v.elevation || 0,
        spineId: spine.id,
        vertexIndex: i
      });
    }
  }
  return seeds;
}

/**
 * Compute Voronoi diagram from seeds and return cell polygons
 *
 * @param {Array<{x: number, z: number, spineId: string, vertexIndex: number}>} seeds
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds
 * @returns {Map<number, Array<{x: number, z: number}>>} Map from seed index to cell polygon
 */
export function computeVoronoiCells(seeds, bounds = DEFAULT_BOUNDS) {
  if (!seeds || seeds.length === 0) {
    return new Map();
  }

  // Handle single seed case
  if (seeds.length === 1) {
    const polygon = [
      { x: bounds.minX, z: bounds.minZ },
      { x: bounds.maxX, z: bounds.minZ },
      { x: bounds.maxX, z: bounds.maxZ },
      { x: bounds.minX, z: bounds.maxZ }
    ];
    return new Map([[0, polygon]]);
  }

  // Create flat array for d3-delaunay: [x0, y0, x1, y1, ...]
  const points = [];
  for (const seed of seeds) {
    points.push(seed.x, seed.z);
  }

  // Compute Delaunay triangulation and Voronoi diagram
  const delaunay = new Delaunay(points);
  const voronoi = delaunay.voronoi([bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ]);

  // Extract cell polygons
  const cellPolygons = new Map();
  for (let i = 0; i < seeds.length; i++) {
    const cellGenerator = voronoi.cellPolygon(i);
    if (cellGenerator) {
      // Convert from array of [x, z] to array of {x, z}
      const polygon = [];
      for (const point of cellGenerator) {
        // d3-delaunay returns closed polygons (first == last), skip the duplicate
        if (polygon.length > 0 &&
            polygon[0].x === point[0] &&
            polygon[0].z === point[1]) {
          continue;
        }
        polygon.push({ x: point[0], z: point[1] });
      }
      cellPolygons.set(i, polygon);
    }
  }

  return cellPolygons;
}

/**
 * Split a Voronoi cell polygon into half-cells based on spine geometry
 *
 * For endpoints: split by extending the spine segment line through the vertex
 * For interior vertices: split using both adjacent spine segments as cutting lines
 *
 * @param {Array<{x: number, z: number}>} cellPolygon - The full Voronoi cell polygon
 * @param {Object} spine - The spine this vertex belongs to
 * @param {number} vertexIndex - Index of the vertex in the spine
 * @returns {Object} Object with half-cell polygons keyed by side
 */
function splitCellIntoHalfCells(cellPolygon, spine, vertexIndex) {
  const vertex = spine.vertices[vertexIndex];
  const vertices = spine.vertices;

  if (vertices.length === 1) {
    // Single vertex spine: one radial cell (no splitting)
    return {
      radial: cellPolygon
    };
  }

  if (vertexIndex === 0) {
    // First endpoint: split by extending the segment line
    // Segment direction: vertex[0] -> vertex[1]
    const next = vertices[1];
    const dx = next.x - vertex.x;
    const dz = next.z - vertex.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const dir = len > 0 ? { x: dx / len, z: dz / len } : { x: 1, z: 0 };

    const { left, right } = splitPolygonByLine(cellPolygon, vertex, dir);
    return { left, right };
  }

  if (vertexIndex === vertices.length - 1) {
    // Last endpoint: split by extending the segment line
    // Segment direction: vertex[n-2] -> vertex[n-1]
    const prev = vertices[vertexIndex - 1];
    const dx = vertex.x - prev.x;
    const dz = vertex.z - prev.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const dir = len > 0 ? { x: dx / len, z: dz / len } : { x: 1, z: 0 };

    const { left, right } = splitPolygonByLine(cellPolygon, vertex, dir);
    return { left, right };
  }

  // Interior vertex: split using the bisector of the two spine segment directions
  // This creates a clean split that follows the spine's overall direction through the vertex
  const prev = vertices[vertexIndex - 1];
  const next = vertices[vertexIndex + 1];

  // Segment 1 direction (prev -> vertex), normalized
  const d1x = vertex.x - prev.x;
  const d1z = vertex.z - prev.z;
  const len1 = Math.sqrt(d1x * d1x + d1z * d1z);
  const n1x = len1 > 0 ? d1x / len1 : 1;
  const n1z = len1 > 0 ? d1z / len1 : 0;

  // Segment 2 direction (vertex -> next), normalized
  const d2x = next.x - vertex.x;
  const d2z = next.z - vertex.z;
  const len2 = Math.sqrt(d2x * d2x + d2z * d2z);
  const n2x = len2 > 0 ? d2x / len2 : 1;
  const n2z = len2 > 0 ? d2z / len2 : 0;

  // Bisector = average of the two normalized directions
  // This points in the "forward" direction along the spine
  const bisX = n1x + n2x;
  const bisZ = n1z + n2z;
  const bisLen = Math.sqrt(bisX * bisX + bisZ * bisZ);

  let dir;
  if (bisLen > 1e-6) {
    dir = { x: bisX / bisLen, z: bisZ / bisLen };
  } else {
    // Segments point in opposite directions (180° turn) - use segment 1 direction
    dir = { x: n1x, z: n1z };
  }

  const { left, right } = splitPolygonByLine(cellPolygon, vertex, dir);
  return { left, right };
}

/**
 * Compute and cache all half-cell polygons
 *
 * @param {Array} spines - Array of spine objects
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds - Bounding rectangle
 * @returns {Map<string, Array<{x: number, z: number}>>} Map from half-cell ID to polygon
 */
export function computeHalfCellPolygons(spines, bounds = DEFAULT_BOUNDS) {
  const spinesHash = computeSpinesHash(spines);
  const boundsHash = computeBoundsHash(bounds);

  // Return cached result if nothing changed
  if (spinesHash === cachedSpinesHash && boundsHash === cachedBoundsHash) {
    return halfCellPolygonCache;
  }

  // Clear and recompute
  halfCellPolygonCache.clear();

  if (!spines || spines.length === 0) {
    cachedSpinesHash = spinesHash;
    cachedBoundsHash = boundsHash;
    return halfCellPolygonCache;
  }

  // Build seeds from all spine vertices
  const seeds = buildSeeds(spines);

  // Compute Voronoi cells
  const cellPolygons = computeVoronoiCells(seeds, bounds);

  // Split each cell into half-cells
  for (let seedIndex = 0; seedIndex < seeds.length; seedIndex++) {
    const seed = seeds[seedIndex];
    const cellPolygon = cellPolygons.get(seedIndex);

    if (!cellPolygon || cellPolygon.length < 3) continue;

    const spine = spines.find(s => s.id === seed.spineId);
    if (!spine) continue;

    const halfCells = splitCellIntoHalfCells(cellPolygon, spine, seed.vertexIndex);

    // Store each half-cell polygon with its canonical ID
    for (const [side, polygon] of Object.entries(halfCells)) {
      if (polygon && polygon.length >= 3) {
        const id = `${seed.spineId}:${seed.vertexIndex}:${side}`;
        halfCellPolygonCache.set(id, polygon);
      }
    }
  }

  cachedSpinesHash = spinesHash;
  cachedBoundsHash = boundsHash;
  return halfCellPolygonCache;
}

/**
 * Get cached half-cell polygon by ID
 *
 * @param {string} halfCellId - Half-cell ID (format: "spineId:vertexIndex:side")
 * @returns {Array<{x: number, z: number}> | null} Polygon vertices or null
 */
export function getHalfCellPolygon(halfCellId) {
  return halfCellPolygonCache.get(halfCellId) || null;
}

/**
 * Find which cell contains a point (power diagram query)
 * Kept for backward compatibility with elevation sampling
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
 * Find which half-cell contains a point using cached polygons
 *
 * @param {number} x - Query X coordinate
 * @param {number} z - Query Z coordinate
 * @param {Array} spines - Array of spine objects
 * @param {Array<{x: number, z: number, influence: number, spineId: string}>} seeds - Voronoi seeds (optional, for backward compatibility)
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds - Bounds for Voronoi computation
 * @returns {{spineId: string, vertexIndex: number, side: string} | null}
 */
export function findHalfCellAt(x, z, spines, seeds = null, bounds = DEFAULT_BOUNDS) {
  if (!spines || spines.length === 0) return null;

  // Ensure half-cell polygons are computed
  const polygons = computeHalfCellPolygons(spines, bounds);

  // Test point against each cached polygon
  for (const [id, polygon] of polygons) {
    if (pointInPolygon(x, z, polygon)) {
      // Parse the ID to extract components
      const parts = id.split(':');
      // Handle spine IDs that might contain colons
      const side = parts.pop();
      const vertexIndex = parseInt(parts.pop(), 10);
      const spineId = parts.join(':');

      return { spineId, vertexIndex, side };
    }
  }

  // Fallback: if point is outside all polygons (shouldn't happen within bounds),
  // find nearest half-cell by distance to centroid
  let nearestId = null;
  let nearestDist = Infinity;

  for (const [id, polygon] of polygons) {
    let cx = 0, cz = 0;
    for (const p of polygon) {
      cx += p.x;
      cz += p.z;
    }
    cx /= polygon.length;
    cz /= polygon.length;

    const dist = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestId = id;
    }
  }

  if (nearestId) {
    const parts = nearestId.split(':');
    const side = parts.pop();
    const vertexIndex = parseInt(parts.pop(), 10);
    const spineId = parts.join(':');
    return { spineId, vertexIndex, side };
  }

  return null;
}

/**
 * Extract the boundary polygon for a half-cell
 *
 * @param {string} targetSpineId - Spine ID to match
 * @param {number} vertexIndex - Vertex index to match
 * @param {string} side - Side to match ('left', 'right', or 'radial')
 * @param {Array} spines - Array of spine objects
 * @param {Array} seeds - Voronoi seeds (unused, kept for backward compatibility)
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds - Bounding box
 * @param {number} resolution - Unused, kept for backward compatibility
 * @returns {Array<Array<{x: number, z: number}>>} Array containing the boundary polygon
 */
export function extractHalfCellBoundary(targetSpineId, vertexIndex, side, spines, seeds, bounds, resolution = 0.015) {
  // Ensure half-cell polygons are computed
  computeHalfCellPolygons(spines, bounds);

  const id = `${targetSpineId}:${vertexIndex}:${side}`;
  const polygon = halfCellPolygonCache.get(id);

  if (!polygon || polygon.length < 3) {
    return [];
  }

  // Return as array of polylines (single closed polygon)
  // Close the polygon by adding first point at end
  const closedPolygon = [...polygon, polygon[0]];
  return [closedPolygon];
}

// Legacy export for backward compatibility
export function computeVoronoi(seeds) {
  return {
    seeds,
    cells: seeds.map((seed, i) => ({
      index: i,
      seed
    })),
    edges: []
  };
}
