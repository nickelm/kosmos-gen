/**
 * Contour extraction using marching squares algorithm
 *
 * Extracts polyline contours at a threshold value from a sampled field.
 * Used for coastlines (sea level) and elevation contour lines.
 */

/**
 * Extract contour polylines at a threshold value
 *
 * @param {Function} sampleFn - (x, z) => value
 * @param {number} threshold - Contour level
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds - Sampling bounds
 * @param {number} resolution - Sample spacing in world units
 * @returns {Array<Array<{x: number, z: number}>>} Array of polylines
 */
export function extractContours(sampleFn, threshold, bounds, resolution) {
  const { minX, maxX, minZ, maxZ } = bounds;

  // Build grid of samples
  const gridWidth = Math.ceil((maxX - minX) / resolution) + 1;
  const gridHeight = Math.ceil((maxZ - minZ) / resolution) + 1;

  if (gridWidth < 2 || gridHeight < 2) {
    return [];
  }

  const grid = [];
  for (let i = 0; i < gridHeight; i++) {
    grid[i] = [];
    const wz = minZ + i * resolution;
    for (let j = 0; j < gridWidth; j++) {
      const wx = minX + j * resolution;
      grid[i][j] = sampleFn(wx, wz);
    }
  }

  // Generate segments using marching squares
  // Use edge keys for exact matching between adjacent cells
  const segments = [];

  // Linear interpolation - returns value in [0, 1]
  const lerp = (e1, e2) => {
    const d = e2 - e1;
    if (Math.abs(d) < 0.0001) return 0.5;
    return Math.max(0, Math.min(1, (threshold - e1) / d));
  };

  // Edge key functions - ensure adjacent cells share exact same edge points
  // Horizontal edges: keyed by (row, col, col+1)
  // Vertical edges: keyed by (col, row, row+1)
  const hEdgeCache = new Map();
  const vEdgeCache = new Map();

  const getHorizontalEdge = (row, col) => {
    const key = `h:${row},${col}`;
    if (!hEdgeCache.has(key)) {
      const e1 = grid[row][col];
      const e2 = grid[row][col + 1];
      const t = lerp(e1, e2);
      hEdgeCache.set(key, {
        x: minX + (col + t) * resolution,
        z: minZ + row * resolution
      });
    }
    return hEdgeCache.get(key);
  };

  const getVerticalEdge = (row, col) => {
    const key = `v:${row},${col}`;
    if (!vEdgeCache.has(key)) {
      const e1 = grid[row][col];
      const e2 = grid[row + 1][col];
      const t = lerp(e1, e2);
      vEdgeCache.set(key, {
        x: minX + col * resolution,
        z: minZ + (row + t) * resolution
      });
    }
    return vEdgeCache.get(key);
  };

  // Marching squares lookup table
  // Corner layout:  0---1   (row i)
  //                 |   |
  //                 3---2   (row i+1)
  //
  // Case index = c0 + c1*2 + c2*4 + c3*8 where c=1 if >= threshold
  // Each case lists edges to connect: [from, to]
  // Edge names: top (0-1), right (1-2), bottom (2-3), left (3-0)
  //
  // The contour separates "above" corners from "below" corners.
  // Complement cases (e.g., 1 and 14) produce the same contour.
  const EDGE_TABLE = {
    0: [],                           // All below - no contour
    1: [['left', 'top']],            // Only 0 above
    2: [['top', 'right']],           // Only 1 above
    3: [['left', 'right']],          // 0,1 above
    4: [['right', 'bottom']],        // Only 2 above
    5: [['left', 'top'], ['right', 'bottom']],  // 0,2 above (saddle)
    6: [['top', 'bottom']],          // 1,2 above
    7: [['left', 'bottom']],         // 0,1,2 above (only 3 below) - same contour as case 8
    8: [['left', 'bottom']],         // Only 3 above
    9: [['top', 'bottom']],          // 0,3 above
    10: [['top', 'right'], ['left', 'bottom']], // 1,3 above (saddle)
    11: [['right', 'bottom']],       // 0,1,3 above (only 2 below) - same contour as case 4
    12: [['left', 'right']],         // 2,3 above - same contour as case 3
    13: [['top', 'right']],          // 0,2,3 above (only 1 below) - same contour as case 2
    14: [['left', 'top']],           // 1,2,3 above (only 0 below) - same contour as case 1
    15: []                           // All above - no contour
  };

  for (let i = 0; i < gridHeight - 1; i++) {
    for (let j = 0; j < gridWidth - 1; j++) {
      // Sample at 4 corners (binary classification)
      // Corner 0 = top-left, 1 = top-right, 2 = bottom-right, 3 = bottom-left
      const c0 = grid[i][j] >= threshold ? 1 : 0;
      const c1 = grid[i][j + 1] >= threshold ? 1 : 0;
      const c2 = grid[i + 1][j + 1] >= threshold ? 1 : 0;
      const c3 = grid[i + 1][j] >= threshold ? 1 : 0;

      const caseIndex = c0 + c1 * 2 + c2 * 4 + c3 * 8;

      // Skip if all same (no contour crossing)
      if (caseIndex === 0 || caseIndex === 15) continue;

      // Get edge crossing points (cached for exact matching)
      const edges = {
        top: getHorizontalEdge(i, j),        // Top edge of cell
        bottom: getHorizontalEdge(i + 1, j), // Bottom edge of cell
        left: getVerticalEdge(i, j),         // Left edge of cell
        right: getVerticalEdge(i, j + 1)     // Right edge of cell
      };

      const edgePairs = EDGE_TABLE[caseIndex];
      for (const [from, to] of edgePairs) {
        segments.push([edges[from], edges[to]]);
      }
    }
  }

  // Connect segments into polylines
  return connectSegments(segments);
}

/**
 * Connect line segments into polylines by matching endpoints
 * Uses object identity for matching since edge points are cached
 *
 * @param {Array<Array<{x: number, z: number}>>} segments - Array of [start, end] pairs
 * @returns {Array<Array<{x: number, z: number}>>} Connected polylines
 */
function connectSegments(segments) {
  if (segments.length === 0) return [];

  // Build adjacency map: point object -> list of {segmentIndex, endpoint: 0|1}
  // Uses object identity (Map with object keys) since edge points are cached
  const adjacency = new Map();

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const p0 = seg[0];
    const p1 = seg[1];

    if (!adjacency.has(p0)) adjacency.set(p0, []);
    if (!adjacency.has(p1)) adjacency.set(p1, []);

    adjacency.get(p0).push({ segmentIndex: i, endpoint: 0 });
    adjacency.get(p1).push({ segmentIndex: i, endpoint: 1 });
  }

  // Chain segments into polylines
  const used = new Set();
  const polylines = [];

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    // Start new polyline from this segment
    const polyline = [segments[i][0], segments[i][1]];
    used.add(i);

    // Extend forward from end
    let currentPoint = polyline[polyline.length - 1];
    while (true) {
      const neighbors = adjacency.get(currentPoint);
      if (!neighbors) break;

      const next = neighbors.find(n => !used.has(n.segmentIndex));
      if (!next) break;

      used.add(next.segmentIndex);
      const seg = segments[next.segmentIndex];
      // Add the OTHER endpoint of the segment
      const nextPoint = next.endpoint === 0 ? seg[1] : seg[0];
      polyline.push(nextPoint);
      currentPoint = nextPoint;
    }

    // Extend backward from start
    currentPoint = polyline[0];
    while (true) {
      const neighbors = adjacency.get(currentPoint);
      if (!neighbors) break;

      const prev = neighbors.find(n => !used.has(n.segmentIndex));
      if (!prev) break;

      used.add(prev.segmentIndex);
      const seg = segments[prev.segmentIndex];
      // Add the OTHER endpoint of the segment at the beginning
      const prevPoint = prev.endpoint === 0 ? seg[1] : seg[0];
      polyline.unshift(prevPoint);
      currentPoint = prevPoint;
    }

    polylines.push(polyline);
  }

  return polylines;
}

/**
 * Simplify polyline using Douglas-Peucker algorithm
 *
 * @param {Array<{x: number, z: number}>} points - Input polyline
 * @param {number} epsilon - Tolerance in world units
 * @returns {Array<{x: number, z: number}>} Simplified polyline
 */
export function simplifyPolyline(points, epsilon) {
  if (points.length <= 2) return points;

  // Find point with maximum distance from line segment (first to last)
  let maxDist = 0;
  let maxIndex = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > epsilon) {
    // Recursively simplify both halves
    const left = simplifyPolyline(points.slice(0, maxIndex + 1), epsilon);
    const right = simplifyPolyline(points.slice(maxIndex), epsilon);
    // Combine, removing duplicate point at junction
    return [...left.slice(0, -1), ...right];
  } else {
    // Just keep endpoints
    return [start, end];
  }
}

/**
 * Calculate perpendicular distance from point to line segment
 *
 * @param {{x: number, z: number}} point
 * @param {{x: number, z: number}} lineStart
 * @param {{x: number, z: number}} lineEnd
 * @returns {number} Distance
 */
function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dz = lineEnd.z - lineStart.z;
  const lengthSq = dx * dx + dz * dz;

  // Degenerate case: line segment is a point
  if (lengthSq === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.z - lineStart.z) ** 2);
  }

  // Project point onto line and clamp to segment
  const t = Math.max(0, Math.min(1,
    ((point.x - lineStart.x) * dx + (point.z - lineStart.z) * dz) / lengthSq
  ));

  const closestX = lineStart.x + t * dx;
  const closestZ = lineStart.z + t * dz;

  return Math.sqrt((point.x - closestX) ** 2 + (point.z - closestZ) ** 2);
}

/**
 * Check if a polyline forms a closed loop
 *
 * @param {Array<{x: number, z: number}>} points - Polyline points
 * @param {number} tolerance - Distance tolerance for closure check
 * @returns {boolean} True if first and last points are within tolerance
 */
export function isClosedLoop(points, tolerance = 0.001) {
  if (points.length < 3) return false;

  const first = points[0];
  const last = points[points.length - 1];

  const dx = last.x - first.x;
  const dz = last.z - first.z;

  return Math.sqrt(dx * dx + dz * dz) <= tolerance;
}
