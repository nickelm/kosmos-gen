/**
 * Stage 9: Points of Interest (POI) placement
 *
 * Places POIs on the island based on caller-defined type rules.
 * If no POI config is provided, generates no POIs.
 *
 * Follows the same coarse-grid + suitability-scoring pattern as settlements.
 */

import { deriveSeed, seededRandom } from '../../core/seeds.js';
import { getBiomeName as defaultBiomeName } from '../../config/defaultBiomes.js';
import { generateName } from '../naming.js';

/** Coarse grid step (sample every N cells of the elevation grid) */
const COARSE_STEP = 4;

/**
 * Generate POIs based on caller-defined placement rules.
 *
 * @param {Object} result - Full pipeline result (elevation, hydrology, biomes, settlements, roads)
 * @param {Object} [poisConfig] - Caller POI configuration with types array
 * @param {number} seed - World seed
 * @param {Object} [namingConfig] - Caller naming palettes
 * @returns {{ pois: Array }}
 */
export function generatePOIs(result, poisConfig, seed, namingConfig) {
  if (!poisConfig?.types || poisConfig.types.length === 0) {
    return { pois: [] };
  }

  const { elevation, hydrology, biomes, settlements, roads } = result;
  if (!elevation) return { pois: [] };

  const rng = seededRandom(deriveSeed(seed, 'pois'));
  const allPOIs = [];

  // Pre-compute helper data
  const { width, height, data, bounds } = elevation;
  const cellW = (bounds.maxX - bounds.minX) / width;
  const cellH = (bounds.maxZ - bounds.minZ) / height;
  const { seaLevel } = result.params;

  // Build biome name lookup (numeric ID -> string name)
  const biomeNameLookup = buildBiomeNameLookup(biomes);

  // Pre-compute slope grid at coarse resolution
  const coarseW = Math.floor(width / COARSE_STEP);
  const coarseH = Math.floor(height / COARSE_STEP);
  const slopes = computeCoarseSlopes(data, width, height, cellW, coarseW, coarseH);

  // Settlement positions for distance checks
  const settlementPositions = (settlements?.settlements || []).map(s => s.position);

  for (const poiType of poisConfig.types) {
    const count = resolveCount(poiType.count, rng);
    if (count <= 0) continue;

    const placed = placePOIType(
      poiType, count, data, width, height, bounds, cellW, cellH,
      seaLevel, slopes, coarseW, coarseH,
      hydrology, biomes, biomeNameLookup, roads,
      settlementPositions, allPOIs, seed, rng, namingConfig
    );
    allPOIs.push(...placed);
  }

  console.log(`[pois] ${allPOIs.length} placed across ${poisConfig.types.length} types`);

  return { pois: allPOIs };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveCount(countSpec, rng) {
  if (typeof countSpec === 'number') return countSpec;
  if (Array.isArray(countSpec)) {
    const [min, max] = countSpec;
    return min + Math.floor(rng() * (max - min + 1));
  }
  return 0;
}

/**
 * Build a lookup from numeric biome ID -> string biome name.
 * Works with both default Whittaker (no registry) and custom biomes (with registry).
 */
function buildBiomeNameLookup(biomes) {
  if (!biomes) return null;
  if (biomes.registry) {
    // Custom biomes: registry.idToString is our lookup
    return biomes.registry.idToString;
  }
  // Default Whittaker: build from defaultBiomeName
  return { get: (id) => defaultBiomeName(id) };
}

/**
 * Get biome name for a numeric ID using the lookup.
 */
function getBiomeName(biomeNameLookup, numericId) {
  if (!biomeNameLookup) return 'unknown';
  if (biomeNameLookup instanceof Map) return biomeNameLookup.get(numericId) || 'unknown';
  return biomeNameLookup.get(numericId) || 'unknown';
}

/**
 * Compute slope at coarse grid resolution.
 * Slope = max elevation difference in the 3x3 neighborhood / cell distance.
 */
function computeCoarseSlopes(data, width, height, cellW, coarseW, coarseH) {
  const slopes = new Float32Array(coarseW * coarseH);

  for (let cr = 0; cr < coarseH; cr++) {
    for (let cc = 0; cc < coarseW; cc++) {
      const r = cr * COARSE_STEP + Math.floor(COARSE_STEP / 2);
      const c = cc * COARSE_STEP + Math.floor(COARSE_STEP / 2);
      if (r >= height || c >= width) continue;

      const centerElev = data[r * width + c];
      let maxDiff = 0;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr * COARSE_STEP;
          const nc = c + dc * COARSE_STEP;
          if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
          const diff = Math.abs(data[nr * width + nc] - centerElev);
          if (diff > maxDiff) maxDiff = diff;
        }
      }

      // Slope = elevation change per unit distance
      const dist = cellW * COARSE_STEP;
      slopes[cr * coarseW + cc] = maxDiff / dist;
    }
  }

  return slopes;
}

/**
 * Compute flatness (elevation variance) within a radius around a grid cell.
 */
function computeFlatness(data, width, height, r, c, radiusCells) {
  let sumE = 0, sumE2 = 0, cnt = 0;
  const halfR = Math.ceil(radiusCells);

  for (let dr = -halfR; dr <= halfR; dr++) {
    for (let dc = -halfR; dc <= halfR; dc++) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
      if (dr * dr + dc * dc > radiusCells * radiusCells) continue;
      const e = data[nr * width + nc];
      sumE += e;
      sumE2 += e * e;
      cnt++;
    }
  }

  if (cnt === 0) return 0;
  const mean = sumE / cnt;
  const variance = sumE2 / cnt - mean * mean;
  return variance;
}

// ---------------------------------------------------------------------------
// POI placement for a single type
// ---------------------------------------------------------------------------

function placePOIType(
  poiType, count, data, width, height, bounds, cellW, cellH,
  seaLevel, slopes, coarseW, coarseH,
  hydrology, biomes, biomeNameLookup, roads,
  settlementPositions, existingPOIs, seed, rng, namingConfig
) {
  const rules = poiType.placement || {};
  const placed = [];

  // Build set of allowed biome numeric IDs (if biome filter specified)
  const allowedBiomeIds = resolveBiomeFilter(rules, biomes);

  // Score all coarse grid candidates
  const scored = [];

  for (let cr = 0; cr < coarseH; cr++) {
    for (let cc = 0; cc < coarseW; cc++) {
      const r = cr * COARSE_STEP + Math.floor(COARSE_STEP / 2);
      const c = cc * COARSE_STEP + Math.floor(COARSE_STEP / 2);
      if (r >= height || c >= width) continue;

      const idx = r * width + c;
      const elev = data[idx];
      const wx = bounds.minX + (cc * COARSE_STEP + COARSE_STEP / 2) * cellW;
      const wz = bounds.minZ + (cr * COARSE_STEP + COARSE_STEP / 2) * cellH;

      // Hard filter: must be land
      if (elev <= seaLevel) continue;

      // Hard filter: elevation range
      if (rules.elevation) {
        const [eMin, eMax] = rules.elevation;
        if (eMin !== null && eMin !== undefined && elev < eMin) continue;
        if (eMax !== null && eMax !== undefined && elev > eMax) continue;
      }

      // Hard filter: slope
      const slope = slopes[cr * coarseW + cc];
      if (rules.slopeMax !== undefined && slope > rules.slopeMax) continue;

      // Hard filter: biome
      if (allowedBiomeIds && biomes?.data) {
        const biomeId = biomes.data[idx];
        if (!allowedBiomeIds.has(biomeId)) continue;
      }

      // Hard filter: biome exclusions
      if (rules.biomesExclude && biomes?.data) {
        const biomeId = biomes.data[idx];
        const biomeName = getBiomeName(biomeNameLookup, biomeId);
        if (rules.biomesExclude.includes(biomeName)) continue;
      }

      // Hard filter: water distance
      if (rules.avoidWater || rules.waterDistance) {
        const waterDist = getWaterDistance(hydrology, idx);
        if (rules.waterDistance) {
          const [wMin, wMax] = rules.waterDistance;
          if (wMin !== null && wMin !== undefined && waterDist < wMin) continue;
          if (wMax !== null && wMax !== undefined && waterDist > wMax) continue;
        }
        if (rules.avoidWater && waterDist < 0.01) continue;
      }

      // Hard filter: near water
      if (rules.nearWater) {
        const waterDist = getWaterDistance(hydrology, idx);
        if (waterDist > 0.05) continue;
      }

      // Hard filter: settlement distance
      if (rules.settlementDistance) {
        const [sMin, sMax] = rules.settlementDistance;
        const sDist = nearestDistance(wx, wz, settlementPositions);
        if (sMin !== null && sMin !== undefined && sDist < sMin) continue;
        if (sMax !== null && sMax !== undefined && sDist > sMax) continue;
      }

      // Hard filter: road distance
      if (rules.roadDistance || rules.nearRoad !== undefined) {
        const roadDist = getRoadDistance(roads, idx);
        if (rules.roadDistance) {
          const [rMin, rMax] = rules.roadDistance;
          if (rMin !== null && rMin !== undefined && roadDist < rMin) continue;
          if (rMax !== null && rMax !== undefined && roadDist > rMax) continue;
        }
        if (rules.nearRoad === true && roadDist > 0.05) continue;
        if (rules.nearRoad === false && roadDist < 0.01) continue;
      }

      // Hard filter: flatness requirement
      if (rules.requiresFlat) {
        const flatRadius = rules.flatRadius || 0.02;
        const radiusCells = Math.ceil(flatRadius / cellW);
        const variance = computeFlatness(data, width, height, r, c, radiusCells);
        if (variance > 0.001) continue;
      }

      // Passed all hard filters - compute score
      let score = 1.0;

      // Soft: prefer middle of elevation range
      if (rules.elevation) {
        const [eMin, eMax] = rules.elevation;
        const lo = eMin ?? seaLevel;
        const hi = eMax ?? 1.0;
        const mid = (lo + hi) / 2;
        const range = hi - lo;
        if (range > 0) {
          score += 0.5 * (1 - Math.abs(elev - mid) / (range / 2));
        }
      }

      // Soft: prefer flatter terrain (unless slope is desired)
      if (rules.slopeMax !== undefined) {
        score += 0.3 * (1 - slope / Math.max(rules.slopeMax, 0.01));
      }

      scored.push({ wx, wz, elev, score, biomeId: biomes?.data?.[idx] ?? 0 });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Place POIs respecting spacing
  const minSelfDist = rules.minDistanceFromSame || 0;
  let typeCounter = 0;

  for (const cand of scored) {
    if (placed.length >= count) break;

    // Check self-spacing
    if (minSelfDist > 0) {
      let tooClose = false;
      for (const p of placed) {
        const dx = cand.wx - p.position[0];
        const dz = cand.wz - p.position[1];
        if (Math.sqrt(dx * dx + dz * dz) < minSelfDist) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
    }

    // Check distance from all existing POIs (across types)
    const globalMinDist = 0.02; // minimum distance between any two POIs
    let globalTooClose = false;
    for (const p of existingPOIs) {
      const dx = cand.wx - p.position[0];
      const dz = cand.wz - p.position[1];
      if (Math.sqrt(dx * dx + dz * dz) < globalMinDist) {
        globalTooClose = true;
        break;
      }
    }
    if (globalTooClose) continue;

    // Generate name
    const biomeName = getBiomeName(biomeNameLookup, cand.biomeId);
    const poiPalette = namingConfig?.poi?.[poiType.id] || null;
    const name = poiPalette
      ? generateName(cand.wx, cand.wz, seed, poiType.id, poiPalette)
      : null;

    placed.push({
      id: `${poiType.id}_${typeCounter}`,
      typeId: poiType.id,
      position: [cand.wx, cand.wz],
      elevation: cand.elev,
      biome: biomeName,
      name,
    });
    typeCounter++;
  }

  return placed;
}

// ---------------------------------------------------------------------------
// Biome filter resolution
// ---------------------------------------------------------------------------

/**
 * Resolve biome name filter to numeric IDs for efficient grid lookup.
 */
function resolveBiomeFilter(rules, biomes) {
  if (!rules.biomes || !biomes) return null;

  const allowed = new Set();

  if (biomes.registry) {
    // Custom biomes: look up string -> numeric ID
    for (const name of rules.biomes) {
      const id = biomes.registry.stringToId.get(name);
      if (id !== undefined) allowed.add(id);
    }
  } else {
    // Default Whittaker: build name -> ID from known biome set
    const nameToId = new Map([
      ['ocean', 0], ['beach', 1], ['desert', 2], ['grassland', 3],
      ['forest', 4], ['jungle', 5], ['swamp', 6], ['tundra', 7],
      ['snow', 8], ['mountain_rock', 9],
    ]);
    for (const name of rules.biomes) {
      const id = nameToId.get(name);
      if (id !== undefined) allowed.add(id);
    }
  }

  return allowed.size > 0 ? allowed : null;
}

// ---------------------------------------------------------------------------
// Distance helpers
// ---------------------------------------------------------------------------

function getWaterDistance(hydrology, idx) {
  if (!hydrology) return Infinity;
  let minDist = Infinity;
  if (hydrology.riverSDF) {
    const d = hydrology.riverSDF[idx];
    if (d !== undefined && d < minDist) minDist = d;
  }
  if (hydrology.lakeSDF) {
    const d = hydrology.lakeSDF[idx];
    // lakeSDF is signed: negative = inside lake
    if (d !== undefined && Math.abs(d) < minDist) minDist = Math.abs(d);
  }
  return minDist;
}

function getRoadDistance(roads, idx) {
  if (!roads?.roadSDF) return Infinity;
  return roads.roadSDF[idx] ?? Infinity;
}

function nearestDistance(x, z, positions) {
  let min = Infinity;
  for (const pos of positions) {
    const dx = x - pos[0];
    const dz = z - pos[1];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < min) min = d;
  }
  return min;
}
