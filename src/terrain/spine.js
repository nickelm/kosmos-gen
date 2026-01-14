/**
 * Spine representation and half-cell management
 */

/**
 * Create a new spine
 * @param {string} id - Unique identifier
 * @param {Array<{x: number, z: number, elevation: number, influence: number}>} vertices
 * @returns {Object} Spine object
 */
export function createSpine(id, vertices) {
  return {
    id,
    vertices
  };
}

/**
 * Get half-cells for a spine
 * 
 * Interior vertices (not endpoints) produce 2 half-cells (left/right).
 * Endpoint vertices produce 1 radial cell.
 * 
 * @param {Object} spine - Spine object
 * @returns {Array<{id: string, vertexIndex: number, side: string}>} Half-cell descriptors
 */
export function getHalfCells(spine) {
  const cells = [];

  // Single-vertex spine: one radial cell (The Lonely Mountain)
  if (spine.vertices.length === 1) {
    return [{
      id: `${spine.id}:0:radial`,
      vertexIndex: 0,
      side: 'radial'
    }];
  }

  // All vertices (including endpoints) have left/right half-cells
  // Endpoints are split by the spine direction at that point
  for (let i = 0; i < spine.vertices.length; i++) {
    cells.push({
      id: `${spine.id}:${i}:left`,
      vertexIndex: i,
      side: 'left'
    });
    cells.push({
      id: `${spine.id}:${i}:right`,
      vertexIndex: i,
      side: 'right'
    });
  }

  return cells;
}

/**
 * Determine which side of a spine segment a point is on
 * 
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {Object} v1 - First vertex {x, z}
 * @param {Object} v2 - Second vertex {x, z}
 * @returns {'left' | 'right'} Side of spine
 */
export function getSide(px, pz, v1, v2) {
  // Cross product to determine side
  const cross = (v2.x - v1.x) * (pz - v1.z) - (v2.z - v1.z) * (px - v1.x);
  return cross < 0 ? 'left' : 'right';
}

/**
 * Get the canonical ID for a half-cell
 * @param {string} spineId - Spine identifier
 * @param {number} vertexIndex - Vertex index in spine
 * @param {'left' | 'right' | 'radial'} side - Side of spine
 * @returns {string} Half-cell ID
 */
export function getHalfCellId(spineId, vertexIndex, side) {
  return `${spineId}:${vertexIndex}:${side}`;
}

/**
 * Default surface noise configuration
 * Duplicated here to avoid circular imports with surfacenoise.js
 */
const DEFAULT_NOISE_ROUGHNESS = 0.3;
const DEFAULT_NOISE_FEATURE_SCALE = 0.1;

/**
 * Get merged configuration for a half-cell
 *
 * Half-cell config can specify elevation profile in two ways:
 * - profile: Named preset ('ramp', 'plateau', 'bowl', 'shield')
 * - shape: Numeric value for fine control (-1 to 1 typical range)
 *
 * If shape is provided, it takes precedence over profile name.
 *
 * Noise parameters control surface detail:
 * - roughness: Noise amplitude (0-1, maps to ~10% of elevation range)
 * - featureScale: Wavelength of noise features in world units
 *
 * @param {Object} world - World object with halfCells and defaults
 * @param {string} spineId - Spine identifier
 * @param {number} vertexIndex - Vertex index
 * @param {'left' | 'right' | 'radial'} side - Side of spine
 * @returns {{profile: string|number, baseElevation: number, falloffCurve: number, roughness: number, featureScale: number}}
 */
export function getHalfCellConfig(world, spineId, vertexIndex, side) {
  const id = getHalfCellId(spineId, vertexIndex, side);
  const cellOverride = world.halfCells?.[id] || {};
  const defaults = world.defaults || {};
  const noiseDefaults = defaults.surfaceNoise || {};

  // Shape takes precedence if specified, otherwise use profile name
  const profile = cellOverride.shape ?? cellOverride.profile ?? defaults.shape ?? defaults.profile ?? 'ramp';

  return {
    profile,
    baseElevation: cellOverride.baseElevation ?? defaults.baseElevation ?? 0.1,
    falloffCurve: cellOverride.falloffCurve ?? defaults.falloffCurve ?? 0.5,
    roughness: cellOverride.roughness ?? noiseDefaults.roughness ?? DEFAULT_NOISE_ROUGHNESS,
    featureScale: cellOverride.featureScale ?? noiseDefaults.featureScale ?? DEFAULT_NOISE_FEATURE_SCALE
  };
}
