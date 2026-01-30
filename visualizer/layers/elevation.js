/**
 * Elevation layer renderer
 *
 * Renders the elevation grid as a color-ramped heightmap using an offscreen
 * canvas. Uses drawImage (not putImageData) so canvas transforms apply.
 */

/** Color ramp stops: [elevation, r, g, b] */
const COLOR_RAMP = [
  [0.00, 26, 35, 126],   // Deep ocean — dark blue
  [0.04, 21, 101, 192],  // Mid ocean — blue
  [0.08, 66, 165, 245],  // Shallow water — light blue
  [0.10, 100, 181, 246], // Shore water — very light blue
  [0.11, 212, 167, 106], // Beach — tan
  [0.15, 139, 195, 74],  // Coastal lowland — light green
  [0.25, 76, 175, 80],   // Lowland — green
  [0.40, 46, 125, 50],   // Highland — dark green
  [0.55, 121, 85, 72],   // Mountain — brown
  [0.70, 158, 158, 158], // High mountain — gray
  [0.85, 250, 250, 250], // Snow — white
];

/**
 * Sample the color ramp at a given elevation
 * @param {number} elevation - Normalized elevation
 * @returns {[number, number, number]} RGB values [0-255]
 */
function sampleColorRamp(elevation) {
  if (elevation <= COLOR_RAMP[0][0]) {
    return [COLOR_RAMP[0][1], COLOR_RAMP[0][2], COLOR_RAMP[0][3]];
  }

  const lastStop = COLOR_RAMP[COLOR_RAMP.length - 1];
  if (elevation >= lastStop[0]) {
    return [lastStop[1], lastStop[2], lastStop[3]];
  }

  for (let i = 0; i < COLOR_RAMP.length - 1; i++) {
    const a = COLOR_RAMP[i];
    const b = COLOR_RAMP[i + 1];

    if (elevation >= a[0] && elevation < b[0]) {
      const t = (elevation - a[0]) / (b[0] - a[0]);
      return [
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
        Math.round(a[3] + (b[3] - a[3]) * t),
      ];
    }
  }

  return [lastStop[1], lastStop[2], lastStop[3]];
}

/** Cached offscreen canvas for the elevation texture */
let offscreenCanvas = null;
let cachedDataKey = null;

/**
 * Render elevation grid to canvas via offscreen canvas + drawImage
 * (drawImage respects canvas transforms, unlike putImageData)
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} generatedData - Pipeline output
 * @param {number} canvasWidth - Base canvas width
 * @param {number} canvasHeight - Base canvas height
 * @param {number} _zoom - Current zoom (unused for elevation)
 */
export function renderElevation(ctx, generatedData, canvasWidth, canvasHeight, _zoom) {
  const { elevation } = generatedData;
  if (!elevation) return;

  const { width, height, data } = elevation;

  // Check if we can reuse cached offscreen canvas
  const dataKey = `${generatedData.seed}-${width}-${height}-${canvasWidth}-${canvasHeight}`;
  if (offscreenCanvas && cachedDataKey === dataKey) {
    ctx.drawImage(offscreenCanvas, 0, 0);
    return;
  }

  // Create offscreen canvas at base size
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
      const [r, g, b] = sampleColorRamp(elev);

      const idx = (cy * canvasWidth + cx) * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = 255;
    }
  }

  offCtx.putImageData(imageData, 0, 0);
  cachedDataKey = dataKey;

  // Draw to main canvas (respects active transform)
  ctx.drawImage(offscreenCanvas, 0, 0);
}

/**
 * Invalidate the elevation render cache
 */
export function invalidateElevationCache() {
  offscreenCanvas = null;
  cachedDataKey = null;
}
