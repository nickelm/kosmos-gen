/**
 * Polyline spatial index
 *
 * Grid-based spatial index for polyline segments enabling fast radius queries
 * with rich segment metadata (polyline ID, per-vertex attributes, interpolation
 * parameter). Supports O(1) rejection for distant queries and efficient
 * nearest-segment lookups.
 */

import { pointToSegmentDistance } from '../core/math.js';

// ---------------------------------------------------------------------------
// Standalone distance utility
// ---------------------------------------------------------------------------

/**
 * Compute the distance from a query point to a line segment, with full details.
 *
 * @param {{x: number, z: number}} p0 - Segment start
 * @param {{x: number, z: number}} p1 - Segment end
 * @param {{x: number, z: number}} queryPoint - Query point
 * @returns {{distance: number, t: number, closest: {x: number, z: number}}}
 *   - distance: shortest distance from point to segment
 *   - t: parameter along segment (0 = p0, 1 = p1), clamped
 *   - closest: nearest point on the segment
 */
export function distanceToSegment(p0, p1, queryPoint) {
  const { distance, t } = pointToSegmentDistance(
    queryPoint.x, queryPoint.z, p0.x, p0.z, p1.x, p1.z
  );
  return {
    distance,
    t,
    closest: {
      x: p0.x + t * (p1.x - p0.x),
      z: p0.z + t * (p1.z - p0.z)
    }
  };
}

// ---------------------------------------------------------------------------
// Index construction
// ---------------------------------------------------------------------------

/**
 * Build a spatial grid index for fast polyline segment queries.
 *
 * Each polyline is decomposed into segments. Every segment is inserted into
 * each grid cell its axis-aligned bounding box overlaps, enabling fast
 * candidate collection during radius queries.
 *
 * @param {Array<{id: string|number, points: Array<{x: number, z: number}>, attributes?: Array<Object>}>} polylines
 *   Each polyline has:
 *   - id: unique identifier
 *   - points: array of {x, z, ...} vertices (minimum 2 for any segments)
 *   - attributes: optional per-vertex attribute objects (same length as points)
 * @param {Object} [options]
 * @param {number} [options.cellSize] - Grid cell size in world units.
 *   Auto-computed as boundsSize/20 if omitted.
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} [options.bounds]
 *   World bounds (default: {minX: -1, maxX: 1, minZ: -1, maxZ: 1})
 * @returns {{
 *   cellSize: number,
 *   bounds: {minX: number, maxX: number, minZ: number, maxZ: number},
 *   gridWidth: number,
 *   gridHeight: number,
 *   cells: Array<Array<Object>>,
 *   segmentCount: number
 * }}
 */
export function createPolylineIndex(polylines, options = {}) {
  const bounds = options.bounds || { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const boundsW = bounds.maxX - bounds.minX;
  const boundsH = bounds.maxZ - bounds.minZ;
  const cellSize = options.cellSize || Math.max(boundsW, boundsH) / 20;

  const gridWidth = Math.max(1, Math.ceil(boundsW / cellSize));
  const gridHeight = Math.max(1, Math.ceil(boundsH / cellSize));

  const cells = new Array(gridHeight * gridWidth);
  for (let i = 0; i < cells.length; i++) cells[i] = [];

  let segmentCount = 0;

  if (!polylines) return { cellSize, bounds, gridWidth, gridHeight, cells, segmentCount };

  for (let pi = 0; pi < polylines.length; pi++) {
    const pl = polylines[pi];
    if (!pl || !pl.points || pl.points.length < 2) continue;

    const attrs = pl.attributes || null;

    for (let si = 0; si < pl.points.length - 1; si++) {
      const a = pl.points[si];
      const b = pl.points[si + 1];

      const seg = {
        polylineId: pl.id,
        segmentIndex: si,
        p0: { x: a.x, z: a.z },
        p1: { x: b.x, z: b.z },
        attrStart: attrs ? attrs[si] : null,
        attrEnd: attrs ? attrs[si + 1] : null
      };

      // Segment AABB mapped to cell range (clamped to grid)
      const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - bounds.minX) / cellSize));
      const c1 = Math.min(gridWidth - 1, Math.floor((Math.max(a.x, b.x) - bounds.minX) / cellSize));
      const r0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - bounds.minZ) / cellSize));
      const r1 = Math.min(gridHeight - 1, Math.floor((Math.max(a.z, b.z) - bounds.minZ) / cellSize));

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          cells[r * gridWidth + c].push(seg);
        }
      }

      segmentCount++;
    }
  }

  return { cellSize, bounds, gridWidth, gridHeight, cells, segmentCount };
}

// ---------------------------------------------------------------------------
// Radius query
// ---------------------------------------------------------------------------

/**
 * Find all polyline segments within a given radius of a query point.
 *
 * Collects candidate segments from grid cells overlapping the query circle's
 * bounding box, deduplicates (segments may span multiple cells), computes
 * precise distances, and returns results sorted by ascending distance.
 *
 * @param {{cellSize: number, bounds: Object, gridWidth: number, gridHeight: number, cells: Array}} index
 *   Index from createPolylineIndex
 * @param {number} x - Query point X
 * @param {number} z - Query point Z
 * @param {number} radius - Search radius in world units
 * @returns {Array<{segment: Object, distance: number, t: number, closest: {x: number, z: number}}>}
 *   Results sorted by ascending distance. Each result contains:
 *   - segment: the Segment object (polylineId, segmentIndex, p0, p1, attrStart, attrEnd)
 *   - distance: perpendicular distance to segment
 *   - t: parameter along segment (0 = p0, 1 = p1)
 *   - closest: nearest point on the segment {x, z}
 */
export function queryNearbySegments(index, x, z, radius) {
  const { cells, gridWidth, gridHeight, cellSize, bounds } = index;

  // Cell range covering the query circle's bounding box
  const c0 = Math.max(0, Math.floor((x - radius - bounds.minX) / cellSize));
  const c1 = Math.min(gridWidth - 1, Math.floor((x + radius - bounds.minX) / cellSize));
  const r0 = Math.max(0, Math.floor((z - radius - bounds.minZ) / cellSize));
  const r1 = Math.min(gridHeight - 1, Math.floor((z + radius - bounds.minZ) / cellSize));

  // Collect unique candidates via Set (reference equality deduplicates
  // segments that appear in multiple cells)
  const seen = new Set();
  const candidates = [];

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const bucket = cells[r * gridWidth + c];
      for (let i = 0; i < bucket.length; i++) {
        const seg = bucket[i];
        if (!seen.has(seg)) {
          seen.add(seg);
          candidates.push(seg);
        }
      }
    }
  }

  // Compute precise distances, filter by radius, build results
  const results = [];

  for (let i = 0; i < candidates.length; i++) {
    const seg = candidates[i];
    const { distance, t } = pointToSegmentDistance(
      x, z, seg.p0.x, seg.p0.z, seg.p1.x, seg.p1.z
    );

    if (distance <= radius) {
      results.push({
        segment: seg,
        distance,
        t,
        closest: {
          x: seg.p0.x + t * (seg.p1.x - seg.p0.x),
          z: seg.p0.z + t * (seg.p1.z - seg.p0.z)
        }
      });
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results;
}
