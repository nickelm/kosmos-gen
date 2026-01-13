/**
 * World - The core data structure for a generated world
 * 
 * A World can be:
 * - Generated from a template + seed
 * - Loaded from storage
 * - Queried for terrain data
 */

export class World {
  /**
   * @param {Object} data - World data
   * @param {string} data.id - World identifier
   * @param {number} data.seed - Generation seed
   * @param {Object} data.template - Source template
   * @param {Object} data.voronoi - Computed Voronoi diagram
   * @param {Object} data.halfCells - Half-cell configurations
   * @param {Array} data.rivers - River polylines
   * @param {Array} data.lakes - Lake polygons
   * @param {Array} data.zones - Zone placements
   * @param {Object} data.sdf - Distance field textures
   */
  constructor(data) {
    this.id = data.id;
    this.seed = data.seed;
    this.template = data.template;
    this.voronoi = data.voronoi;
    this.halfCells = data.halfCells || {};
    this.rivers = data.rivers || [];
    this.lakes = data.lakes || [];
    this.zones = data.zones || [];
    this.sdf = data.sdf || null;
  }
  
  /**
   * Get elevation at a point
   * @param {number} x 
   * @param {number} z 
   * @returns {number} Elevation [0, 1]
   */
  getElevationAt(x, z) {
    // TODO: Implement via SDF lookup or direct computation
    return 0;
  }
  
  /**
   * Get biome at a point
   * @param {number} x 
   * @param {number} z 
   * @returns {string} Biome name
   */
  getBiomeAt(x, z) {
    // TODO: Implement
    return 'plains';
  }
  
  /**
   * Get zone at a point
   * @param {number} x 
   * @param {number} z 
   * @returns {Object|null} Zone or null
   */
  getZoneAt(x, z) {
    // TODO: Implement
    return null;
  }
  
  /**
   * Serialize for storage
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      seed: this.seed,
      template: this.template,
      voronoi: this.voronoi,
      halfCells: this.halfCells,
      rivers: this.rivers,
      lakes: this.lakes,
      zones: this.zones
      // Note: SDF textures serialized separately as ArrayBuffers
    };
  }
  
  /**
   * Deserialize from storage
   * @param {Object} json 
   * @returns {World}
   */
  static fromJSON(json) {
    return new World(json);
  }
}
