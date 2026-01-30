/**
 * Archetype registry
 *
 * Maps archetype names to their generator functions.
 * Provides weighted random selection for seed-based archetype choice.
 */

import { generateRidge } from './ridge.js';
import { generateArc } from './arc.js';
import { generateCrescent } from './crescent.js';
import { generateRing } from './ring.js';
import { generateStar } from './star.js';
import { generateScattered } from './scattered.js';

const ARCHETYPES = {
  ridge: generateRidge,
  arc: generateArc,
  crescent: generateCrescent,
  ring: generateRing,
  star: generateStar,
  scattered: generateScattered,
};

/** Weights for random archetype selection (higher = more likely) */
const ARCHETYPE_WEIGHTS = {
  ridge: 3,
  arc: 2,
  crescent: 2,
  ring: 1,
  star: 2,
  scattered: 1,
};

/**
 * Get a generator function for the given archetype
 * @param {string} name - Archetype name
 * @returns {Function} Generator function
 */
export function getArchetype(name) {
  const gen = ARCHETYPES[name];
  if (!gen) {
    throw new Error(`Unknown archetype: ${name}`);
  }
  return gen;
}

/**
 * List available archetype names
 * @returns {string[]}
 */
export function listArchetypes() {
  return Object.keys(ARCHETYPES);
}

/**
 * Pick an archetype using weighted random selection
 * @param {Function} rng - Seeded random function returning [0, 1)
 * @returns {string} Archetype name
 */
export function pickArchetype(rng) {
  const names = Object.keys(ARCHETYPE_WEIGHTS);
  const weights = names.map(n => ARCHETYPE_WEIGHTS[n]);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let roll = rng() * totalWeight;
  for (let i = 0; i < names.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return names[i];
  }
  return names[names.length - 1];
}
