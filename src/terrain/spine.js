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
  
  for (let i = 0; i < spine.vertices.length; i++) {
    const isEndpoint = (i === 0 || i === spine.vertices.length - 1);
    
    if (isEndpoint) {
      cells.push({
        id: `${spine.id}:${i}:radial`,
        vertexIndex: i,
        side: 'radial'
      });
    } else {
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
 * Get merged configuration for a half-cell
 * @param {Object} world - World object with halfCells and defaults
 * @param {string} spineId - Spine identifier
 * @param {number} vertexIndex - Vertex index
 * @param {'left' | 'right' | 'radial'} side - Side of spine
 * @returns {{profile: string, baseElevation: number, falloffCurve: number}}
 */
export function getHalfCellConfig(world, spineId, vertexIndex, side) {
  const id = getHalfCellId(spineId, vertexIndex, side);
  const cellOverride = world.halfCells?.[id] || {};
  const defaults = world.defaults || {};

  return {
    profile: cellOverride.profile ?? defaults.profile ?? 'ramp',
    baseElevation: cellOverride.baseElevation ?? defaults.baseElevation ?? 0.1,
    falloffCurve: cellOverride.falloffCurve ?? defaults.falloffCurve ?? 0.5
  };
}
