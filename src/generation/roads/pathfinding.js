/**
 * Terrain-aware A* pathfinding
 *
 * Finds optimal paths on the elevation grid for road construction,
 * penalising steep slopes and river crossings. Uses soft penalties
 * everywhere (no hard blocks except deep water) to guarantee paths
 * connect settlements.
 */

import { distance } from '../../core/math.js';

// ---------------------------------------------------------------------------
// Road type configuration
//
// maxSlope = gradient threshold in normalized-elevation / world-distance.
// Terrain is [0,1] elevation over [-1,1] world. Typical cell-to-cell
// elevation difference is 0.0005–0.005, cellW ~0.004, so gradients
// range 0.1–1.3.  These thresholds are tuned for that scale.
// ---------------------------------------------------------------------------

const ROAD_TYPES = {
  highway: { maxSlope: 0.6,  bridgeCostMult: 1.5, tunnelCostMult: 2.0 },
  road:    { maxSlope: 1.0,  bridgeCostMult: 2.0, tunnelCostMult: 3.0 },
  path:    { maxSlope: 1.8,  bridgeCostMult: 4.0, tunnelCostMult: 5.0 },
};

// D8 neighbor offsets: N, NE, E, SE, S, SW, W, NW
const D8_DR = [-1, -1, 0, 1, 1, 1, 0, -1];
const D8_DC = [0, 1, 1, 1, 0, -1, -1, -1];
const SQRT2 = Math.SQRT2;

// River crossing threshold in world units (SDF value below this = on river)
const RIVER_CROSS_THRESHOLD = 0.008;

// Max bridge span — if river SDF region is wider than this, find another way
const MAX_BRIDGE_SPAN_CELLS = 15;

// ---------------------------------------------------------------------------
// Min-heap keyed on f-cost
// ---------------------------------------------------------------------------

class MinHeap {
  constructor() { this.items = []; }

  push(item) {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[i].f >= this.items[p].f) break;
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
        if (l < this.items.length && this.items[l].f < this.items[s].f) s = l;
        if (r < this.items.length && this.items[r].f < this.items[s].f) s = r;
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
// Path simplification (Douglas-Peucker)
// ---------------------------------------------------------------------------

function perpDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return distance(px, pz, ax, az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return distance(px, pz, ax + t * dx, az + t * dz);
}

function simplifyDP(points, epsilon) {
  if (points.length <= 2) return points;

  let maxDist = 0, maxIdx = 0;
  const first = points[0], last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i].x, points[i].z, first.x, first.z, last.x, last.z);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    const left = simplifyDP(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyDP(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

// ---------------------------------------------------------------------------
// Fallback: straight-line path with elevation sampling
// ---------------------------------------------------------------------------

function straightLinePath(start, end, elevation) {
  const { width, height, data, bounds } = elevation;
  const cellW = (bounds.maxX - bounds.minX) / width;
  const cellH = (bounds.maxZ - bounds.minZ) / height;

  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const dist = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.max(2, Math.ceil(dist / cellW));

  const waypoints = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = start[0] + dx * t;
    const z = start[1] + dz * t;
    const c = Math.max(0, Math.min(width - 1, Math.round((x - bounds.minX) / cellW)));
    const r = Math.max(0, Math.min(height - 1, Math.round((z - bounds.minZ) / cellH)));
    waypoints.push({ x, z, elevation: data[r * width + c] });
  }
  return waypoints;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find an optimal terrain-aware path between two world-space points.
 *
 * Uses soft penalties (never hard-blocks except deep lake interior)
 * to guarantee paths reach from start to goal. Falls back to a straight
 * line if A* truly cannot find a path.
 *
 * @param {Object} params
 * @param {[number,number]} params.start - [x, z] world coordinates
 * @param {[number,number]} params.end   - [x, z] world coordinates
 * @param {Object} params.elevation      - { width, height, data: Float32Array, bounds }
 * @param {Float32Array} params.riverSDF - River distance field (unsigned)
 * @param {Float32Array} params.lakeSDF  - Lake distance field (signed, negative inside)
 * @param {string} params.roadType       - 'highway' | 'road' | 'path'
 * @param {Uint8Array|null} params.roadMask - Binary mask of existing roads (1=road)
 * @param {number} params.seaLevel
 * @returns {{ waypoints: Array<{x,z,elevation}>, cost: number }}
 */
export function findPath({ start, end, elevation, riverSDF, lakeSDF, roadType, roadMask, seaLevel }) {
  const { width, height, data, bounds } = elevation;
  const config = ROAD_TYPES[roadType];
  const cellW = (bounds.maxX - bounds.minX) / width;
  const cellH = (bounds.maxZ - bounds.minZ) / height;

  // Convert world coords to grid coords
  const sc = Math.max(0, Math.min(width - 1, Math.round((start[0] - bounds.minX) / cellW)));
  const sr = Math.max(0, Math.min(height - 1, Math.round((start[1] - bounds.minZ) / cellH)));
  const gc = Math.max(0, Math.min(width - 1, Math.round((end[0] - bounds.minX) / cellW)));
  const gr = Math.max(0, Math.min(height - 1, Math.round((end[1] - bounds.minZ) / cellH)));

  const n = width * height;
  const gScore = new Float32Array(n);
  gScore.fill(Infinity);
  const closed = new Uint8Array(n);
  const cameFrom = new Int32Array(n);
  cameFrom.fill(-1);

  const startIdx = sr * width + sc;
  const goalIdx = gr * width + gc;
  gScore[startIdx] = 0;

  // Euclidean heuristic (admissible)
  function heuristic(col, row) {
    const dx = (col - gc) * cellW;
    const dz = (row - gr) * cellH;
    return Math.sqrt(dx * dx + dz * dz);
  }

  const open = new MinHeap();
  open.push({ row: sr, col: sc, f: heuristic(sc, sr) });

  // Limit iterations to avoid infinite loops on huge grids
  const maxIterations = width * height;
  let iterations = 0;

  while (open.size > 0 && iterations < maxIterations) {
    iterations++;
    const cur = open.pop();
    const idx = cur.row * width + cur.col;

    if (closed[idx]) continue;
    closed[idx] = 1;

    if (idx === goalIdx) {
      // Reconstruct path
      const gridPath = [];
      let ci = idx;
      while (ci !== -1) {
        gridPath.push(ci);
        ci = cameFrom[ci];
      }
      gridPath.reverse();

      // Count underwater cells for filtering
      let underwaterCount = 0;
      for (const gi of gridPath) {
        if (data[gi] <= seaLevel) underwaterCount++;
      }
      const underwaterFraction = gridPath.length > 0 ? underwaterCount / gridPath.length : 0;

      // Convert grid path to world-space waypoints
      const waypoints = gridPath.map(gi => {
        const r = (gi / width) | 0;
        const c = gi % width;
        return {
          x: bounds.minX + c * cellW,
          z: bounds.minZ + r * cellH,
          elevation: data[gi],
        };
      });

      // Simplify to remove grid stepping artifacts (tighter epsilon for terrain conformance)
      const simplified = simplifyDP(waypoints, cellW * 1.0);
      return { waypoints: simplified, cost: gScore[goalIdx], underwaterFraction };
    }

    for (let d = 0; d < 8; d++) {
      const nr = cur.row + D8_DR[d];
      const nc = cur.col + D8_DC[d];
      if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;

      const ni = nr * width + nc;
      if (closed[ni]) continue;

      // Base step distance
      const isDiag = d % 2 !== 0;
      const stepDist = isDiag ? cellW * SQRT2 : cellW;

      const fromElev = data[idx];
      const toElev = data[ni];
      let cost = stepDist;

      // --- Underwater penalty (soft, not hard block) ---
      if (toElev <= seaLevel) {
        // Heavy penalty to discourage but not block
        const depth = seaLevel - toElev;
        cost += stepDist * 50 + depth * 500;
      }

      // --- Lake interior: very high penalty (effectively blocked) ---
      if (lakeSDF && lakeSDF[ni] < -0.01) {
        // Deep inside lake — practically impassable
        cost += stepDist * 200;
      } else if (lakeSDF && lakeSDF[ni] < 0) {
        // Lake edge — high but crossable penalty
        cost += stepDist * 50;
      }

      // --- Slope penalty (smooth, no hard block) ---
      const gradient = Math.abs(toElev - fromElev) / stepDist;
      if (gradient > config.maxSlope) {
        // Above comfortable slope: quadratic penalty
        const ratio = gradient / config.maxSlope;
        cost += stepDist * ratio * ratio * 3.0;
      } else {
        // Within slope limit: mild linear penalty
        cost += stepDist * (gradient / config.maxSlope) * 0.3;
      }

      // --- River crossing: bridge penalty with perpendicularity incentive ---
      if (riverSDF && riverSDF[ni] < RIVER_CROSS_THRESHOLD) {
        cost += config.bridgeCostMult * stepDist * 3.0;

        // Encourage perpendicular crossings using SDF gradient direction.
        // The SDF gradient points across the river; steps aligned with it
        // are perpendicular crossings (cheap), steps along the river are not (expensive).
        const riC = Math.min(nc + 1, width - 1);
        const liC = Math.max(nc - 1, 0);
        const biR = Math.min(nr + 1, height - 1);
        const tiR = Math.max(nr - 1, 0);
        const gx = riverSDF[nr * width + riC] - riverSDF[nr * width + liC];
        const gz = riverSDF[biR * width + nc] - riverSDF[tiR * width + nc];
        const glen = Math.sqrt(gx * gx + gz * gz);

        if (glen > 1e-8) {
          const sx = D8_DC[d], sz = D8_DR[d];
          const slen = isDiag ? SQRT2 : 1.0;
          // dot ≈ 1 → perpendicular crossing (good), dot ≈ 0 → along river (bad)
          const dot = Math.abs(sx * gx + sz * gz) / (slen * glen);
          cost += (1 - dot) * stepDist * config.bridgeCostMult * 2.0;
        }
      }

      // --- Existing road discount (strong to encourage road sharing) ---
      if (roadMask && roadMask[ni]) {
        cost *= 0.15;
      }

      const tentativeG = gScore[idx] + cost;
      if (tentativeG < gScore[ni]) {
        gScore[ni] = tentativeG;
        cameFrom[ni] = idx;
        open.push({ row: nr, col: nc, f: tentativeG + heuristic(nc, nr) });
      }
    }
  }

  // A* failed — fall back to straight line path
  console.warn(`Road A* failed for ${roadType} (${start} → ${end}), using straight-line fallback`);
  const fallback = straightLinePath(start, end, elevation);
  let uwCount = 0;
  for (const wp of fallback) {
    if (wp.elevation <= seaLevel) uwCount++;
  }
  return {
    waypoints: fallback,
    cost: Infinity,
    underwaterFraction: fallback.length > 0 ? uwCount / fallback.length : 1,
  };
}
