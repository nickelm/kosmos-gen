/**
 * Archetype catalog with descriptions and selection weights.
 *
 * Each archetype defines a distinct island shape.
 * Weights control probability during random selection from seed.
 */
export const ARCHETYPES = {
  ridge: {
    description: 'Linear mountain spine with central peaks',
    weight: 3,
  },
  arc: {
    description: 'Curved mountain range forming a partial arc',
    weight: 2,
  },
  crescent: {
    description: 'Moon-shaped range with an open bay',
    weight: 2,
  },
  ring: {
    description: 'Circular mountain ring (caldera), optionally with a gap',
    weight: 1,
  },
  star: {
    description: 'Multiple mountain arms radiating from center',
    weight: 2,
  },
  scattered: {
    description: 'Archipelago of small islands',
    weight: 1,
  },
};
