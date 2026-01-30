/**
 * Biome layer renderer
 *
 * Colors each cell by its Whittaker biome classification.
 */

import { getBiomeColor } from '../../src/generation/whittaker.js';

/** Cached offscreen canvas */
let offscreenCanvas = null;
let cachedDataKey = null;

/**
 * Render biome map
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} generatedData - Pipeline output
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} _zoom
 */
export function renderBiomes(ctx, generatedData, canvasWidth, canvasHeight, _zoom) {
  const { biomes } = generatedData;
  if (!biomes) return;

  const { width, height, data } = biomes;

  const dataKey = `biomes-${generatedData.seed}-${width}-${height}-${canvasWidth}-${canvasHeight}`;
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

      const biomeId = data[gy * width + gx];
      const [r, g, b] = getBiomeColor(biomeId);

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
 * Invalidate the biomes render cache
 */
export function invalidateBiomesCache() {
  offscreenCanvas = null;
  cachedDataKey = null;
}
