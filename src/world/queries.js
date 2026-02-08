/**
 * Hybrid Query API — Component 4 of the Hybrid Query System
 *
 * Provides terrain workers with a clean API for querying continental features
 * (coastline, rivers, roads) at any (x, z) world coordinate.
 *
 * Two-tier strategy per query:
 *   1. Fast rejection via pre-baked influence textures (O(1) grid lookup)
 *   2. Precise geometry via polyline spatial index (only when influence > 0)
 */

import { lerp, clamp } from '../core/math.js';
import { queryNearbySegments } from '../geometry/polyline-index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INFLUENCE_THRESHOLD = 2; // raw byte value; below this we skip vector queries

const ROAD_PRIORITY = {
  highway: 0,
  road: 1,
  trail: 2,
  path: 3
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Sample an influence texture at world coordinates.
 *
 * Derives bounds from the spatial index and resolution from the texture length.
 * Returns the raw byte value 0–255.
 *
 * @param {Uint8Array} texture - Influence field (resolution x resolution)
 * @param {Object} index - PolylineIndex (used for bounds)
 * @param {number} x - World X
 * @param {number} z - World Z
 * @returns {number} Raw texture value 0–255
 */
function sampleInfluenceTexture(texture, index, x, z) {
  const { bounds } = index;
  const resolution = Math.round(Math.sqrt(texture.length));

  const u = (x - bounds.minX) / (bounds.maxX - bounds.minX);
  const v = (z - bounds.minZ) / (bounds.maxZ - bounds.minZ);

  const col = clamp(Math.floor(u * resolution), 0, resolution - 1);
  const row = clamp(Math.floor(v * resolution), 0, resolution - 1);

  return texture[row * resolution + col];
}

/**
 * Interpolate a named attribute between segment start and end.
 *
 * @param {Object|null} attrStart
 * @param {Object|null} attrEnd
 * @param {number} t - Interpolation parameter [0, 1]
 * @param {string} key - Attribute name
 * @param {number} [fallback=0]
 * @returns {number}
 */
function lerpAttr(attrStart, attrEnd, t, key, fallback = 0) {
  const a = (attrStart && attrStart[key] !== undefined) ? attrStart[key] : fallback;
  const b = (attrEnd && attrEnd[key] !== undefined) ? attrEnd[key] : fallback;
  return lerp(a, b, t);
}

/**
 * Compute a safe search radius for spatial index queries.
 * Covers the full 3x3 cell neighborhood the index is designed for.
 *
 * @param {Object} index - PolylineIndex
 * @returns {number}
 */
function getSearchRadius(index) {
  return index.cellSize * 3;
}

/**
 * Get or lazily build a road lookup map from metadata.
 *
 * @param {Object} metadata - ContinentMetadata
 * @returns {Map<string, Object>}
 */
function getRoadLookup(metadata) {
  if (!metadata._roadLookup) {
    metadata._roadLookup = new Map();
    for (const road of metadata.roads) {
      metadata._roadLookup.set(road.id, road);
    }
  }
  return metadata._roadLookup;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query coastline influence and geometry at a world position.
 *
 * The influence value peaks at 1.0 on the shoreline and falls to 0.0 both
 * far out to sea and deep inland. Signed distance is negative on the ocean
 * side and positive on the land side.
 *
 * @param {Object} metadata - ContinentMetadata from createContinentMetadata
 * @param {number} x - World X
 * @param {number} z - World Z
 * @returns {{
 *   influence: number,
 *   distanceToShore: number,
 *   shoreNormal: {x: number, z: number},
 *   shoreElevation: number
 * }}
 */
export function queryCoastline(metadata, x, z) {
  const texture = metadata.coastlineInfluence;
  const index = metadata.coastlineIndex;

  // Guard: no coastline data
  if (!texture || texture.length === 0 || !index) {
    return { influence: 0, distanceToShore: Infinity, shoreNormal: { x: 0, z: 1 }, shoreElevation: 0 };
  }

  const raw = sampleInfluenceTexture(texture, index, x, z);

  // Influence peaks at the shoreline (raw = 127) and falls to 0 at extremes.
  //   raw   0 → deep ocean   → influence 0
  //   raw 127 → shoreline    → influence 1
  //   raw 255 → deep inland  → influence 0
  const influence = 1 - Math.abs(raw - 127) / 127;

  // Early out: far from any coastline
  if (raw <= INFLUENCE_THRESHOLD) {
    return { influence: 0, distanceToShore: -Infinity, shoreNormal: { x: 0, z: 1 }, shoreElevation: 0 };
  }
  if (raw >= 255 - INFLUENCE_THRESHOLD) {
    return { influence: 0, distanceToShore: Infinity, shoreNormal: { x: 0, z: 1 }, shoreElevation: 0 };
  }

  // Land/ocean determination from texture encoding
  const isLand = raw > 127;

  // Vector query for precise geometry
  const results = queryNearbySegments(index, x, z, getSearchRadius(index));

  if (results.length === 0) {
    // Texture says nearby but no segments found (resolution mismatch)
    return { influence, distanceToShore: isLand ? 0 : 0, shoreNormal: { x: 0, z: 1 }, shoreElevation: 0 };
  }

  const nearest = results[0];
  const seg = nearest.segment;
  const dist = nearest.distance;

  // Signed distance: positive = land, negative = ocean
  const distanceToShore = isLand ? dist : -dist;

  // Shore normal: direction toward land
  let nx, nz;
  if (dist > 1e-8) {
    // Vector from closest shore point toward query point
    nx = (x - nearest.closest.x) / dist;
    nz = (z - nearest.closest.z) / dist;

    // If query is on ocean side, this vector points away from land — flip it
    if (!isLand) {
      nx = -nx;
      nz = -nz;
    }
  } else {
    // Query is right on the coastline — use segment perpendicular
    const dx = seg.p1.x - seg.p0.x;
    const dz = seg.p1.z - seg.p0.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 1e-8) {
      nx = -dz / len;
      nz = dx / len;
    } else {
      nx = 0;
      nz = 1;
    }
  }

  // Interpolate shore elevation from segment attributes
  const shoreElevation = lerpAttr(seg.attrStart, seg.attrEnd, nearest.t, 'elevation');

  return {
    influence,
    distanceToShore,
    shoreNormal: { x: nx, z: nz },
    shoreElevation
  };
}

/**
 * Query river influence and geometry at a world position.
 *
 * Returns interpolated river properties (width, flow direction, elevation)
 * and determines which bank the point is on relative to the flow direction.
 *
 * @param {Object} metadata - ContinentMetadata
 * @param {number} x - World X
 * @param {number} z - World Z
 * @returns {{
 *   influence: number,
 *   distanceToCenter: number,
 *   width: number,
 *   flowDirection: {x: number, z: number},
 *   elevation: number,
 *   bankSide: "left"|"right"|null
 * }}
 */
export function queryRiver(metadata, x, z) {
  const texture = metadata.riverInfluence;
  const index = metadata.riverIndex;

  // Guard: no river data
  if (!texture || texture.length === 0 || !index) {
    return { influence: 0, distanceToCenter: Infinity, width: 0, flowDirection: { x: 0, z: 0 }, elevation: 0, bankSide: null };
  }

  const raw = sampleInfluenceTexture(texture, index, x, z);
  const influence = raw / 255;

  // Early out: no river influence
  if (raw <= INFLUENCE_THRESHOLD) {
    return { influence: 0, distanceToCenter: Infinity, width: 0, flowDirection: { x: 0, z: 0 }, elevation: 0, bankSide: null };
  }

  // Vector query for precise geometry
  const results = queryNearbySegments(index, x, z, getSearchRadius(index));

  if (results.length === 0) {
    return { influence, distanceToCenter: Infinity, width: 0, flowDirection: { x: 0, z: 0 }, elevation: 0, bankSide: null };
  }

  const nearest = results[0];
  const seg = nearest.segment;
  const t = nearest.t;

  // Interpolate per-vertex attributes
  const width = lerpAttr(seg.attrStart, seg.attrEnd, t, 'width');
  const elevation = lerpAttr(seg.attrStart, seg.attrEnd, t, 'elevation');

  // Flow direction from segment orientation (rivers stored in downstream order)
  const dx = seg.p1.x - seg.p0.x;
  const dz = seg.p1.z - seg.p0.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const flowDirection = { x: dx / len, z: dz / len };

  // Bank side: cross product of flow direction and vector to query point
  // Positive cross = left bank, negative = right bank (facing downstream)
  // Null if inside the channel (distance < half width)
  let bankSide = null;
  if (nearest.distance > width * 0.5) {
    const toQx = x - nearest.closest.x;
    const toQz = z - nearest.closest.z;
    const cross = flowDirection.x * toQz - flowDirection.z * toQx;
    bankSide = cross > 0 ? 'left' : 'right';
  }

  return {
    influence,
    distanceToCenter: nearest.distance,
    width,
    flowDirection,
    elevation,
    bankSide
  };
}

/**
 * Query road influence and geometry at a world position.
 *
 * When multiple roads overlap, the highest-priority road is selected
 * (highway > road > trail > path), with ties broken by distance.
 *
 * @param {Object} metadata - ContinentMetadata
 * @param {number} x - World X
 * @param {number} z - World Z
 * @returns {{
 *   influence: number,
 *   distanceToCenter: number,
 *   width: number,
 *   roadType: string|null,
 *   grade: number,
 *   surfaceElevation: number
 * }}
 */
export function queryRoad(metadata, x, z) {
  const texture = metadata.roadInfluence;
  const index = metadata.roadIndex;

  // Guard: no road data
  if (!texture || texture.length === 0 || !index) {
    return { influence: 0, distanceToCenter: Infinity, width: 0, roadType: null, grade: 0, surfaceElevation: 0 };
  }

  const raw = sampleInfluenceTexture(texture, index, x, z);
  const influence = raw / 255;

  // Early out: no road influence
  if (raw <= INFLUENCE_THRESHOLD) {
    return { influence: 0, distanceToCenter: Infinity, width: 0, roadType: null, grade: 0, surfaceElevation: 0 };
  }

  // Vector query for precise geometry
  const results = queryNearbySegments(index, x, z, getSearchRadius(index));

  if (results.length === 0) {
    return { influence, distanceToCenter: Infinity, width: 0, roadType: null, grade: 0, surfaceElevation: 0 };
  }

  // When multiple roads are nearby, pick the highest priority one.
  // Group by polylineId (keep nearest per road), then select by priority.
  const lookup = getRoadLookup(metadata);
  let best = null;
  let bestPriority = Infinity;

  if (results.length === 1) {
    // Fast path: single result
    best = results[0];
    const road = lookup.get(best.segment.polylineId);
    bestPriority = ROAD_PRIORITY[road?.type] ?? 99;
  } else {
    // Multiple results: group by road, keep nearest per road, pick highest priority
    const byRoad = new Map();
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const id = r.segment.polylineId;
      if (!byRoad.has(id) || r.distance < byRoad.get(id).distance) {
        byRoad.set(id, r);
      }
    }

    for (const [id, result] of byRoad) {
      const road = lookup.get(id);
      const priority = ROAD_PRIORITY[road?.type] ?? 99;
      if (priority < bestPriority || (priority === bestPriority && result.distance < (best?.distance ?? Infinity))) {
        best = result;
        bestPriority = priority;
      }
    }
  }

  const seg = best.segment;
  const t = best.t;

  // Interpolate per-vertex attributes
  const width = lerpAttr(seg.attrStart, seg.attrEnd, t, 'width');
  const grade = lerpAttr(seg.attrStart, seg.attrEnd, t, 'grade');
  const surfaceElevation = lerpAttr(seg.attrStart, seg.attrEnd, t, 'elevation');

  // Resolve road type from the polyline metadata
  const road = lookup.get(seg.polylineId);
  const roadType = road?.type ?? null;

  return {
    influence,
    distanceToCenter: best.distance,
    width,
    roadType,
    grade,
    surfaceElevation
  };
}

/**
 * Query all geographic features at a world position.
 *
 * Convenience function that runs all three queries and returns null for
 * features with zero influence (not present at this location).
 *
 * @param {Object} metadata - ContinentMetadata
 * @param {number} x - World X
 * @param {number} z - World Z
 * @returns {{
 *   coastline: Object|null,
 *   river: Object|null,
 *   road: Object|null
 * }}
 */
export function queryAllFeatures(metadata, x, z) {
  const coastline = queryCoastline(metadata, x, z);
  const river = queryRiver(metadata, x, z);
  const road = queryRoad(metadata, x, z);

  return {
    coastline: coastline.influence > 0 ? coastline : null,
    river: river.influence > 0 ? river : null,
    road: road.influence > 0 ? road : null
  };
}
