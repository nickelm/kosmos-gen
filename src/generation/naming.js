/**
 * Name generation
 *
 * Deterministic name generator using position-based hashing.
 * Supports caller-provided naming palettes with multiple pattern types.
 * Falls back to built-in Verdania palette when no palette is provided.
 */

import { deriveSeed, seededRandom } from '../core/seeds.js';
import { DEFAULT_NAMING } from '../config/defaultNaming.js';

// ---------------------------------------------------------------------------
// Pattern generators
//
// Each takes (rng, palette) and returns a name string.
// Patterns reference fields in the palette object by convention.
// ---------------------------------------------------------------------------

function pick(rng, arr) {
  if (!arr || arr.length === 0) return '';
  return arr[Math.floor(rng() * arr.length)];
}

const PATTERN_GENERATORS = {
  /** root + suffix -> "Thornwick" */
  compound(rng, p) {
    return pick(rng, p.roots) + pick(rng, p.suffixes).toLowerCase();
  },

  /** person + 's + feature -> "Cooper's Rest" */
  possessive(rng, p) {
    return `${pick(rng, p.people)}'s ${pick(rng, p.features)}`;
  },

  /** descriptor + feature -> "Quiet Haven" */
  descriptive(rng, p) {
    return `${pick(rng, p.descriptors)} ${pick(rng, p.features)}`;
  },

  /** The + adjective + noun -> "The Fallen Temple" */
  the_adjective_noun(rng, p) {
    return `The ${pick(rng, p.adjectives)} ${pick(rng, p.nouns)}`;
  },

  /** person + 's + noun -> "King's Tomb" */
  possessive_noun(rng, p) {
    return `${pick(rng, p.people)}'s ${pick(rng, p.nouns)}`;
  },

  /** name + Isle -> "Vern Isle" */
  name_isle(rng, p) {
    return `${pick(rng, p.names)} Isle`;
  },

  /** The + adjective + name -> "The Iron Korth" */
  the_adjective_name(rng, p) {
    return `The ${pick(rng, p.adjectives)} ${pick(rng, p.names)}`;
  },

  /** name + Field -> "Peterson Field" */
  name_field(rng, p) {
    return `${pick(rng, p.names)} Field`;
  },

  /** direction + name -> "North Eagle" */
  direction_name(rng, p) {
    return `${pick(rng, p.directions)} ${pick(rng, p.names)}`;
  },

  /** The + name + River -> "The Willow River" */
  the_name_river(rng, p) {
    return `The ${pick(rng, p.names)} River`;
  },

  /** Just the name -> "Storm" */
  name(rng, p) {
    return pick(rng, p.names);
  },
};

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic name from a palette.
 *
 * @param {number} x - World X coordinate (used for seed derivation)
 * @param {number} z - World Z coordinate (used for seed derivation)
 * @param {number} seed - World seed
 * @param {string} category - Category hint (e.g. 'city', 'village', 'island', 'river')
 * @param {Object} [palette] - Naming palette with patterns and word lists.
 *   If null/undefined, uses the appropriate default palette.
 * @returns {string} Generated name
 */
export function generateName(x, z, seed, category, palette) {
  // Resolve palette: use provided, or pick from defaults
  const effectivePalette = palette || resolveDefaultPalette(category);

  // Create a deterministic RNG from position and seed
  const nameSeed = deriveSeed(
    deriveSeed(seed, 'name'),
    `${Math.round(x * 10000)}_${Math.round(z * 10000)}`
  );
  const rng = seededRandom(nameSeed);

  // Select pattern
  const patterns = effectivePalette.patterns;
  if (!patterns || patterns.length === 0) {
    return pick(rng, effectivePalette.names || effectivePalette.roots) || 'Unnamed';
  }

  const weights = effectivePalette.weights;
  let patternName;

  if (weights && weights.length === patterns.length) {
    // Weighted selection
    const roll = rng();
    let cumulative = 0;
    patternName = patterns[patterns.length - 1]; // fallback to last
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (roll < cumulative) {
        patternName = patterns[i];
        break;
      }
    }
  } else {
    // Equal weight
    patternName = patterns[Math.floor(rng() * patterns.length)];
  }

  const generator = PATTERN_GENERATORS[patternName];
  if (!generator) {
    // Unknown pattern, fall back to picking a name or root
    return pick(rng, effectivePalette.names || effectivePalette.roots) || 'Unnamed';
  }

  return generator(rng, effectivePalette);
}

/**
 * Resolve the default palette for a given category.
 */
function resolveDefaultPalette(category) {
  switch (category) {
    case 'island':
      return DEFAULT_NAMING.island || DEFAULT_NAMING.settlement;
    case 'river':
      return DEFAULT_NAMING.river || DEFAULT_NAMING.settlement;
    default:
      return DEFAULT_NAMING.settlement;
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible wrapper
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic settlement name (legacy API).
 *
 * @param {number} x - Settlement world X coordinate
 * @param {number} z - Settlement world Z coordinate
 * @param {number} seed - World seed
 * @param {string} type - 'city' | 'village' | 'hamlet'
 * @param {Object} [palette] - Optional naming palette override
 * @returns {string} Generated name
 */
export function generateSettlementName(x, z, seed, type, palette) {
  return generateName(x, z, seed, type, palette);
}
