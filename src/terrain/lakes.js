/**
 * Lake detection, filling, and boundary extraction
 */

import {
  indexToCell,
  cellToWorld,
  cellIndex,
  isValidCell,
  SINK_DIRECTION,
  D8_DIRECTIONS
} from './flowgrid.js';
import { extractContours } from '../geometry/contour.js';
import { sampleElevation } from './elevation.js';

// Minimum lake area to consider (in grid cells)
const MIN_LAKE_CELLS = 3;

/**
 * Detect potential lake locations from flow grid sinks
 * @param {Object} flowGrid - Flow grid with directions computed
 * @param {number} minArea - Minimum area for auto-detected lakes (world units squared)
 * @returns {Array} Array of potential lake objects
 */
export function detectPotentialLakes(flowGrid, minArea = 0.001) {
  const cellCount = flowGrid.width * flowGrid.height;
  const visited = new Uint8Array(cellCount);
  const lakes = [];

  // Find all sink cells and group them into connected components
  for (let i = 0; i < cellCount; i++) {
    if (visited[i]) continue;
    if (flowGrid.flowDirection[i] !== SINK_DIRECTION) continue;

    // Found a sink - flood fill to find connected sinks
    const component = floodFillSinks(flowGrid, i, visited);

    if (component.length < MIN_LAKE_CELLS) continue;

    // Compute center and bounds of lake region
    let sumX = 0, sumZ = 0;
    let minElev = Infinity;

    for (const idx of component) {
      const { cellX, cellZ } = indexToCell(flowGrid, idx);
      const { x, z } = cellToWorld(flowGrid, cellX, cellZ);
      sumX += x;
      sumZ += z;
      minElev = Math.min(minElev, flowGrid.elevation[idx]);
    }

    const centerX = sumX / component.length;
    const centerZ = sumZ / component.length;
    const cellArea = flowGrid.resolution * flowGrid.resolution;
    const area = component.length * cellArea;

    if (area < minArea) continue;

    lakes.push({
      id: `lake_auto_${lakes.length}`,
      x: centerX,
      z: centerZ,
      waterLevel: minElev,
      spillElevation: null,
      spillPoint: null,
      outflowRiverId: null,
      area,
      boundary: [],
      origin: 'auto',
      endorheic: true, // Will be updated after fill computation
      sinkCells: component // Keep for fill computation
    });
  }

  return lakes;
}

/**
 * Flood fill to find connected sink cells
 * @param {Object} flowGrid - Flow grid
 * @param {number} startIdx - Starting cell index
 * @param {Uint8Array} visited - Visited array
 * @returns {Array} Array of connected sink cell indices
 */
function floodFillSinks(flowGrid, startIdx, visited) {
  const component = [];
  const queue = [startIdx];

  while (queue.length > 0) {
    const idx = queue.shift();
    if (visited[idx]) continue;
    if (flowGrid.flowDirection[idx] !== SINK_DIRECTION) continue;

    visited[idx] = 1;
    component.push(idx);

    // Check all 8 neighbors
    const { cellX, cellZ } = indexToCell(flowGrid, idx);
    for (const { dx, dz } of D8_DIRECTIONS) {
      const nx = cellX + dx;
      const nz = cellZ + dz;
      if (!isValidCell(flowGrid, nx, nz)) continue;

      const neighborIdx = cellIndex(flowGrid, nx, nz);
      if (!visited[neighborIdx] && flowGrid.flowDirection[neighborIdx] === SINK_DIRECTION) {
        queue.push(neighborIdx);
      }
    }
  }

  return component;
}

/**
 * Compute lake fill level and spill point
 * Simulates water filling the depression until it overflows
 * @param {Object} flowGrid - Flow grid
 * @param {Object} lake - Lake object with sinkCells
 */
export function computeLakeFill(flowGrid, lake) {
  if (!lake.sinkCells || lake.sinkCells.length === 0) return;

  // Find the minimum elevation in the sink region
  let minElev = Infinity;
  for (const idx of lake.sinkCells) {
    minElev = Math.min(minElev, flowGrid.elevation[idx]);
  }

  // Find all cells that could be part of the lake (at or below potential spill)
  // Start from sink cells and expand outward
  const lakeCells = new Set(lake.sinkCells);
  const boundary = new Set();

  // Find boundary cells (non-sink neighbors of sink cells)
  for (const idx of lake.sinkCells) {
    const { cellX, cellZ } = indexToCell(flowGrid, idx);
    for (const { dx, dz } of D8_DIRECTIONS) {
      const nx = cellX + dx;
      const nz = cellZ + dz;
      if (!isValidCell(flowGrid, nx, nz)) continue;

      const neighborIdx = cellIndex(flowGrid, nx, nz);
      if (!lakeCells.has(neighborIdx)) {
        boundary.add(neighborIdx);
      }
    }
  }

  // Find the spill point (lowest point on boundary)
  let spillIdx = -1;
  let spillElev = Infinity;

  for (const idx of boundary) {
    const elev = flowGrid.elevation[idx];
    if (elev < spillElev) {
      spillElev = elev;
      spillIdx = idx;
    }
  }

  // The water level is the spill elevation
  // (water fills up to the lowest point on the rim)
  lake.waterLevel = spillElev;
  lake.spillElevation = spillElev;

  if (spillIdx >= 0) {
    const { cellX, cellZ } = indexToCell(flowGrid, spillIdx);
    const { x, z } = cellToWorld(flowGrid, cellX, cellZ);
    lake.spillPoint = { x, z };

    // Lake overflows if water level reaches spill point
    // In this case, it's not endorheic
    lake.endorheic = false;
  } else {
    // No spill point found - true endorheic basin
    lake.spillPoint = null;
    lake.endorheic = true;
  }

  // Recalculate area based on fill level
  // Count cells at or below water level within the basin
  const filledCells = [];
  const fillVisited = new Set();
  const fillQueue = [...lake.sinkCells];

  while (fillQueue.length > 0) {
    const idx = fillQueue.shift();
    if (fillVisited.has(idx)) continue;

    const elev = flowGrid.elevation[idx];
    if (elev > lake.waterLevel) continue;

    fillVisited.add(idx);
    filledCells.push(idx);

    const { cellX, cellZ } = indexToCell(flowGrid, idx);
    for (const { dx, dz } of D8_DIRECTIONS) {
      const nx = cellX + dx;
      const nz = cellZ + dz;
      if (!isValidCell(flowGrid, nx, nz)) continue;

      const neighborIdx = cellIndex(flowGrid, nx, nz);
      if (!fillVisited.has(neighborIdx)) {
        fillQueue.push(neighborIdx);
      }
    }
  }

  const cellArea = flowGrid.resolution * flowGrid.resolution;
  lake.area = filledCells.length * cellArea;
  lake.filledCells = filledCells;
}

/**
 * Extract lake boundary polygon using contour extraction
 * @param {Object} world - World object
 * @param {Object} lake - Lake with waterLevel set
 * @returns {Array} Boundary polygon as [{x, z}, ...]
 */
export function extractLakeBoundary(world, lake) {
  if (!lake.waterLevel || lake.waterLevel <= 0) return [];

  // Use a small area around the lake center
  const radius = Math.sqrt(lake.area) * 2 + 0.1;
  const bounds = {
    minX: lake.x - radius,
    maxX: lake.x + radius,
    minZ: lake.z - radius,
    maxZ: lake.z + radius
  };

  // Resolution for contour extraction
  const resolution = 0.01;

  // Create sample function for contour extraction
  const sampleFn = (x, z) => sampleElevation(world, x, z, { includeNoise: true });

  // Extract contour at water level
  const contours = extractContours(sampleFn, lake.waterLevel, bounds, resolution);

  // Find the contour closest to the lake center
  let bestContour = [];
  let bestDist = Infinity;

  for (const contour of contours) {
    if (contour.length < 3) continue;

    // Check distance from lake center to any point on contour
    for (const point of contour) {
      const dist = Math.sqrt(
        Math.pow(point.x - lake.x, 2) + Math.pow(point.z - lake.z, 2)
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestContour = contour;
      }
    }
  }

  return bestContour;
}

/**
 * Classify whether a lake is endorheic (no outflow)
 * @param {Object} lake - Lake object
 * @param {Array} rivers - Array of rivers
 * @returns {boolean} True if endorheic
 */
export function classifyLakeAsEndorheic(lake, rivers) {
  // Check if any river originates from this lake
  for (const river of rivers) {
    if (river.sourceLakeId === lake.id) {
      return false;
    }
  }

  // Check if lake has a spill point with outflow
  if (lake.spillPoint && lake.outflowRiverId) {
    return false;
  }

  return true;
}

/**
 * Create a manual lake
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {Object} options - Lake options
 * @returns {Object} Lake object
 */
export function createManualLake(x, z, options = {}) {
  return {
    id: options.id || `lake_manual_${Date.now()}`,
    x,
    z,
    waterLevel: options.waterLevel ?? 0.15,
    spillElevation: null,
    spillPoint: null,
    outflowRiverId: null,
    area: options.area ?? 0.01,
    boundary: [],
    origin: 'manual',
    endorheic: true
  };
}

/**
 * Find lakes that a river terminates in
 * @param {Object} river - River object
 * @param {Array} lakes - Array of lakes
 * @returns {Object|null} Lake the river terminates in, or null
 */
export function findTerminatingLake(river, lakes) {
  if (river.vertices.length === 0) return null;

  const lastVertex = river.vertices[river.vertices.length - 1];

  for (const lake of lakes) {
    // Check if last vertex is within lake boundary
    if (lake.boundary && lake.boundary.length > 0) {
      if (pointInPolygon(lastVertex.x, lastVertex.z, lake.boundary)) {
        return lake;
      }
    }

    // Fallback: check distance from lake center
    const dist = Math.sqrt(
      Math.pow(lastVertex.x - lake.x, 2) + Math.pow(lastVertex.z - lake.z, 2)
    );
    const lakeRadius = Math.sqrt(lake.area / Math.PI);
    if (dist < lakeRadius * 1.5) {
      return lake;
    }
  }

  return null;
}

/**
 * Simple point-in-polygon test using ray casting
 * @param {number} x - Point X
 * @param {number} z - Point Z
 * @param {Array} polygon - Polygon vertices [{x, z}, ...]
 * @returns {boolean} True if point is inside polygon
 */
function pointInPolygon(x, z, polygon) {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, zi = polygon[i].z;
    const xj = polygon[j].x, zj = polygon[j].z;

    if (((zi > z) !== (zj > z)) &&
        (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}
