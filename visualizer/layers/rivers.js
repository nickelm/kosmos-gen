/**
 * River layer renderer
 *
 * Draws river polylines with variable width based on flow accumulation.
 */

/** Cached river data */
let cachedRivers = null;
let cachedKey = null;

/**
 * Render rivers on canvas
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} generatedData - Pipeline output
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} zoom - Current viewport zoom
 */
export function renderRivers(ctx, generatedData, canvasWidth, canvasHeight, zoom) {
  const { hydrology, elevation } = generatedData;
  if (!hydrology?.rivers || !elevation) return;

  const { bounds } = elevation;
  const toCanvasX = (wx) => ((wx - bounds.minX) / (bounds.maxX - bounds.minX)) * canvasWidth;
  const toCanvasZ = (wz) => ((wz - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * canvasHeight;
  const worldToCanvas = (bounds.maxX - bounds.minX);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const river of hydrology.rivers) {
    if (river.vertices.length < 2) continue;

    // Draw segments with varying width
    for (let i = 0; i < river.vertices.length - 1; i++) {
      const v0 = river.vertices[i];
      const v1 = river.vertices[i + 1];

      // Average width in canvas pixels, zoom-compensated
      const avgWidth = (v0.width + v1.width) / 2;
      const widthPx = (avgWidth / worldToCanvas) * canvasWidth;
      ctx.lineWidth = Math.max(1.0 / zoom, widthPx);

      ctx.strokeStyle = 'rgba(30, 100, 220, 0.85)';
      ctx.beginPath();
      ctx.moveTo(toCanvasX(v0.x), toCanvasZ(v0.z));
      ctx.lineTo(toCanvasX(v1.x), toCanvasZ(v1.z));
      ctx.stroke();
    }
  }
}

/**
 * Invalidate the rivers cache
 */
export function invalidateRiversCache() {
  cachedRivers = null;
  cachedKey = null;
}
