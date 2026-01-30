/**
 * Ring archetype
 *
 * Generates a circular/elliptical ring of mountain spine (atoll shape).
 * Optional gap in the ring for a harbor entrance.
 * Elevation is relatively uniform around the ring.
 */

import { seededRandom, deriveSeed } from '../../core/seeds.js';
import { createSimplexNoise } from '../../core/noise.js';
import { lerp, smoothstep } from '../../core/math.js';

/**
 * Generate ring spine vertices and segments
 *
 * @param {Object} params - World parameters
 * @param {Object} params.center - Island center {x, z}
 * @param {number} params.radius - Island radius
 * @param {Object} params.archetypeParams - Ring-specific params
 * @param {number} seed - Generation seed
 * @returns {{ vertices: Array, segments: Array }}
 */
export function generateRing(params, seed) {
  const { center, radius, archetypeParams } = params;
  const {
    eccentricity,
    gapAngle,
    gapWidth,
    peakElevation,
    vertexCount,
    noiseDisplacement,
  } = archetypeParams;

  const rng = seededRandom(deriveSeed(seed, 'ring'));
  const noise = createSimplexNoise(deriveSeed(seed, 'ringNoise'));

  // Ellipse radii
  const ringRadius = radius * 0.4;
  const radiusX = ringRadius * (1 + eccentricity);
  const radiusZ = ringRadius * (1 - eccentricity);

  // Random rotation for the ellipse
  const rotation = rng() * Math.PI * 2;

  const vertices = [];
  const gapVertices = []; // Track which vertices are in the gap

  // Half gap in radians
  const halfGap = gapWidth / 2;

  for (let i = 0; i < vertexCount; i++) {
    const t = i / vertexCount; // [0, 1) — don't duplicate last vertex
    const theta = t * Math.PI * 2;

    // Check if this vertex falls in the gap
    let angleDiff = theta - gapAngle;
    // Normalize to [-PI, PI]
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    const inGap = Math.abs(angleDiff) < halfGap;
    gapVertices.push(inGap);

    // Ellipse position (before rotation)
    const ex = Math.cos(theta) * radiusX;
    const ez = Math.sin(theta) * radiusZ;

    // Rotate
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    let x = center.x + ex * cosR - ez * sinR;
    let z = center.z + ex * sinR + ez * cosR;

    // Radial noise displacement
    const noiseVal = noise(x * 5, z * 5);
    const radialX = Math.cos(theta + rotation);
    const radialZ = Math.sin(theta + rotation);
    x += radialX * noiseVal * noiseDisplacement;
    z += radialZ * noiseVal * noiseDisplacement;

    // Small random jitter
    x += (rng() - 0.5) * noiseDisplacement * 0.3;
    z += (rng() - 0.5) * noiseDisplacement * 0.3;

    // Elevation: relatively uniform, slightly lower near gap edges
    let elevation;
    if (inGap) {
      elevation = 0.05; // Below sea level in the gap
    } else {
      // Fade near gap edges
      const gapFade = smoothstep(0, halfGap * 1.5, Math.abs(angleDiff));
      elevation = lerp(0.12, peakElevation, gapFade);
    }

    // Influence radius — uniform around the ring
    const influence = lerp(0.08, 0.18, inGap ? 0.2 : 1.0) * radius;

    vertices.push({ x, z, elevation, influence });
  }

  // Connect sequential vertices, skipping gap segments
  const segments = [];
  for (let i = 0; i < vertexCount; i++) {
    const next = (i + 1) % vertexCount;
    // Skip segment if either endpoint is in the gap
    if (!gapVertices[i] && !gapVertices[next]) {
      segments.push({ from: i, to: next });
    }
  }

  return { vertices, segments };
}
