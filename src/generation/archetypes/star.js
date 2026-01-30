/**
 * Star archetype
 *
 * Multiple spines radiating from a shared center vertex (volcanic island shape).
 * 3-6 arms spread outward, each a short ridge tapering from the peak.
 * All arms share vertex 0 as the center hub.
 */

import { seededRandom, deriveSeed } from '../../core/seeds.js';
import { createSimplexNoise } from '../../core/noise.js';
import { lerp, smoothstep } from '../../core/math.js';

/**
 * Generate star spine vertices and segments
 *
 * @param {Object} params - World parameters
 * @param {Object} params.center - Island center {x, z}
 * @param {number} params.radius - Island radius
 * @param {Object} params.archetypeParams - Star-specific params
 * @param {number} seed - Generation seed
 * @returns {{ vertices: Array, segments: Array }}
 */
export function generateStar(params, seed) {
  const { center, radius, archetypeParams } = params;
  const {
    armCount,
    armLength,
    peakElevation,
    vertexCountPerArm,
    noiseDisplacement,
  } = archetypeParams;

  const rng = seededRandom(deriveSeed(seed, 'star'));
  const noise = createSimplexNoise(deriveSeed(seed, 'starNoise'));

  const vertices = [];
  const segments = [];

  // Vertex 0: center hub (highest point)
  let cx = center.x + (rng() - 0.5) * noiseDisplacement * 0.5;
  let cz = center.z + (rng() - 0.5) * noiseDisplacement * 0.5;
  vertices.push({
    x: cx,
    z: cz,
    elevation: peakElevation,
    influence: 0.25 * radius,
  });

  // Base angle offset so arms don't always start at 0
  const baseAngle = rng() * Math.PI * 2;

  // Even angular spacing with some jitter
  const angleStep = (Math.PI * 2) / armCount;

  for (let arm = 0; arm < armCount; arm++) {
    const armAngle = baseAngle + arm * angleStep + (rng() - 0.5) * angleStep * 0.3;
    const armLen = radius * armLength * lerp(0.7, 1.3, rng()); // Vary arm length

    const cosA = Math.cos(armAngle);
    const sinA = Math.sin(armAngle);

    // Generate vertices along this arm (skip t=0, that's the center)
    for (let i = 1; i <= vertexCountPerArm; i++) {
      const t = i / vertexCountPerArm;

      // Position along the arm
      let x = cx + cosA * t * armLen;
      let z = cz + sinA * t * armLen;

      // Perpendicular noise displacement
      const noiseVal = noise(x * 5, z * 5);
      const perpX = -sinA * noiseVal * noiseDisplacement;
      const perpZ = cosA * noiseVal * noiseDisplacement;
      x += perpX;
      z += perpZ;

      // Small random jitter
      x += (rng() - 0.5) * noiseDisplacement * 0.3;
      z += (rng() - 0.5) * noiseDisplacement * 0.3;

      // Elevation: tapers from peak to low along the arm
      const fade = 1 - smoothstep(0.1, 1.0, t);
      const elevation = lerp(0.12, peakElevation * 0.85, fade);

      // Influence: wider near center, narrower at tips
      const influence = lerp(0.06, 0.2, fade) * radius;

      vertices.push({ x, z, elevation, influence });
    }

    // Segments: connect center to first arm vertex, then chain along arm
    const armStartIdx = 1 + arm * vertexCountPerArm;
    segments.push({ from: 0, to: armStartIdx }); // Center to first

    for (let i = 0; i < vertexCountPerArm - 1; i++) {
      segments.push({ from: armStartIdx + i, to: armStartIdx + i + 1 });
    }
  }

  return { vertices, segments };
}
