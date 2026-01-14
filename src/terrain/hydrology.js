/**
 * Main hydrology module
 * Handles river tracing and overall hydrology generation
 */

import { deriveSeed, seededRandom } from '../core/seeds.js';
import { createSimplexNoise } from '../core/noise.js';
import {
  createFlowGrid,
  sampleElevationsToGrid,
  computeFlowDirections,
  computeFlowAccumulation,
  findHighFlowCells,
  getDownstreamCell,
  cellToWorld,
  worldToCell,
  cellIndex,
  indexToCell,
  isValidCell,
  SINK_DIRECTION
} from './flowgrid.js';
import { detectWaterSources, mergeNearbySources } from './watersources.js';
import { detectPotentialLakes, computeLakeFill, extractLakeBoundary, classifyLakeAsEndorheic } from './lakes.js';

// Sea level constant (from elevation.js)
export const SEA_LEVEL = 0.1;

// Default hydrology configuration
export const DEFAULT_HYDROLOGY_CONFIG = {
  multiridge: false,        // Enable multi-spine watershed interactions
  autoDetect: true,         // Auto-suggest sources and lakes
  carveEnabled: true,       // Rivers modify elevation
  carveFactor: 0.02,        // Max carve depth per unit flow
  riverThreshold: 50,       // Min accumulation to become river
  lakeMinArea: 0.001,       // Min area for auto-detected lakes
  gridResolution: 0.01,     // Flow grid cell size
  baseRiverWidth: 0.005,    // Base river width at threshold flow
  riverWidthScale: 1.0      // River width multiplier
};

/**
 * Generate hydrology for a world
 * @param {Object} world - World object
 * @param {Object} options - Generation options
 * @returns {Object} Hydrology data {rivers, lakes, waterSources, flowGrid}
 */
export function generateHydrology(world, options = {}) {
  const config = { ...DEFAULT_HYDROLOGY_CONFIG, ...world.hydrologyConfig, ...options };
  const bounds = options.bounds || { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const seed = deriveSeed(world.seed, 'hydrology');
  const rng = seededRandom(seed);

  // Step 1: Create and populate flow grid
  const flowGrid = createFlowGrid(bounds, config.gridResolution);
  sampleElevationsToGrid(world, flowGrid, {
    includeNoise: true,
    multiridge: config.multiridge
  });

  // Step 2: Compute flow directions and accumulation
  computeFlowDirections(flowGrid);
  computeFlowAccumulation(flowGrid);

  // Step 3: Detect water sources
  let waterSources = world.waterSources || [];
  if (config.autoDetect) {
    const autoSources = detectWaterSources(world, flowGrid, { seed: deriveSeed(seed, 'sources') });
    waterSources = mergeNearbySources([...waterSources, ...autoSources], config.gridResolution * 3);
  }

  // Step 4: Trace rivers ONLY from water sources (not from high-flow cells)
  // This ensures we get exactly one river per source
  const rivers = [];

  // Create meander noise function for organic river paths
  const meanderSeed = deriveSeed(seed, 'meander');
  const meanderNoise = createSimplexNoise(meanderSeed);

  for (const source of waterSources) {
    if (source.enabled === false) continue;

    const river = traceRiverFromPoint(flowGrid, source.x, source.z, config, `river_${source.id}`);
    if (river && river.vertices.length >= 2) {
      river.sourceId = source.id;
      // Apply meandering to make rivers organic
      applyMeandering(river, meanderNoise, config);
      rivers.push(river);
    }
  }

  // Step 5: Detect lakes
  let lakes = world.lakes?.filter(l => l.origin === 'manual') || [];
  if (config.autoDetect) {
    const autoLakes = detectPotentialLakes(flowGrid, config.lakeMinArea);
    for (const lake of autoLakes) {
      computeLakeFill(flowGrid, lake);
      lake.boundary = extractLakeBoundary(world, lake);
    }
    lakes = [...lakes, ...autoLakes];
  }

  // Step 6: Handle lake overflow - spawn outflow rivers
  for (const lake of lakes) {
    if (lake.spillPoint && !lake.endorheic) {
      const outflowRiver = traceRiverFromPoint(
        flowGrid,
        lake.spillPoint.x,
        lake.spillPoint.z,
        config,
        `lake_${lake.id}_outflow`
      );
      if (outflowRiver) {
        outflowRiver.sourceLakeId = lake.id;
        lake.outflowRiverId = outflowRiver.id;
        rivers.push(outflowRiver);
      }
    }

    // Classify lake as endorheic if no outflow
    lake.endorheic = classifyLakeAsEndorheic(lake, rivers);
  }

  // Step 7: Handle river confluences - merge tributaries
  mergeRiverConfluences(rivers, flowGrid);

  return {
    rivers,
    lakes,
    waterSources,
    flowGrid
  };
}

/**
 * Trace a single river starting from a cell
 * @param {Object} flowGrid - Flow grid
 * @param {number} startIdx - Starting cell index
 * @param {Object} config - Hydrology configuration
 * @param {number} riverId - River ID number
 * @returns {Object|null} River object or null
 */
function traceRiverFromCell(flowGrid, startIdx, config, riverId) {
  const vertices = [];
  const visited = new Set();
  let currentIdx = startIdx;

  while (currentIdx !== null && !visited.has(currentIdx)) {
    visited.add(currentIdx);

    const { cellX, cellZ } = indexToCell(flowGrid, currentIdx);
    const { x, z } = cellToWorld(flowGrid, cellX, cellZ);
    const elevation = flowGrid.elevation[currentIdx];
    const flow = flowGrid.accumulation[currentIdx];

    // Compute width from flow
    const width = computeRiverWidth(flow, config);

    // Compute carve depth
    const carveDepth = config.carveEnabled
      ? computeCarveDepth(flow, elevation, config)
      : 0;

    vertices.push({ x, z, elevation, flow, width, carveDepth });

    // Stop if we've reached sea level
    if (elevation <= SEA_LEVEL) break;

    // Follow flow direction
    currentIdx = getDownstreamCell(flowGrid, currentIdx);
  }

  if (vertices.length < 2) return null;

  return {
    id: `river_${riverId}`,
    sourceId: null,
    vertices,
    tributaryIds: [],
    termination: 'coast',
    terminatingLakeId: null
  };
}

/**
 * Trace a river from a specific world point (for lake overflow)
 * @param {Object} flowGrid - Flow grid
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {Object} config - Hydrology configuration
 * @param {string} id - River ID
 * @returns {Object|null} River object or null
 */
function traceRiverFromPoint(flowGrid, x, z, config, id) {
  const { cellX, cellZ } = worldToCell(flowGrid, x, z);
  if (!isValidCell(flowGrid, cellX, cellZ)) return null;

  const startIdx = cellIndex(flowGrid, cellX, cellZ);
  const river = traceRiverFromCell(flowGrid, startIdx, config, id);

  if (river) {
    river.id = id;
  }

  return river;
}

/**
 * Compute river width from flow accumulation
 * @param {number} flow - Flow accumulation value
 * @param {Object} config - Hydrology configuration
 * @returns {number} River width in world units
 */
function computeRiverWidth(flow, config) {
  const { riverThreshold, baseRiverWidth, riverWidthScale } = config;
  return baseRiverWidth * Math.sqrt(flow / riverThreshold) * riverWidthScale;
}

/**
 * Compute how deep the river carves into terrain
 * @param {number} flow - Flow accumulation value
 * @param {number} elevation - Current elevation
 * @param {Object} config - Hydrology configuration
 * @returns {number} Carve depth (positive value)
 */
function computeCarveDepth(flow, elevation, config) {
  const { carveFactor, riverThreshold } = config;
  const normalizedFlow = flow / riverThreshold;
  const maxCarve = elevation - SEA_LEVEL - 0.01;
  return Math.min(normalizedFlow * carveFactor, Math.max(0, maxCarve));
}

/**
 * Merge river confluences - when tributaries join main rivers
 * Updates flow values downstream of merge points
 * @param {Array} rivers - Array of river objects
 * @param {Object} flowGrid - Flow grid
 */
function mergeRiverConfluences(rivers, flowGrid) {
  // Build spatial index of river segments
  const cellToRiver = new Map();

  for (let i = 0; i < rivers.length; i++) {
    const river = rivers[i];
    for (const vertex of river.vertices) {
      const { cellX, cellZ } = worldToCell(flowGrid, vertex.x, vertex.z);
      if (isValidCell(flowGrid, cellX, cellZ)) {
        const idx = cellIndex(flowGrid, cellX, cellZ);
        if (!cellToRiver.has(idx)) {
          cellToRiver.set(idx, []);
        }
        cellToRiver.get(idx).push({ riverIdx: i, vertex });
      }
    }
  }

  // Find cells where multiple rivers meet
  for (const [cellIdx, riverData] of cellToRiver) {
    if (riverData.length < 2) continue;

    // Sort by flow (highest = main river)
    riverData.sort((a, b) => b.vertex.flow - a.vertex.flow);

    const mainRiver = rivers[riverData[0].riverIdx];

    // Mark other rivers as tributaries
    for (let i = 1; i < riverData.length; i++) {
      const tributaryRiver = rivers[riverData[i].riverIdx];
      if (!mainRiver.tributaryIds.includes(tributaryRiver.id)) {
        mainRiver.tributaryIds.push(tributaryRiver.id);
      }
    }
  }
}

/**
 * Apply meandering displacement to a river for organic appearance
 * Displaces vertices perpendicular to flow direction using noise
 * @param {Object} river - River object with vertices
 * @param {Function} noise - Simplex noise function
 * @param {Object} config - Hydrology config
 */
function applyMeandering(river, noise, config) {
  const vertices = river.vertices;
  if (vertices.length < 3) return;

  // Meander amplitude scales with river width (wider rivers meander more)
  const baseAmplitude = config.gridResolution * 3;
  // Meander frequency - how often the river curves
  const frequency = 15;

  for (let i = 1; i < vertices.length - 1; i++) {
    const v = vertices[i];
    const prev = vertices[i - 1];
    const next = vertices[i + 1];

    // Compute flow direction (tangent)
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.0001) continue;

    // Perpendicular direction (normal)
    const nx = -dz / len;
    const nz = dx / len;

    // Sample noise at vertex position - use position along river for coherent curves
    const t = i / vertices.length;
    const noiseVal = noise(v.x * frequency, v.z * frequency);

    // Amplitude increases with river width (wider = more meandering)
    // But decreases near source (steeper terrain = straighter)
    const widthFactor = Math.sqrt(v.width / config.baseRiverWidth);
    const positionFactor = Math.min(1, t * 3); // Ramp up from source
    const amplitude = baseAmplitude * widthFactor * positionFactor;

    // Displace perpendicular to flow
    v.x += nx * noiseVal * amplitude;
    v.z += nz * noiseVal * amplitude;
  }
}

/**
 * Simplify river path using Douglas-Peucker algorithm
 * @param {Array} vertices - River vertices
 * @param {number} epsilon - Simplification threshold
 * @returns {Array} Simplified vertices
 */
export function simplifyRiverPath(vertices, epsilon = 0.005) {
  if (vertices.length < 3) return vertices;

  // Find point with maximum distance from line between first and last
  let maxDist = 0;
  let maxIdx = 0;

  const first = vertices[0];
  const last = vertices[vertices.length - 1];

  for (let i = 1; i < vertices.length - 1; i++) {
    const dist = perpendicularDistance(vertices[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  // If max distance exceeds threshold, recursively simplify
  if (maxDist > epsilon) {
    const left = simplifyRiverPath(vertices.slice(0, maxIdx + 1), epsilon);
    const right = simplifyRiverPath(vertices.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  // Otherwise, return just the endpoints
  return [first, last];
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dz = lineEnd.z - lineStart.z;
  const lineLengthSq = dx * dx + dz * dz;

  if (lineLengthSq === 0) {
    // Line is a point
    const pdx = point.x - lineStart.x;
    const pdz = point.z - lineStart.z;
    return Math.sqrt(pdx * pdx + pdz * pdz);
  }

  // Project point onto line
  const t = Math.max(0, Math.min(1,
    ((point.x - lineStart.x) * dx + (point.z - lineStart.z) * dz) / lineLengthSq
  ));

  const projX = lineStart.x + t * dx;
  const projZ = lineStart.z + t * dz;

  const distX = point.x - projX;
  const distZ = point.z - projZ;

  return Math.sqrt(distX * distX + distZ * distZ);
}

/**
 * Find the nearest point on a river to a given world position
 * @param {Object} river - River object
 * @param {number} x - World X
 * @param {number} z - World Z
 * @returns {{distance: number, width: number, carveDepth: number, t: number}} Nearest point info
 */
export function findNearestRiverPoint(river, x, z) {
  let minDist = Infinity;
  let bestWidth = 0;
  let bestCarveDepth = 0;
  let bestT = 0;

  for (let i = 0; i < river.vertices.length - 1; i++) {
    const v0 = river.vertices[i];
    const v1 = river.vertices[i + 1];

    // Find closest point on segment
    const dx = v1.x - v0.x;
    const dz = v1.z - v0.z;
    const segLengthSq = dx * dx + dz * dz;

    let t = 0;
    if (segLengthSq > 0) {
      t = Math.max(0, Math.min(1,
        ((x - v0.x) * dx + (z - v0.z) * dz) / segLengthSq
      ));
    }

    const closestX = v0.x + t * dx;
    const closestZ = v0.z + t * dz;

    const distX = x - closestX;
    const distZ = z - closestZ;
    const dist = Math.sqrt(distX * distX + distZ * distZ);

    if (dist < minDist) {
      minDist = dist;
      // Interpolate width and carve depth
      bestWidth = v0.width + t * (v1.width - v0.width);
      bestCarveDepth = v0.carveDepth + t * (v1.carveDepth - v0.carveDepth);
      bestT = (i + t) / (river.vertices.length - 1);
    }
  }

  return {
    distance: minDist,
    width: bestWidth,
    carveDepth: bestCarveDepth,
    t: bestT
  };
}
