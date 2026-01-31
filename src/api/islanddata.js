/**
 * IslandData - Queryable interface over generated island data
 *
 * Wraps raw pipeline output with FieldSamplers for O(1) grid queries
 * and provides convenient methods for terrain, water, road, settlement,
 * and POI lookups.
 *
 * All coordinate parameters use normalized [-1, 1] space.
 */

import { FieldSampler } from './fieldsampler.js';
import { getBiomeName as defaultGetBiomeName, getBiomeColor as defaultGetBiomeColor } from '../generation/whittaker.js';
import { generateName } from '../generation/naming.js';

export class IslandData {
  /**
   * @param {Object} result - Raw pipeline result from generate()
   * @param {Object} config - Effective generation config
   */
  constructor(result, config) {
    this._result = result;
    this._config = config;
    this._name = null; // lazy

    const elev = result.elevation;
    const bounds = elev.bounds;

    // Core terrain sampler
    this._elevation = new FieldSampler(elev.data, elev.width, elev.height, bounds);

    // Climate samplers
    if (result.climate) {
      this._temperature = new FieldSampler(
        result.climate.temperature, result.climate.width, result.climate.height, bounds
      );
      this._humidity = new FieldSampler(
        result.climate.humidity, result.climate.width, result.climate.height, bounds
      );
    }

    // Biome sampler (nearest-neighbor for discrete IDs)
    if (result.biomes) {
      this._biomes = new FieldSampler(
        result.biomes.data, result.biomes.width, result.biomes.height, bounds,
        { nearest: true }
      );
      this._biomeRegistry = result.biomes.registry || null;
    }

    // Hydrology SDFs
    if (result.hydrology) {
      const hw = result.hydrology.width;
      const hh = result.hydrology.height;
      if (result.hydrology.riverSDF) {
        this._riverSDF = new FieldSampler(result.hydrology.riverSDF, hw, hh, bounds);
      }
      if (result.hydrology.lakeSDF) {
        this._lakeSDF = new FieldSampler(result.hydrology.lakeSDF, hw, hh, bounds);
      }
    }

    // Coast SDF
    if (result.settlements?.coastSDF) {
      this._coastSDF = new FieldSampler(
        result.settlements.coastSDF, elev.width, elev.height, bounds
      );
    }

    // Road SDF
    if (result.roads?.roadSDF) {
      this._roadSDF = new FieldSampler(
        result.roads.roadSDF, result.roads.sdfWidth, result.roads.sdfHeight, bounds
      );
    }

    // Flat arrays for spatial lookups
    this._settlements = result.settlements?.settlements || [];
    this._roads = result.roads?.roads || [];
    this._rivers = result.hydrology?.rivers || [];
    this._lakes = result.hydrology?.lakes || [];
    this._pois = result.pois?.pois || [];
    this._seaLevel = result.params.seaLevel;
  }

  // ------------------------------------------------------------------
  // Terrain
  // ------------------------------------------------------------------

  /** Get interpolated elevation at (x, z). Returns 0..1 normalized. */
  getElevation(x, z) {
    return this._elevation.sample(x, z);
  }

  /** Get biome ID at (x, z). Returns integer biome ID. */
  getBiome(x, z) {
    if (!this._biomes) return 0;
    return this._biomes.sample(x, z);
  }

  /** Get biome name at (x, z). */
  getBiomeName(x, z) {
    const numericId = this.getBiome(x, z);
    if (this._biomeRegistry) {
      return this._biomeRegistry.idToString.get(numericId) || `biome_${numericId}`;
    }
    return defaultGetBiomeName(numericId);
  }

  /** Get biome color at (x, z). Returns [r, g, b] array (0-255). */
  getBiomeColor(x, z) {
    const numericId = this.getBiome(x, z);
    if (this._biomeRegistry && this._config.biomes?.colors) {
      const stringId = this._biomeRegistry.idToString.get(numericId);
      return this._config.biomes.colors[stringId] || [128, 128, 128];
    }
    return defaultGetBiomeColor(numericId);
  }

  /**
   * Get climate at (x, z).
   * @returns {{ temperature: number, humidity: number }}
   */
  getClimate(x, z) {
    return {
      temperature: this._temperature ? this._temperature.sample(x, z) : 0.5,
      humidity: this._humidity ? this._humidity.sample(x, z) : 0.5,
    };
  }

  // ------------------------------------------------------------------
  // Water
  // ------------------------------------------------------------------

  /** Is (x, z) below sea level (ocean)? */
  isOcean(x, z) {
    return this.getElevation(x, z) < this._seaLevel;
  }

  /**
   * Is (x, z) on or in a river?
   * @param {number} [threshold=0.008] - Distance threshold in normalized units
   */
  isRiver(x, z, threshold = 0.008) {
    if (!this._riverSDF) return false;
    return this._riverSDF.sample(x, z) < threshold;
  }

  /** Is (x, z) inside a lake? (lakeSDF is signed: negative = inside) */
  isLake(x, z) {
    if (!this._lakeSDF) return false;
    return this._lakeSDF.sample(x, z) < 0;
  }

  /** Is (x, z) any kind of water (ocean, river, or lake)? */
  isWater(x, z) {
    return this.isOcean(x, z) || this.isRiver(x, z) || this.isLake(x, z);
  }

  /**
   * Get approximate river width at (x, z) by finding the nearest
   * river vertex and returning its stored width property.
   * Returns 0 if not near a river.
   */
  getRiverWidth(x, z) {
    if (!this.isRiver(x, z, 0.02)) return 0;
    const nearest = this._findNearestRiverVertex(x, z);
    return nearest ? nearest.width : 0;
  }

  // ------------------------------------------------------------------
  // Roads
  // ------------------------------------------------------------------

  /**
   * Is (x, z) on a road? Uses roadSDF for O(1) lookup.
   * @param {number} [threshold=0.007] - Distance threshold (highway half-width)
   */
  isOnRoad(x, z, threshold = 0.007) {
    if (!this._roadSDF) return false;
    return this._roadSDF.sample(x, z) < threshold;
  }

  /**
   * Get road info at (x, z). Returns null if not near a road.
   * @returns {{ roadId: string, type: string, width: number, segmentType: string, bridgeData?: Object, tunnelData?: Object } | null}
   */
  getRoadAt(x, z) {
    return this._findNearestRoadSegment(x, z);
  }

  /** Get road type ('highway', 'road', 'path') at (x, z), or null. */
  getRoadType(x, z) {
    const info = this.getRoadAt(x, z);
    return info ? info.type : null;
  }

  /** Get road width at (x, z). Returns 0 if not on a road. */
  getRoadWidth(x, z) {
    const info = this.getRoadAt(x, z);
    return info ? info.width : 0;
  }

  /**
   * Get bridge data at (x, z), or null if not on a bridge.
   * @returns {{ spanLength: number, roadType: string } | null}
   */
  getBridgeAt(x, z) {
    const info = this._findNearestRoadSegment(x, z);
    if (!info || info.segmentType !== 'bridge') return null;
    return {
      spanLength: info.bridgeData?.spanLength || 0,
      roadType: info.type,
    };
  }

  /**
   * Get tunnel data at (x, z), or null if not in a tunnel.
   * @returns {{ ridgeMaxElev: number, length: number, roadType: string } | null}
   */
  getTunnelAt(x, z) {
    const info = this._findNearestRoadSegment(x, z);
    if (!info || info.segmentType !== 'tunnel') return null;
    return {
      ridgeMaxElev: info.tunnelData?.ridgeMaxElev || 0,
      length: info.tunnelData?.length || 0,
      roadType: info.type,
    };
  }

  // ------------------------------------------------------------------
  // Settlements
  // ------------------------------------------------------------------

  /**
   * Get the settlement at (x, z) if inside a settlement's radius.
   * @returns {Object|null} Settlement object or null
   */
  getSettlementAt(x, z) {
    for (const s of this._settlements) {
      const dx = x - s.position[0];
      const dz = z - s.position[1];
      if (dx * dx + dz * dz <= s.radius * s.radius) {
        return s;
      }
    }
    return null;
  }

  /**
   * Get terrace elevation at (x, z) if inside a settlement terrace.
   * Returns the terrace's targetElevation, or null if not on a terrace.
   */
  getTerraceElevation(x, z) {
    const settlement = this.getSettlementAt(x, z);
    if (!settlement || !settlement.terraces) return null;

    for (const terrace of settlement.terraces) {
      if (this._pointInPolygon(x, z, terrace.polygon)) {
        return terrace.targetElevation;
      }
    }
    return null;
  }

  /**
   * Find the nearest settlement to (x, z).
   * @returns {{ settlement: Object, distance: number } | null}
   */
  getNearestSettlement(x, z) {
    if (this._settlements.length === 0) return null;

    let nearest = null;
    let minDist = Infinity;

    for (const s of this._settlements) {
      const dx = x - s.position[0];
      const dz = z - s.position[1];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < minDist) {
        minDist = d;
        nearest = s;
      }
    }

    return { settlement: nearest, distance: minDist };
  }

  // ------------------------------------------------------------------
  // POIs
  // ------------------------------------------------------------------

  /** Get all POIs as an array. */
  getPOIs() {
    return [...this._pois];
  }

  /**
   * Get POIs filtered by type ID.
   * @param {string} typeId - POI type identifier
   * @returns {Array} POI objects matching the type
   */
  getPOIsOfType(typeId) {
    return this._pois.filter(p => p.typeId === typeId);
  }

  /**
   * Get the nearest POI within radius of (x, z).
   * @param {number} x
   * @param {number} z
   * @param {number} [radius=0.02] - Search radius in normalized units
   * @returns {Object|null} POI object or null
   */
  getPOIAt(x, z, radius = 0.02) {
    let nearest = null;
    let minDist = radius;

    for (const poi of this._pois) {
      const dx = x - poi.position[0];
      const dz = z - poi.position[1];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < minDist) {
        minDist = d;
        nearest = poi;
      }
    }

    return nearest;
  }

  /**
   * Get nearest POI to (x, z), optionally filtered by type.
   * @param {number} x
   * @param {number} z
   * @param {string} [typeId] - Optional type filter
   * @returns {{ poi: Object, distance: number } | null}
   */
  getNearestPOI(x, z, typeId) {
    let nearest = null;
    let minDist = Infinity;
    const source = typeId ? this._pois.filter(p => p.typeId === typeId) : this._pois;

    for (const poi of source) {
      const dx = x - poi.position[0];
      const dz = z - poi.position[1];
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < minDist) {
        minDist = d;
        nearest = poi;
      }
    }

    return nearest ? { poi: nearest, distance: minDist } : null;
  }

  // ------------------------------------------------------------------
  // Meta
  // ------------------------------------------------------------------

  /** Get a deterministic island name from the seed. */
  getIslandName() {
    if (this._name === null) {
      const palette = this._config.naming?.island || null;
      this._name = generateName(0, 0, this._result.seed, 'island', palette);
    }
    return this._name;
  }

  /** Get the coordinate bounds of the island data. */
  getBounds() {
    return { ...this._result.elevation.bounds };
  }

  /** Check if (x, z) is within the data bounds. */
  isInBounds(x, z) {
    return this._elevation.isInBounds(x, z);
  }

  /** Get the sea level threshold. */
  getSeaLevel() {
    return this._seaLevel;
  }

  /** Get the archetype used to generate this island. */
  getArchetype() {
    return this._result.params.archetype;
  }

  /** Get the seed used to generate this island. */
  getSeed() {
    return this._result.seed;
  }

  /** Get pipeline timing data (ms per stage). */
  getTiming() {
    return { ...this._result.timing };
  }

  /** Get all settlements as an array. */
  getSettlements() {
    return [...this._settlements];
  }

  /** Get all roads as an array. */
  getRoads() {
    return [...this._roads];
  }

  /** Get all rivers as an array. */
  getRivers() {
    return [...this._rivers];
  }

  /** Get all lakes as an array. */
  getLakes() {
    return [...this._lakes];
  }

  // ------------------------------------------------------------------
  // Raw sampler access (for advanced consumers like chunk generators)
  // ------------------------------------------------------------------

  /** @returns {FieldSampler} Elevation grid sampler */
  getElevationSampler() { return this._elevation; }
  /** @returns {FieldSampler|undefined} Temperature grid sampler */
  getTemperatureSampler() { return this._temperature; }
  /** @returns {FieldSampler|undefined} Humidity grid sampler */
  getHumiditySampler() { return this._humidity; }
  /** @returns {FieldSampler|undefined} Biome grid sampler (nearest-neighbor) */
  getBiomeSampler() { return this._biomes; }
  /** @returns {FieldSampler|undefined} River distance field sampler */
  getRiverSDFSampler() { return this._riverSDF; }
  /** @returns {FieldSampler|undefined} Lake distance field sampler (signed) */
  getLakeSDFSampler() { return this._lakeSDF; }
  /** @returns {FieldSampler|undefined} Coast distance field sampler */
  getCoastSDFSampler() { return this._coastSDF; }
  /** @returns {FieldSampler|undefined} Road distance field sampler */
  getRoadSDFSampler() { return this._roadSDF; }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /** @private Find nearest river vertex to (x, z). */
  _findNearestRiverVertex(x, z) {
    let nearest = null;
    let minDistSq = Infinity;

    for (const river of this._rivers) {
      for (const v of river.vertices) {
        const dx = x - v.x;
        const dz = z - v.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistSq) {
          minDistSq = dSq;
          nearest = v;
        }
      }
    }
    return nearest;
  }

  /**
   * @private Find nearest road segment at (x, z).
   * Returns road info + segment classification if close enough, else null.
   */
  _findNearestRoadSegment(x, z) {
    let bestRoad = null;
    let bestWpIdx = -1;
    let minDistSq = Infinity;

    for (const road of this._roads) {
      for (let i = 0; i < road.waypoints.length; i++) {
        const wp = road.waypoints[i];
        const dx = x - wp.x;
        const dz = z - wp.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistSq) {
          minDistSq = dSq;
          bestRoad = road;
          bestWpIdx = i;
        }
      }
    }

    if (!bestRoad) return null;

    // Check if within road influence (road width * 2 for margin)
    const maxDist = bestRoad.width * 2;
    if (Math.sqrt(minDistSq) > maxDist) return null;

    // Find which segment this waypoint belongs to
    let segmentType = 'normal';
    let bridgeData = null;
    let tunnelData = null;

    for (const seg of bestRoad.segments) {
      if (bestWpIdx >= seg.startIdx && bestWpIdx <= seg.endIdx) {
        segmentType = seg.type;
        bridgeData = seg.bridgeData;
        tunnelData = seg.tunnelData;
        break;
      }
    }

    return {
      roadId: bestRoad.id,
      type: bestRoad.type,
      width: bestRoad.width,
      segmentType,
      bridgeData,
      tunnelData,
    };
  }

  /**
   * @private Point-in-polygon test (ray casting) for terrace polygons.
   * @param {number} x
   * @param {number} z
   * @param {Array<[number,number]>} polygon
   */
  _pointInPolygon(x, z, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], zi = polygon[i][1];
      const xj = polygon[j][0], zj = polygon[j][1];
      if (
        ((zi > z) !== (zj > z)) &&
        (x < (xj - xi) * (z - zi) / (zj - zi) + xi)
      ) {
        inside = !inside;
      }
    }
    return inside;
  }
}
