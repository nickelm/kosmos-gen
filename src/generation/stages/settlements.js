/**
 * Stage 7: Settlements
 *
 * Places cities, villages, and hamlets on suitable terrain using a
 * suitability scoring system. Generates terraces (buildable platforms)
 * and assigns deterministic names.
 */

import { deriveSeed, seededRandom } from '../../core/seeds.js';
import { clamp, distance } from '../../core/math.js';
import { convexHull } from '../convexhull.js';
import { generateSettlementName } from '../naming.js';

// ---------------------------------------------------------------------------
// Settlement type definitions (world-space units, 1 block ≈ 0.001)
// ---------------------------------------------------------------------------

const SETTLEMENT_TYPES = {
  city: {
    radiusMin: 0.06,
    radiusMax: 0.08,
    maxTerraces: 4,
    terraceHeightMin: 0.015,
    terraceHeightMax: 0.025,
  },
  village: {
    radiusMin: 0.03,
    radiusMax: 0.045,
    maxTerraces: 3,
    terraceHeightMin: 0.012,
    terraceHeightMax: 0.018,
  },
  hamlet: {
    radiusMin: 0.015,
    radiusMax: 0.025,
    maxTerraces: 2,
    terraceHeightMin: 0.008,
    terraceHeightMax: 0.012,
  },
};

/** Minimum spacing between settlement pairs (world units) */
const MIN_SPACING = {
  city:    { city: 0.8, village: 0.4, hamlet: 0.2 },
  village: { city: 0.4, village: 0.25, hamlet: 0.1 },
  hamlet:  { city: 0.2, village: 0.1, hamlet: 0.08 },
};

/** Suitability thresholds for placement */
const CITY_THRESHOLD = 3.0;
const VILLAGE_THRESHOLD = 2.0;
const HAMLET_THRESHOLD = 1.0;

/** Biome IDs to reject for settlement placement */
const REJECTED_BIOMES = new Set([0, 1, 8, 9]); // ocean, beach, snow, mountain_rock

/** Coarse grid step (sample every N cells of the elevation grid) */
const COARSE_STEP = 4;

/** Blend zone width around settlement footprint (world units) */
const BLEND_ZONE = 0.008;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @param {Object} params    - { seaLevel, … }
 * @param {Object} elevation - { width, height, data: Float32Array, bounds }
 * @param {Object} hydrology - { rivers, lakes, riverSDF, lakeSDF, width, height }
 * @param {Object} biomes    - { data: Uint8Array, width, height }
 * @param {number} seed
 * @returns {{ settlements: Array, coastSDF: Float32Array }}
 */
export function generateSettlements(params, elevation, hydrology, biomes, seed) {
  if (!elevation || !hydrology) {
    return { settlements: [], coastSDF: null };
  }

  const { width, height, data, bounds } = elevation;
  const { seaLevel } = params;
  const settleSeed = deriveSeed(seed, 'settlements');
  const rng = seededRandom(settleSeed);

  const cellW = (bounds.maxX - bounds.minX) / width;
  const cellH = (bounds.maxZ - bounds.minZ) / height;

  // 1. Compute coast SDF (distance from sea level contour)
  const coastSDF = computeCoastSDF(data, width, height, seaLevel, cellW);

  // 2. Classify island size
  const { targetCities, targetVillages, targetHamlets } = classifyIslandSize(
    data, width, height, seaLevel
  );

  // 3. Score suitability on coarse grid
  const scores = scoreSuitability(
    data, width, height, bounds, cellW, cellH, seaLevel,
    hydrology, biomes, coastSDF
  );

  // 4. Place settlements
  const settlements = placeSettlements(
    scores, data, width, height, bounds, cellW, cellH, seaLevel,
    targetCities, targetVillages, targetHamlets,
    seed, rng
  );

  // 5. Generate terraces for each settlement
  for (const s of settlements) {
    s.terraces = generateTerraces(
      s, data, width, height, bounds, cellW, cellH, rng
    );
  }

  console.log(`[settlements] ${settlements.length} placed: ${settlements.filter(s => s.type === 'city').length} cities, ${settlements.filter(s => s.type === 'village').length} villages, ${settlements.filter(s => s.type === 'hamlet').length} hamlets`);

  return { settlements, coastSDF };
}

// ---------------------------------------------------------------------------
// Coast SDF (chamfer distance from coastline)
// ---------------------------------------------------------------------------

function computeCoastSDF(data, width, height, seaLevel, cellW) {
  const n = width * height;
  const mask = new Uint8Array(n);

  // Mark cells at the land-sea boundary
  for (let r = 1; r < height - 1; r++) {
    for (let c = 1; c < width - 1; c++) {
      const idx = r * width + c;
      const isLand = data[idx] > seaLevel;
      if (!isLand) continue;

      // Check if any neighbor is water
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (data[(r + dr) * width + (c + dc)] <= seaLevel) {
            mask[idx] = 1;
            break;
          }
        }
        if (mask[idx]) break;
      }
    }
  }

  return chamfer(mask, width, height, cellW);
}

function chamfer(mask, width, height, cs) {
  const n = width * height;
  const d = new Float32Array(n);
  const I = 1e6;
  const dg = cs * Math.SQRT2;
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

// ---------------------------------------------------------------------------
// Island size classification
// ---------------------------------------------------------------------------

function classifyIslandSize(data, width, height, seaLevel) {
  let landCells = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > seaLevel) landCells++;
  }

  // Area in world-space squared units
  const cellArea = (2 / width) * (2 / height);
  const landArea = landCells * cellArea;

  // Classification thresholds
  if (landArea < 0.8) {
    // Small island
    return { targetCities: 0, targetVillages: [1, 2], targetHamlets: [2, 4] };
  } else if (landArea < 1.5) {
    // Medium island
    return { targetCities: [0, 1], targetVillages: [2, 4], targetHamlets: [4, 6] };
  } else {
    // Large island
    return { targetCities: 1, targetVillages: [3, 5], targetHamlets: [5, 8] };
  }
}

function resolveCount(value, rng) {
  if (typeof value === 'number') return value;
  const [min, max] = value;
  return min + Math.floor(rng() * (max - min + 1));
}

// ---------------------------------------------------------------------------
// Suitability scoring
// ---------------------------------------------------------------------------

function scoreSuitability(
  data, width, height, bounds, cellW, cellH, seaLevel,
  hydrology, biomes, coastSDF
) {
  const { riverSDF } = hydrology;
  const coarseW = Math.floor(width / COARSE_STEP);
  const coarseH = Math.floor(height / COARSE_STEP);
  const scores = new Float32Array(coarseW * coarseH);

  const SIGMA_RIVER = 0.05;
  const SIGMA_COAST = 0.1;
  // Elevation band: full score from just above sea to mid-highlands, taper to high peaks
  const ELEV_PLATEAU_LOW = seaLevel + 0.02;
  const ELEV_PLATEAU_HIGH = 0.45;
  const ELEV_TAPER_MAX = 0.60;

  for (let cr = 0; cr < coarseH; cr++) {
    for (let cc = 0; cc < coarseW; cc++) {
      const r = cr * COARSE_STEP + Math.floor(COARSE_STEP / 2);
      const c = cc * COARSE_STEP + Math.floor(COARSE_STEP / 2);
      if (r >= height || c >= width) continue;

      const idx = r * width + c;
      const elev = data[idx];

      // Reject underwater and extreme elevations
      if (elev <= seaLevel + 0.02 || elev > 0.65) {
        scores[cr * coarseW + cc] = -Infinity;
        continue;
      }

      // Reject bad biomes
      if (biomes && biomes.data) {
        const biomeId = biomes.data[idx];
        if (REJECTED_BIOMES.has(biomeId)) {
          scores[cr * coarseW + cc] = -Infinity;
          continue;
        }
      }

      // Flatness: variance in 5×5 neighborhood on full grid
      let sumE = 0, sumE2 = 0, cnt = 0;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr * COARSE_STEP;
          const nc = c + dc * COARSE_STEP;
          if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
          const e = data[nr * width + nc];
          sumE += e;
          sumE2 += e * e;
          cnt++;
        }
      }
      const mean = sumE / cnt;
      const variance = sumE2 / cnt - mean * mean;
      const flatness = Math.max(0, 1 - variance / 0.002);

      // Water access: gaussian falloff from river and coast SDFs
      let waterAccess = 0;
      if (riverSDF) {
        const riverDist = riverSDF[idx] || 0;
        waterAccess = Math.max(waterAccess, Math.exp(-0.5 * (riverDist / SIGMA_RIVER) ** 2));
      }
      if (coastSDF) {
        const coastDist = coastSDF[idx] || 0;
        waterAccess = Math.max(waterAccess, Math.exp(-0.5 * (coastDist / SIGMA_COAST) ** 2));
      }

      // Elevation band preference: plateau in habitable range, taper at high elevations
      let elevBand;
      if (elev <= ELEV_PLATEAU_LOW) {
        elevBand = 0;
      } else if (elev <= ELEV_PLATEAU_HIGH) {
        elevBand = 1.0;
      } else if (elev <= ELEV_TAPER_MAX) {
        elevBand = 1.0 - (elev - ELEV_PLATEAU_HIGH) / (ELEV_TAPER_MAX - ELEV_PLATEAU_HIGH);
      } else {
        elevBand = 0;
      }

      scores[cr * coarseW + cc] = flatness * 3.0 + waterAccess * 2.0 + elevBand * 1.5;
    }
  }

  return { scores, coarseW, coarseH };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

function placeSettlements(
  scoreData, data, width, height, bounds, cellW, cellH, seaLevel,
  targetCities, targetVillages, targetHamlets,
  seed, rng
) {
  const { scores, coarseW, coarseH } = scoreData;
  const settlements = [];

  // Build candidate list with world coordinates pre-computed
  const candidates = [];
  for (let cr = 0; cr < coarseH; cr++) {
    for (let cc = 0; cc < coarseW; cc++) {
      const score = scores[cr * coarseW + cc];
      if (score > 0) {
        const wx = bounds.minX + (cc * COARSE_STEP + COARSE_STEP / 2) * cellW;
        const wz = bounds.minZ + (cr * COARSE_STEP + COARSE_STEP / 2) * cellH;
        candidates.push({ cr, cc, score, wx, wz, used: false });
      }
    }
  }

  // Place cities (first placed gets pure best-score; cities are few)
  const numCities = resolveCount(targetCities, rng);
  placeType('city', numCities, CITY_THRESHOLD, candidates, settlements,
    data, width, bounds, cellW, seed, rng);

  // Place villages (spread-aware)
  const numVillages = resolveCount(targetVillages, rng);
  placeType('village', numVillages, VILLAGE_THRESHOLD, candidates, settlements,
    data, width, bounds, cellW, seed, rng);

  // Place hamlets (spread-aware)
  const numHamlets = resolveCount(targetHamlets, rng);
  placeType('hamlet', numHamlets, HAMLET_THRESHOLD, candidates, settlements,
    data, width, bounds, cellW, seed, rng);

  return settlements;
}

/**
 * Place settlements of a given type using spread-aware selection.
 *
 * For each slot, every valid candidate is scored as:
 *   effectiveScore = baseScore + SPREAD_WEIGHT × minDistToExisting
 *
 * This prevents clustering: after placing one settlement, candidates
 * far from it get a bonus, distributing placements around the island.
 */
const SPREAD_WEIGHT = 3.0;

function placeType(
  type, count, threshold, candidates, settlements,
  data, width, bounds, cellW, seed, rng
) {
  const typeDef = SETTLEMENT_TYPES[type];

  for (let placed = 0; placed < count; placed++) {
    let bestScore = -Infinity;
    let bestIdx = -1;

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (cand.used || cand.score < threshold) continue;

      // Check spacing constraints
      if (!checkSpacing(type, cand.wx, cand.wz, settlements)) continue;

      // Compute spread bonus: reward distance from existing settlements
      let spreadBonus = 0;
      if (settlements.length > 0) {
        let minDist = Infinity;
        for (const s of settlements) {
          const dx = cand.wx - s.position[0];
          const dz = cand.wz - s.position[1];
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < minDist) minDist = d;
        }
        // Normalize: typical island diameter ~1.5, so distances are 0-2
        spreadBonus = SPREAD_WEIGHT * Math.min(minDist, 1.0);
      }

      const effectiveScore = cand.score + spreadBonus;
      if (effectiveScore > bestScore) {
        bestScore = effectiveScore;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) break;

    const cand = candidates[bestIdx];
    cand.used = true;

    // Look up elevation at center
    const col = Math.floor((cand.wx - bounds.minX) / cellW);
    const row = Math.floor((cand.wz - bounds.minZ) / cellW);
    const elev = data[row * width + col];

    const radius = typeDef.radiusMin + rng() * (typeDef.radiusMax - typeDef.radiusMin);
    const name = generateSettlementName(cand.wx, cand.wz, seed, type);

    settlements.push({
      id: `${type}_${placed}`,
      type,
      position: [cand.wx, cand.wz],
      elevation: elev,
      radius,
      name,
      terraces: [],
    });
  }
}

function checkSpacing(type, x, z, settlements) {
  const spacingReq = MIN_SPACING[type];
  for (const s of settlements) {
    const minDist = spacingReq[s.type];
    const dx = x - s.position[0];
    const dz = z - s.position[1];
    if (dx * dx + dz * dz < minDist * minDist) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Terrace generation
// ---------------------------------------------------------------------------

function generateTerraces(settlement, data, width, height, bounds, cellW, cellH, rng) {
  const { type, position, radius } = settlement;
  const [cx, cz] = position;
  const typeDef = SETTLEMENT_TYPES[type];

  // Sample elevations within footprint (every 4 grid cells)
  const sampleStep = 4;
  const samples = [];

  const minCol = Math.max(0, Math.floor((cx - radius - bounds.minX) / cellW));
  const maxCol = Math.min(width - 1, Math.ceil((cx + radius - bounds.minX) / cellW));
  const minRow = Math.max(0, Math.floor((cz - radius - bounds.minZ) / cellH));
  const maxRow = Math.min(height - 1, Math.ceil((cz + radius - bounds.minZ) / cellH));

  for (let r = minRow; r <= maxRow; r += sampleStep) {
    for (let c = minCol; c <= maxCol; c += sampleStep) {
      const wx = bounds.minX + (c + 0.5) * cellW;
      const wz = bounds.minZ + (r + 0.5) * cellH;
      const dx = wx - cx;
      const dz = wz - cz;
      if (dx * dx + dz * dz > radius * radius) continue;

      samples.push({
        x: wx,
        z: wz,
        elevation: data[r * width + c],
      });
    }
  }

  if (samples.length < 3) return [];

  // Determine elevation range
  let minElev = Infinity, maxElev = -Infinity;
  for (const s of samples) {
    if (s.elevation < minElev) minElev = s.elevation;
    if (s.elevation > maxElev) maxElev = s.elevation;
  }

  const elevRange = maxElev - minElev;

  // If terrain is already flat, single terrace
  if (elevRange < 0.004) {
    const meanElev = samples.reduce((sum, s) => sum + s.elevation, 0) / samples.length;
    const hull = convexHull(samples);
    if (hull.length < 3) return [];
    return [{
      polygon: hull.map(p => [p.x, p.z]),
      targetElevation: meanElev,
      area: polygonArea2D(hull),
      retainingWalls: [],
    }];
  }

  // Split into elevation bands (quantile-based)
  const maxTerraces = Math.min(
    typeDef.maxTerraces,
    Math.max(1, Math.floor(elevRange / 0.008))
  );

  // Sort samples by elevation for quantile splitting
  const sorted = samples.slice().sort((a, b) => a.elevation - b.elevation);
  const bandSize = Math.ceil(sorted.length / maxTerraces);

  const terraces = [];
  for (let band = 0; band < maxTerraces; band++) {
    const start = band * bandSize;
    const end = Math.min(start + bandSize, sorted.length);
    const bandSamples = sorted.slice(start, end);

    if (bandSamples.length < 3) continue;

    // Compute convex hull for this band
    const hull = convexHull(bandSamples);
    if (hull.length < 3) continue;

    // Target elevation is the rounded mean of the band
    const bandMean = bandSamples.reduce((s, p) => s + p.elevation, 0) / bandSamples.length;

    terraces.push({
      polygon: hull.map(p => [p.x, p.z]),
      targetElevation: bandMean,
      area: polygonArea2D(hull),
      retainingWalls: [],
    });
  }

  // Sort terraces by elevation (lowest first)
  terraces.sort((a, b) => a.targetElevation - b.targetElevation);

  // Identify retaining walls between adjacent terraces
  for (let i = 0; i < terraces.length - 1; i++) {
    const lower = terraces[i];
    const upper = terraces[i + 1];
    const heightDiff = upper.targetElevation - lower.targetElevation;

    if (heightDiff > 0.002) {
      // Find closest edge segments between the two polygons
      const walls = findRetainingWalls(lower.polygon, upper.polygon, heightDiff);
      lower.retainingWalls = walls;
    }
  }

  return terraces;
}

/**
 * Find retaining wall segments between two terrace polygons.
 * Uses edge midpoints of the upper polygon that are closest to the lower polygon.
 */
function findRetainingWalls(lowerPoly, upperPoly, heightDiff) {
  const walls = [];

  for (let i = 0; i < upperPoly.length; i++) {
    const j = (i + 1) % upperPoly.length;
    const [ax, az] = upperPoly[i];
    const [bx, bz] = upperPoly[j];

    // Check if this edge midpoint is near the lower polygon
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;

    let minDist = Infinity;
    for (let k = 0; k < lowerPoly.length; k++) {
      const l = (k + 1) % lowerPoly.length;
      const d = pointToSegDist(mx, mz, lowerPoly[k][0], lowerPoly[k][1], lowerPoly[l][0], lowerPoly[l][1]);
      if (d < minDist) minDist = d;
    }

    // If edge is close to lower terrace, it's a retaining wall
    if (minDist < 0.02) {
      walls.push({
        start: [ax, az],
        end: [bx, bz],
        height: heightDiff,
      });
    }
  }

  return walls;
}

function pointToSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return distance(px, pz, ax, az);
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1);
  const cx = ax + t * dx, cz = az + t * dz;
  return distance(px, pz, cx, cz);
}

function polygonArea2D(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].z - points[j].x * points[i].z;
  }
  return Math.abs(area) / 2;
}
