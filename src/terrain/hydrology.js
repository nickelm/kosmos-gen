/**
 * Main hydrology module
 * Handles river tracing and overall hydrology generation
 */

import { deriveSeed, seededRandom } from '../core/seeds.js';
import { createSimplexNoise } from '../core/noise.js';
import { smoothstep, lerp } from '../core/math.js';
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
import { D8_DIRECTIONS } from './flowgrid.js';

// Sea level constant (from elevation.js)
export const SEA_LEVEL = 0.1;

/**
 * Find connected sink cells starting from a given cell index
 * Used to determine lake extent at river termination points
 * @param {Object} flowGrid - Flow grid
 * @param {number} startIdx - Starting cell index
 * @returns {Array} Array of connected sink cell indices
 */
function findConnectedSinkCells(flowGrid, startIdx) {
  const visited = new Set();
  const result = [];
  const queue = [startIdx];

  while (queue.length > 0) {
    const idx = queue.shift();
    if (visited.has(idx)) continue;

    // Check if this cell is a sink or has very low slope
    if (flowGrid.flowDirection[idx] !== SINK_DIRECTION) {
      // Also include cells that flow into sinks (low accumulation neighbors)
      continue;
    }

    visited.add(idx);
    result.push(idx);

    // Check all 8 neighbors
    const { cellX, cellZ } = indexToCell(flowGrid, idx);
    for (const { dx, dz } of D8_DIRECTIONS) {
      const nx = cellX + dx;
      const nz = cellZ + dz;
      if (!isValidCell(flowGrid, nx, nz)) continue;

      const neighborIdx = cellIndex(flowGrid, nx, nz);
      if (!visited.has(neighborIdx)) {
        queue.push(neighborIdx);
      }
    }
  }

  // If no sink cells found, at least include the starting cell
  if (result.length === 0) {
    result.push(startIdx);
  }

  return result;
}

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
  riverWidthScale: 1.0,     // River width multiplier
  // Valley carving profile
  valleyWidthMultiplier: 6, // Valley extends to width * N from river center
  floodplainMultiplier: 3,  // Floodplain extends to width * N
  // Organic shoreline noise
  shoreNoiseFrequency: 40,  // Noise frequency for zone boundary jitter
  shoreNoiseAmplitude: 0.3, // Max jitter as fraction of zone width
  widthNoiseFrequency: 25,  // Noise frequency for width variation
  widthNoiseAmplitude: 0.2, // Max width variation fraction
  // Meander erosion
  meanderErosionStrength: 0.3,  // How much curvature increases carve depth
  meanderWideningStrength: 0.15 // How much curvature increases width
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

  // Track basins where rivers terminate (will become lakes)
  const basinLakes = [];

  for (const source of waterSources) {
    if (source.enabled === false) continue;

    // Pass source's flowRate to scale river width
    const river = traceRiverFromPoint(flowGrid, source.x, source.z, config, `river_${source.id}`, source.flowRate);
    if (river && river.vertices.length >= 2) {
      river.sourceId = source.id;
      river.flowRate = source.flowRate; // Store for reference
      // Apply meandering to make rivers organic
      applyMeandering(river, meanderNoise, config);
      // Enforce monotonically decreasing elevation
      enforceMonotonicElevation(river, world, config);
      // Compute curvature for meander-dependent effects
      computeRiverCurvatures(river);
      // Apply organic width variation
      applyWidthNoise(river, meanderNoise, config);
      rivers.push(river);

      // If river ends at a basin (not coast), create a lake there
      if (river.termination === 'basin' && river.sinkLocation) {
        const sink = river.sinkLocation;
        // Find sink cells around this location for lake fill computation
        const sinkCells = findConnectedSinkCells(flowGrid, sink.cellIdx);
        basinLakes.push({
          id: `lake_basin_${source.id}`,
          x: sink.x,
          z: sink.z,
          waterLevel: sink.elevation + 0.02, // Lake surface slightly above terrain
          origin: 'river_basin',
          inflowRiverId: river.id,
          cellIdx: sink.cellIdx,
          sinkCells: sinkCells,
          area: sinkCells.length * config.gridResolution * config.gridResolution
        });
      }
    }
  }

  // Step 5: Detect lakes (manual + auto-detected + basin lakes from rivers)
  let lakes = world.lakes?.filter(l => l.origin === 'manual') || [];

  // Add lakes created at river basin endpoints
  for (const basinLake of basinLakes) {
    computeLakeFill(flowGrid, basinLake);
    basinLake.boundary = extractLakeBoundary(world, basinLake);
    lakes.push(basinLake);
  }

  if (config.autoDetect) {
    const autoLakes = detectPotentialLakes(flowGrid, config.lakeMinArea);
    for (const lake of autoLakes) {
      computeLakeFill(flowGrid, lake);
      lake.boundary = extractLakeBoundary(world, lake);
    }
    lakes = [...lakes, ...autoLakes];
  }

  // Step 6: Handle lake overflow - spawn outflow rivers that continue to sea
  for (const lake of lakes) {
    if (lake.spillPoint && !lake.endorheic) {
      // Check if spillpoint is above sea level (otherwise lake drains to sea directly)
      if (lake.spillPoint.elevation > SEA_LEVEL) {
        const outflowRiver = traceRiverFromPoint(
          flowGrid,
          lake.spillPoint.x,
          lake.spillPoint.z,
          config,
          `lake_${lake.id}_outflow`
        );
        if (outflowRiver && outflowRiver.vertices.length >= 2) {
          outflowRiver.sourceLakeId = lake.id;
          lake.outflowRiverId = outflowRiver.id;
          applyMeandering(outflowRiver, meanderNoise, config);
          enforceMonotonicElevation(outflowRiver, world, config);
          computeRiverCurvatures(outflowRiver);
          applyWidthNoise(outflowRiver, meanderNoise, config);
          rivers.push(outflowRiver);

          // Link the original river to this lake
          const inflowRiver = rivers.find(r => r.id === lake.inflowRiverId);
          if (inflowRiver) {
            inflowRiver.terminatingLakeId = lake.id;
          }
        }
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
 * @param {number} flowRate - Source flow rate (0.1-1.0) to scale river width
 * @returns {Object|null} River object or null
 */
function traceRiverFromCell(flowGrid, startIdx, config, riverId, flowRate = 0.5) {
  const vertices = [];
  const visited = new Set();
  let currentIdx = startIdx;
  let termination = 'coast';
  let sinkLocation = null;
  let stepsWithoutProgress = 0;
  const maxSteps = flowGrid.width * flowGrid.height; // Prevent infinite loops

  while (currentIdx !== null && !visited.has(currentIdx) && vertices.length < maxSteps) {
    visited.add(currentIdx);

    const { cellX, cellZ } = indexToCell(flowGrid, currentIdx);
    const { x, z } = cellToWorld(flowGrid, cellX, cellZ);
    const elevation = flowGrid.elevation[currentIdx];
    const flow = flowGrid.accumulation[currentIdx];

    // Compute width from flow, scaled by source's flowRate
    const width = computeRiverWidth(flow, config, flowRate);

    // Compute carve depth
    const carveDepth = config.carveEnabled
      ? computeCarveDepth(flow, elevation, config)
      : 0;

    vertices.push({ x, z, elevation, flow, width, carveDepth });

    // Stop if we've reached sea level (river enters the ocean)
    if (elevation <= SEA_LEVEL) {
      termination = 'coast';
      break;
    }

    // Follow flow direction
    const nextIdx = getDownstreamCell(flowGrid, currentIdx);

    // If no downstream (sink or grid boundary), check if we should terminate
    if (nextIdx === null) {
      // Check if we're at a grid boundary - if so, this might be an edge case
      const atBoundary = cellX <= 0 || cellX >= flowGrid.width - 1 ||
                         cellZ <= 0 || cellZ >= flowGrid.height - 1;

      if (atBoundary && elevation <= SEA_LEVEL + 0.05) {
        // Close enough to coast at boundary, treat as reaching coast
        termination = 'coast';
      } else {
        // True basin/sink - will form a lake
        termination = 'basin';
        sinkLocation = { x, z, elevation, cellIdx: currentIdx };
      }
      break;
    }

    // Check for progress (elevation should generally decrease)
    const nextElevation = flowGrid.elevation[nextIdx];
    if (nextElevation >= elevation) {
      stepsWithoutProgress++;
      // If we've been flat for too long, we're in a depression
      if (stepsWithoutProgress > 50) {
        termination = 'basin';
        sinkLocation = { x, z, elevation, cellIdx: currentIdx };
        break;
      }
    } else {
      stepsWithoutProgress = 0;
    }

    currentIdx = nextIdx;
  }

  if (vertices.length < 2) return null;

  return {
    id: `river_${riverId}`,
    sourceId: null,
    vertices,
    tributaryIds: [],
    termination,
    terminatingLakeId: null,
    sinkLocation // Will be set if river ended at a basin
  };
}

/**
 * Trace a river from a specific world point (for lake overflow)
 * @param {Object} flowGrid - Flow grid
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {Object} config - Hydrology configuration
 * @param {string} id - River ID
 * @param {number} flowRate - Source flow rate (0.1-1.0) to scale river width
 * @returns {Object|null} River object or null
 */
function traceRiverFromPoint(flowGrid, x, z, config, id, flowRate = 0.5) {
  const { cellX, cellZ } = worldToCell(flowGrid, x, z);
  if (!isValidCell(flowGrid, cellX, cellZ)) return null;

  const startIdx = cellIndex(flowGrid, cellX, cellZ);
  const river = traceRiverFromCell(flowGrid, startIdx, config, id, flowRate);

  if (river) {
    river.id = id;
  }

  return river;
}

/**
 * Compute river width from flow accumulation
 * Width depends only on flow accumulation and the source's flowRate
 * @param {number} flow - Flow accumulation value
 * @param {Object} config - Hydrology configuration
 * @param {number} flowRate - Source flow rate (0.1-1.0) to scale width
 * @returns {number} River width in world units
 */
function computeRiverWidth(flow, config, flowRate = 0.5) {
  const { riverThreshold, baseRiverWidth } = config;
  // Width = base * sqrt(flow) * flowRate
  // flowRate acts as the per-river width multiplier (controlled via source)
  return baseRiverWidth * Math.sqrt(flow / riverThreshold) * flowRate * 2;
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
 * Enforce monotonically decreasing elevation along a river
 * Ensures water flows downhill continuously from source to terminus
 * @param {Object} river - River object with vertices
 * @param {Object} world - World object (used to look up lake water levels)
 * @param {Object} config - Hydrology configuration
 */
function enforceMonotonicElevation(river, world, config) {
  const vertices = river.vertices;
  if (vertices.length < 2) return;

  // Determine terminus target elevation
  let targetElev;
  if (river.termination === 'coast') {
    targetElev = SEA_LEVEL;
  } else if (river.terminatingLakeId) {
    const lake = (world.lakes || []).find(l => l.id === river.terminatingLakeId);
    targetElev = lake ? lake.waterLevel : vertices[vertices.length - 1].elevation;
  } else if (river.sinkLocation) {
    targetElev = river.sinkLocation.elevation;
  } else {
    targetElev = vertices[vertices.length - 1].elevation;
  }

  // Forward pass: clamp each vertex to be <= predecessor
  for (let i = 1; i < vertices.length; i++) {
    if (vertices[i].elevation > vertices[i - 1].elevation) {
      vertices[i].elevation = vertices[i - 1].elevation;
    }
  }

  // Smooth ramp to terminus over final portion of river
  // Compute cumulative arc-length from end
  const arcLengths = new Float64Array(vertices.length);
  arcLengths[vertices.length - 1] = 0;
  for (let i = vertices.length - 2; i >= 0; i--) {
    const dx = vertices[i + 1].x - vertices[i].x;
    const dz = vertices[i + 1].z - vertices[i].z;
    arcLengths[i] = arcLengths[i + 1] + Math.sqrt(dx * dx + dz * dz);
  }
  const totalLength = arcLengths[0];
  if (totalLength < 0.0001) return;

  // Blend toward target over the last 30% of river length
  const blendStart = totalLength * 0.3;
  for (let i = 0; i < vertices.length; i++) {
    const distToEnd = arcLengths[i];
    if (distToEnd < blendStart) {
      const t = smoothstep(0, blendStart, distToEnd);
      // t=0 at terminus, t=1 at blend start
      const blended = lerp(targetElev, vertices[i].elevation, t);
      vertices[i].elevation = Math.min(vertices[i].elevation, blended);
    }
  }

  // Final clamp: ensure last vertex reaches target
  vertices[vertices.length - 1].elevation = Math.min(
    vertices[vertices.length - 1].elevation,
    targetElev
  );

  // Second forward pass after blending to re-enforce monotonic
  for (let i = 1; i < vertices.length; i++) {
    if (vertices[i].elevation > vertices[i - 1].elevation) {
      vertices[i].elevation = vertices[i - 1].elevation;
    }
  }

  // Recompute carve depth for each vertex (depends on elevation)
  if (config.carveEnabled) {
    for (const v of vertices) {
      const normalizedFlow = v.flow / (config.riverThreshold || 50);
      const maxCarve = v.elevation - SEA_LEVEL - 0.01;
      v.carveDepth = Math.min(normalizedFlow * (config.carveFactor || 0.02), Math.max(0, maxCarve));
    }
  }
}

/**
 * Compute signed curvature at each river vertex
 * Positive = curves left, negative = curves right
 * @param {Object} river - River object with vertices
 */
function computeRiverCurvatures(river) {
  const vertices = river.vertices;
  if (vertices.length < 3) {
    for (const v of vertices) v.curvature = 0;
    return;
  }

  for (let i = 1; i < vertices.length - 1; i++) {
    const prev = vertices[i - 1];
    const curr = vertices[i];
    const next = vertices[i + 1];

    // Tangent vectors
    const t1x = curr.x - prev.x;
    const t1z = curr.z - prev.z;
    const t2x = next.x - curr.x;
    const t2z = next.z - curr.z;

    const len1 = Math.sqrt(t1x * t1x + t1z * t1z);
    const len2 = Math.sqrt(t2x * t2x + t2z * t2z);
    const segLen = (len1 + len2) / 2;

    if (segLen < 0.00001) {
      curr.curvature = 0;
      continue;
    }

    // Cross product z-component gives signed curvature direction
    const cross = (t1x / len1) * (t2z / len2) - (t1z / len1) * (t2x / len2);
    curr.curvature = Math.max(-500, Math.min(500, cross / segLen));
  }

  // Copy endpoint curvatures from neighbors
  vertices[0].curvature = vertices[1].curvature;
  vertices[vertices.length - 1].curvature = vertices[vertices.length - 2].curvature;
}

/**
 * Apply organic width variation using noise and curvature
 * Makes river edges irregular and meander bends asymmetric
 * @param {Object} river - River object with vertices (must have curvature computed)
 * @param {Function} noise - Simplex noise function
 * @param {Object} config - Hydrology configuration
 */
function applyWidthNoise(river, noise, config) {
  const vertices = river.vertices;
  const widthNoiseFreq = config.widthNoiseFrequency || 25;
  const widthNoiseAmp = config.widthNoiseAmplitude || 0.2;
  const meanderWiden = config.meanderWideningStrength || 0.15;
  const meanderDeepen = config.meanderErosionStrength || 0.3;

  for (const v of vertices) {
    // Low-frequency noise for organic width variation
    const n = noise(v.x * widthNoiseFreq, v.z * widthNoiseFreq);
    const widthJitter = 1.0 + n * widthNoiseAmp;

    // Curvature-dependent widening at meander bends
    const absCurv = Math.abs(v.curvature || 0);
    const curvatureBonus = 1.0 + Math.min(absCurv * 200, 3) * meanderWiden;

    v.width *= widthJitter * curvatureBonus;

    // Curvature-dependent deepening of carve depth
    v.carveDepth *= (1.0 + Math.min(absCurv * 200, 3) * meanderDeepen);
  }
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
 * Returns enriched info including curvature, tangent, and side for erosion effects
 * @param {Object} river - River object
 * @param {number} x - World X
 * @param {number} z - World Z
 * @returns {{distance: number, width: number, carveDepth: number, t: number, curvature: number, tangentX: number, tangentZ: number, side: number}} Nearest point info
 */
export function findNearestRiverPoint(river, x, z) {
  let minDist = Infinity;
  let bestWidth = 0;
  let bestCarveDepth = 0;
  let bestT = 0;
  let bestCurvature = 0;
  let bestTangentX = 0;
  let bestTangentZ = 1;
  let bestSide = 1;

  for (let i = 0; i < river.vertices.length - 1; i++) {
    const v0 = river.vertices[i];
    const v1 = river.vertices[i + 1];

    // Find closest point on segment
    const sdx = v1.x - v0.x;
    const sdz = v1.z - v0.z;
    const segLengthSq = sdx * sdx + sdz * sdz;

    let t = 0;
    if (segLengthSq > 0) {
      t = Math.max(0, Math.min(1,
        ((x - v0.x) * sdx + (z - v0.z) * sdz) / segLengthSq
      ));
    }

    const closestX = v0.x + t * sdx;
    const closestZ = v0.z + t * sdz;

    const distX = x - closestX;
    const distZ = z - closestZ;
    const dist = Math.sqrt(distX * distX + distZ * distZ);

    if (dist < minDist) {
      minDist = dist;
      // Interpolate width and carve depth
      bestWidth = v0.width + t * (v1.width - v0.width);
      bestCarveDepth = v0.carveDepth + t * (v1.carveDepth - v0.carveDepth);
      bestT = (i + t) / (river.vertices.length - 1);

      // Interpolate curvature
      const c0 = v0.curvature || 0;
      const c1 = v1.curvature || 0;
      bestCurvature = c0 + t * (c1 - c0);

      // Tangent direction (normalized segment direction)
      const segLen = Math.sqrt(segLengthSq);
      if (segLen > 0.00001) {
        bestTangentX = sdx / segLen;
        bestTangentZ = sdz / segLen;
      }

      // Side: which side of the river is the query point on
      // Cross product of tangent × (query - closest) gives signed side
      bestSide = (bestTangentX * distZ - bestTangentZ * distX) >= 0 ? 1 : -1;
    }
  }

  return {
    distance: minDist,
    width: bestWidth,
    carveDepth: bestCarveDepth,
    t: bestT,
    curvature: bestCurvature,
    tangentX: bestTangentX,
    tangentZ: bestTangentZ,
    side: bestSide
  };
}
