/**
 * Flow grid for hydrology simulation
 * Uses D8 algorithm for flow direction calculation
 */

import { sampleElevation } from './elevation.js';

// D8 direction encoding: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW, 255=sink
export const D8_DIRECTIONS = [
  { dx: 0, dz: -1 },  // 0: N
  { dx: 1, dz: -1 },  // 1: NE
  { dx: 1, dz: 0 },   // 2: E
  { dx: 1, dz: 1 },   // 3: SE
  { dx: 0, dz: 1 },   // 4: S
  { dx: -1, dz: 1 },  // 5: SW
  { dx: -1, dz: 0 },  // 6: W
  { dx: -1, dz: -1 }  // 7: NW
];

// Distance for diagonal vs cardinal directions
const D8_DISTANCES = [
  1,           // N
  Math.SQRT2,  // NE
  1,           // E
  Math.SQRT2,  // SE
  1,           // S
  Math.SQRT2,  // SW
  1,           // W
  Math.SQRT2   // NW
];

const SINK_DIRECTION = 255;

/**
 * Create an empty flow grid
 * @param {Object} bounds - {minX, maxX, minZ, maxZ}
 * @param {number} resolution - Cell size in world units
 * @returns {Object} FlowGrid structure
 */
export function createFlowGrid(bounds, resolution) {
  const width = Math.ceil((bounds.maxX - bounds.minX) / resolution);
  const height = Math.ceil((bounds.maxZ - bounds.minZ) / resolution);
  const cellCount = width * height;

  return {
    bounds,
    resolution,
    width,
    height,
    elevation: new Float32Array(cellCount),
    flowDirection: new Uint8Array(cellCount).fill(SINK_DIRECTION),
    accumulation: new Float32Array(cellCount)
  };
}

/**
 * Get world coordinates for a grid cell
 * @param {Object} grid - FlowGrid
 * @param {number} cellX - Cell X index
 * @param {number} cellZ - Cell Z index
 * @returns {{x: number, z: number}} World coordinates
 */
export function cellToWorld(grid, cellX, cellZ) {
  return {
    x: grid.bounds.minX + (cellX + 0.5) * grid.resolution,
    z: grid.bounds.minZ + (cellZ + 0.5) * grid.resolution
  };
}

/**
 * Get cell indices for world coordinates
 * @param {Object} grid - FlowGrid
 * @param {number} x - World X
 * @param {number} z - World Z
 * @returns {{cellX: number, cellZ: number}} Cell indices
 */
export function worldToCell(grid, x, z) {
  return {
    cellX: Math.floor((x - grid.bounds.minX) / grid.resolution),
    cellZ: Math.floor((z - grid.bounds.minZ) / grid.resolution)
  };
}

/**
 * Get flat array index from cell coordinates
 */
export function cellIndex(grid, cellX, cellZ) {
  return cellZ * grid.width + cellX;
}

/**
 * Get cell coordinates from flat array index
 */
export function indexToCell(grid, idx) {
  return {
    cellX: idx % grid.width,
    cellZ: Math.floor(idx / grid.width)
  };
}

/**
 * Check if cell coordinates are within grid bounds
 */
export function isValidCell(grid, cellX, cellZ) {
  return cellX >= 0 && cellX < grid.width && cellZ >= 0 && cellZ < grid.height;
}

/**
 * Sample elevations from world into grid
 * @param {Object} world - World object
 * @param {Object} grid - FlowGrid to fill
 * @param {Object} options - Sampling options
 * @param {boolean} options.includeNoise - Include noise in elevation
 * @param {boolean} options.multiridge - Enable multiridge blending
 */
export function sampleElevationsToGrid(world, grid, options = {}) {
  const { includeNoise = true, multiridge = false } = options;

  for (let cellZ = 0; cellZ < grid.height; cellZ++) {
    for (let cellX = 0; cellX < grid.width; cellX++) {
      const { x, z } = cellToWorld(grid, cellX, cellZ);
      const idx = cellIndex(grid, cellX, cellZ);

      grid.elevation[idx] = sampleElevation(world, x, z, {
        includeNoise,
        multiridge
      });
    }
  }
}

/**
 * Compute D8 flow directions for all cells
 * Each cell flows to the neighbor with the steepest downhill slope
 * @param {Object} grid - FlowGrid with elevation filled
 */
export function computeFlowDirections(grid) {
  for (let cellZ = 0; cellZ < grid.height; cellZ++) {
    for (let cellX = 0; cellX < grid.width; cellX++) {
      const idx = cellIndex(grid, cellX, cellZ);
      const elevation = grid.elevation[idx];

      let steepestDir = SINK_DIRECTION;
      let steepestSlope = 0;

      // Check all 8 neighbors
      for (let dir = 0; dir < 8; dir++) {
        const { dx, dz } = D8_DIRECTIONS[dir];
        const nx = cellX + dx;
        const nz = cellZ + dz;

        if (!isValidCell(grid, nx, nz)) continue;

        const neighborIdx = cellIndex(grid, nx, nz);
        const neighborElevation = grid.elevation[neighborIdx];

        // Compute slope (positive = downhill)
        const distance = D8_DISTANCES[dir] * grid.resolution;
        const slope = (elevation - neighborElevation) / distance;

        if (slope > steepestSlope) {
          steepestSlope = slope;
          steepestDir = dir;
        }
      }

      grid.flowDirection[idx] = steepestDir;
    }
  }

  // Handle flat areas - route to nearest lower cell using BFS
  resolveFlatAreas(grid);
}

/**
 * Resolve flow direction for flat areas using BFS to nearest lower cell
 * @param {Object} grid - FlowGrid with initial flow directions
 */
function resolveFlatAreas(grid) {
  const cellCount = grid.width * grid.height;
  const resolved = new Uint8Array(cellCount);

  // Find all sink cells (potential flat areas or true sinks)
  const sinkCells = [];
  for (let i = 0; i < cellCount; i++) {
    if (grid.flowDirection[i] === SINK_DIRECTION) {
      sinkCells.push(i);
    } else {
      resolved[i] = 1;
    }
  }

  // For each sink, try to find a path to a lower cell using BFS
  for (const sinkIdx of sinkCells) {
    if (resolved[sinkIdx]) continue;

    const sinkElevation = grid.elevation[sinkIdx];
    const { cellX: startX, cellZ: startZ } = indexToCell(grid, sinkIdx);

    // BFS to find nearest cell that flows downhill
    const queue = [{ cellX: startX, cellZ: startZ, dist: 0, fromDir: -1 }];
    const visited = new Set([sinkIdx]);
    let foundPath = false;

    while (queue.length > 0 && !foundPath) {
      const { cellX, cellZ, fromDir } = queue.shift();
      const idx = cellIndex(grid, cellX, cellZ);

      // Check if this cell has a valid outflow (not sink, or flows to lower elevation)
      if (grid.flowDirection[idx] !== SINK_DIRECTION || grid.elevation[idx] < sinkElevation) {
        // Found a valid drain - trace back and set directions
        if (fromDir !== -1) {
          // Set the sink cell to flow toward this path
          // We need the reverse direction
          const reverseDir = (fromDir + 4) % 8;
          grid.flowDirection[sinkIdx] = reverseDir;
          resolved[sinkIdx] = 1;
          foundPath = true;
        }
        break;
      }

      // Explore neighbors at same or lower elevation
      for (let dir = 0; dir < 8; dir++) {
        const { dx, dz } = D8_DIRECTIONS[dir];
        const nx = cellX + dx;
        const nz = cellZ + dz;

        if (!isValidCell(grid, nx, nz)) continue;

        const neighborIdx = cellIndex(grid, nx, nz);
        if (visited.has(neighborIdx)) continue;

        const neighborElevation = grid.elevation[neighborIdx];
        if (neighborElevation <= sinkElevation + 0.0001) {
          visited.add(neighborIdx);
          queue.push({ cellX: nx, cellZ: nz, dist: queue.length, fromDir: dir });
        }
      }
    }

    // If no path found, this is a true sink (depression)
    // Mark as resolved even if still sink - it's a potential lake location
    resolved[sinkIdx] = 1;
  }
}

/**
 * Compute flow accumulation for all cells
 * Each cell's accumulation = 1 + sum of upstream cells' accumulation
 * @param {Object} grid - FlowGrid with flow directions computed
 */
export function computeFlowAccumulation(grid) {
  const cellCount = grid.width * grid.height;
  const computed = new Uint8Array(cellCount);

  // Initialize all cells with 1 (representing rainfall on that cell)
  grid.accumulation.fill(1);

  /**
   * Recursively compute accumulation for a cell
   * Returns the total accumulation at this cell
   */
  function computeCell(idx) {
    if (computed[idx]) return grid.accumulation[idx];
    computed[idx] = 1;

    const { cellX, cellZ } = indexToCell(grid, idx);

    // Find all cells that flow INTO this cell
    for (let dir = 0; dir < 8; dir++) {
      const { dx, dz } = D8_DIRECTIONS[dir];
      const nx = cellX + dx;
      const nz = cellZ + dz;

      if (!isValidCell(grid, nx, nz)) continue;

      const neighborIdx = cellIndex(grid, nx, nz);
      const neighborDir = grid.flowDirection[neighborIdx];

      // Check if neighbor flows to this cell
      // Neighbor flows to us if its direction is the opposite of our offset to it
      const expectedDir = (dir + 4) % 8;
      if (neighborDir === expectedDir) {
        grid.accumulation[idx] += computeCell(neighborIdx);
      }
    }

    return grid.accumulation[idx];
  }

  // Compute accumulation for all cells
  for (let i = 0; i < cellCount; i++) {
    computeCell(i);
  }
}

/**
 * Get the neighbor cell index in the flow direction
 * @param {Object} grid - FlowGrid
 * @param {number} idx - Current cell index
 * @returns {number|null} Downstream cell index or null if sink/edge
 */
export function getDownstreamCell(grid, idx) {
  const dir = grid.flowDirection[idx];
  if (dir === SINK_DIRECTION) return null;

  const { cellX, cellZ } = indexToCell(grid, idx);
  const { dx, dz } = D8_DIRECTIONS[dir];
  const nx = cellX + dx;
  const nz = cellZ + dz;

  if (!isValidCell(grid, nx, nz)) return null;

  return cellIndex(grid, nx, nz);
}

// Sea level constant (rivers only form above this elevation)
const SEA_LEVEL = 0.1;

/**
 * Find all cells above a flow accumulation threshold
 * Only includes cells above sea level (rivers don't form in the ocean)
 * @param {Object} grid - FlowGrid with accumulation computed
 * @param {number} threshold - Minimum accumulation to be considered a river
 * @returns {Array<number>} Array of cell indices sorted by accumulation (descending)
 */
export function findHighFlowCells(grid, threshold) {
  const cells = [];
  const cellCount = grid.width * grid.height;

  for (let i = 0; i < cellCount; i++) {
    // Only include cells above sea level with sufficient flow
    if (grid.accumulation[i] >= threshold && grid.elevation[i] > SEA_LEVEL) {
      cells.push(i);
    }
  }

  // Sort by accumulation descending (process main rivers first)
  cells.sort((a, b) => grid.accumulation[b] - grid.accumulation[a]);

  return cells;
}

/**
 * Find all sink cells (potential lake locations)
 * @param {Object} grid - FlowGrid
 * @returns {Array<number>} Array of sink cell indices
 */
export function findSinkCells(grid) {
  const sinks = [];
  const cellCount = grid.width * grid.height;

  for (let i = 0; i < cellCount; i++) {
    if (grid.flowDirection[i] === SINK_DIRECTION) {
      sinks.push(i);
    }
  }

  return sinks;
}

// Export constant for external use
export { SINK_DIRECTION };
