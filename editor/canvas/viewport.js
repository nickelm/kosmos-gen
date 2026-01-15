/**
 * Viewport state and coordinate transforms for the editor canvas.
 *
 * Manages pan/zoom state and provides coordinate conversion between
 * screen pixels and world coordinates.
 */

// Scale clamping bounds
const MIN_SCALE = 0.25;
const MAX_SCALE = 4.0;

/**
 * Create a viewport state object.
 * @param {number} canvasWidth - Initial canvas width in pixels
 * @param {number} canvasHeight - Initial canvas height in pixels
 * @returns {object} Viewport state
 */
export function createViewport(canvasWidth = 800, canvasHeight = 600) {
  return {
    offsetX: canvasWidth / 2,
    offsetY: canvasHeight / 2,
    scale: Math.min(canvasWidth, canvasHeight) / 2.5
  };
}

/**
 * Clamp scale to valid range.
 * @param {number} scale - Scale value to clamp
 * @returns {number} Clamped scale
 */
export function clampScale(scale) {
  // Convert from zoom units (50-2000) to normalized scale (0.25-4.0)
  // The editor uses zoom values around 200-400 for typical views
  // Clamp raw zoom value to reasonable bounds
  return Math.max(50, Math.min(2000, scale));
}

/**
 * Convert screen coordinates to world coordinates.
 * @param {object} viewport - Viewport state { offsetX, offsetY, scale }
 * @param {number} screenX - X position in screen pixels
 * @param {number} screenY - Y position in screen pixels
 * @returns {object} World coordinates { x, z }
 */
export function screenToWorld(viewport, screenX, screenY) {
  return {
    x: (screenX - viewport.offsetX) / viewport.scale,
    z: (screenY - viewport.offsetY) / viewport.scale
  };
}

/**
 * Convert world coordinates to screen coordinates.
 * @param {object} viewport - Viewport state { offsetX, offsetY, scale }
 * @param {number} worldX - X position in world units
 * @param {number} worldZ - Z position in world units
 * @returns {object} Screen coordinates { x, y }
 */
export function worldToScreen(viewport, worldX, worldZ) {
  return {
    x: viewport.offsetX + worldX * viewport.scale,
    y: viewport.offsetY + worldZ * viewport.scale
  };
}

/**
 * Apply viewport transform to a canvas for CSS-based instant feedback.
 * This uses CSS transforms for immediate visual response during gestures.
 * @param {HTMLCanvasElement} canvas - The canvas element
 * @param {object} viewport - Viewport state
 * @param {object} baseViewport - Original viewport state before gesture
 */
export function applyToCanvas(canvas, viewport, baseViewport) {
  if (!baseViewport) {
    canvas.style.transform = '';
    canvas.style.transformOrigin = 'center center';
    return;
  }

  const scaleRatio = viewport.scale / baseViewport.scale;
  const dx = viewport.offsetX - baseViewport.offsetX;
  const dy = viewport.offsetY - baseViewport.offsetY;

  canvas.style.transformOrigin = 'center center';
  canvas.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleRatio})`;
}

/**
 * Clear CSS transform from canvas.
 * @param {HTMLCanvasElement} canvas - The canvas element
 */
export function clearCanvasTransform(canvas) {
  canvas.style.transform = '';
}

/**
 * Pan the viewport by a delta in screen pixels.
 * @param {object} viewport - Viewport state to modify
 * @param {number} dx - X delta in pixels
 * @param {number} dy - Y delta in pixels
 */
export function pan(viewport, dx, dy) {
  viewport.offsetX += dx;
  viewport.offsetY += dy;
}

/**
 * Zoom the viewport around a focal point.
 * @param {object} viewport - Viewport state to modify
 * @param {number} factor - Zoom factor (>1 to zoom in, <1 to zoom out)
 * @param {number} focalX - X position in screen pixels to zoom around
 * @param {number} focalY - Y position in screen pixels to zoom around
 */
export function zoom(viewport, factor, focalX, focalY) {
  // Get world position at focal point before zoom
  const worldBefore = screenToWorld(viewport, focalX, focalY);

  // Apply zoom with clamping
  viewport.scale = clampScale(viewport.scale * factor);

  // Get world position at focal point after zoom
  const worldAfter = screenToWorld(viewport, focalX, focalY);

  // Adjust offset to keep focal point stationary
  viewport.offsetX += (worldAfter.x - worldBefore.x) * viewport.scale;
  viewport.offsetY += (worldAfter.z - worldBefore.z) * viewport.scale;
}

/**
 * Reset viewport to center on origin with default zoom.
 * @param {object} viewport - Viewport state to modify
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 */
export function reset(viewport, canvasWidth, canvasHeight) {
  viewport.offsetX = canvasWidth / 2;
  viewport.offsetY = canvasHeight / 2;
  viewport.scale = Math.min(canvasWidth, canvasHeight) / 2.5;
}

/**
 * Get visible world bounds for the current viewport.
 * @param {object} viewport - Viewport state
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 * @returns {object} Bounds { minX, maxX, minZ, maxZ }
 */
export function getVisibleBounds(viewport, canvasWidth, canvasHeight) {
  const topLeft = screenToWorld(viewport, 0, 0);
  const bottomRight = screenToWorld(viewport, canvasWidth, canvasHeight);
  return {
    minX: topLeft.x,
    maxX: bottomRight.x,
    minZ: topLeft.z,
    maxZ: bottomRight.z
  };
}

/**
 * Copy viewport state.
 * @param {object} viewport - Viewport state to copy
 * @returns {object} New viewport state with same values
 */
export function copyViewport(viewport) {
  return {
    offsetX: viewport.offsetX,
    offsetY: viewport.offsetY,
    scale: viewport.scale
  };
}
