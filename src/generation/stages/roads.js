/**
 * Stage 8: Road network generation
 *
 * Connects settlements with terrain-aware roads. Produces road polylines
 * with classified segments (normal / bridge / tunnel), embankment heights,
 * and a distance field for downstream chunk queries.
 */

import { deriveSeed, seededRandom } from '../../core/seeds.js';
import { distance, clamp } from '../../core/math.js';
import { buildConnectivityGraph } from '../roads/connectivity.js';
import { findPath } from '../roads/pathfinding.js';

// ---------------------------------------------------------------------------
// Road type configuration
// ---------------------------------------------------------------------------

const ROAD_CONFIGS = {
  highway: { width: 0.007, maxSlope: 0.6,  bridgeCostMult: 1.5, tunnelCostMult: 2.0 },
  road:    { width: 0.005, maxSlope: 1.0,  bridgeCostMult: 2.0, tunnelCostMult: 3.0 },
  path:    { width: 0.003, maxSlope: 1.8,  bridgeCostMult: 4.0, tunnelCostMult: 5.0 },
};

// Bridge / tunnel detection
const RIVER_CROSS_THRESHOLD = 0.008;  // SDF below this = on/in river
const MAX_BRIDGE_SPAN = 0.06;         // max bridge length in world units
const TUNNEL_LOOKAHEAD = 10;
const TUNNEL_MIN_RIDGE = 0.03;
const TUNNEL_MAX_WIDTH = 30;
const TUNNEL_COST_RATIO = 0.7;

// Embankment
const EMBANKMENT_HEIGHT = 0.003;      // road sits this far above terrain (normalized)

// ---------------------------------------------------------------------------
// Segment classification
// ---------------------------------------------------------------------------

/**
 * Classify road waypoints into segments: normal, bridge, or tunnel.
 * Bridges are limited to MAX_BRIDGE_SPAN; longer crossings are treated as normal.
 */
function classifySegments(waypoints, elevation, riverSDF, roadType) {
  const { width, height, bounds } = elevation;
  const cellW = (bounds.maxX - bounds.minX) / width;
  const config = ROAD_CONFIGS[roadType];

  function worldToIdx(x, z) {
    const c = clamp(Math.round((x - bounds.minX) / cellW), 0, width - 1);
    const r = clamp(Math.round((z - bounds.minZ) / cellW), 0, height - 1);
    return r * width + c;
  }

  // -- Bridge detection: find river crossing ranges and check span length --
  const bridgeRanges = [];
  let bridgeStart = -1;

  for (let i = 0; i < waypoints.length; i++) {
    const idx = worldToIdx(waypoints[i].x, waypoints[i].z);
    const rd = riverSDF ? riverSDF[idx] : Infinity;

    if (rd < RIVER_CROSS_THRESHOLD) {
      if (bridgeStart === -1) bridgeStart = i;
    } else {
      if (bridgeStart !== -1) {
        // Check span length
        const span = distance(
          waypoints[bridgeStart].x, waypoints[bridgeStart].z,
          waypoints[i - 1].x, waypoints[i - 1].z,
        );
        if (span <= MAX_BRIDGE_SPAN) {
          bridgeRanges.push({ start: bridgeStart, end: i - 1, span });
        }
        bridgeStart = -1;
      }
    }
  }
  if (bridgeStart !== -1) {
    const span = distance(
      waypoints[bridgeStart].x, waypoints[bridgeStart].z,
      waypoints[waypoints.length - 1].x, waypoints[waypoints.length - 1].z,
    );
    if (span <= MAX_BRIDGE_SPAN) {
      bridgeRanges.push({ start: bridgeStart, end: waypoints.length - 1, span });
    }
  }

  // -- Tunnel detection: look for narrow ridges --
  const tunnelRanges = [];

  for (let i = 0; i < waypoints.length - TUNNEL_LOOKAHEAD; i++) {
    // Skip if overlaps bridge
    let hasBridge = false;
    for (const br of bridgeRanges) {
      if (i <= br.end && i + TUNNEL_LOOKAHEAD >= br.start) { hasBridge = true; break; }
    }
    if (hasBridge) continue;

    const startElev = waypoints[i].elevation;
    const endElev = waypoints[Math.min(i + TUNNEL_LOOKAHEAD, waypoints.length - 1)].elevation;
    const lineElev = (startElev + endElev) / 2;
    let peakElev = 0;
    let peakIdx = i;

    for (let j = i + 1; j < Math.min(i + TUNNEL_LOOKAHEAD, waypoints.length); j++) {
      if (waypoints[j].elevation > peakElev) {
        peakElev = waypoints[j].elevation;
        peakIdx = j;
      }
    }

    const ridgeHeight = peakElev - lineElev;
    const ridgeWidth = peakIdx - i;

    if (ridgeHeight > TUNNEL_MIN_RIDGE && ridgeWidth < TUNNEL_MAX_WIDTH) {
      const climbDist = ridgeHeight / config.maxSlope;
      const endIdx = Math.min(i + TUNNEL_LOOKAHEAD, waypoints.length - 1);
      const tunnelDist = distance(
        waypoints[i].x, waypoints[i].z,
        waypoints[endIdx].x, waypoints[endIdx].z,
      );
      const tunnelCost = tunnelDist * config.tunnelCostMult;

      if (tunnelCost < climbDist * TUNNEL_COST_RATIO) {
        tunnelRanges.push({
          start: i, end: endIdx,
          ridgeMaxElev: peakElev, length: tunnelDist,
        });
        i = endIdx;
      }
    }
  }

  // -- Build classification per waypoint --
  const classification = new Array(waypoints.length).fill('normal');
  for (const br of bridgeRanges) {
    for (let i = br.start; i <= br.end; i++) classification[i] = 'bridge';
  }
  for (const tr of tunnelRanges) {
    for (let i = tr.start; i <= tr.end; i++) classification[i] = 'tunnel';
  }

  // -- Merge into segment runs --
  const segments = [];
  let runType = classification[0];
  let runStart = 0;

  for (let i = 1; i <= waypoints.length; i++) {
    const t = i < waypoints.length ? classification[i] : null;
    if (t !== runType) {
      const seg = { type: runType, startIdx: runStart, endIdx: i - 1, bridgeData: null, tunnelData: null };

      if (runType === 'bridge') {
        const br = bridgeRanges.find(r => r.start >= runStart && r.start <= i - 1);
        seg.bridgeData = { spanLength: br ? br.span : 0 };
      }
      if (runType === 'tunnel') {
        const tr = tunnelRanges.find(r => r.start >= runStart && r.start <= i - 1);
        if (tr) seg.tunnelData = { ridgeMaxElev: tr.ridgeMaxElev, length: tr.length };
      }

      segments.push(seg);
      runType = t;
      runStart = i;
    }
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Switchback generation
// ---------------------------------------------------------------------------

function insertSwitchbacks(waypoints, elevation, roadType) {
  const config = ROAD_CONFIGS[roadType];
  const { width, height, data, bounds } = elevation;
  const cellW = (bounds.maxX - bounds.minX) / width;
  const switchbackOffset = 20 * cellW;

  function sampleElev(x, z) {
    const c = clamp(Math.round((x - bounds.minX) / cellW), 0, width - 1);
    const r = clamp(Math.round((z - bounds.minZ) / cellW), 0, height - 1);
    return data[r * width + c];
  }

  const result = [waypoints[0]];

  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const dx = curr.x - prev.x;
    const dz = curr.z - prev.z;
    const segDist = Math.sqrt(dx * dx + dz * dz);

    if (segDist < 1e-8) {
      result.push(curr);
      continue;
    }

    const gradient = Math.abs(curr.elevation - prev.elevation) / segDist;

    if (gradient > config.maxSlope * 1.5) {
      // Very steep — insert zigzag waypoints
      const numSwitches = Math.min(6, Math.ceil(gradient / config.maxSlope));
      const perpX = -dz / segDist;
      const perpZ = dx / segDist;

      for (let s = 1; s <= numSwitches; s++) {
        const t = s / (numSwitches + 1);
        const baseX = prev.x + dx * t;
        const baseZ = prev.z + dz * t;
        const sign = (s % 2 === 0) ? 1 : -1;
        const wx = baseX + perpX * switchbackOffset * sign;
        const wz = baseZ + perpZ * switchbackOffset * sign;

        const cx = clamp(wx, bounds.minX + cellW, bounds.maxX - cellW);
        const cz = clamp(wz, bounds.minZ + cellW, bounds.maxZ - cellW);
        result.push({ x: cx, z: cz, elevation: sampleElev(cx, cz) });
      }
    }

    result.push(curr);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Embankment computation
// ---------------------------------------------------------------------------

/**
 * For each waypoint, compute the desired road surface elevation.
 * Road sits EMBANKMENT_HEIGHT above the terrain, or follows the terrain
 * if terrain is already above the road baseline.
 */
function computeEmbankments(waypoints, elevation) {
  const { width, height, data, bounds } = elevation;
  const cellW = (bounds.maxX - bounds.minX) / width;

  for (const wp of waypoints) {
    const c = clamp(Math.round((wp.x - bounds.minX) / cellW), 0, width - 1);
    const r = clamp(Math.round((wp.z - bounds.minZ) / cellW), 0, height - 1);
    const terrainElev = data[r * width + c];
    // Road surface is the higher of: terrain + embankment, or waypoint elevation + embankment
    wp.roadElevation = Math.max(terrainElev, wp.elevation) + EMBANKMENT_HEIGHT;
    wp.embankmentHeight = wp.roadElevation - terrainElev;
  }
}

// ---------------------------------------------------------------------------
// Road merging: snap nearby waypoints to existing road corridors
// ---------------------------------------------------------------------------

/**
 * Snap intermediate waypoints to nearby existing road waypoints.
 * This merges parallel roads that travel together into shared corridors.
 * Start and end waypoints (settlement positions) are never snapped.
 */
function snapToExistingRoads(waypoints, snapTargets, snapDist) {
  if (snapTargets.length === 0 || waypoints.length < 3) return waypoints;

  const result = [waypoints[0]]; // Keep start (settlement position)

  for (let i = 1; i < waypoints.length - 1; i++) {
    const wp = waypoints[i];
    let bestDist = snapDist;
    let bestTarget = null;

    for (const target of snapTargets) {
      const dx = wp.x - target.x;
      const dz = wp.z - target.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestDist) {
        bestDist = d;
        bestTarget = target;
      }
    }

    if (bestTarget) {
      result.push({ x: bestTarget.x, z: bestTarget.z, elevation: bestTarget.elevation });
    } else {
      result.push(wp);
    }
  }

  result.push(waypoints[waypoints.length - 1]); // Keep end (settlement position)

  // Remove consecutive duplicates from snapping
  const deduped = [result[0]];
  for (let i = 1; i < result.length; i++) {
    const prev = deduped[deduped.length - 1];
    const dx = result[i].x - prev.x;
    const dz = result[i].z - prev.z;
    if (dx * dx + dz * dz > 1e-12) {
      deduped.push(result[i]);
    }
  }

  return deduped.length >= 2 ? deduped : waypoints;
}

// ---------------------------------------------------------------------------
// Path resampling for terrain conformance
// ---------------------------------------------------------------------------

/**
 * Resample a waypoint path at regular intervals, sampling terrain elevation
 * at each intermediate point. This ensures 3D ribbons follow terrain closely
 * rather than interpolating linearly between sparse simplified waypoints.
 */
function resamplePath(waypoints, elevation, maxSpacing) {
  if (waypoints.length < 2) return waypoints;

  const { width, height, data, bounds } = elevation;
  const cellW = (bounds.maxX - bounds.minX) / width;

  const result = [waypoints[0]];

  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const dx = curr.x - prev.x;
    const dz = curr.z - prev.z;
    const segDist = Math.sqrt(dx * dx + dz * dz);

    if (segDist > maxSpacing) {
      const steps = Math.ceil(segDist / maxSpacing);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const x = prev.x + dx * t;
        const z = prev.z + dz * t;
        const c = clamp(Math.round((x - bounds.minX) / cellW), 0, width - 1);
        const r = clamp(Math.round((z - bounds.minZ) / cellW), 0, height - 1);
        result.push({ x, z, elevation: data[r * width + c] });
      }
    }

    result.push(curr);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Road SDF baking
// ---------------------------------------------------------------------------

function chamfer(mask, width, height, cs) {
  const n = width * height;
  const d = new Float32Array(n);
  const I = 1e6, dg = cs * Math.SQRT2;
  for (let i = 0; i < n; i++) d[i] = mask[i] ? 0 : I;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      if (c > 0) d[i] = Math.min(d[i], d[i - 1] + cs);
      if (r > 0) {
        d[i] = Math.min(d[i], d[(r - 1) * width + c] + cs);
        if (c > 0) d[i] = Math.min(d[i], d[(r - 1) * width + c - 1] + dg);
        if (c < width - 1) d[i] = Math.min(d[i], d[(r - 1) * width + c + 1] + dg);
      }
    }
  }
  for (let r = height - 1; r >= 0; r--) {
    for (let c = width - 1; c >= 0; c--) {
      const i = r * width + c;
      if (c < width - 1) d[i] = Math.min(d[i], d[i + 1] + cs);
      if (r < height - 1) {
        d[i] = Math.min(d[i], d[(r + 1) * width + c] + cs);
        if (c < width - 1) d[i] = Math.min(d[i], d[(r + 1) * width + c + 1] + dg);
        if (c > 0) d[i] = Math.min(d[i], d[(r + 1) * width + c - 1] + dg);
      }
    }
  }
  return d;
}

function rasterizeSegment(mask, ax, az, bx, bz, halfWidth, width, height, bounds, cellW) {
  const steps = Math.ceil(distance(ax, az, bx, bz) / (cellW * 0.5)) + 1;

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const wx = ax + (bx - ax) * t;
    const wz = az + (bz - az) * t;
    const cc = Math.round((wx - bounds.minX) / cellW);
    const cr = Math.round((wz - bounds.minZ) / cellW);

    for (let dr = -halfWidth; dr <= halfWidth; dr++) {
      for (let dc = -halfWidth; dc <= halfWidth; dc++) {
        const r = cr + dr, c = cc + dc;
        if (r >= 0 && r < height && c >= 0 && c < width) {
          mask[r * width + c] = 1;
        }
      }
    }
  }
}

function computeRoadSDF(roads, width, height, bounds, cellW) {
  const n = width * height;
  const mask = new Uint8Array(n);

  for (const road of roads) {
    const halfWidthCells = Math.max(1, Math.ceil((road.width / 2) / cellW));
    for (let i = 0; i < road.waypoints.length - 1; i++) {
      const a = road.waypoints[i];
      const b = road.waypoints[i + 1];
      rasterizeSegment(mask, a.x, a.z, b.x, b.z, halfWidthCells, width, height, bounds, cellW);
    }
  }

  return chamfer(mask, width, height, cellW);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate road network connecting all settlements.
 *
 * @param {Object} params      - { seaLevel, ... }
 * @param {Object} elevation   - { width, height, data: Float32Array, bounds }
 * @param {Object} hydrology   - { rivers, lakes, riverSDF, lakeSDF, width, height }
 * @param {Object} settlements - { settlements: Array, coastSDF: Float32Array }
 * @param {number} seed
 * @returns {{ roads: Array, roadSDF: Float32Array, sdfWidth: number, sdfHeight: number }}
 */
export function generateRoads(params, elevation, hydrology, settlements, seed) {
  const { width, height, bounds } = elevation;
  const cellW = (bounds.maxX - bounds.minX) / width;
  const { seaLevel } = params;
  const rng = seededRandom(deriveSeed(seed, 'roads'));

  const setts = settlements?.settlements || [];
  if (setts.length < 2) {
    return {
      roads: [],
      roadSDF: new Float32Array(width * height),
      sdfWidth: width,
      sdfHeight: height,
    };
  }

  // 1. Build connectivity graph (MST + shortcuts)
  const edges = buildConnectivityGraph(setts, rng);

  // 2. Sort: highways first for road sharing discount
  const typePriority = { highway: 0, road: 1, path: 2 };
  edges.sort((a, b) => typePriority[a.type] - typePriority[b.type]);

  // 3. Pathfind each edge
  const roads = [];
  const roadMask = new Uint8Array(width * height);
  const snapTargets = [];
  const SNAP_DIST = cellW * 5;
  const RESAMPLE_SPACING = cellW * 3;

  for (const edge of edges) {
    const fromSettlement = setts[edge.fromIdx];
    const toSettlement = setts[edge.toIdx];
    const config = ROAD_CONFIGS[edge.type];

    const pathResult = findPath({
      start: fromSettlement.position,
      end: toSettlement.position,
      elevation,
      riverSDF: hydrology.riverSDF,
      lakeSDF: hydrology.lakeSDF,
      roadType: edge.type,
      roadMask,
      seaLevel,
    });

    let { waypoints, underwaterFraction } = pathResult;

    // Skip roads with significant underwater segments (e.g. scattered archipelagos)
    if (underwaterFraction > 0.2) continue;

    // 4. Snap waypoints to existing road corridors (merges nearby parallel roads)
    waypoints = snapToExistingRoads(waypoints, snapTargets, SNAP_DIST);

    // 5. Resample for terrain conformance (adds intermediate points with terrain elevation)
    waypoints = resamplePath(waypoints, elevation, RESAMPLE_SPACING);

    // 6. Compute embankment heights
    computeEmbankments(waypoints, elevation);

    // 7. Classify segments (bridge / tunnel / normal)
    const segments = classifySegments(waypoints, elevation, hydrology.riverSDF, edge.type);

    // 8. Build road object
    const road = {
      id: `road_${roads.length}`,
      type: edge.type,
      from: edge.from,
      to: edge.to,
      width: config.width,
      waypoints,
      segments,
    };

    roads.push(road);

    // 9. Collect snap targets for subsequent road merging
    for (const wp of waypoints) {
      snapTargets.push(wp);
    }

    // 10. Update road mask — wide corridor to attract subsequent roads into shared paths
    const ATTRACTION_CELLS = { highway: 8, road: 6, path: 4 };
    const halfWidthCells = ATTRACTION_CELLS[edge.type] || 5;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i];
      const b = waypoints[i + 1];
      rasterizeSegment(roadMask, a.x, a.z, b.x, b.z, halfWidthCells, width, height, bounds, cellW);
    }
  }

  // 9. Bake final road SDF
  const roadSDF = computeRoadSDF(roads, width, height, bounds, cellW);

  return { roads, roadSDF, sdfWidth: width, sdfHeight: height };
}
