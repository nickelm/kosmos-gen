/**
 * Road layer renderer
 *
 * Draws road polylines with type-differentiated styling.
 * Bridges shown with lighter blue-gray, tunnels with dashed lines.
 */

/** Style configuration per road type */
const ROAD_STYLES = {
  highway: { stroke: 'rgba(120, 80, 40, 0.9)',  baseWidth: 5.0 },
  road:    { stroke: 'rgba(160, 120, 60, 0.85)', baseWidth: 3.5 },
  path:    { stroke: 'rgba(180, 160, 100, 0.7)', baseWidth: 2.5 },
};

const BRIDGE_STROKE = 'rgba(100, 140, 180, 0.9)';
const TUNNEL_STROKE = 'rgba(80, 80, 80, 0.7)';

let cachedKey = null;

/**
 * Render roads on canvas
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} generatedData - Pipeline output
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} zoom - Current viewport zoom
 */
export function renderRoads(ctx, generatedData, canvasWidth, canvasHeight, zoom) {
  const { roads: roadsData, elevation } = generatedData;
  if (!roadsData?.roads || !elevation) return;

  const { bounds } = elevation;
  const toCanvasX = (wx) => ((wx - bounds.minX) / (bounds.maxX - bounds.minX)) * canvasWidth;
  const toCanvasZ = (wz) => ((wz - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * canvasHeight;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw roads in order: paths first, then roads, then highways (so highways draw on top)
  const sortedRoads = [...roadsData.roads].sort((a, b) => {
    const order = { path: 0, road: 1, highway: 2 };
    return (order[a.type] || 0) - (order[b.type] || 0);
  });

  for (const road of sortedRoads) {
    const style = ROAD_STYLES[road.type] || ROAD_STYLES.path;
    const waypoints = road.waypoints;
    if (!waypoints || waypoints.length < 2) continue;

    // Build a set of segment classifications per waypoint index
    const wpType = new Array(waypoints.length).fill('normal');
    if (road.segments) {
      for (const seg of road.segments) {
        for (let i = seg.startIdx; i <= seg.endIdx && i < waypoints.length; i++) {
          wpType[i] = seg.type;
        }
      }
    }

    // Draw segment-by-segment with appropriate styling
    for (let i = 0; i < waypoints.length - 1; i++) {
      const v0 = waypoints[i];
      const v1 = waypoints[i + 1];
      const segType = wpType[i];

      ctx.beginPath();
      ctx.moveTo(toCanvasX(v0.x), toCanvasZ(v0.z));
      ctx.lineTo(toCanvasX(v1.x), toCanvasZ(v1.z));

      if (segType === 'bridge') {
        ctx.strokeStyle = BRIDGE_STROKE;
        ctx.lineWidth = Math.max(1.0 / zoom, (style.baseWidth + 1.5) / zoom);
        ctx.setLineDash([]);
      } else if (segType === 'tunnel') {
        ctx.strokeStyle = TUNNEL_STROKE;
        ctx.lineWidth = Math.max(1.0 / zoom, style.baseWidth / zoom);
        ctx.setLineDash([4 / zoom, 3 / zoom]);
      } else {
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = Math.max(0.8 / zoom, style.baseWidth / zoom);
        ctx.setLineDash([]);
      }

      ctx.stroke();
    }

    // Reset dash
    ctx.setLineDash([]);
  }
}

/**
 * Invalidate the roads cache
 */
export function invalidateRoadsCache() {
  cachedKey = null;
}
