/**
 * Climate layer renderer
 *
 * Renders temperature or humidity as a color-mapped heatmap.
 * Mode controlled by generatedData.climateMode ('temperature' or 'humidity').
 */

/** Cached offscreen canvas */
let offscreenCanvas = null;
let cachedDataKey = null;

/**
 * Sample temperature color: blue (cold) → cyan → green → yellow → red (hot)
 * @param {number} t - Temperature [0, 1]
 * @returns {[number, number, number]}
 */
function sampleTemperatureColor(t) {
  if (t < 0.25) {
    const s = t / 0.25;
    return [
      Math.round(0 + s * 0),
      Math.round(0 + s * 180),
      Math.round(200 + s * 55),
    ];
  }
  if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return [
      Math.round(0 + s * 80),
      Math.round(180 + s * 20),
      Math.round(255 - s * 200),
    ];
  }
  if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return [
      Math.round(80 + s * 175),
      Math.round(200 - s * 10),
      Math.round(55 - s * 55),
    ];
  }
  const s = (t - 0.75) / 0.25;
  return [
    Math.round(255),
    Math.round(190 - s * 190),
    Math.round(0),
  ];
}

/**
 * Sample humidity color: brown (dry) → yellow-green → green (wet)
 * @param {number} h - Humidity [0, 1]
 * @returns {[number, number, number]}
 */
function sampleHumidityColor(h) {
  if (h < 0.5) {
    const s = h / 0.5;
    return [
      Math.round(180 - s * 70),
      Math.round(140 + s * 50),
      Math.round(80 - s * 30),
    ];
  }
  const s = (h - 0.5) / 0.5;
  return [
    Math.round(110 - s * 80),
    Math.round(190 - s * 60),
    Math.round(50 + s * 10),
  ];
}

/**
 * Render climate field (temperature or humidity)
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} generatedData - Pipeline output
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} _zoom
 */
export function renderClimate(ctx, generatedData, canvasWidth, canvasHeight, _zoom) {
  const { climate } = generatedData;
  if (!climate) return;

  const mode = generatedData.climateMode || 'temperature';
  const field = mode === 'humidity' ? climate.humidity : climate.temperature;
  const colorFn = mode === 'humidity' ? sampleHumidityColor : sampleTemperatureColor;

  const { width, height } = climate;

  const dataKey = `climate-${generatedData.seed}-${mode}-${width}-${height}-${canvasWidth}-${canvasHeight}`;
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

      const value = field[gy * width + gx];
      const [r, g, b] = colorFn(value);

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
 * Invalidate the climate render cache
 */
export function invalidateClimateCache() {
  offscreenCanvas = null;
  cachedDataKey = null;
}
