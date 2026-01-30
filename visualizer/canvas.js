/**
 * Canvas management & rendering
 *
 * Handles canvas sizing, viewport pan/zoom, and layer composition.
 */

/** Zoom limits */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

/**
 * Initialize the canvas with viewport support
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Function} onRedraw - Called whenever the viewport changes and needs re-render
 * @returns {{ ctx, resize, viewport, resetView }}
 */
export function initCanvas(canvas, onRedraw) {
  const ctx = canvas.getContext('2d');

  // Viewport state: pan offsets in canvas pixels, zoom factor
  // At zoom=1 & pan=(0,0) the full scene fits the canvas
  const viewport = { panX: 0, panY: 0, zoom: 1 };

  function resize() {
    const container = canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  resize();
  window.addEventListener('resize', resize);

  // --- Pan (mouse drag) ---
  let isPanning = false;
  let lastMouse = { x: 0, y: 0 };

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // left button only
    isPanning = true;
    lastMouse = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    viewport.panX += dx;
    viewport.panY += dy;
    lastMouse = { x: e.clientX, y: e.clientY };
    onRedraw();
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      canvas.style.cursor = 'grab';
    }
  });

  // --- Zoom (scroll wheel, centered on cursor) ---
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { width, height } = canvas;
    const cx = width / 2;
    const cy = height / 2;

    // Scene position under mouse before zoom
    const sceneX = (mx - cx - viewport.panX) / viewport.zoom + cx;
    const sceneY = (my - cy - viewport.panY) / viewport.zoom + cy;

    // Apply zoom
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    viewport.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.zoom * factor));

    // Adjust pan so the same scene point stays under the cursor
    viewport.panX = mx - cx - (sceneX - cx) * viewport.zoom;
    viewport.panY = my - cy - (sceneY - cy) * viewport.zoom;

    onRedraw();
  }, { passive: false });

  // --- Double-click to reset ---
  canvas.addEventListener('dblclick', () => {
    viewport.panX = 0;
    viewport.panY = 0;
    viewport.zoom = 1;
    onRedraw();
  });

  function resetView() {
    viewport.panX = 0;
    viewport.panY = 0;
    viewport.zoom = 1;
  }

  return { ctx, resize, viewport, resetView };
}

/**
 * Render all enabled layers with viewport transform
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} generatedData - Pipeline output
 * @param {Object} layers - Layer visibility map
 * @param {Object} layerRenderers - Layer name -> render function
 * @param {Object} viewport - { panX, panY, zoom }
 */
export function render(ctx, generatedData, layers, layerRenderers, viewport) {
  const { width, height } = ctx.canvas;

  // Clear entire canvas
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(0, 0, width, height);

  if (!generatedData) return;

  // The world is square [-1,1] x [-1,1]. Fit it to the shorter canvas axis
  // and center on the longer axis.
  const sceneSize = Math.min(width, height);
  const sceneOffX = (width - sceneSize) / 2;
  const sceneOffY = (height - sceneSize) / 2;

  // Apply viewport transform:
  // 1. Translate canvas center to origin
  // 2. Apply pan
  // 3. Scale by zoom
  // 4. Translate back to canvas center
  // 5. Offset to center the square scene in the rectangular canvas
  const cx = width / 2;
  const cy = height / 2;

  ctx.save();
  ctx.translate(cx + viewport.panX, cy + viewport.panY);
  ctx.scale(viewport.zoom, viewport.zoom);
  ctx.translate(-cx, -cy);
  ctx.translate(sceneOffX, sceneOffY);

  // Render layers in scene space [0, sceneSize] x [0, sceneSize]
  const layerOrder = ['elevation', 'underwater', 'climate', 'biomes', 'lakes', 'rivers', 'coastline', 'spines'];

  for (const name of layerOrder) {
    if (layers[name] && layerRenderers[name]) {
      layerRenderers[name](ctx, generatedData, sceneSize, sceneSize, viewport.zoom);
    }
  }

  ctx.restore();
}
