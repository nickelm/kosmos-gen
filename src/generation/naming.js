/**
 * Settlement name generation
 *
 * Deterministic name generator using position-based hashing.
 * Produces fantasy settlement names in three patterns:
 * compound (40%), possessive (35%), descriptive (25%).
 */

import { deriveSeed, seededRandom } from '../core/seeds.js';

// ---------------------------------------------------------------------------
// Word lists (Verdania naming palette)
// ---------------------------------------------------------------------------

const ROOTS = [
  'Willow', 'Oak', 'Ash', 'Thorn', 'Stone', 'Iron', 'Brook', 'Glen',
  'Elm', 'Birch', 'Moss', 'Fern', 'Copper', 'Hazel', 'Alder', 'Reed',
  'Briar', 'Cliff', 'Mist', 'Storm', 'Raven', 'Crane', 'Fox', 'Hare',
  'Silver', 'Gold', 'Amber', 'Flint', 'Slate', 'Wren',
];

const SUFFIXES = [
  'ford', 'wick', 'holme', 'dale', 'mere', 'fell', 'stead', 'gate',
  'haven', 'ton', 'bridge', 'vale', 'moor', 'croft', 'field', 'wood',
  'marsh', 'reach', 'bury', 'holt',
];

const PEOPLE = [
  'Miller', 'Smith', 'Cooper', 'Warden', 'Shepherd', 'Fletcher',
  'Mason', 'Thatcher', 'Brewer', 'Carter', 'Forester', 'Fisher',
  'Tinker', 'Chandler', 'Wainwright', 'Bowman',
];

const FEATURES = [
  'Rest', 'Crossing', 'Bridge', 'Well', 'Mill', 'Hall', 'Keep',
  'Landing', 'Watch', 'Hollow', 'Hearth', 'Lodge', 'Wharf', 'Market',
  'Green', 'End',
];

const DESCRIPTORS = [
  'Old', 'Quiet', 'High', 'Low', 'Green', 'White', 'Dark', 'Long',
  'Far', 'Bright', 'Deep', 'Broad', 'North', 'South', 'East', 'West',
];

// ---------------------------------------------------------------------------
// Name generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic settlement name.
 *
 * @param {number} x - Settlement world X coordinate
 * @param {number} z - Settlement world Z coordinate
 * @param {number} seed - World seed
 * @param {string} type - 'city' | 'village' | 'hamlet'
 * @returns {string} Generated name
 */
export function generateSettlementName(x, z, seed, type) {
  // Create a deterministic RNG from position and seed
  const nameSeed = deriveSeed(
    deriveSeed(seed, 'name'),
    `${Math.round(x * 10000)}_${Math.round(z * 10000)}`
  );
  const rng = seededRandom(nameSeed);

  // Pattern selection: compound 40%, possessive 35%, descriptive 25%
  const roll = rng();

  if (roll < 0.40) {
    return compoundName(rng);
  } else if (roll < 0.75) {
    return possessiveName(rng);
  } else {
    return descriptiveName(rng);
  }
}

/**
 * Compound name: Root + suffix (e.g. "Thornwick", "Ashford")
 */
function compoundName(rng) {
  const root = ROOTS[Math.floor(rng() * ROOTS.length)];
  const suffix = SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
  return root + suffix.toLowerCase();
}

/**
 * Possessive name: Person's Feature (e.g. "Cooper's Rest")
 */
function possessiveName(rng) {
  const person = PEOPLE[Math.floor(rng() * PEOPLE.length)];
  const feature = FEATURES[Math.floor(rng() * FEATURES.length)];
  return `${person}'s ${feature}`;
}

/**
 * Descriptive name: Descriptor Feature (e.g. "Quiet Haven")
 */
function descriptiveName(rng) {
  const descriptor = DESCRIPTORS[Math.floor(rng() * DESCRIPTORS.length)];
  const feature = FEATURES[Math.floor(rng() * FEATURES.length)];
  return `${descriptor} ${feature}`;
}
