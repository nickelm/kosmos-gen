/**
 * Stage 2: Spine generation
 *
 * Generates mountain spine polylines using the selected archetype.
 */

import { deriveSeed } from '../../core/seeds.js';
import { getArchetype } from '../archetypes/index.js';

/**
 * Generate spines from world parameters
 *
 * @param {Object} params - World parameters (from Stage 1)
 * @param {number} seed - World seed
 * @returns {{ vertices: Array<{x,z,elevation,influence}>, segments: Array<{from,to}>, archetype: string, islands?: Array }}
 */
export function generateSpines(params, seed) {
  const archetypeFn = getArchetype(params.archetype);
  const spineSeed = deriveSeed(seed, 'spines');
  const result = archetypeFn(params, spineSeed);

  return {
    vertices: result.vertices,
    segments: result.segments,
    archetype: params.archetype,
    // Scattered archetype returns per-island metadata for elevation falloff
    ...(result.islands ? { islands: result.islands } : {}),
  };
}
