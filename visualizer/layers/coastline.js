/**
 * Coastline layer renderer
 *
 * Extracts and renders the sea level contour line using marching squares
 * from the existing contour extraction code.
 */

import { extractContours, simplifyPolyline } from '../../src/geometry/contour.js';

/** Cached coastline polylines */
let cachedPolylines = null;
let cachedKey = null;

/**
 * Render coastline contour on canvas
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} generatedData - Pipeline output
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} zoom - Current viewport zoom (for line width compensation)
 */
export function renderCoastline(ctx, generatedData, canvasWidth, canvasHeight, zoom) {
  const { elevation, params } = generatedData;
  if (!elevation || !params) return;

  const { width, height, data, bounds } = elevation;
  const seaLevel = params.seaLevel;

  // Check cache
  const key = `${generatedData.seed}-${width}-${height}`;
  let polylines;

  if (cachedPolylines && cachedKey === key) {
    polylines = cachedPolylines;
  } else {
    const cellW = (bounds.maxX - bounds.minX) / width;
    const cellH = (bounds.maxZ - bounds.minZ) / height;

    const sampleFn = (x, z) => {
      const col = Math.floor((x - bounds.minX) / cellW);
      const row = Math.floor((z - bounds.minZ) / cellH);
      if (col < 0 || col >= width || row < 0 || row >= height) return 0;
      return data[row * width + col];
    };

    const resolution = (bounds.maxX - bounds.minX) / width * 2;
    polylines = extractContours(sampleFn, seaLevel, bounds, resolution);
    polylines = polylines.map(pl => simplifyPolyline(pl, resolution * 0.5));

    cachedPolylines = polylines;
    cachedKey = key;
  }

  // Map world coordinates to base canvas space
  const toCanvasX = (wx) => ((wx - bounds.minX) / (bounds.maxX - bounds.minX)) * canvasWidth;
  const toCanvasZ = (wz) => ((wz - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * canvasHeight;

  // Compensate line width for zoom so lines stay visually consistent
  ctx.strokeStyle = 'rgba(20, 20, 20, 0.8)';
  ctx.lineWidth = 1.5 / zoom;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const polyline of polylines) {
    if (polyline.length < 2) continue;

    ctx.beginPath();
    ctx.moveTo(toCanvasX(polyline[0].x), toCanvasZ(polyline[0].z));

    for (let i = 1; i < polyline.length; i++) {
      ctx.lineTo(toCanvasX(polyline[i].x), toCanvasZ(polyline[i].z));
    }

    ctx.stroke();
  }
}

/**
 * Invalidate the coastline cache
 */
export function invalidateCoastlineCache() {
  cachedPolylines = null;
  cachedKey = null;
}
