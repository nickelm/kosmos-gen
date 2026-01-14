/**
 * World - The core data structure for a generated world
 *
 * A World can be:
 * - Generated from a template + seed
 * - Loaded from storage
 * - Queried for terrain data
 */

import { sampleElevation } from '../terrain/elevation.js';

// Default hydrology configuration
export const DEFAULT_HYDROLOGY_CONFIG = {
  multiridge: false,        // Enable multi-spine watershed interactions
  autoDetect: true,         // Auto-suggest sources and lakes
  carveEnabled: true,       // Rivers modify elevation
  carveFactor: 0.02,        // Max carve depth per unit flow
  riverThreshold: 50,       // Min accumulation to become river
  lakeMinArea: 0.001,       // Min area for auto-detected lakes
  gridResolution: 0.01,     // Flow grid cell size
  baseRiverWidth: 0.005,    // Base river width at threshold flow
  riverWidthScale: 1.0      // River width multiplier
};

export class World {
  /**
   * @param {Object} data - World data
   * @param {string} data.id - World identifier
   * @param {number} data.seed - Generation seed
   * @param {Object} data.template - Source template (contains blobs array)
   * @param {Array} data.rivers - River polylines
   * @param {Array} data.lakes - Lake polygons
   * @param {Array} data.waterSources - Water source locations
   * @param {Object} data.flowGrid - Flow grid for hydrology
   * @param {Object} data.hydrologyConfig - Hydrology configuration
   * @param {Array} data.zones - Zone placements
   * @param {Object} data.sdf - Distance field textures
   */
  constructor(data) {
    this.id = data.id;
    this.seed = data.seed;
    this.template = data.template;
    this.rivers = data.rivers || [];
    this.lakes = data.lakes || [];
    this.waterSources = data.waterSources || [];
    this.flowGrid = data.flowGrid || null;
    this.hydrologyConfig = { ...DEFAULT_HYDROLOGY_CONFIG, ...data.hydrologyConfig };
    this.zones = data.zones || [];
    this.sdf = data.sdf || null;

    // Propagate defaults from template if present
    this.defaults = data.template?.defaults || data.defaults || {};
  }
  
  /**
   * Get elevation at a point
   * @param {number} x 
   * @param {number} z 
   * @returns {number} Elevation [0, 1]
   */
  getElevationAt(x, z) {
    return sampleElevation(this, x, z);
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
      version: 2,  // Blob-based terrain format
      id: this.id,
      seed: this.seed,
      template: this.template,
      rivers: this.rivers,
      lakes: this.lakes,
      waterSources: this.waterSources,
      hydrologyConfig: this.hydrologyConfig,
      zones: this.zones
      // Note: SDF textures and flowGrid serialized separately as ArrayBuffers
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
