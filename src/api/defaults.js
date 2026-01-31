/**
 * Default configuration for island generation.
 *
 * Values represent midpoints of seed-randomized ranges where applicable.
 * Pass partial overrides to generateIsland(seed, options) to customize.
 * Unset keys remain seed-randomized for variety.
 */
export const DEFAULTS = {
  // Pipeline control
  resolution: 512,        // Elevation grid size (512 = default)
  upToStage: 'pois',      // Stop after this pipeline stage

  // Terrain noise
  noise: {
    octaves: 2,
    persistence: 0.45,
    lacunarity: 2.0,
    frequency: 4.75,      // midpoint of [3.5, 6.0]
    amplitude: 0.20,      // midpoint of [0.15, 0.25]
  },

  // Domain warp (organic terrain distortion)
  warp: {
    enabled: true,
    strength: 0.06,       // midpoint of [0.04, 0.08]
    scale: 0.175,         // midpoint of [0.10, 0.25]
    octaves: 10,
  },

  // Elevation shape
  elevation: {
    foothillRadius: 2.5,
    foothillHeight: 0,
    terraceStrength: 0,
  },

  // Sea level threshold
  seaLevel: 0.10,

  // Road type configurations
  roads: {
    highway: { width: 0.007, maxSlope: 0.6 },
    road:    { width: 0.005, maxSlope: 1.0 },
    path:    { width: 0.003, maxSlope: 1.8 },
  },

  // Caller-provided configuration (null = use built-in defaults)
  biomes: null,   // null = built-in Whittaker classifier
  pois: null,     // null = no POIs generated
  naming: null,   // null = built-in Verdania palette
};
