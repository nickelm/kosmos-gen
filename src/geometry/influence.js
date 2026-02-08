/**
 * Influence field baking
 *
 * Generates pre-baked influence textures with smooth falloff from polylines,
 * replacing raw SDF grids with continuous 0.0-1.0 values encoded as 0-255.
 *
 * Uses a coarse segment grid for spatial acceleration: per-texel cost is
 * proportional to local segment density, not total segment count.
 */

import { pointToSegmentDistance, smoothstep } from '../core/math.js';
import { pointInPolygon } from './polygon.js';
import { isClosedLoop } from './contour.js';

// ---------------------------------------------------------------------------
// Segment grid acceleration structure
// ---------------------------------------------------------------------------

/**
 * Build a coarse spatial grid indexing polyline segments.
 * Each segment is inserted into every cell its axis-aligned bounding box overlaps.
 *
 * @param {Array<Array<{x: number, z: number}>>} polylines
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds
 * @param {number} cellSize - Grid cell size in world units
 * @returns {{ cells: Array<Array>, cols: number, rows: number, cellSize: number, bounds: Object }}
 */
function buildSegmentGrid(polylines, bounds, cellSize) {
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize));

  const cells = new Array(rows * cols);
  for (let i = 0; i < cells.length; i++) cells[i] = [];

  for (let pi = 0; pi < polylines.length; pi++) {
    const pl = polylines[pi];
    if (!pl || pl.length < 2) continue;

    for (let si = 0; si < pl.length - 1; si++) {
      const a = pl[si];
      const b = pl[si + 1];

      // Segment AABB mapped to cell range
      const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - bounds.minX) / cellSize));
      const c1 = Math.min(cols - 1, Math.floor((Math.max(a.x, b.x) - bounds.minX) / cellSize));
      const r0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - bounds.minZ) / cellSize));
      const r1 = Math.min(rows - 1, Math.floor((Math.max(a.z, b.z) - bounds.minZ) / cellSize));

      const seg = { ax: a.x, az: a.z, bx: b.x, bz: b.z };

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          cells[r * cols + c].push(seg);
        }
      }
    }
  }

  return { cells, cols, rows, cellSize, bounds };
}

/**
 * Find minimum distance from a point to any segment in the grid.
 * Searches the 3x3 cell neighborhood around the query point.
 *
 * Correctness guarantee: when cellSize >= searchRadius, any segment within
 * searchRadius of the query is in the 3x3 neighborhood because its nearest
 * point lies within one cell of the query, and the segment's AABB includes
 * that cell.
 *
 * @param {Object} grid - Grid from buildSegmentGrid
 * @param {number} px - Query X
 * @param {number} pz - Query Z
 * @returns {number} Minimum distance, or Infinity if no segments nearby
 */
function queryMinDistance(grid, px, pz) {
  const { cells, cols, rows, cellSize, bounds } = grid;

  const gc = Math.floor((px - bounds.minX) / cellSize);
  const gr = Math.floor((pz - bounds.minZ) / cellSize);

  let minDist = Infinity;

  for (let dr = -1; dr <= 1; dr++) {
    const r = gr + dr;
    if (r < 0 || r >= rows) continue;
    for (let dc = -1; dc <= 1; dc++) {
      const c = gc + dc;
      if (c < 0 || c >= cols) continue;

      const bucket = cells[r * cols + c];
      for (let i = 0; i < bucket.length; i++) {
        const seg = bucket[i];
        const { distance } = pointToSegmentDistance(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
        if (distance < minDist) {
          minDist = distance;
        }
      }
    }
  }

  return minDist;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Bake a smooth influence field from polylines.
 *
 * For each texel, computes the distance to the nearest polyline segment
 * and applies smoothstep falloff between outerRadius (influence = 0.0)
 * and innerRadius (influence = 1.0).
 *
 * @param {Array<Array<{x: number, z: number}>>} polylines
 * @param {Object} options
 * @param {number} [options.resolution=512] - Texture width and height in texels
 * @param {number} options.innerRadius - Distance at which influence = 1.0
 * @param {number} options.outerRadius - Distance at which influence = 0.0
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} [options.bounds]
 * @returns {Uint8Array} Values 0-255 representing influence 0.0-1.0, length = resolution^2
 */
export function bakeInfluenceField(polylines, options = {}) {
  const {
    resolution = 512,
    innerRadius = 0,
    outerRadius = 0,
    bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }
  } = options;

  const n = resolution * resolution;
  const output = new Uint8Array(n);

  // Early out: no polylines or zero influence range
  if (!polylines || polylines.length === 0 || outerRadius <= 0) {
    return output;
  }

  // Build acceleration grid.
  // cellSize >= outerRadius ensures 3x3 neighborhood covers the full search radius.
  // Cap at boundsSize/500 to prevent excessive grid dimensions for tiny radii.
  const boundsW = bounds.maxX - bounds.minX;
  const boundsH = bounds.maxZ - bounds.minZ;
  const cellSize = Math.max(outerRadius, Math.max(boundsW, boundsH) / 500);
  const grid = buildSegmentGrid(polylines, bounds, cellSize);

  const texelW = boundsW / resolution;
  const texelH = boundsH / resolution;

  for (let r = 0; r < resolution; r++) {
    const z = bounds.minZ + (r + 0.5) * texelH;
    for (let c = 0; c < resolution; c++) {
      const x = bounds.minX + (c + 0.5) * texelW;

      const dist = queryMinDistance(grid, x, z);

      if (dist >= outerRadius) continue; // output stays 0

      // smoothstep(outerRadius, innerRadius, dist) yields:
      //   0.0 at dist = outerRadius, 1.0 at dist <= innerRadius
      const influence = smoothstep(outerRadius, innerRadius, dist);
      output[r * resolution + c] = Math.round(influence * 255);
    }
  }

  return output;
}

/**
 * Bake a coastline influence field with signed distance encoding.
 *
 * Produces a texture where:
 *   0   = deep ocean (distance >= transitionWidth on ocean side)
 *   127 = shoreline  (distance = 0)
 *   255 = interior land (distance >= beachWidth on land side)
 *
 * Sign is determined by point-in-polygon tests against closed coastline
 * polylines: inside any closed polygon = land (positive distance),
 * outside = ocean (negative distance). Nested polygons toggle (handles holes).
 *
 * @param {Array<Array<{x: number, z: number}>>} coastlinePolylines
 * @param {Object} options
 * @param {number} [options.resolution=512] - Texture width and height in texels
 * @param {number} [options.beachWidth=0.02] - Land-side distance for full influence (255)
 * @param {number} [options.transitionWidth=0.05] - Ocean-side distance for zero influence (0)
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} [options.bounds]
 * @returns {Uint8Array} Values 0-255, length = resolution^2
 */
export function bakeCoastlineInfluence(coastlinePolylines, options = {}) {
  const {
    resolution = 512,
    beachWidth = 0.02,
    transitionWidth = 0.05,
    bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }
  } = options;

  const n = resolution * resolution;
  const output = new Uint8Array(n);

  if (!coastlinePolylines || coastlinePolylines.length === 0) {
    // No coastline: assume all land
    output.fill(255);
    return output;
  }

  // Closed polylines are used for the inside/outside (land/ocean) test
  const closedPolys = coastlinePolylines.filter(
    pl => pl.length >= 3 && isClosedLoop(pl)
  );

  // Build acceleration grid using the larger radius
  const maxRadius = Math.max(beachWidth, transitionWidth);
  const boundsW = bounds.maxX - bounds.minX;
  const boundsH = bounds.maxZ - bounds.minZ;
  const cellSize = Math.max(maxRadius || 0.01, Math.max(boundsW, boundsH) / 500);
  const grid = buildSegmentGrid(coastlinePolylines, bounds, cellSize);

  const texelW = boundsW / resolution;
  const texelH = boundsH / resolution;

  for (let r = 0; r < resolution; r++) {
    const z = bounds.minZ + (r + 0.5) * texelH;
    for (let c = 0; c < resolution; c++) {
      const x = bounds.minX + (c + 0.5) * texelW;

      // Unsigned distance to nearest coastline segment
      const dist = queryMinDistance(grid, x, z);

      // Determine sign: inside closed polygon(s) = land
      // Toggle for nested polygons to handle holes correctly
      let isLand = false;
      for (let i = 0; i < closedPolys.length; i++) {
        if (pointInPolygon(x, z, closedPolys[i])) {
          isLand = !isLand;
        }
      }

      const signedDist = isLand ? dist : -dist;

      // Map signed distance to 0-255 with 127 at the shoreline
      let value;
      if (signedDist <= -transitionWidth) {
        // Deep ocean
        value = 0;
      } else if (signedDist < 0) {
        // Ocean transition: [-transitionWidth, 0] -> [0, 127]
        const t = smoothstep(-transitionWidth, 0, signedDist);
        value = Math.round(t * 127);
      } else if (signedDist < beachWidth) {
        // Beach transition: [0, beachWidth] -> [127, 255]
        const t = smoothstep(0, beachWidth, signedDist);
        value = 127 + Math.round(t * 128);
      } else {
        // Interior land
        value = 255;
      }

      output[r * resolution + c] = value;
    }
  }

  return output;
}
