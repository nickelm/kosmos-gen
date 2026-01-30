/**
 * Settlement layer renderer
 *
 * Draws settlement footprints, terrace polygons, retaining walls, and names.
 */

/** Colors by settlement type */
const TYPE_COLORS = {
  city:    { fill: 'rgba(218, 165, 32, 0.25)', stroke: 'rgba(218, 165, 32, 0.9)', text: '#daa520' },
  village: { fill: 'rgba(139, 90, 43, 0.20)',  stroke: 'rgba(139, 90, 43, 0.8)',  text: '#8b5a2b' },
  hamlet:  { fill: 'rgba(160, 160, 160, 0.18)', stroke: 'rgba(128, 128, 128, 0.7)', text: '#808080' },
};

/** Terrace fill colors (alternating shades) */
const TERRACE_FILLS = [
  'rgba(180, 140, 80, 0.30)',
  'rgba(160, 120, 70, 0.30)',
  'rgba(140, 110, 65, 0.30)',
  'rgba(120, 100, 60, 0.30)',
];

/**
 * Render settlements on canvas
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} generatedData - Pipeline output
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} zoom - Current viewport zoom
 */
export function renderSettlements(ctx, generatedData, canvasWidth, canvasHeight, zoom) {
  const { settlements, elevation } = generatedData;
  if (!settlements?.settlements || !elevation) return;

  const { bounds } = elevation;
  const toCanvasX = (wx) => ((wx - bounds.minX) / (bounds.maxX - bounds.minX)) * canvasWidth;
  const toCanvasZ = (wz) => ((wz - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * canvasHeight;
  const worldToCanvas = (bounds.maxX - bounds.minX);
  const scaleToCanvas = (worldDist) => (worldDist / worldToCanvas) * canvasWidth;

  for (const settlement of settlements.settlements) {
    const [wx, wz] = settlement.position;
    const cx = toCanvasX(wx);
    const cz = toCanvasZ(wz);
    const radiusPx = scaleToCanvas(settlement.radius);
    const colors = TYPE_COLORS[settlement.type] || TYPE_COLORS.hamlet;

    // Draw footprint circle
    ctx.beginPath();
    ctx.arc(cx, cz, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = colors.fill;
    ctx.fill();
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([4 / zoom, 3 / zoom]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw terrace polygons
    if (settlement.terraces) {
      for (let ti = 0; ti < settlement.terraces.length; ti++) {
        const terrace = settlement.terraces[ti];
        if (!terrace.polygon || terrace.polygon.length < 3) continue;

        // Fill terrace polygon
        ctx.beginPath();
        ctx.moveTo(toCanvasX(terrace.polygon[0][0]), toCanvasZ(terrace.polygon[0][1]));
        for (let i = 1; i < terrace.polygon.length; i++) {
          ctx.lineTo(toCanvasX(terrace.polygon[i][0]), toCanvasZ(terrace.polygon[i][1]));
        }
        ctx.closePath();
        ctx.fillStyle = TERRACE_FILLS[ti % TERRACE_FILLS.length];
        ctx.fill();
        ctx.strokeStyle = 'rgba(100, 80, 50, 0.5)';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();

        // Elevation label at terrace centroid
        let tcx = 0, tcz = 0;
        for (const [px, pz] of terrace.polygon) {
          tcx += px;
          tcz += pz;
        }
        tcx /= terrace.polygon.length;
        tcz /= terrace.polygon.length;

        const fontSize = Math.max(8, 10 / zoom);
        ctx.font = `${fontSize}px monospace`;
        ctx.fillStyle = 'rgba(80, 60, 30, 0.7)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          terrace.targetElevation.toFixed(3),
          toCanvasX(tcx),
          toCanvasZ(tcz)
        );

        // Retaining walls
        if (terrace.retainingWalls) {
          for (const wall of terrace.retainingWalls) {
            ctx.beginPath();
            ctx.moveTo(toCanvasX(wall.start[0]), toCanvasZ(wall.start[1]));
            ctx.lineTo(toCanvasX(wall.end[0]), toCanvasZ(wall.end[1]));
            ctx.strokeStyle = 'rgba(60, 40, 20, 0.7)';
            ctx.lineWidth = 2 / zoom;
            ctx.stroke();
          }
        }
      }
    }

    // Draw settlement name
    const nameFontSize = Math.max(10, 13 / zoom);
    ctx.font = `bold ${nameFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Text shadow for readability
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillText(settlement.name, cx + 1 / zoom, cz - radiusPx - 3 / zoom + 1 / zoom);

    ctx.fillStyle = colors.text;
    ctx.fillText(settlement.name, cx, cz - radiusPx - 3 / zoom);

    // Type label (smaller)
    const typeFontSize = Math.max(7, 9 / zoom);
    ctx.font = `${typeFontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillText(settlement.type, cx + 0.5 / zoom, cz - radiusPx - 2 / zoom + nameFontSize + 0.5 / zoom);
    ctx.fillStyle = colors.text;
    ctx.fillText(settlement.type, cx, cz - radiusPx - 2 / zoom + nameFontSize);

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cz, 3 / zoom, 0, Math.PI * 2);
    ctx.fillStyle = colors.stroke;
    ctx.fill();
  }
}

/**
 * Invalidate settlements cache
 */
export function invalidateSettlementsCache() {
  // No offscreen cache currently
}
