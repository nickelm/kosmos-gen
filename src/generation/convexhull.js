/**
 * Convex hull computation (Graham scan)
 *
 * Returns the convex hull of a set of 2D points as a polygon
 * with vertices in counter-clockwise order.
 */

/**
 * Compute the convex hull of a set of points.
 *
 * @param {{ x: number, z: number }[]} points - Input points (at least 3)
 * @returns {{ x: number, z: number }[]} Hull vertices in CCW order
 */
export function convexHull(points) {
  if (points.length < 3) return points.slice();

  // Find the bottom-most point (lowest z, then leftmost x)
  let pivot = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].z < points[pivot].z ||
        (points[i].z === points[pivot].z && points[i].x < points[pivot].x)) {
      pivot = i;
    }
  }

  // Move pivot to index 0
  const pts = points.slice();
  [pts[0], pts[pivot]] = [pts[pivot], pts[0]];
  const origin = pts[0];

  // Sort remaining points by polar angle from origin
  const rest = pts.slice(1);
  rest.sort((a, b) => {
    const angleA = Math.atan2(a.z - origin.z, a.x - origin.x);
    const angleB = Math.atan2(b.z - origin.z, b.x - origin.x);
    if (angleA !== angleB) return angleA - angleB;
    // Same angle: closer point first
    const dA = (a.x - origin.x) ** 2 + (a.z - origin.z) ** 2;
    const dB = (b.x - origin.x) ** 2 + (b.z - origin.z) ** 2;
    return dA - dB;
  });

  // Graham scan
  const stack = [origin, rest[0]];
  for (let i = 1; i < rest.length; i++) {
    while (stack.length > 1 && cross(stack[stack.length - 2], stack[stack.length - 1], rest[i]) <= 0) {
      stack.pop();
    }
    stack.push(rest[i]);
  }

  return stack;
}

/**
 * Cross product of vectors (o→a) and (o→b).
 * Positive = CCW turn, negative = CW turn, zero = collinear.
 */
function cross(o, a, b) {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}
