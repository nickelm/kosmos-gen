/**
 * Enhanced polyline storage — Component 3 of the Hybrid Query System
 *
 * Provides converter functions that transform generation-stage output into
 * normalized polyline formats (CoastlinePolyline, RiverPolyline, RoadPolyline)
 * and a factory function that bundles everything into a ContinentMetadata object
 * with influence textures and spatial indices.
 */

import { distance } from '../core/math.js';
import { isClosedLoop } from '../geometry/contour.js';
import { bakeInfluenceField, bakeCoastlineInfluence } from '../geometry/influence.js';
import { createPolylineIndex } from '../geometry/polyline-index.js';

// ---------------------------------------------------------------------------
// Polyline converters
// ---------------------------------------------------------------------------

/**
 * Convert a generation-stage river to a RiverPolyline.
 *
 * @param {Object} river - River from hydrology stage
 *   { id, vertices: [{x, z, elevation, flow, width}], termination, terminatingLakeId }
 * @returns {{ id: string, name: string, points: Array<{x: number, z: number, width: number, flow: number, elevation: number}> }}
 */
export function convertRiverToPolyline(river) {
  return {
    id: river.id,
    name: river.name || river.id,
    points: river.vertices.map(v => ({
      x: v.x,
      z: v.z,
      width: v.width,
      flow: v.flow,
      elevation: v.elevation
    }))
  };
}

/**
 * Convert a generation-stage road to a RoadPolyline.
 *
 * Per-point grade is computed as forward-difference of elevation divided by
 * 2D distance between adjacent waypoints. The last point uses backward
 * difference. Width is broadcast from the per-road scalar.
 *
 * @param {Object} road - Road from roads stage
 *   { id, type, from, to, width, waypoints: [{x, z, elevation, ...}], segments }
 * @returns {{ id: string, type: string, points: Array<{x: number, z: number, width: number, grade: number}>, connectsSettlements: [string, string] }}
 */
export function convertRoadToPolyline(road) {
  const wps = road.waypoints;
  const points = [];

  for (let i = 0; i < wps.length; i++) {
    const wp = wps[i];

    let grade = 0;
    if (wps.length >= 2) {
      const j = (i < wps.length - 1) ? i + 1 : i - 1;
      const other = wps[j];
      const dist = distance(wp.x, wp.z, other.x, other.z);
      if (dist > 1e-8) {
        const elevDelta = (i < wps.length - 1)
          ? other.elevation - wp.elevation
          : wp.elevation - other.elevation;
        grade = elevDelta / dist;
      }
    }

    points.push({
      x: wp.x,
      z: wp.z,
      width: road.width,
      grade,
      elevation: wp.roadElevation ?? wp.elevation ?? 0
    });
  }

  return {
    id: road.id,
    type: road.type,
    points,
    connectsSettlements: [road.from, road.to]
  };
}

/**
 * Convert a raw coastline point array to a CoastlinePolyline.
 *
 * @param {Array<{x: number, z: number}>} polyline - Raw coastline points from extractContours
 * @param {number} index - Index for auto-generated ID
 * @param {number} [seaLevel=0.1] - Sea level elevation value
 * @returns {{ id: string, points: Array<{x: number, z: number, elevation: number}>, closed: boolean }}
 */
export function convertCoastlineToPolyline(polyline, index, seaLevel = 0.1) {
  return {
    id: `coastline_${index}`,
    points: polyline.map(p => ({
      x: p.x,
      z: p.z,
      elevation: seaLevel
    })),
    closed: isClosedLoop(polyline)
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Bridge spec-format polylines to createPolylineIndex input format.
 * Extracts all non-positional fields from each point as per-vertex attributes.
 *
 * @param {Array<{id: string, points: Array<{x: number, z: number}>}>} polylines
 * @param {Object} [options] - Forwarded to createPolylineIndex
 * @returns {Object} PolylineIndex
 */
function buildPolylineIndexFromSpec(polylines, options = {}) {
  const indexInput = polylines.map(pl => ({
    id: pl.id,
    points: pl.points,
    attributes: pl.points.map(p => {
      const attr = {};
      for (const key of Object.keys(p)) {
        if (key !== 'x' && key !== 'z') attr[key] = p[key];
      }
      return attr;
    })
  }));
  return createPolylineIndex(indexInput, options);
}

/**
 * Bake river influence from spec-format RiverPolylines.
 * Mirrors the logic in hydrology.js: innerRadius = maxWidth, outerRadius = maxWidth * 6.
 */
function bakeRiverInfluenceOnDemand(riverPolylines, resolution, bounds, config) {
  if (riverPolylines.length === 0) return new Uint8Array(resolution * resolution);

  const rawPolylines = riverPolylines.map(r => r.points);

  let maxWidth = 0;
  for (const r of riverPolylines) {
    for (const p of r.points) {
      if (p.width > maxWidth) maxWidth = p.width;
    }
  }

  const valleyMul = config.riverValleyMultiplier ?? 6;
  return bakeInfluenceField(rawPolylines, {
    resolution,
    innerRadius: maxWidth,
    outerRadius: maxWidth * valleyMul,
    bounds
  });
}

/**
 * Bake road influence from spec-format RoadPolylines.
 * Mirrors the logic in roads.js: innerRadius = maxWidth, outerRadius = maxWidth * 3.
 */
function bakeRoadInfluenceOnDemand(roadPolylines, resolution, bounds, config) {
  if (roadPolylines.length === 0) return new Uint8Array(resolution * resolution);

  const rawPolylines = roadPolylines.map(r => r.points);

  let maxWidth = 0;
  for (const r of roadPolylines) {
    for (const p of r.points) {
      if (p.width > maxWidth) maxWidth = p.width;
    }
  }

  const corridorMul = config.roadCorridorMultiplier ?? 3;
  return bakeInfluenceField(rawPolylines, {
    resolution,
    innerRadius: maxWidth,
    outerRadius: maxWidth * corridorMul,
    bounds
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ContinentMetadata bundle from generation pipeline output.
 *
 * Accepts either pre-baked influence textures (from the generation pipeline)
 * or raw polyline arrays (in which case influence is baked on demand).
 *
 * @param {Object} options
 * @param {Array<Array<{x: number, z: number}>>} [options.coastlinePolylines] - Raw coastline point arrays
 * @param {Array} [options.rivers] - River objects from hydrology stage
 * @param {Array} [options.roads] - Road objects from roads stage
 * @param {number} [options.seaLevel=0.1] - Sea level for coastline elevation
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} [options.bounds]
 * @param {Uint8Array} [options.coastlineInfluence] - Pre-baked coastline influence
 * @param {Uint8Array} [options.riverInfluence] - Pre-baked river influence
 * @param {Uint8Array} [options.roadInfluence] - Pre-baked road influence
 * @param {Uint8Array} [options.elevationField] - Elevation raster (pass-through)
 * @param {Uint8Array} [options.climateField] - Climate raster (pass-through)
 * @param {number} [options.influenceResolution=512] - Resolution for on-demand influence baking
 * @param {Object} [options.influenceConfig] - Config for on-demand influence baking
 * @returns {Object} ContinentMetadata
 */
export function createContinentMetadata(options = {}) {
  const {
    coastlinePolylines = [],
    rivers = [],
    roads = [],
    seaLevel = 0.1,
    bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
    influenceResolution = 512,
    influenceConfig = {}
  } = options;

  // Step 1: Convert to spec polyline formats
  const coastlines = coastlinePolylines.map((pl, i) =>
    convertCoastlineToPolyline(pl, i, seaLevel)
  );
  const riverPolylines = rivers.map(r => convertRiverToPolyline(r));
  const roadPolylines = roads.map(r => convertRoadToPolyline(r));

  // Step 2: Resolve influence textures (accept pre-baked or bake on demand)
  const coastlineInfluence = options.coastlineInfluence
    || bakeCoastlineInfluence(coastlinePolylines, {
      resolution: influenceResolution,
      beachWidth: influenceConfig.beachWidth ?? 0.02,
      transitionWidth: influenceConfig.transitionWidth ?? 0.05,
      bounds
    });

  const riverInfluence = options.riverInfluence
    || bakeRiverInfluenceOnDemand(riverPolylines, influenceResolution, bounds, influenceConfig);

  const roadInfluence = options.roadInfluence
    || bakeRoadInfluenceOnDemand(roadPolylines, influenceResolution, bounds, influenceConfig);

  // Step 3: Build spatial indices
  const coastlineIndex = buildPolylineIndexFromSpec(coastlines, { bounds });
  const riverIndex = buildPolylineIndexFromSpec(riverPolylines, { bounds });
  const roadIndex = buildPolylineIndexFromSpec(roadPolylines, { bounds });

  // Step 4: Assemble
  return {
    coastlines,
    rivers: riverPolylines,
    roads: roadPolylines,
    coastlineInfluence,
    riverInfluence,
    roadInfluence,
    coastlineIndex,
    riverIndex,
    roadIndex,
    elevationField: options.elevationField || null,
    climateField: options.climateField || null
  };
}
