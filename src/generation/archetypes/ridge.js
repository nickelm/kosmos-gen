/**
 * Ridge archetype
 *
 * Generates a roughly linear mountain spine across the island,
 * with noise displacement for organic shape. Elevation peaks
 * in the middle and tapers toward the ends.
 */

import { seededRandom, deriveSeed } from '../../core/seeds.js';
import { createSimplexNoise } from '../../core/noise.js';
import { lerp, smoothstep } from '../../core/math.js';

/**
 * Generate ridge spine vertices and segments
 *
 * @param {Object} params - World parameters
 * @param {Object} params.center - Island center {x, z}
 * @param {number} params.radius - Island radius
 * @param {Object} params.archetypeParams - Ridge-specific params
 * @param {number} seed - Generation seed
 * @returns {{ vertices: Array, segments: Array }}
 */
export function generateRidge(params, seed) {
  const { center, radius, archetypeParams } = params;
  const {
    angle,
    ridgeLength,
    peakElevation,
    vertexCount,
    noiseDisplacement,
  } = archetypeParams;

  const rng = seededRandom(deriveSeed(seed, 'ridge'));
  const noise = createSimplexNoise(deriveSeed(seed, 'ridgeNoise'));

  const halfLength = radius * ridgeLength;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const vertices = [];

  for (let i = 0; i < vertexCount; i++) {
    // Parameter along the ridge [0, 1]
    const t = i / (vertexCount - 1);

    // Base position along the ridge line
    const along = (t - 0.5) * 2 * halfLength; // [-halfLength, halfLength]
    let x = center.x + cosA * along;
    let z = center.z + sinA * along;

    // Perpendicular noise displacement for organic shape
    const noiseVal = noise(x * 5, z * 5);
    const perpX = -sinA * noiseVal * noiseDisplacement;
    const perpZ = cosA * noiseVal * noiseDisplacement;
    x += perpX;
    z += perpZ;

    // Additional small random jitter
    x += (rng() - 0.5) * noiseDisplacement * 0.3;
    z += (rng() - 0.5) * noiseDisplacement * 0.3;

    // Elevation: peaks in middle, tapers at ends
    // Use smoothstep for nice falloff at endpoints
    const edgeFade = Math.min(
      smoothstep(0, 0.25, t),
      smoothstep(1, 0.75, t)
    );
    const elevation = lerp(0.15, peakElevation, edgeFade);

    // Influence radius: how far this vertex's elevation extends
    // Wider in the middle, narrower at tips
    const influence = lerp(0.08, 0.25, edgeFade) * radius;

    vertices.push({ x, z, elevation, influence });
  }

  // Create segments connecting sequential vertices
  const segments = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({ from: i, to: i + 1 });
  }

  return { vertices, segments };
}
