/**
 * Scattered archetype
 *
 * Generates multiple disconnected spines (archipelago).
 * Each island is a mini-ridge with its own center, radius, and angle.
 * Vertices and segments from all sub-islands are merged into a single
 * flat array. The params stage also sets `params.islands` so the elevation
 * stage can compute per-island falloff.
 */

import { seededRandom, deriveSeed } from '../../core/seeds.js';
import { createSimplexNoise } from '../../core/noise.js';
import { lerp, smoothstep, distance } from '../../core/math.js';

/**
 * Generate scattered spine vertices and segments
 *
 * @param {Object} params - World parameters
 * @param {Object} params.center - Island center {x, z}
 * @param {number} params.radius - Island radius
 * @param {Object} params.archetypeParams - Scattered-specific params
 * @param {number} seed - Generation seed
 * @returns {{ vertices: Array, segments: Array, islands: Array }}
 */
export function generateScattered(params, seed) {
  const { center, radius, archetypeParams } = params;
  const {
    islandCount,
    spreadRadius,
    minIslandRadius,
    maxIslandRadius,
    peakElevation,
    vertexCountPerIsland,
    noiseDisplacement,
  } = archetypeParams;

  const rng = seededRandom(deriveSeed(seed, 'scattered'));
  const noise = createSimplexNoise(deriveSeed(seed, 'scatteredNoise'));

  const allVertices = [];
  const allSegments = [];
  const islands = [];

  // Place sub-islands with minimum spacing
  const minSpacing = minIslandRadius * 2.5;
  const islandCenters = [];

  for (let i = 0; i < islandCount; i++) {
    let ix, iz;
    let attempts = 0;

    // Try to find a position with sufficient spacing
    do {
      const angle = rng() * Math.PI * 2;
      const dist = rng() * spreadRadius * radius;
      ix = center.x + Math.cos(angle) * dist;
      iz = center.z + Math.sin(angle) * dist;
      attempts++;
    } while (
      attempts < 50 &&
      islandCenters.some(c => distance(ix, iz, c.x, c.z) < minSpacing)
    );

    const islandRadius = lerp(minIslandRadius, maxIslandRadius, rng());
    const islandAngle = rng() * Math.PI;
    const islandPeak = lerp(peakElevation * 0.5, peakElevation, rng());

    islandCenters.push({ x: ix, z: iz });
    islands.push({ center: { x: ix, z: iz }, radius: islandRadius });

    // Generate a mini-ridge for this sub-island
    const halfLength = islandRadius * lerp(0.4, 0.7, rng());
    const cosA = Math.cos(islandAngle);
    const sinA = Math.sin(islandAngle);
    const baseIndex = allVertices.length;

    for (let v = 0; v < vertexCountPerIsland; v++) {
      const t = v / (vertexCountPerIsland - 1);

      const along = (t - 0.5) * 2 * halfLength;
      let x = ix + cosA * along;
      let z = iz + sinA * along;

      // Perpendicular noise
      const noiseVal = noise(x * 5, z * 5);
      x += -sinA * noiseVal * noiseDisplacement;
      z += cosA * noiseVal * noiseDisplacement;

      // Jitter
      x += (rng() - 0.5) * noiseDisplacement * 0.3;
      z += (rng() - 0.5) * noiseDisplacement * 0.3;

      // Elevation peaks in middle
      const edgeFade = Math.min(
        smoothstep(0, 0.25, t),
        smoothstep(1, 0.75, t)
      );
      const elevation = lerp(0.12, islandPeak, edgeFade);

      // Influence — scaled to sub-island size
      const influence = lerp(0.06, 0.18, edgeFade) * islandRadius;

      allVertices.push({ x, z, elevation, influence });
    }

    // Segments within this sub-island
    for (let v = 0; v < vertexCountPerIsland - 1; v++) {
      allSegments.push({ from: baseIndex + v, to: baseIndex + v + 1 });
    }
  }

  return { vertices: allVertices, segments: allSegments, islands };
}
