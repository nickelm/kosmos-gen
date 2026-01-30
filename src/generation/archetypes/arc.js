/**
 * Arc archetype
 *
 * Generates a curved mountain spine following a circular arc path.
 * Like ridge but bends smoothly. Elevation peaks at the center
 * of the arc and tapers toward the endpoints.
 */

import { seededRandom, deriveSeed } from '../../core/seeds.js';
import { createSimplexNoise } from '../../core/noise.js';
import { lerp, smoothstep } from '../../core/math.js';

/**
 * Generate arc spine vertices and segments
 *
 * @param {Object} params - World parameters
 * @param {Object} params.center - Island center {x, z}
 * @param {number} params.radius - Island radius
 * @param {Object} params.archetypeParams - Arc-specific params
 * @param {number} seed - Generation seed
 * @returns {{ vertices: Array, segments: Array }}
 */
export function generateArc(params, seed) {
  const { center, radius, archetypeParams } = params;
  const {
    curvature,
    arcAngle,
    startAngle,
    peakElevation,
    vertexCount,
    noiseDisplacement,
  } = archetypeParams;

  const rng = seededRandom(deriveSeed(seed, 'arc'));
  const noise = createSimplexNoise(deriveSeed(seed, 'arcNoise'));

  // Arc radius derived from curvature (higher curvature = tighter bend)
  const arcRadius = radius * (0.3 / curvature);

  // Arc center is offset from island center
  const arcCenterX = center.x - Math.cos(startAngle + arcAngle / 2) * arcRadius;
  const arcCenterZ = center.z - Math.sin(startAngle + arcAngle / 2) * arcRadius;

  const vertices = [];

  for (let i = 0; i < vertexCount; i++) {
    const t = i / (vertexCount - 1);

    // Angle along the arc
    const theta = startAngle + t * arcAngle;

    // Base position on the arc
    let x = arcCenterX + Math.cos(theta) * arcRadius;
    let z = arcCenterZ + Math.sin(theta) * arcRadius;

    // Perpendicular noise displacement (radial direction is perpendicular to arc)
    const noiseVal = noise(x * 5, z * 5);
    const radialX = Math.cos(theta);
    const radialZ = Math.sin(theta);
    x += radialX * noiseVal * noiseDisplacement;
    z += radialZ * noiseVal * noiseDisplacement;

    // Small random jitter
    x += (rng() - 0.5) * noiseDisplacement * 0.3;
    z += (rng() - 0.5) * noiseDisplacement * 0.3;

    // Elevation: peaks in middle, tapers at ends
    const edgeFade = Math.min(
      smoothstep(0, 0.25, t),
      smoothstep(1, 0.75, t)
    );
    const elevation = lerp(0.15, peakElevation, edgeFade);

    // Influence radius
    const influence = lerp(0.08, 0.25, edgeFade) * radius;

    vertices.push({ x, z, elevation, influence });
  }

  // Connect sequential vertices
  const segments = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({ from: i, to: i + 1 });
  }

  return { vertices, segments };
}
