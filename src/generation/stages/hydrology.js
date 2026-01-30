/**
 * Stage 4: Hydrology
 *
 * Rivers start near spine vertices and trace downhill via gradient descent.
 * When a river hits a local minimum (bowl), we flood-fill to find the spill
 * point and continue from there.  Small depressions (noise) are hopped over
 * silently; large depressions become lakes.
 */

import { deriveSeed, seededRandom } from '../../core/seeds.js';
import { createSimplexNoise } from '../../core/noise.js';
import { clamp, pointToSegmentDistance } from '../../core/math.js';
import { extractContours, simplifyPolyline } from '../../geometry/contour.js';

// ---------------------------------------------------------------------------
// D8 neighbor offsets: N, NE, E, SE, S, SW, W, NW
// ---------------------------------------------------------------------------

const D8_DC = [0, 1, 1, 1, 0, -1, -1, -1];
const D8_DR = [-1, -1, 0, 1, 1, 1, 0, -1];

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

const BASE_RIVER_WIDTH = 0.006;
const MEANDER_AMPLITUDE = 0.006;
const MEANDER_FREQUENCY = 15;

/** Minimum filled cells for a depression to be recorded as a lake */
const MIN_LAKE_CELLS = 20;

/** Minimum depth (waterLevel − bowlElev) to count as a lake */
const MIN_LAKE_DEPTH = 0.005;

/** Cap on cells the flood-fill will explore per depression */
const MAX_FILL_CELLS = 5000;

// ---------------------------------------------------------------------------
// Binary min-heap keyed on elevation (for efficient priority-flood)
// ---------------------------------------------------------------------------

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[i].elev >= this.items[p].elev) break;
      [this.items[i], this.items[p]] = [this.items[p], this.items[i]];
      i = p;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      while (true) {
        let s = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < this.items.length && this.items[l].elev < this.items[s].elev) s = l;
        if (r < this.items.length && this.items[r].elev < this.items[s].elev) s = r;
        if (s === i) break;
        [this.items[i], this.items[s]] = [this.items[s], this.items[i]];
        i = s;
      }
    }
    return top;
  }
  get size() { return this.items.length; }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @param {Object} params    – { seaLevel, … }
 * @param {Object} elevation – { width, height, data: Float32Array, bounds }
 * @param {number} seed
 * @param {Object} [spines]  – { vertices, segments }
 */
export function generateHydrology(params, elevation, seed, spines) {
  const { width, height, data, bounds } = elevation;
  const { seaLevel } = params;
  const hydroSeed = deriveSeed(seed, 'hydrology');
  const cellW = (bounds.maxX - bounds.minX) / width;
  const cellH = (bounds.maxZ - bounds.minZ) / height;
  const rng = seededRandom(deriveSeed(hydroSeed, 'sources'));
  const meanderNoise = createSimplexNoise(deriveSeed(hydroSeed, 'meander'));

  // 1. Pick sources near spine vertices / segments
  const sources = pickSpineSources(
    spines, data, width, height, bounds, cellW, cellH, seaLevel, rng
  );

  // 2. Trace each river downhill, hopping over depressions
  const rivers = [];
  const lakes = [];
  const depressionStats = { count: 0, maxCells: 0, maxDepth: 0 };

  for (let i = 0; i < sources.length; i++) {
    const { river, newLakes, stats } = traceRiver(
      data, width, height, bounds, cellW, cellH,
      sources[i].col, sources[i].row,
      seaLevel, meanderNoise, `river_${i}`
    );
    if (river && river.vertices.length >= 2) {
      rivers.push(river);
    }
    for (const lk of newLakes) lakes.push(lk);
    if (stats) {
      depressionStats.count += stats.count;
      if (stats.maxCells > depressionStats.maxCells) depressionStats.maxCells = stats.maxCells;
      if (stats.maxDepth > depressionStats.maxDepth) depressionStats.maxDepth = stats.maxDepth;
    }
  }

  console.log(`[hydrology] ${sources.length} sources → ${rivers.length} rivers (${rivers.filter(r => r.termination === 'coast').length} reach coast), ${lakes.length} river lakes`);

  // 2b. Place lakes explicitly at suitable flat locations
  const lakeRng = seededRandom(deriveSeed(hydroSeed, 'lakes'));
  const placedLakes = placeExplicitLakes(
    data, width, height, bounds, cellW, cellH, seaLevel, spines, lakeRng, meanderNoise
  );
  for (const lk of placedLakes) lakes.push(lk);

  console.log(`[hydrology] ${placedLakes.length} placed lakes (total: ${lakes.length})`);

  // 3. SDFs
  const riverSDF = computeRiverSDF(rivers, width, height, bounds, cellW);
  const lakeSDF = computeLakeSDF(lakes, data, width, height, bounds, cellW, seaLevel);

  return { rivers, lakes, riverSDF, lakeSDF, width, height };
}

// ---------------------------------------------------------------------------
// Source selection
// ---------------------------------------------------------------------------

function pickSpineSources(spines, data, width, height, bounds, cellW, cellH, seaLevel, rng) {
  if (!spines?.vertices?.length) return [];

  const sources = [];
  const MIN_SPACING_SQ = 25 * 25;

  // Helper: add a source if it passes spacing check
  const tryAdd = (col, row) => {
    if (col < 1 || col >= width - 1 || row < 1 || row >= height - 1) return;
    const elev = data[row * width + col];
    if (elev <= seaLevel) return;
    for (const s of sources) {
      const dr = row - s.row, dc = col - s.col;
      if (dr * dr + dc * dc < MIN_SPACING_SQ) return;
    }
    sources.push({ col, row, elev });
  };

  // From each high-elevation vertex, place a source offset downhill
  for (const v of spines.vertices) {
    if (v.elevation < 0.18) continue;

    const vc = Math.floor((v.x - bounds.minX) / cellW);
    const vr = Math.floor((v.z - bounds.minZ) / cellH);

    // Try offsets at several distances on all 8 directions
    const OFFSETS = [6, 12, 18];
    const candidates = [];
    for (const off of OFFSETS) {
      for (let d = 0; d < 8; d++) {
        const oc = vc + D8_DC[d] * off;
        const or_ = vr + D8_DR[d] * off;
        if (oc < 1 || oc >= width - 1 || or_ < 1 || or_ >= height - 1) continue;
        const elev = data[or_ * width + oc];
        if (elev > seaLevel && elev < v.elevation * 0.9) {
          candidates.push({ col: oc, row: or_, elev, drop: v.elevation - elev });
        }
      }
    }
    if (!candidates.length) continue;
    // Prefer candidates with a large elevation drop (clear slope)
    candidates.sort((a, b) => b.drop - a.drop);
    const pick = candidates[Math.floor(rng() * Math.min(candidates.length, 4))];
    tryAdd(pick.col, pick.row);
  }

  // From segment midpoints, offset perpendicular
  if (spines.segments) {
    for (const seg of spines.segments) {
      const vA = spines.vertices[seg.from];
      const vB = spines.vertices[seg.to];
      if (!vA || !vB) continue;
      const midElev = (vA.elevation + vB.elevation) / 2;
      if (midElev < 0.18) continue;

      const mx = (vA.x + vB.x) / 2;
      const mz = (vA.z + vB.z) / 2;
      const dx = vB.x - vA.x, dz = vB.z - vA.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) continue;
      const px = -dz / len, pz = dx / len;

      const sides = rng() < 0.5 ? [1, -1] : [-1, 1];
      for (const side of sides) {
        for (const dist of [12, 20]) {
          const ox = mx + px * side * cellW * dist;
          const oz = mz + pz * side * cellH * dist;
          const oc = Math.floor((ox - bounds.minX) / cellW);
          const or_ = Math.floor((oz - bounds.minZ) / cellH);
          tryAdd(oc, or_);
        }
      }
    }
  }

  return sources;
}

// ---------------------------------------------------------------------------
// River tracing with depression hopping
// ---------------------------------------------------------------------------

function traceRiver(
  data, width, height, bounds, cellW, cellH,
  startCol, startRow, seaLevel, meanderNoise, riverId
) {
  const rawVertices = [];
  const newLakes = [];
  const depStats = { count: 0, maxCells: 0, maxDepth: 0 };
  let col = startCol, row = startRow;
  let termination = 'edge';

  const visited = new Set();
  const MAX_STEPS = 8000;
  let step = 0;

  while (step < MAX_STEPS) {
    if (col < 0 || col >= width || row < 0 || row >= height) {
      termination = 'edge';
      break;
    }

    const idx = row * width + col;
    if (visited.has(idx)) break;
    visited.add(idx);

    const elev = data[idx];

    // World position + meander
    const wx = bounds.minX + (col + 0.5) * cellW;
    const wz = bounds.minZ + (row + 0.5) * cellH;
    let mx = wx, mz = wz;
    if (step > 3) {
      mx += meanderNoise(wx * MEANDER_FREQUENCY, wz * MEANDER_FREQUENCY) * MEANDER_AMPLITUDE;
      mz += meanderNoise(wx * MEANDER_FREQUENCY + 97, wz * MEANDER_FREQUENCY + 97) * MEANDER_AMPLITUDE;
    }

    // Width grows with distance from source
    const t = Math.min(step / 300, 1);
    const riverWidth = BASE_RIVER_WIDTH * (0.3 + Math.sqrt(t) * 1.7);

    rawVertices.push({ x: mx, z: mz, elevation: elev, flow: step, width: riverWidth });

    // Reached sea level → coast
    if (elev <= seaLevel) {
      termination = 'coast';
      break;
    }

    // ── gradient descent: find lowest neighbor ─────────────────────
    let bestElev = elev, bestR = -1, bestC = -1;
    for (let d = 0; d < 8; d++) {
      const nr = row + D8_DR[d], nc = col + D8_DC[d];
      if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
      if (visited.has(nr * width + nc)) continue;
      const ne = data[nr * width + nc];
      if (ne < bestElev) { bestElev = ne; bestR = nr; bestC = nc; }
    }

    if (bestR >= 0 && bestElev < elev) {
      // Normal downhill step
      row = bestR; col = bestC; step++; continue;
    }

    // ── local minimum → flood-fill to find the spill point ─────────
    const fill = findSpillPoint(data, width, height, col, row, seaLevel, visited);

    if (!fill) {
      termination = 'basin';
      break;
    }

    // Mark all filled cells as visited so we never re-enter this depression
    for (const ci of fill.filledCells) visited.add(ci);

    // Track depression stats
    depStats.count++;
    if (fill.filledCount > depStats.maxCells) depStats.maxCells = fill.filledCount;
    const depth = fill.waterLevel - fill.bowlElev;
    if (depth > depStats.maxDepth) depStats.maxDepth = depth;

    // If the depression is big enough, record it as a lake
    if (fill.filledCount >= MIN_LAKE_CELLS &&
        fill.waterLevel - fill.bowlElev >= MIN_LAKE_DEPTH) {
      const lake = buildLake(
        data, width, height, bounds, cellW, cellH,
        fill, seaLevel
      );
      if (lake) newLakes.push(lake);
    }

    // Always continue from the spill point (hop over tiny depressions)
    col = fill.spillCol;
    row = fill.spillRow;
    step++;
  }

  if (rawVertices.length < 3) {
    return { river: null, newLakes, stats: depStats };
  }

  // Enforce monotonically decreasing elevation before simplification
  enforceMonotonicRaw(rawVertices, seaLevel);

  const vertices = simplifyRiverPath(rawVertices, cellW * 0.6);
  const river = { id: riverId, vertices, termination, terminatingLakeId: null };
  return { river, newLakes, stats: depStats };
}

// ---------------------------------------------------------------------------
// Explicit lake placement
//
// Places lakes at suitable flat locations with noise-perturbed elliptical
// boundaries. Does NOT modify the elevation grid — lakes are purely geometric
// overlays, so they produce no visible terrain artifacts.
// ---------------------------------------------------------------------------

function placeExplicitLakes(data, width, height, bounds, cellW, cellH, seaLevel, spines, rng, meanderNoise) {
  const NUM_CANDIDATES = 80;
  const MAX_LAKES = 6;
  const MIN_LAKE_SPACING_SQ = 0.08 * 0.08; // world-coord squared
  const BOUNDARY_POINTS = 36;

  const { vertices, segments } = spines || {};
  if (!segments || !vertices) return [];

  // 1. Generate candidate locations
  const candidates = [];
  for (let i = 0; i < NUM_CANDIDATES; i++) {
    const col = Math.floor(rng() * (width - 80)) + 40;
    const row = Math.floor(rng() * (height - 80)) + 40;
    const elev = data[row * width + col];

    // Must be well above sea level but not on peaks
    if (elev < seaLevel + 0.05 || elev > 0.38) continue;

    // Check local flatness — variance in 11×11 neighborhood
    let sumE = 0, sumE2 = 0, cnt = 0;
    for (let dr = -5; dr <= 5; dr++) {
      for (let dc = -5; dc <= 5; dc++) {
        const e = data[(row + dr) * width + (col + dc)];
        sumE += e;
        sumE2 += e * e;
        cnt++;
      }
    }
    const mean = sumE / cnt;
    const variance = sumE2 / cnt - mean * mean;
    if (variance > 0.001) continue;

    // Must be away from spine ridges
    const wx = bounds.minX + (col + 0.5) * cellW;
    const wz = bounds.minZ + (row + 0.5) * cellH;
    let minSpineDist = Infinity;
    for (const seg of segments) {
      const vA = vertices[seg.from];
      const vB = vertices[seg.to];
      const result = pointToSegmentDistance(wx, wz, vA.x, vA.z, vB.x, vB.z);
      minSpineDist = Math.min(minSpineDist, result.distance);
    }
    if (minSpineDist < 0.06) continue;

    // Score: flat areas at moderate elevation, away from ridges
    const flatScore = 1 - Math.min(variance / 0.001, 1);
    const elevScore = 1 - Math.abs(elev - 0.20) * 5;
    const distScore = Math.min(minSpineDist * 4, 1);
    candidates.push({
      col, row, wx, wz, elev,
      score: flatScore * 0.5 + elevScore * 0.3 + distScore * 0.2,
    });
  }

  // 2. Sort by score, enforce spacing
  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const c of candidates) {
    if (selected.length >= MAX_LAKES) break;
    let tooClose = false;
    for (const s of selected) {
      const dx = c.wx - s.wx, dz = c.wz - s.wz;
      if (dx * dx + dz * dz < MIN_LAKE_SPACING_SQ) { tooClose = true; break; }
    }
    if (tooClose) continue;
    selected.push(c);
  }

  // 3. Build each lake with a noise-perturbed elliptical boundary
  const lakes = [];
  for (const loc of selected) {
    const a = 0.025 + rng() * 0.04;       // semi-major axis (world coords)
    const b = a * (0.55 + rng() * 0.45);   // semi-minor axis (55-100% of a)
    const rotation = rng() * Math.PI;       // random orientation
    const cosA = Math.cos(rotation), sinA = Math.sin(rotation);

    // Water level sits at local terrain elevation
    const waterLevel = loc.elev;

    // Generate boundary polygon with noise perturbation for organic shape
    const boundary = [];
    for (let j = 0; j < BOUNDARY_POINTS; j++) {
      const theta = (j / BOUNDARY_POINTS) * Math.PI * 2;
      const cosT = Math.cos(theta), sinT = Math.sin(theta);

      // Ellipse radius at this angle
      const baseR = (a * b) / Math.sqrt((b * cosT) ** 2 + (a * sinT) ** 2);

      // Low-frequency noise perturbation for organic edges
      const n1 = meanderNoise(loc.wx + cosT * 3.7, loc.wz + sinT * 3.7);
      const n2 = meanderNoise(loc.wx + cosT * 7.3 + 50, loc.wz + sinT * 7.3 + 50);
      const r = baseR * (1 + n1 * 0.3 + n2 * 0.12);

      // Rotate and translate to world position
      const lx = r * cosT, lz = r * sinT;
      boundary.push({
        x: loc.wx + lx * cosA - lz * sinA,
        z: loc.wz + lx * sinA + lz * cosA,
      });
    }

    // Shoelace area
    let area = 0;
    for (let j = 0; j < boundary.length; j++) {
      const k = (j + 1) % boundary.length;
      area += boundary[j].x * boundary[k].z - boundary[k].x * boundary[j].z;
    }
    area = Math.abs(area) / 2;

    lakes.push({
      id: `lake_${loc.col}_${loc.row}`,
      x: loc.wx, z: loc.wz,
      waterLevel,
      spillElevation: waterLevel,
      spillPoint: null,
      area,
      boundary,
      endorheic: true,
      inflowRiverIds: [],
      outflowRiverId: null,
    });
  }

  return lakes;
}

// ---------------------------------------------------------------------------
// Flood-fill a depression to find where water would spill out
//
// Priority-flood that absorbs cells from the bowl outward in elevation order.
// Water level rises as higher cells are absorbed (climbing the bowl walls).
// The spill point is found when a newly-discovered neighbor is LOWER than the
// accumulated water level — that's the rim, and water overflows there.
//
// This correctly handles smooth bowls where every cell is slightly higher
// than its inner neighbor (the old "first cell above waterLevel" approach
// would declare spill after absorbing only the center cell).
// ---------------------------------------------------------------------------

function findSpillPoint(data, width, height, bowlCol, bowlRow, seaLevel, visited) {
  const bowlIdx = bowlRow * width + bowlCol;
  const bowlElev = data[bowlIdx];

  const filled = new Set();
  filled.add(bowlIdx);

  const heap = new MinHeap();
  const inBoundary = new Set();

  // Seed boundary with bowl-center neighbors
  for (let d = 0; d < 8; d++) {
    const nr = bowlRow + D8_DR[d], nc = bowlCol + D8_DC[d];
    if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
    const ni = nr * width + nc;
    if (!visited.has(ni)) {
      heap.push({ idx: ni, elev: data[ni] });
      inBoundary.add(ni);
    }
  }

  let waterLevel = bowlElev;
  let spillIdx = -1;

  while (heap.size > 0 && filled.size < MAX_FILL_CELLS) {
    const cell = heap.pop();

    // Ocean escape — water reached the sea
    if (cell.elev <= seaLevel) {
      spillIdx = cell.idx;
      break;
    }

    // Absorb this cell — water rises to at least this elevation
    filled.add(cell.idx);
    waterLevel = Math.max(waterLevel, cell.elev);

    const cr = Math.floor(cell.idx / width);
    const cc = cell.idx % width;

    // Examine neighbors: look for escape route (lower than water level)
    let escaped = false;
    for (let d = 0; d < 8; d++) {
      const nr = cr + D8_DR[d], nc = cc + D8_DC[d];
      if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
      const ni = nr * width + nc;
      if (filled.has(ni) || visited.has(ni)) continue;

      if (!inBoundary.has(ni)) {
        const ne = data[ni];
        if (ne < waterLevel) {
          // Newly discovered cell below water level — water escapes here
          spillIdx = ni;
          escaped = true;
          break;
        }
        heap.push({ idx: ni, elev: ne });
        inBoundary.add(ni);
      }
    }
    if (escaped) break;
  }

  if (spillIdx < 0) return null;

  const spillRow = Math.floor(spillIdx / width);
  const spillCol = spillIdx % width;

  return {
    spillCol,
    spillRow,
    bowlElev,
    waterLevel,
    filledCount: filled.size,
    filledCells: filled,
  };
}

// ---------------------------------------------------------------------------
// Build a lake object from a significant depression
// ---------------------------------------------------------------------------

function buildLake(data, width, height, bounds, cellW, cellH, fill, seaLevel) {
  const { filledCells, waterLevel, spillCol, spillRow } = fill;

  let sumX = 0, sumZ = 0;
  let minCol = width, maxCol = 0, minRow = height, maxRow = 0;

  for (const ci of filledCells) {
    const cr = Math.floor(ci / width), cc = ci % width;
    sumX += bounds.minX + (cc + 0.5) * cellW;
    sumZ += bounds.minZ + (cr + 0.5) * cellH;
    if (cc < minCol) minCol = cc;
    if (cc > maxCol) maxCol = cc;
    if (cr < minRow) minRow = cr;
    if (cr > maxRow) maxRow = cr;
  }

  const cx = sumX / filledCells.size;
  const cz = sumZ / filledCells.size;
  const area = filledCells.size * cellW * cellH;

  // Contour boundary
  const sampleFn = (x, z) => {
    const c = Math.floor((x - bounds.minX) / cellW);
    const r = Math.floor((z - bounds.minZ) / cellH);
    if (c < 0 || c >= width || r < 0 || r >= height) return 0;
    return data[r * width + c];
  };

  const pad = 5;
  const regionBounds = {
    minX: bounds.minX + Math.max(0, minCol - pad) * cellW,
    maxX: bounds.minX + Math.min(width, maxCol + pad + 1) * cellW,
    minZ: bounds.minZ + Math.max(0, minRow - pad) * cellH,
    maxZ: bounds.minZ + Math.min(height, maxRow + pad + 1) * cellH,
  };

  let boundary = [];
  try {
    const res = cellW * 2;
    const contours = extractContours(sampleFn, waterLevel, regionBounds, res);
    if (contours.length) {
      boundary = contours.reduce((a, b) => a.length > b.length ? a : b);
      boundary = simplifyPolyline(boundary, res * 0.5);
    }
  } catch (_) { /* no boundary */ }

  const spillPoint = {
    x: bounds.minX + (spillCol + 0.5) * cellW,
    z: bounds.minZ + (spillRow + 0.5) * cellH,
  };

  return {
    id: `lake_${minCol}_${minRow}`,
    x: cx, z: cz,
    waterLevel,
    spillElevation: data[spillRow * width + spillCol],
    spillPoint,
    area,
    boundary,
    endorheic: false,
    inflowRiverIds: [],
    outflowRiverId: null,
  };
}

// ---------------------------------------------------------------------------
// Monotonic elevation enforcement
// ---------------------------------------------------------------------------

/**
 * Enforce monotonically decreasing elevation along raw river vertices.
 * Also applies a smooth ramp to sea level over the final 30% of the river.
 * @param {Array} vertices - Raw river vertices with elevation
 * @param {number} seaLevel - Sea level threshold
 */
function enforceMonotonicRaw(vertices, seaLevel) {
  if (vertices.length < 2) return;

  // Forward pass: each vertex must be <= its predecessor
  for (let i = 1; i < vertices.length; i++) {
    if (vertices[i].elevation > vertices[i - 1].elevation) {
      vertices[i].elevation = vertices[i - 1].elevation;
    }
  }

  // If the river doesn't reach sea level, ramp the last 30% toward it
  const last = vertices[vertices.length - 1];
  if (last.elevation > seaLevel) {
    const startIdx = Math.floor(vertices.length * 0.7);
    const startElev = vertices[startIdx].elevation;
    for (let i = startIdx; i < vertices.length; i++) {
      const t = (i - startIdx) / (vertices.length - 1 - startIdx);
      const ramped = startElev + (seaLevel - startElev) * t;
      vertices[i].elevation = Math.min(vertices[i].elevation, ramped);
    }
  }

  // Second forward pass to clean up any ramp artifacts
  for (let i = 1; i < vertices.length; i++) {
    if (vertices[i].elevation > vertices[i - 1].elevation) {
      vertices[i].elevation = vertices[i - 1].elevation;
    }
  }
}

// ---------------------------------------------------------------------------
// River path simplification (Douglas-Peucker)
// ---------------------------------------------------------------------------

function simplifyRiverPath(vertices, epsilon) {
  if (vertices.length <= 3) return vertices;

  let maxDist = 0, maxIdx = 0;
  const s = vertices[0], e = vertices[vertices.length - 1];

  for (let i = 1; i < vertices.length - 1; i++) {
    const d = perpDist(vertices[i], s, e);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    const left = simplifyRiverPath(vertices.slice(0, maxIdx + 1), epsilon);
    const right = simplifyRiverPath(vertices.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [s, e];
}

function perpDist(pt, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.sqrt((pt.x - a.x) ** 2 + (pt.z - a.z) ** 2);
  const t = clamp(((pt.x - a.x) * dx + (pt.z - a.z) * dz) / lenSq, 0, 1);
  return Math.sqrt((pt.x - a.x - t * dx) ** 2 + (pt.z - a.z - t * dz) ** 2);
}

// ---------------------------------------------------------------------------
// SDF helpers (unchanged)
// ---------------------------------------------------------------------------

function computeRiverSDF(rivers, width, height, bounds, cellW) {
  const n = width * height;
  const mask = new Uint8Array(n);
  for (const r of rivers) {
    for (const v of r.vertices) {
      const c = Math.floor((v.x - bounds.minX) / cellW);
      const rr = Math.floor((v.z - bounds.minZ) / cellW);
      if (c >= 0 && c < width && rr >= 0 && rr < height) mask[rr * width + c] = 1;
    }
  }
  return chamfer(mask, width, height, cellW);
}

function computeLakeSDF(lakes, data, width, height, bounds, cellW, seaLevel) {
  const n = width * height;
  const mask = new Uint8Array(n);
  for (const lake of lakes) {
    const cc = Math.floor((lake.x - bounds.minX) / cellW);
    const cr = Math.floor((lake.z - bounds.minZ) / cellW);
    const rad = Math.ceil(Math.sqrt(lake.area) / cellW) + 5;
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        const r = cr + dr, c = cc + dc;
        if (r < 0 || r >= height || c < 0 || c >= width) continue;
        const idx = r * width + c;
        if (data[idx] <= lake.waterLevel && data[idx] > seaLevel) mask[idx] = 1;
      }
    }
  }

  const outside = chamfer(mask, width, height, cellW);
  const inv = new Uint8Array(n);
  for (let i = 0; i < n; i++) inv[i] = mask[i] ? 0 : 1;
  const inside = chamfer(inv, width, height, cellW);

  const sdf = new Float32Array(n);
  for (let i = 0; i < n; i++) sdf[i] = mask[i] ? -inside[i] : outside[i];
  return sdf;
}

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
