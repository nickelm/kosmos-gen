/**
 * Underwater depth layer renderer
 *
 * Shows seafloor terrain with depth-based blue shading.
 * Only renders cells below sea level; above-water cells are transparent.
 */

/** Cached offscreen canvas */
let offscreenCanvas = null;
let cachedDataKey = null;

/**
 * Render underwater depth shading
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} generatedData - Pipeline output
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} _zoom
 */
export function renderUnderwater(ctx, generatedData, canvasWidth, canvasHeight, _zoom) {
  const { elevation, params } = generatedData;
  if (!elevation || !params) return;

  const { width, height, data } = elevation;
  const { seaLevel } = params;

  const dataKey = `underwater-${generatedData.seed}-${width}-${height}-${canvasWidth}-${canvasHeight}`;
  if (offscreenCanvas && cachedDataKey === dataKey) {
    ctx.drawImage(offscreenCanvas, 0, 0);
    return;
  }

  offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = canvasWidth;
  offscreenCanvas.height = canvasHeight;
  const offCtx = offscreenCanvas.getContext('2d');

  const imageData = offCtx.createImageData(canvasWidth, canvasHeight);
  const pixels = imageData.data;

  const scaleX = width / canvasWidth;
  const scaleY = height / canvasHeight;

  for (let cy = 0; cy < canvasHeight; cy++) {
    for (let cx = 0; cx < canvasWidth; cx++) {
      const gx = Math.min(width - 1, Math.floor(cx * scaleX));
      const gy = Math.min(height - 1, Math.floor(cy * scaleY));

      const elev = data[gy * width + gx];

      if (elev >= seaLevel) continue; // transparent (imageData is zero-initialized)

      // Depth: 0 at sea level, positive going deeper
      const depth = seaLevel - elev;
      const normalizedDepth = Math.min(1, depth / seaLevel);

      // Shallow = lighter blue, deep = darker blue
      const r = Math.round(100 - normalizedDepth * 90);
      const g = Math.round(180 - normalizedDepth * 150);
      const b = Math.round(240 - normalizedDepth * 140);

      const idx = (cy * canvasWidth + cx) * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = 255;
    }
  }

  offCtx.putImageData(imageData, 0, 0);
  cachedDataKey = dataKey;

  ctx.drawImage(offscreenCanvas, 0, 0);
}

/**
 * Invalidate the underwater render cache
 */
export function invalidateUnderwaterCache() {
  offscreenCanvas = null;
  cachedDataKey = null;
}
