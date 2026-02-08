/**
 * Terrain profile functions — Component 5 of the Hybrid Query System
 *
 * Transforms hybrid query results (from src/world/queries.js) into concrete
 * terrain modifications: elevation deltas, surface type assignments, and
 * blend weights. Each function is pure and deterministic.
 *
 * Three profiles:
 *   coastlineProfile — beaches, cliffs, submarine shelves
 *   riverProfile     — channel carving, floodplains, valley walls
 *   roadProfile      — road surface flattening with shoulders
 */

import { lerp, smoothstep, clamp } from '../core/math.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEA_LEVEL = 0.1;

// Coastline zone parameters (world-space units, normalized [-1, 1])
const SHELF_WIDTH = 0.05;       // how far offshore the submarine shelf extends
const SHELF_DEPTH = 0.03;       // max seabed depression at shelf edge
const BEACH_WIDTH = 0.015;      // how far inland beach extends from shoreline
const BEACH_DEPRESSION = 0.005; // how much beach sits below surrounding land
const BEACH_NOISE_THRESHOLD = -0.3; // noise values above this produce beaches
const ROCK_TRANSITION = 0.005;  // narrow cliff transition zone

// River zone multipliers (of channel width)
const FLOODPLAIN_MUL = 3;
const VALLEY_MUL = 6;

// Road shoulder multipliers (of half-width) per road type
const ROAD_SHOULDER_MUL = {
  highway: 2.0,
  road: 1.5,
  trail: 1.2,
  path: 1.0
};

// Road surface material per road type
const ROAD_SURFACE_TYPE = {
  highway: 'paved',
  road: 'gravel',
  trail: 'dirt',
  path: 'dirt'
};

// ---------------------------------------------------------------------------
// Surface type constants
// ---------------------------------------------------------------------------

/**
 * All valid surface type strings returned by profile functions.
 * Downstream consumers (terrain workers, biome classifiers) can reference
 * these instead of hardcoding strings.
 */
export const SURFACE_TYPES = Object.freeze({
  OCEAN: 'ocean',
  BEACH: 'beach',
  ROCK: 'rock',
  WATER: 'water',
  MUD: 'mud',
  PAVED: 'paved',
  GRAVEL: 'gravel',
  DIRT: 'dirt'
});

// ---------------------------------------------------------------------------
// Coastline profile
// ---------------------------------------------------------------------------

/**
 * Compute terrain modification for a coastline feature.
 *
 * Zones (from ocean to land):
 *   1. Submarine shelf — gentle slope rising toward shore
 *   2. Beach or rocky coast — determined by localNoise
 *   3. Inland — no modification
 *
 * @param {Object} queryResult - From queryCoastline()
 * @param {number} queryResult.influence - 0–1, peaks at shoreline
 * @param {number} queryResult.distanceToShore - Signed: negative = ocean, positive = land
 * @param {{x: number, z: number}} queryResult.shoreNormal - Direction toward land
 * @param {number} queryResult.shoreElevation - Elevation at nearest shore point
 * @param {number} localNoise - Noise value in [-1, 1] for beach/cliff variation
 * @returns {{ elevationDelta: number, surfaceType: string|null, blendWeight: number }}
 */
export function coastlineProfile(queryResult, localNoise) {
  const { influence, distanceToShore } = queryResult;

  // No influence — far from any coastline
  if (influence < 0.01) {
    return { elevationDelta: 0, surfaceType: null, blendWeight: 0 };
  }

  const dist = distanceToShore;

  // --- Ocean side (negative distance) ---
  if (dist < 0) {
    // Submarine shelf: smooth rise from -SHELF_DEPTH to 0 as we approach shore
    const shelfT = smoothstep(-SHELF_WIDTH, 0, dist);
    const elevationDelta = -SHELF_DEPTH * (1 - shelfT);
    const blendWeight = clamp(influence * shelfT, 0, 1);
    return { elevationDelta, surfaceType: 'ocean', blendWeight };
  }

  // --- Land side (positive distance) ---

  const isBeach = localNoise > BEACH_NOISE_THRESHOLD;

  if (isBeach) {
    // Beach zone: gentle depression that tapers inland
    const beachT = smoothstep(0, BEACH_WIDTH, dist);
    if (beachT >= 1) {
      return { elevationDelta: 0, surfaceType: null, blendWeight: 0 };
    }
    const falloff = 1 - beachT;
    const elevationDelta = -BEACH_DEPRESSION * falloff;
    const blendWeight = clamp(influence * falloff, 0, 1);
    return { elevationDelta, surfaceType: 'beach', blendWeight };
  }

  // Rocky coast: very narrow transition, cliffs keep base terrain elevation
  const rockT = smoothstep(0, ROCK_TRANSITION, dist);
  if (rockT >= 1) {
    return { elevationDelta: 0, surfaceType: null, blendWeight: 0 };
  }
  const blendWeight = clamp(influence * (1 - rockT), 0, 1);
  return { elevationDelta: 0, surfaceType: 'rock', blendWeight };
}

// ---------------------------------------------------------------------------
// River profile
// ---------------------------------------------------------------------------

/**
 * Compute terrain modification for a river feature.
 *
 * Three concentric zones radiating from the river centerline:
 *   1. Channel — V/U-shaped carve down to water elevation
 *   2. Floodplain — gentle 40% carve with mud surface
 *   3. Valley walls — subtle 15% carve blending to natural terrain
 *
 * Wider rivers produce flatter (U-shaped) channels; narrow rivers are V-shaped.
 *
 * @param {Object} queryResult - From queryRiver()
 * @param {number} queryResult.influence - 0–1
 * @param {number} queryResult.distanceToCenter - Distance to river centerline
 * @param {number} queryResult.width - River channel width at this point
 * @param {{x: number, z: number}} queryResult.flowDirection - Downstream direction
 * @param {number} queryResult.elevation - Water surface elevation
 * @param {"left"|"right"|null} queryResult.bankSide - Which bank the point is on
 * @param {number} baseElevation - Terrain elevation before river modification
 * @returns {{ elevationDelta: number, surfaceType: string|null, blendWeight: number }}
 */
export function riverProfile(queryResult, baseElevation) {
  const { influence, distanceToCenter, width, elevation: waterElevation } = queryResult;

  // No influence or degenerate width
  if (influence < 0.01 || width <= 0) {
    return { elevationDelta: 0, surfaceType: null, blendWeight: 0 };
  }

  const channelRadius = width;
  const floodplainRadius = width * FLOODPLAIN_MUL;
  const valleyRadius = width * VALLEY_MUL;

  // Beyond valley: no effect
  if (distanceToCenter >= valleyRadius) {
    return { elevationDelta: 0, surfaceType: null, blendWeight: 0 };
  }

  // Max carve depth: never go below sea level or below water surface
  const floorElevation = Math.max(waterElevation, SEA_LEVEL);
  const maxCarve = Math.max(0, baseElevation - floorElevation);

  // Zone 1: Channel — V/U-shaped cross-section
  if (distanceToCenter < channelRadius) {
    const t = distanceToCenter / channelRadius;

    // Wider rivers have flatter (U-shaped) beds, narrow rivers are V-shaped
    const flatness = smoothstep(0.003, 0.015, width);
    const vShape = 1 - t * t;
    const uShape = 1 - smoothstep(0, 1, t) * smoothstep(0, 1, t);
    const profile = lerp(vShape, uShape, flatness);

    const elevationDelta = -maxCarve * profile;
    const blendWeight = clamp(influence * profile, 0, 1);
    return { elevationDelta, surfaceType: 'water', blendWeight };
  }

  // Zone 2: Floodplain — gentle slope from channel edge
  if (distanceToCenter < floodplainRadius) {
    const t = (distanceToCenter - channelRadius) / (floodplainRadius - channelRadius);
    const falloff = 1 - smoothstep(0, 1, t);
    const elevationDelta = -maxCarve * 0.4 * falloff;
    const blendWeight = clamp(influence * falloff, 0, 1);
    return { elevationDelta, surfaceType: 'mud', blendWeight };
  }

  // Zone 3: Valley walls — gradual blend to natural terrain
  const t = (distanceToCenter - floodplainRadius) / (valleyRadius - floodplainRadius);
  const falloff = 1 - smoothstep(0, 1, t);
  const elevationDelta = -maxCarve * 0.15 * falloff;
  const blendWeight = clamp(influence * falloff * 0.5, 0, 1);
  return { elevationDelta, surfaceType: null, blendWeight };
}

// ---------------------------------------------------------------------------
// Road profile
// ---------------------------------------------------------------------------

/**
 * Compute terrain modification for a road feature.
 *
 * Two zones:
 *   1. Road surface — flatten terrain to road elevation (slight center crown)
 *   2. Shoulder — smooth blend from road elevation to natural terrain
 *
 * Shoulder width and surface material vary by road type.
 *
 * @param {Object} queryResult - From queryRoad()
 * @param {number} queryResult.influence - 0–1
 * @param {number} queryResult.distanceToCenter - Distance to road centerline
 * @param {number} queryResult.width - Road width at this point
 * @param {string|null} queryResult.roadType - "highway", "road", "trail", or "path"
 * @param {number} queryResult.grade - Terrain slope along road
 * @param {number} queryResult.surfaceElevation - Target road surface elevation
 * @param {number} baseElevation - Terrain elevation before road modification
 * @returns {{ elevationDelta: number, surfaceType: string|null, blendWeight: number }}
 */
export function roadProfile(queryResult, baseElevation) {
  const { influence, distanceToCenter, width, roadType, surfaceElevation } = queryResult;

  // No influence or missing data
  if (influence < 0.01 || !roadType || width <= 0) {
    return { elevationDelta: 0, surfaceType: null, blendWeight: 0 };
  }

  const halfWidth = width * 0.5;
  const shoulderMul = ROAD_SHOULDER_MUL[roadType] ?? 1.5;
  const shoulderRadius = halfWidth * shoulderMul;
  const surfaceType = ROAD_SURFACE_TYPE[roadType] ?? 'dirt';

  // Target delta: how much to raise/lower terrain to meet road surface
  const targetDelta = surfaceElevation - baseElevation;

  // Beyond shoulder: no effect
  if (distanceToCenter >= shoulderRadius) {
    return { elevationDelta: 0, surfaceType: null, blendWeight: 0 };
  }

  // Zone 1: Road surface — flatten with slight center crown for drainage
  if (distanceToCenter < halfWidth) {
    const centerT = distanceToCenter / halfWidth;
    const crown = 1 - centerT * centerT * 0.1;
    const elevationDelta = targetDelta * crown;
    return { elevationDelta, surfaceType, blendWeight: clamp(influence, 0, 1) };
  }

  // Zone 2: Shoulder — blend from road elevation to natural terrain
  const t = (distanceToCenter - halfWidth) / (shoulderRadius - halfWidth);
  const falloff = 1 - smoothstep(0, 1, t);
  const elevationDelta = targetDelta * falloff;
  const blendWeight = clamp(influence * falloff, 0, 1);
  // Surface type applies on inner half of shoulder, natural terrain on outer half
  const shoulderSurface = t < 0.5 ? surfaceType : null;
  return { elevationDelta, surfaceType: shoulderSurface, blendWeight };
}
