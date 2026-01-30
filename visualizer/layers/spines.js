/**
 * Spines layer renderer
 *
 * Draws spine segments and vertices on the canvas.
 */

/**
 * Render spine polylines and vertices
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} generatedData - Pipeline output
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} zoom - Current viewport zoom (for size compensation)
 */
export function renderSpines(ctx, generatedData, canvasWidth, canvasHeight, zoom) {
  const { spines, elevation } = generatedData;
  if (!spines) return;

  const { vertices, segments } = spines;
  const bounds = elevation?.bounds ?? { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };

  // Map world coordinates to base canvas space
  const toCanvasX = (wx) => ((wx - bounds.minX) / (bounds.maxX - bounds.minX)) * canvasWidth;
  const toCanvasZ = (wz) => ((wz - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * canvasHeight;

  // Compensate sizes for zoom
  const lineWidth = 2 / zoom;
  const dotRadius = 4 / zoom;
  const fontSize = Math.max(8, 10 / zoom);

  // Draw segments
  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const seg of segments) {
    const a = vertices[seg.from];
    const b = vertices[seg.to];

    ctx.beginPath();
    ctx.moveTo(toCanvasX(a.x), toCanvasZ(a.z));
    ctx.lineTo(toCanvasX(b.x), toCanvasZ(b.z));
    ctx.stroke();
  }

  // Draw vertices
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const cx = toCanvasX(v.x);
    const cz = toCanvasZ(v.z);

    // Influence radius circle (faint)
    const influencePixels = (v.influence / (bounds.maxX - bounds.minX)) * canvasWidth;
    ctx.strokeStyle = 'rgba(233, 69, 96, 0.2)';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.arc(cx, cz, influencePixels, 0, Math.PI * 2);
    ctx.stroke();

    // Vertex dot
    ctx.fillStyle = '#e94560';
    ctx.beginPath();
    ctx.arc(cx, cz, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    // Elevation label
    ctx.fillStyle = '#fff';
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(v.elevation.toFixed(2), cx, cz - dotRadius * 2);
  }
}
