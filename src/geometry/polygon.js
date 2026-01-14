/**
 * Polygon utilities for half-cell computation
 */

/**
 * Test if a point is inside a polygon using ray casting
 * @param {number} x - Point X
 * @param {number} z - Point Z
 * @param {Array<{x: number, z: number}>} polygon - Polygon vertices (closed or open)
 * @returns {boolean} True if point is inside
 */
export function pointInPolygon(x, z, polygon) {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, zi = polygon[i].z;
    const xj = polygon[j].x, zj = polygon[j].z;

    if (((zi > z) !== (zj > z)) &&
        (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Compute which side of a line a point is on
 * @param {{x: number, z: number}} point - Point to test
 * @param {{x: number, z: number}} linePoint - Point on the line
 * @param {{x: number, z: number}} lineDir - Line direction (normalized or not)
 * @returns {number} Positive if left, negative if right, 0 if on line
 */
export function sideOfLine(point, linePoint, lineDir) {
  const dx = point.x - linePoint.x;
  const dz = point.z - linePoint.z;
  return lineDir.x * dz - lineDir.z * dx;
}

/**
 * Find intersection point of two line segments
 * @param {{x: number, z: number}} p1 - Segment 1 start
 * @param {{x: number, z: number}} p2 - Segment 1 end
 * @param {{x: number, z: number}} p3 - Segment 2 start
 * @param {{x: number, z: number}} p4 - Segment 2 end
 * @returns {{x: number, z: number, t: number} | null} Intersection point and t parameter, or null
 */
export function lineIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1z = p2.z - p1.z;
  const d2x = p4.x - p3.x;
  const d2z = p4.z - p3.z;

  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-10) return null; // Parallel

  const t = ((p3.x - p1.x) * d2z - (p3.z - p1.z) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1z - (p3.z - p1.z) * d1x) / denom;

  // Check if intersection is within both segments
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return {
    x: p1.x + t * d1x,
    z: p1.z + t * d1z,
    t
  };
}

/**
 * Find intersection of a line segment with an infinite line
 * @param {{x: number, z: number}} p1 - Segment start
 * @param {{x: number, z: number}} p2 - Segment end
 * @param {{x: number, z: number}} linePoint - Point on the infinite line
 * @param {{x: number, z: number}} lineDir - Direction of the infinite line
 * @returns {{x: number, z: number, t: number} | null} Intersection point and t parameter (0-1 range), or null
 */
export function segmentLineIntersection(p1, p2, linePoint, lineDir) {
  const d1x = p2.x - p1.x;
  const d1z = p2.z - p1.z;

  const denom = d1x * lineDir.z - d1z * lineDir.x;
  if (Math.abs(denom) < 1e-10) return null; // Parallel

  const t = ((linePoint.x - p1.x) * lineDir.z - (linePoint.z - p1.z) * lineDir.x) / denom;

  // Check if intersection is within segment
  if (t < 0 || t > 1) return null;

  return {
    x: p1.x + t * d1x,
    z: p1.z + t * d1z,
    t
  };
}

/**
 * Split a polygon by an infinite line into two polygons
 * Handles both convex and non-convex polygons
 *
 * @param {Array<{x: number, z: number}>} polygon - Input polygon vertices
 * @param {{x: number, z: number}} linePoint - Point on the splitting line
 * @param {{x: number, z: number}} lineDir - Direction of the splitting line
 * @returns {{left: Array<{x: number, z: number}>, right: Array<{x: number, z: number}>}} Two polygons
 */
export function splitPolygonByLine(polygon, linePoint, lineDir) {
  if (!polygon || polygon.length < 3) {
    return { left: [], right: [] };
  }

  const left = [];
  const right = [];
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];

    const currSide = sideOfLine(curr, linePoint, lineDir);
    const nextSide = sideOfLine(next, linePoint, lineDir);

    // Add current point to appropriate side(s)
    if (currSide >= 0) {
      left.push({ x: curr.x, z: curr.z });
    }
    if (currSide <= 0) {
      right.push({ x: curr.x, z: curr.z });
    }

    // Check for intersection between current edge and line
    if ((currSide > 0 && nextSide < 0) || (currSide < 0 && nextSide > 0)) {
      const intersection = segmentLineIntersection(curr, next, linePoint, lineDir);
      if (intersection) {
        left.push({ x: intersection.x, z: intersection.z });
        right.push({ x: intersection.x, z: intersection.z });
      }
    }
  }

  return { left, right };
}

/**
 * Compute the centroid of a polygon
 * @param {Array<{x: number, z: number}>} polygon
 * @returns {{x: number, z: number}}
 */
export function polygonCentroid(polygon) {
  if (!polygon || polygon.length === 0) {
    return { x: 0, z: 0 };
  }

  let sumX = 0, sumZ = 0;
  for (const p of polygon) {
    sumX += p.x;
    sumZ += p.z;
  }
  return {
    x: sumX / polygon.length,
    z: sumZ / polygon.length
  };
}

/**
 * Compute polygon area using shoelace formula
 * @param {Array<{x: number, z: number}>} polygon
 * @returns {number} Signed area (positive if CCW, negative if CW)
 */
export function polygonArea(polygon) {
  if (!polygon || polygon.length < 3) return 0;

  let area = 0;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i].x * polygon[j].z;
    area -= polygon[j].x * polygon[i].z;
  }

  return area / 2;
}

/**
 * Check if polygon vertices are in clockwise order
 * @param {Array<{x: number, z: number}>} polygon
 * @returns {boolean}
 */
export function isClockwise(polygon) {
  return polygonArea(polygon) < 0;
}

/**
 * Clip polygon to a bounding box
 * Uses Sutherland-Hodgman algorithm
 *
 * @param {Array<{x: number, z: number}>} polygon
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds
 * @returns {Array<{x: number, z: number}>} Clipped polygon
 */
export function clipPolygonToBounds(polygon, bounds) {
  if (!polygon || polygon.length < 3) return [];

  let output = polygon;

  // Clip against each edge of the bounding box
  const edges = [
    { point: { x: bounds.minX, z: 0 }, dir: { x: 0, z: 1 } },  // Left edge
    { point: { x: bounds.maxX, z: 0 }, dir: { x: 0, z: -1 } }, // Right edge
    { point: { x: 0, z: bounds.minZ }, dir: { x: 1, z: 0 } },  // Bottom edge
    { point: { x: 0, z: bounds.maxZ }, dir: { x: -1, z: 0 } }  // Top edge
  ];

  for (const edge of edges) {
    if (output.length === 0) break;

    const input = output;
    output = [];

    for (let i = 0; i < input.length; i++) {
      const curr = input[i];
      const next = input[(i + 1) % input.length];

      const currInside = sideOfLine(curr, edge.point, edge.dir) >= 0;
      const nextInside = sideOfLine(next, edge.point, edge.dir) >= 0;

      if (currInside) {
        output.push({ x: curr.x, z: curr.z });

        if (!nextInside) {
          const intersection = segmentLineIntersection(curr, next, edge.point, edge.dir);
          if (intersection) {
            output.push({ x: intersection.x, z: intersection.z });
          }
        }
      } else if (nextInside) {
        const intersection = segmentLineIntersection(curr, next, edge.point, edge.dir);
        if (intersection) {
          output.push({ x: intersection.x, z: intersection.z });
        }
      }
    }
  }

  return output;
}
