/**
 * Voronoi diagram computation using d3-delaunay
 *
 * For blob-based terrain, we compute a standard Voronoi diagram from blob
 * positions for visualization. Elevation sampling uses direct blob queries,
 * not Voronoi cells.
 */

import { Delaunay } from 'd3-delaunay';

/**
 * Default bounds for Voronoi computation
 */
const DEFAULT_BOUNDS = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

/**
 * Cache for Voronoi cells
 */
let cellCache = new Map();
let cachedBlobsHash = null;
let cachedBoundsHash = null;

/**
 * Compute hash for blobs to detect changes
 */
function computeBlobsHash(blobs) {
  if (!blobs || blobs.length === 0) return 'empty';
  let hash = '';
  for (const blob of blobs) {
    hash += `${blob.id}:${blob.x.toFixed(6)},${blob.z.toFixed(6)};`;
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
 * Clear the cell cache
 */
export function clearCellCache() {
  cellCache.clear();
  cachedBlobsHash = null;
  cachedBoundsHash = null;
}

// Legacy alias
export const clearHalfCellCache = clearCellCache;

/**
 * Build seeds array from blobs
 *
 * @param {Array} blobs - Array of blob objects
 * @returns {Array<{x: number, z: number, blobId: string, index: number}>}
 */
export function buildSeeds(blobs) {
  if (!blobs) return [];
  return blobs.map((blob, i) => ({
    x: blob.x,
    z: blob.z,
    blobId: blob.id,
    index: i
  }));
}

/**
 * Compute Voronoi diagram from seeds and return cell polygons
 *
 * @param {Array<{x: number, z: number}>} seeds - Seed points
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

  // Create flat array for d3-delaunay: [x0, z0, x1, z1, ...]
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
 * Compute and cache Voronoi cells for blobs
 *
 * @param {Array} blobs - Array of blob objects
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds
 * @returns {Map<string, Array<{x: number, z: number}>>} Map from blob ID to polygon
 */
export function computeBlobCells(blobs, bounds = DEFAULT_BOUNDS) {
  const blobsHash = computeBlobsHash(blobs);
  const boundsHash = computeBoundsHash(bounds);

  // Return cached result if nothing changed
  if (blobsHash === cachedBlobsHash && boundsHash === cachedBoundsHash) {
    return cellCache;
  }

  // Clear and recompute
  cellCache.clear();

  if (!blobs || blobs.length === 0) {
    cachedBlobsHash = blobsHash;
    cachedBoundsHash = boundsHash;
    return cellCache;
  }

  // Build seeds from blobs
  const seeds = buildSeeds(blobs);

  // Compute Voronoi cells
  const cellPolygons = computeVoronoiCells(seeds, bounds);

  // Store with blob IDs as keys
  for (let i = 0; i < blobs.length; i++) {
    const polygon = cellPolygons.get(i);
    if (polygon && polygon.length >= 3) {
      cellCache.set(blobs[i].id, polygon);
    }
  }

  cachedBlobsHash = blobsHash;
  cachedBoundsHash = boundsHash;
  return cellCache;
}

/**
 * Find nearest blob to a point
 *
 * @param {number} x - Query X coordinate
 * @param {number} z - Query Z coordinate
 * @param {Array} blobs - Array of blob objects
 * @returns {Object|null} Nearest blob or null
 */
export function findNearestBlob(x, z, blobs) {
  if (!blobs || blobs.length === 0) return null;

  let nearest = null;
  let minDistSq = Infinity;

  for (const blob of blobs) {
    const dx = x - blob.x;
    const dz = z - blob.z;
    const distSq = dx * dx + dz * dz;

    if (distSq < minDistSq) {
      minDistSq = distSq;
      nearest = blob;
    }
  }

  return nearest;
}

/**
 * Find blob at a point (within radius)
 *
 * @param {number} x - Query X coordinate
 * @param {number} z - Query Z coordinate
 * @param {Array} blobs - Array of blob objects
 * @param {number} hitRadius - Hit test radius in world units
 * @returns {Object|null} Blob at point or null
 */
export function findBlobAt(x, z, blobs, hitRadius = 0.02) {
  if (!blobs || blobs.length === 0) return null;

  const hitRadiusSq = hitRadius * hitRadius;

  for (const blob of blobs) {
    const dx = x - blob.x;
    const dz = z - blob.z;
    const distSq = dx * dx + dz * dz;

    if (distSq <= hitRadiusSq) {
      return blob;
    }
  }

  return null;
}

/**
 * Get cell polygon for a blob
 *
 * @param {string} blobId - Blob ID
 * @param {Array} blobs - Array of blob objects
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds
 * @returns {Array<{x: number, z: number}>|null} Cell polygon or null
 */
export function getBlobCell(blobId, blobs, bounds = DEFAULT_BOUNDS) {
  computeBlobCells(blobs, bounds);
  return cellCache.get(blobId) || null;
}

// Legacy exports for backward compatibility (no-ops or simple wrappers)
export function computeVoronoi(seeds) {
  return {
    seeds,
    cells: seeds.map((seed, i) => ({ index: i, seed })),
    edges: []
  };
}

// Legacy: these functions are no longer needed but kept to avoid import errors
export function findHalfCellAt() { return null; }
export function extractHalfCellBoundary() { return []; }
export function computeHalfCellPolygons() { return new Map(); }
