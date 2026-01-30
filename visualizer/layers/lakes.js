/**
 * Lake layer renderer
 *
 * Draws lake boundaries as filled polygons.
 */

/**
 * Render lakes on canvas
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} generatedData - Pipeline output
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} zoom - Current viewport zoom
 */
export function renderLakes(ctx, generatedData, canvasWidth, canvasHeight, zoom) {
  const { hydrology, elevation } = generatedData;
  if (!hydrology?.lakes || !elevation) return;

  const { bounds } = elevation;
  const toCanvasX = (wx) => ((wx - bounds.minX) / (bounds.maxX - bounds.minX)) * canvasWidth;
  const toCanvasZ = (wz) => ((wz - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * canvasHeight;

  for (const lake of hydrology.lakes) {
    if (!lake.boundary || lake.boundary.length < 3) continue;

    ctx.beginPath();
    ctx.moveTo(toCanvasX(lake.boundary[0].x), toCanvasZ(lake.boundary[0].z));
    for (let i = 1; i < lake.boundary.length; i++) {
      ctx.lineTo(toCanvasX(lake.boundary[i].x), toCanvasZ(lake.boundary[i].z));
    }
    ctx.closePath();

    ctx.fillStyle = 'rgba(30, 120, 220, 0.6)';
    ctx.fill();

    ctx.strokeStyle = 'rgba(20, 80, 180, 0.8)';
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();
  }
}

/**
 * Invalidate the lakes cache
 */
export function invalidateLakesCache() {
  // No offscreen cache currently, but keep for consistency
}
