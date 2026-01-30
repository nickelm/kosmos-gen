/**
 * Crescent archetype
 *
 * Generates a tight arc creating a bay/harbor shape.
 * The concave side forms a natural bay or lagoon.
 * Elevation tapers more steeply on the inner (bay) side
 * via asymmetric influence radii.
 */

import { seededRandom, deriveSeed } from '../../core/seeds.js';
import { createSimplexNoise } from '../../core/noise.js';
import { lerp, smoothstep } from '../../core/math.js';

/**
 * Generate crescent spine vertices and segments
 *
 * @param {Object} params - World parameters
 * @param {Object} params.center - Island center {x, z}
 * @param {number} params.radius - Island radius
 * @param {Object} params.archetypeParams - Crescent-specific params
 * @param {number} seed - Generation seed
 * @returns {{ vertices: Array, segments: Array }}
 */
export function generateCrescent(params, seed) {
  const { center, radius, archetypeParams } = params;
  const {
    openingAngle,
    startAngle,
    peakElevation,
    vertexCount,
    noiseDisplacement,
  } = archetypeParams;

  const rng = seededRandom(deriveSeed(seed, 'crescent'));
  const noise = createSimplexNoise(deriveSeed(seed, 'crescentNoise'));

  // Crescent is a tight arc — sweep angle is 2*PI minus the opening
  const sweepAngle = Math.PI * 2 - openingAngle;

  // Arc radius — tighter than arc archetype for the bay shape
  const arcRadius = radius * 0.35;

  // Arc center offset so the crescent wraps around the island center
  const midAngle = startAngle + sweepAngle / 2;
  const arcCenterX = center.x - Math.cos(midAngle) * arcRadius * 0.3;
  const arcCenterZ = center.z - Math.sin(midAngle) * arcRadius * 0.3;

  const vertices = [];

  for (let i = 0; i < vertexCount; i++) {
    const t = i / (vertexCount - 1);

    // Angle along the crescent arc
    const theta = startAngle + t * sweepAngle;

    // Base position on the arc
    let x = arcCenterX + Math.cos(theta) * arcRadius;
    let z = arcCenterZ + Math.sin(theta) * arcRadius;

    // Perpendicular noise displacement (radial direction)
    const noiseVal = noise(x * 5, z * 5);
    const radialX = Math.cos(theta);
    const radialZ = Math.sin(theta);
    x += radialX * noiseVal * noiseDisplacement;
    z += radialZ * noiseVal * noiseDisplacement;

    // Small random jitter
    x += (rng() - 0.5) * noiseDisplacement * 0.3;
    z += (rng() - 0.5) * noiseDisplacement * 0.3;

    // Elevation: peaks in middle of the arc, tapers at the horns
    const edgeFade = Math.min(
      smoothstep(0, 0.2, t),
      smoothstep(1, 0.8, t)
    );
    const elevation = lerp(0.15, peakElevation, edgeFade);

    // Influence: wider on outer side, narrower overall than ridge
    // This creates the asymmetric bay shape
    const influence = lerp(0.06, 0.2, edgeFade) * radius;

    vertices.push({ x, z, elevation, influence });
  }

  // Connect sequential vertices
  const segments = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({ from: i, to: i + 1 });
  }

  return { vertices, segments };
}
