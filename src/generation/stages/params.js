/**
 * Stage 1: World parameter generation
 *
 * Deterministically generates high-level island parameters from a seed.
 * Selects archetype via weighted random and generates archetype-specific params.
 */

import { seededRandom, deriveSeed } from '../../core/seeds.js';
import { lerp } from '../../core/math.js';
import { pickArchetype } from '../archetypes/index.js';

/** Default sea level (matches existing system) */
export const SEA_LEVEL = 0.10;

/**
 * Generate world parameters from seed
 *
 * @param {number} seed - World seed
 * @param {Object} [options]
 * @param {string} [options.archetype] - Force a specific archetype (skip random selection)
 * @param {Object} [options.terrainOverrides] - Override noise/warp config from UI sliders
 * @returns {Object} World parameters
 */
export function generateParams(seed, options = {}) {
  const rng = seededRandom(deriveSeed(seed, 'params'));

  // Island radius in normalized [-1, 1] space
  const radius = lerp(0.6, 0.9, rng());

  // Slight center jitter for variety
  const centerJitter = 0.05;
  const center = {
    x: (rng() - 0.5) * 2 * centerJitter,
    z: (rng() - 0.5) * 2 * centerJitter,
  };

  // Select archetype
  const archetype = options.archetype || pickArchetype(rng);

  // Generate archetype-specific parameters
  const archetypeParams = generateArchetypeParams(archetype, rng, radius);

  // Noise config for terrain detail
  const noiseConfig = {
    octaves: 2,
    persistence: 0.45,
    lacunarity: 2.0,
    frequency: lerp(3.5, 6, rng()),
    amplitude: lerp(0.15, 0.25, rng()),
  };

  // Domain warp config
  const warpConfig = {
    enabled: true,
    strength: lerp(0.04, 0.08, rng()),
    scale: lerp(0.10, 0.25, rng()),
    octaves: 10,
  };

  // Elevation shape config
  const elevationConfig = {
    foothillRadius: 2.5,
    foothillHeight: 0,
    terraceStrength: 0,
  };

  // Apply terrain overrides from UI sliders
  const overrides = options.terrainOverrides;
  if (overrides) {
    if (overrides.noise) {
      Object.assign(noiseConfig, overrides.noise);
    }
    if (overrides.warp) {
      Object.assign(warpConfig, overrides.warp);
    }
    if (overrides.elevation) {
      Object.assign(elevationConfig, overrides.elevation);
    }
  }

  return {
    seed,
    center,
    radius,
    archetype,
    archetypeParams,
    seaLevel: SEA_LEVEL,
    noiseConfig,
    warpConfig,
    elevationConfig,
  };
}

/**
 * Generate archetype-specific parameters
 *
 * @param {string} archetype - Archetype name
 * @param {Function} rng - Seeded RNG
 * @param {number} radius - Island radius
 * @returns {Object} Archetype parameters
 */
function generateArchetypeParams(archetype, rng, radius) {
  switch (archetype) {
    case 'ridge':
      return {
        angle: rng() * Math.PI,
        ridgeLength: lerp(0.5, 0.8, rng()),
        peakElevation: lerp(0.55, 0.85, rng()),
        vertexCount: Math.floor(lerp(6, 12, rng())),
        noiseDisplacement: lerp(0.05, 0.15, rng()),
      };

    case 'arc':
      return {
        curvature: lerp(0.3, 0.8, rng()),
        arcAngle: lerp(Math.PI * 0.4, Math.PI * 0.9, rng()),
        startAngle: rng() * Math.PI * 2,
        peakElevation: lerp(0.5, 0.8, rng()),
        vertexCount: Math.floor(lerp(8, 14, rng())),
        noiseDisplacement: lerp(0.05, 0.12, rng()),
      };

    case 'crescent':
      return {
        openingAngle: lerp(Math.PI * 0.3, Math.PI * 0.8, rng()),
        startAngle: rng() * Math.PI * 2,
        peakElevation: lerp(0.5, 0.75, rng()),
        vertexCount: Math.floor(lerp(10, 18, rng())),
        noiseDisplacement: lerp(0.04, 0.1, rng()),
      };

    case 'ring':
      return {
        eccentricity: lerp(0, 0.3, rng()),
        gapAngle: rng() * Math.PI * 2,
        gapWidth: rng() < 0.3 ? 0 : lerp(0.3, 0.8, rng()),
        peakElevation: lerp(0.35, 0.55, rng()),
        vertexCount: Math.floor(lerp(12, 20, rng())),
        noiseDisplacement: lerp(0.03, 0.08, rng()),
      };

    case 'star':
      return {
        armCount: Math.floor(lerp(3, 6, rng())),
        armLength: lerp(0.3, 0.6, rng()),
        peakElevation: lerp(0.6, 0.9, rng()),
        vertexCountPerArm: Math.floor(lerp(3, 6, rng())),
        noiseDisplacement: lerp(0.04, 0.12, rng()),
      };

    case 'scattered':
      return {
        islandCount: Math.floor(lerp(3, 7, rng())),
        spreadRadius: lerp(0.5, 0.8, rng()),
        minIslandRadius: lerp(0.1, 0.15, rng()),
        maxIslandRadius: lerp(0.2, 0.35, rng()),
        peakElevation: lerp(0.4, 0.7, rng()),
        vertexCountPerIsland: Math.floor(lerp(4, 7, rng())),
        noiseDisplacement: lerp(0.03, 0.08, rng()),
      };

    default:
      throw new Error(`No parameter generator for archetype: ${archetype}`);
  }
}
