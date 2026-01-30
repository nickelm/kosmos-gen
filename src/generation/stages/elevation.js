/**
 * Stage 3: Elevation grid generation
 *
 * Builds a Float32Array elevation grid from spines + noise + island falloff.
 * Elevation extends below sea level for underwater terrain.
 */

import { deriveSeed } from '../../core/seeds.js';
import { createFBmNoise, unipolar } from '../../core/noise.js';
import { createDomainWarp } from '../../core/warp.js';
import { smoothstep, pointToSegmentDistance, lerp } from '../../core/math.js';

/**
 * Generate elevation grid
 *
 * @param {Object} params - World parameters (from Stage 1)
 * @param {Object} spines - Spine data (from Stage 2)
 * @param {number} seed - World seed
 * @param {number} [resolution=512] - Grid size (width and height)
 * @returns {{ width: number, height: number, data: Float32Array, bounds: Object }}
 */
export function generateElevation(params, spines, seed, resolution = 512) {
  const { center, radius, noiseConfig, warpConfig, seaLevel, elevationConfig } = params;
  const foothillRadiusMul = elevationConfig?.foothillRadius ?? 3;
  const foothillHeightOffset = elevationConfig?.foothillHeight ?? 0.08;
  const terraceStrength = elevationConfig?.terraceStrength ?? 1.0;
  const { vertices, segments, islands } = spines;

  // Grid covers [-1, 1] in both axes
  const bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const width = resolution;
  const height = resolution;
  const data = new Float32Array(width * height);

  // Create noise functions
  const elevSeed = deriveSeed(seed, 'elevation');
  const terrainNoise = unipolar(createFBmNoise(deriveSeed(elevSeed, 'terrain'), {
    octaves: noiseConfig.octaves,
    persistence: noiseConfig.persistence,
    lacunarity: noiseConfig.lacunarity,
    frequency: noiseConfig.frequency,
  }));

  // Secondary noise for variation — low persistence for smooth results
  const detailNoise = unipolar(createFBmNoise(deriveSeed(elevSeed, 'detail'), {
    octaves: 2,
    persistence: 0.25,
    lacunarity: 2.0,
    frequency: noiseConfig.frequency * 2,
  }));

  // Domain warp
  const warp = createDomainWarp(deriveSeed(elevSeed, 'warp'), warpConfig);

  // Cell size
  const cellW = (bounds.maxX - bounds.minX) / width;
  const cellH = (bounds.maxZ - bounds.minZ) / height;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const worldX = bounds.minX + (col + 0.5) * cellW;
      const worldZ = bounds.minZ + (row + 0.5) * cellH;

      // Apply domain warp
      const [wx, wz] = warp(worldX, worldZ);
      // let wx = worldX; 
      // let wz = worldZ;

      // 1. Island falloff
      let falloff, deepOceanFalloff;

      if (islands) {
        // Scattered: compute falloff as max across all sub-islands
        falloff = 0;
        deepOceanFalloff = 0;
        for (const isle of islands) {
          const dx = worldX - isle.center.x;
          const dz = worldZ - isle.center.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const nd = dist / isle.radius;
          const f = 1.0 - smoothstep(0.3, 1.15, nd);
          const dof = nd > 1.15 ? Math.max(0, 1.0 - (nd - 1.15) * 2) : 1.0;
          falloff = Math.max(falloff, f);
          deepOceanFalloff = Math.max(deepOceanFalloff, dof);
        }
      } else {
        // Single island: distance from center
        const dx = worldX - center.x;
        const dz = worldZ - center.z;
        const distFromCenter = Math.sqrt(dx * dx + dz * dz);
        const normalizedDist = distFromCenter / radius;

        // Plateau-like falloff: flat near center, drops off near edge
        falloff = 1.0 - smoothstep(0.3, 1.15, normalizedDist);

        // Extra falloff for deep ocean far from island
        deepOceanFalloff = normalizedDist > 1.15
          ? Math.max(0, 1.0 - (normalizedDist - 1.15) * 2)
          : 1.0;
      }

      // 2. Spine influence — max of per-segment contributions
      //    Each segment produces a single smooth value: elev * quartic(dist/influence).
      //    Taking the max avoids Voronoi boundary cliffs (all segments contribute
      //    everywhere they reach) and avoids mesa averaging (no division).
      let spineBias = 0;
      const foothillElev = seaLevel + foothillHeightOffset;

      for (const seg of segments) {
        const vA = vertices[seg.from];
        const vB = vertices[seg.to];

        const result = pointToSegmentDistance(
          wx, wz, vA.x, vA.z, vB.x, vB.z
        );

        const segElev = lerp(vA.elevation, vB.elevation, result.t);
        const segInfluence = lerp(vA.influence, vB.influence, result.t);

        if (result.distance < segInfluence) {
          const t = result.distance / segInfluence;
          const contrib = segElev * (1 - t * t) * (1 - t * t);
          if (contrib > spineBias) spineBias = contrib;
        }

        // Foothills: wider low-elevation influence for flat lowlands
        if (foothillRadiusMul > 0) {
          const fRadius = segInfluence * foothillRadiusMul;
          if (result.distance < fRadius) {
            const ft = result.distance / fRadius;
            const fContrib = foothillElev * (1 - ft * ft) * (1 - ft * ft);
            if (fContrib > spineBias) spineBias = fContrib;
          }
        }
      }

      // 3. Terrain noise (single-octave, no detail noise)
      const noiseVal = terrainNoise(wx, wz) * noiseConfig.amplitude;

      // 4. Combine
      // Base elevation: spine bias provides the mountain structure
      // Noise adds terrain variation
      // Falloff shapes the island
      let elevation = (spineBias + noiseVal) * falloff * deepOceanFalloff;

      // // Add ocean floor noise for underwater detail
      if (elevation < seaLevel) {
        const oceanNoise = terrainNoise(wx * 0.5, wz * 0.5) * 0.06;
        elevation += oceanNoise * (1 - falloff) * 0.5;
      }

      // 5. Multi-band terracing (slider-controlled, default off)
      if (terraceStrength > 0 && elevation > seaLevel) {
        const SHELVES = [
          { center: 0.15, width: 0.05, strength: 0.65 },
          { center: 0.25, width: 0.05, strength: 0.50 },
          { center: 0.38, width: 0.04, strength: 0.35 },
        ];
        for (const shelf of SHELVES) {
          const dist = Math.abs(elevation - shelf.center);
          if (dist < shelf.width) {
            const t = 1.0 - dist / shelf.width;
            const flatness = t * t * shelf.strength * terraceStrength;
            elevation = lerp(elevation, shelf.center, flatness);
          }
        }
      }

      data[row * width + col] = elevation;
    }
  }

  return { width, height, data, bounds };
}
