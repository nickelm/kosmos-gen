/**
 * Water source detection and management
 * Handles automatic detection of water sources and manual source management
 */

import { seededRandom, deriveSeed } from '../core/seeds.js';
import {
  cellToWorld,
  indexToCell,
  isValidCell,
  cellIndex
} from './flowgrid.js';
import { getHalfCellConfig, getHalfCells } from './spine.js';

// Default flow rate for manual sources
const DEFAULT_FLOW_RATE = 0.5;

/**
 * Detect potential water sources automatically
 * @param {Object} world - World object
 * @param {Object} flowGrid - Flow grid with elevation and accumulation
 * @param {Object} options - Detection options
 * @returns {Array} Array of water source objects
 */
export function detectWaterSources(world, flowGrid, options = {}) {
  const { seed = 12345 } = options;
  const rng = seededRandom(seed);
  const sources = [];

  // Strategy 1: High-elevation points near spine vertices
  const spineVertexSources = detectSpineVertexSources(world, flowGrid, rng);
  sources.push(...spineVertexSources);

  // Strategy 2: Bowl-profile half-cell centers
  const bowlSources = detectBowlProfileSources(world, flowGrid, rng);
  sources.push(...bowlSources);

  // Strategy 3: Flow convergence points (high accumulation at high elevation)
  const convergenceSources = detectConvergenceSources(flowGrid, rng);
  sources.push(...convergenceSources);

  // Assign unique IDs
  for (let i = 0; i < sources.length; i++) {
    sources[i].id = `source_auto_${i}`;
  }

  return sources;
}

/**
 * Detect sources near spine vertices (mountain peaks)
 * @param {Object} world - World object
 * @param {Object} flowGrid - Flow grid
 * @param {Function} rng - Random number generator
 * @returns {Array} Water sources
 */
function detectSpineVertexSources(world, flowGrid, rng) {
  const sources = [];
  const spines = world.template?.spines || [];
  const proximityThreshold = 0.1; // Distance from vertex to check

  for (const spine of spines) {
    for (const vertex of spine.vertices) {
      // Skip low-elevation vertices
      if (vertex.elevation < 0.4) continue;

      // Find the grid cell at this vertex
      const cellX = Math.floor((vertex.x - flowGrid.bounds.minX) / flowGrid.resolution);
      const cellZ = Math.floor((vertex.z - flowGrid.bounds.minZ) / flowGrid.resolution);

      if (!isValidCell(flowGrid, cellX, cellZ)) continue;

      // Check if this is a local maximum (higher than surrounding area)
      const idx = cellIndex(flowGrid, cellX, cellZ);
      const elevation = flowGrid.elevation[idx];

      // Only create source if elevation is high enough
      if (elevation < 0.35) continue;

      // Compute flow rate based on elevation
      const flowRate = computeFlowRate(elevation, 1, flowGrid);

      sources.push({
        id: '', // Will be assigned later
        x: vertex.x,
        z: vertex.z,
        flowRate,
        origin: 'auto',
        enabled: true,
        sourceType: 'spine_vertex'
      });
    }
  }

  return sources;
}

/**
 * Detect sources at bowl-profile half-cell centers
 * Bowl cells collect water and often have springs
 * @param {Object} world - World object
 * @param {Object} flowGrid - Flow grid
 * @param {Function} rng - Random number generator
 * @returns {Array} Water sources
 */
function detectBowlProfileSources(world, flowGrid, rng) {
  const sources = [];
  const spines = world.template?.spines || [];

  for (const spine of spines) {
    const halfCells = getHalfCells(spine);

    for (const hc of halfCells) {
      const config = getHalfCellConfig(world, hc.id);
      if (config?.profile !== 'bowl') continue;

      // Get cell center
      const { x, z } = hc.center || { x: 0, z: 0 };

      // Check elevation at this point
      const cellX = Math.floor((x - flowGrid.bounds.minX) / flowGrid.resolution);
      const cellZ = Math.floor((z - flowGrid.bounds.minZ) / flowGrid.resolution);

      if (!isValidCell(flowGrid, cellX, cellZ)) continue;

      const idx = cellIndex(flowGrid, cellX, cellZ);
      const elevation = flowGrid.elevation[idx];

      // Bowl cells at higher elevations make better sources
      if (elevation < 0.25) continue;

      const flowRate = computeFlowRate(elevation, 0.8, flowGrid);

      sources.push({
        id: '',
        x,
        z,
        flowRate,
        origin: 'auto',
        enabled: true,
        sourceType: 'bowl_cell'
      });
    }
  }

  return sources;
}

/**
 * Detect sources at flow convergence points
 * High accumulation at high elevation indicates good spring locations
 * @param {Object} flowGrid - Flow grid
 * @param {Function} rng - Random number generator
 * @returns {Array} Water sources
 */
function detectConvergenceSources(flowGrid, rng) {
  const sources = [];
  const cellCount = flowGrid.width * flowGrid.height;

  // Find max elevation and accumulation for normalization
  let maxElev = 0;
  let maxAccum = 0;
  for (let i = 0; i < cellCount; i++) {
    maxElev = Math.max(maxElev, flowGrid.elevation[i]);
    maxAccum = Math.max(maxAccum, flowGrid.accumulation[i]);
  }

  if (maxElev === 0 || maxAccum === 0) return sources;

  // Look for cells with high accumulation at high elevation
  // These are natural spring locations
  const candidates = [];

  for (let i = 0; i < cellCount; i++) {
    const elevation = flowGrid.elevation[i];
    const accumulation = flowGrid.accumulation[i];

    // Normalize
    const normElev = elevation / maxElev;
    const normAccum = accumulation / maxAccum;

    // Score: want high elevation AND moderate accumulation
    // (very high accumulation means it's downstream, not a source)
    if (normElev > 0.4 && normAccum > 0.02 && normAccum < 0.3) {
      const score = normElev * 2 + normAccum;
      candidates.push({ idx: i, elevation, accumulation, score });
    }
  }

  // Sort by score and take top candidates (spaced apart)
  candidates.sort((a, b) => b.score - a.score);

  const usedCells = new Set();
  const minSpacing = 10; // Grid cells

  for (const candidate of candidates) {
    if (sources.length >= 5) break; // Limit convergence sources

    const { cellX, cellZ } = indexToCell(flowGrid, candidate.idx);

    // Check spacing from existing sources
    let tooClose = false;
    for (const usedIdx of usedCells) {
      const used = indexToCell(flowGrid, usedIdx);
      const dist = Math.sqrt(
        Math.pow(cellX - used.cellX, 2) + Math.pow(cellZ - used.cellZ, 2)
      );
      if (dist < minSpacing) {
        tooClose = true;
        break;
      }
    }

    if (tooClose) continue;

    usedCells.add(candidate.idx);

    const { x, z } = cellToWorld(flowGrid, cellX, cellZ);
    const flowRate = computeFlowRate(candidate.elevation, candidate.accumulation / maxAccum, flowGrid);

    sources.push({
      id: '',
      x,
      z,
      flowRate,
      origin: 'auto',
      enabled: true,
      sourceType: 'convergence'
    });
  }

  return sources;
}

/**
 * Compute flow rate for a water source
 * Based on elevation and catchment area
 * @param {number} elevation - Source elevation
 * @param {number} catchmentFactor - Relative catchment area (0-1)
 * @param {Object} flowGrid - Flow grid (for max elevation)
 * @returns {number} Flow rate (0.1 to 1.0)
 */
function computeFlowRate(elevation, catchmentFactor, flowGrid) {
  // Find max elevation in grid for normalization
  let maxElev = 0;
  for (let i = 0; i < flowGrid.elevation.length; i++) {
    maxElev = Math.max(maxElev, flowGrid.elevation[i]);
  }

  if (maxElev === 0) return DEFAULT_FLOW_RATE;

  // Formula: flowRate = baseRate * (elevation / maxElevation) * log(1 + catchmentArea)
  const baseRate = 0.3;
  const elevationFactor = elevation / maxElev;
  const catchmentLog = Math.log(1 + catchmentFactor * 10) / Math.log(11); // Normalize log

  const flowRate = baseRate * elevationFactor * (1 + catchmentLog);

  // Clamp to valid range
  return Math.min(1.0, Math.max(0.1, flowRate));
}

/**
 * Merge nearby water sources
 * @param {Array} sources - Array of water sources
 * @param {number} threshold - Merge distance threshold
 * @returns {Array} Merged sources
 */
export function mergeNearbySources(sources, threshold) {
  if (sources.length < 2) return sources;

  const merged = [];
  const used = new Set();

  // Sort by flow rate descending (keep higher flow sources)
  const sorted = [...sources].sort((a, b) => b.flowRate - a.flowRate);

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;

    const source = sorted[i];
    let totalFlow = source.flowRate;
    let count = 1;

    // Find nearby sources to merge
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;

      const other = sorted[j];
      const dist = Math.sqrt(
        Math.pow(source.x - other.x, 2) + Math.pow(source.z - other.z, 2)
      );

      if (dist < threshold) {
        used.add(j);
        totalFlow += other.flowRate;
        count++;
      }
    }

    // Keep the position of the highest-flow source, but increase flow
    merged.push({
      ...source,
      flowRate: Math.min(1.0, totalFlow / count + (count - 1) * 0.1)
    });
  }

  return merged;
}

/**
 * Filter sources by minimum elevation
 * @param {Array} sources - Array of water sources
 * @param {number} minElevation - Minimum elevation to keep
 * @param {Object} flowGrid - Flow grid for elevation lookup
 * @returns {Array} Filtered sources
 */
export function filterSourcesByElevation(sources, minElevation, flowGrid) {
  return sources.filter(source => {
    const cellX = Math.floor((source.x - flowGrid.bounds.minX) / flowGrid.resolution);
    const cellZ = Math.floor((source.z - flowGrid.bounds.minZ) / flowGrid.resolution);

    if (!isValidCell(flowGrid, cellX, cellZ)) return false;

    const idx = cellIndex(flowGrid, cellX, cellZ);
    return flowGrid.elevation[idx] >= minElevation;
  });
}

/**
 * Create a manual water source
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {Object} options - Source options
 * @returns {Object} Water source object
 */
export function createManualSource(x, z, options = {}) {
  return {
    id: options.id || `source_manual_${Date.now()}`,
    x,
    z,
    flowRate: options.flowRate ?? DEFAULT_FLOW_RATE,
    origin: 'manual',
    enabled: true,
    sourceType: 'manual'
  };
}
