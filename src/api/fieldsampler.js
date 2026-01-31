/**
 * FieldSampler - Bilinear interpolation on typed-array grids
 *
 * Converts world coordinates to grid indices and performs bilinear
 * interpolation for smooth O(1) queries on Float32Array/Uint8Array data.
 */

export class FieldSampler {
  /**
   * @param {Float32Array|Uint8Array} data - Grid data (row-major)
   * @param {number} width  - Grid width in cells
   * @param {number} height - Grid height in cells
   * @param {Object} bounds - { minX, maxX, minZ, maxZ }
   * @param {Object} [options]
   * @param {boolean} [options.nearest=false] - Use nearest-neighbor instead of bilinear
   *   (appropriate for Uint8Array biome IDs where interpolation is meaningless)
   */
  constructor(data, width, height, bounds, options = {}) {
    this.data = data;
    this.width = width;
    this.height = height;
    this.bounds = bounds;
    this.nearest = options.nearest || false;

    // Precompute inverse scale for world -> grid mapping
    this._invScaleX = width / (bounds.maxX - bounds.minX);
    this._invScaleZ = height / (bounds.maxZ - bounds.minZ);
  }

  /**
   * Sample the field at a world-space position.
   *
   * @param {number} x - X coordinate (normalized space)
   * @param {number} z - Z coordinate (normalized space)
   * @returns {number} Interpolated (or nearest) value
   */
  sample(x, z) {
    // Map world -> continuous grid coordinates
    const gx = (x - this.bounds.minX) * this._invScaleX - 0.5;
    const gz = (z - this.bounds.minZ) * this._invScaleZ - 0.5;

    if (this.nearest) {
      const col = Math.max(0, Math.min(this.width - 1, Math.round(gx)));
      const row = Math.max(0, Math.min(this.height - 1, Math.round(gz)));
      return this.data[row * this.width + col];
    }

    // Bilinear interpolation
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;

    // Clamp indices to grid bounds
    const cx0 = Math.max(0, Math.min(this.width - 1, x0));
    const cx1 = Math.max(0, Math.min(this.width - 1, x0 + 1));
    const cz0 = Math.max(0, Math.min(this.height - 1, z0));
    const cz1 = Math.max(0, Math.min(this.height - 1, z0 + 1));

    const v00 = this.data[cz0 * this.width + cx0];
    const v10 = this.data[cz0 * this.width + cx1];
    const v01 = this.data[cz1 * this.width + cx0];
    const v11 = this.data[cz1 * this.width + cx1];

    return (
      v00 * (1 - fx) * (1 - fz) +
      v10 * fx * (1 - fz) +
      v01 * (1 - fx) * fz +
      v11 * fx * fz
    );
  }

  /**
   * Check if a world-space position is within the grid bounds.
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isInBounds(x, z) {
    return (
      x >= this.bounds.minX && x <= this.bounds.maxX &&
      z >= this.bounds.minZ && z <= this.bounds.maxZ
    );
  }
}
