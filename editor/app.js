/**
 * kosmos-gen Editor
 *
 * Template editor with tab-based workflow:
 * 1. Spines - Draw spines, see Voronoi and coastline
 * 2. Noise - Add procedural detail
 * 3. Hydrology - Rivers and lakes
 * 4. Climate - Temperature, humidity, biomes
 * 5. Zones - Gameplay regions
 * 6. Content - Landmarks, NPCs, quests
 */

import { sampleElevation } from '../src/terrain/elevation.js';
import { findCell } from '../src/geometry/voronoi.js';
import { getSide, getHalfCellId, getHalfCellConfig } from '../src/terrain/spine.js';
import { extractContours, simplifyPolyline } from '../src/geometry/contour.js';

// =============================================================================
// State
// =============================================================================

const state = {
  // Current editor state
  currentTab: 'spines',
  currentTool: 'select',
  seed: 42,
  
  // Template being edited
  template: {
    spines: [],
    halfCells: {},
    defaults: {
      profile: 'ramp',
      baseElevation: 0,  // Profile slopes to sea floor; coastline is at SEA_LEVEL (0.1)
      falloffCurve: 0.5,
      noise: { roughness: 0.3, featureScale: 0.2 }
    },
    climate: {},
    zones: [],
    corridor: {},
    landmarks: [],
    naming: { palette: 'pastoral-english' }
  },
  
  // View state
  view: {
    offsetX: 0,
    offsetY: 0,
    zoom: 1
  },
  
  // Interaction state
  selectedSpine: null,
  selectedVertex: null,
  selectedHalfCell: null,
  isDrawing: false,
  drawingSpine: null,
  isDragging: false,
  isPanning: false,
  panStart: { x: 0, y: 0 },
  hoveredSpine: null,
  mousePos: { x: 0, y: 0 },

  // Display options
  showElevation: true,
  showElevationContours: false,

  // Contour cache (invalidated when spines/profiles change)
  cache: {
    coastlinePolylines: null,
    elevationContours: null,
    cacheKey: null
  }
};

// =============================================================================
// Canvas Setup
// =============================================================================

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  // Get the canvas's actual displayed size
  const rect = canvas.getBoundingClientRect();

  // Set canvas internal resolution to match displayed size (round to integers)
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  canvas.width = width;
  canvas.height = height;

  // Center the view
  state.view.offsetX = width / 2;
  state.view.offsetY = height / 2;
  state.view.zoom = Math.min(width, height) / 2.5;

  render();
}

/**
 * Get mouse coordinates relative to canvas, accounting for any CSS scaling
 */
function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

window.addEventListener('resize', resizeCanvas);

// =============================================================================
// Coordinate Transforms
// =============================================================================

function worldToCanvas(x, z) {
  return {
    x: state.view.offsetX + x * state.view.zoom,
    y: state.view.offsetY + z * state.view.zoom
  };
}

function canvasToWorld(cx, cy) {
  return {
    x: (cx - state.view.offsetX) / state.view.zoom,
    z: (cy - state.view.offsetY) / state.view.zoom
  };
}

// =============================================================================
// World Building (for elevation sampling)
// =============================================================================

/**
 * Build a world object from template state for elevation sampling
 */
function buildWorld() {
  const seeds = [];
  for (const spine of state.template.spines) {
    for (const v of spine.vertices) {
      seeds.push({
        x: v.x,
        z: v.z,
        spineId: spine.id,
        elevation: v.elevation,
        // Influence in world space: UI stores as percentage of world (0-100 → 0-1)
        // Default 30 means influence extends 0.3 world units from spine
        influence: v.influence / 100
      });
    }
  }

  return {
    voronoi: { seeds },
    template: { spines: state.template.spines },
    halfCells: state.template.halfCells,
    defaults: state.template.defaults
  };
}

/**
 * Convert elevation value to color
 * 0.0 = deep ocean (not drawn, background shows)
 * 0.0-0.1 = shallow ocean (light blue gradient)
 * 0.1+ = land (green → brown → white)
 */
function elevationToColor(e) {
  const seaLevel = 0.1;
  if (e < seaLevel) {
    // Shallow ocean: lighter blue near shore, darker toward deep
    // t goes from 0 (deep) to 1 (shoreline)
    const t = e / seaLevel;
    return [
      Math.floor(40 + t * 60),   // 40 → 100
      Math.floor(80 + t * 100),  // 80 → 180
      Math.floor(140 + t * 80)   // 140 → 220
    ];
  } else {
    // Land: green → brown → white
    const t = (e - seaLevel) / (1 - seaLevel);
    if (t < 0.4) {
      // Green lowlands
      const s = t / 0.4;
      return [
        Math.floor(34 + s * 50),
        Math.floor(139 - s * 30),
        Math.floor(34 + s * 20)
      ];
    } else if (t < 0.7) {
      // Brown hills
      const s = (t - 0.4) / 0.3;
      return [
        Math.floor(84 + s * 55),
        Math.floor(109 - s * 40),
        Math.floor(54 - s * 20)
      ];
    } else {
      // White peaks
      const s = (t - 0.7) / 0.3;
      return [
        Math.floor(139 + s * 116),
        Math.floor(69 + s * 186),
        Math.floor(34 + s * 221)
      ];
    }
  }
}

// =============================================================================
// Rendering
// =============================================================================

/**
 * Generate cache key for contour invalidation
 * Includes all factors that affect contour geometry and view bounds
 */
function getContourCacheKey() {
  const spineData = JSON.stringify(state.template.spines.map(s => ({
    id: s.id,
    vertices: s.vertices.map(v => ({
      x: v.x, z: v.z, elevation: v.elevation, influence: v.influence
    }))
  })));
  const halfCellData = JSON.stringify(state.template.halfCells);
  const defaults = JSON.stringify(state.template.defaults);
  // Include view state for infinite canvas (contours depend on visible area)
  const viewData = `${state.view.offsetX.toFixed(0)},${state.view.offsetY.toFixed(0)},${state.view.zoom.toFixed(0)}`;
  return `${spineData}|${halfCellData}|${defaults}|${viewData}`;
}

/**
 * Invalidate contour cache if source data has changed
 */
function invalidateContourCacheIfNeeded() {
  const currentKey = getContourCacheKey();
  if (state.cache.cacheKey !== currentKey) {
    state.cache.coastlinePolylines = null;
    state.cache.elevationContours = null;
    state.cache.cacheKey = currentKey;
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  invalidateContourCacheIfNeeded();

  // Layer 1: Ocean fill (solid blue over world bounds)
  drawOceanFill();

  // Layer 2: Land elevation (only where elevation > sea level)
  drawLandElevation();

  // Layer 3: Optional elevation contours
  if (state.showElevationContours) {
    drawElevationContours();
  }

  // Layer 4: Coastline (vector strokes)
  drawCoastlinePolygons();

  // Layer 5: Selection highlight
  drawSelectedHalfCell();

  // Layer 6: Grid, boundary, spines, vertices
  drawGrid();
  drawWorldBoundary();
  drawSpines();
  drawVertices();

  // Update UI
  updatePropertiesPanel();
}

/**
 * Draw ocean fill over entire canvas
 */
function drawOceanFill() {
  ctx.fillStyle = '#1a4c6e'; // Ocean blue (per spec)
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Draw terrain elevation as color-coded rectangles
 * Draws land AND shallow ocean (elevation > 0), deep ocean (0) shows through
 */
function drawLandElevation() {
  if (!state.showElevation || state.template.spines.length === 0) return;

  const world = buildWorld();
  const step = 4; // Sample every 4 pixels

  for (let cy = 0; cy < canvas.height; cy += step) {
    for (let cx = 0; cx < canvas.width; cx += step) {
      const { x, z } = canvasToWorld(cx, cy);

      const elevation = sampleElevation(world, x, z);

      // Skip deep ocean (elevation = 0) - ocean fill shows through
      if (elevation <= 0) continue;

      const [r, g, b] = elevationToColor(elevation);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(cx, cy, step, step);
    }
  }
}

/**
 * Get visible world bounds from canvas
 */
function getVisibleBounds() {
  const topLeft = canvasToWorld(0, 0);
  const bottomRight = canvasToWorld(canvas.width, canvas.height);
  return {
    minX: topLeft.x,
    maxX: bottomRight.x,
    minZ: topLeft.z,
    maxZ: bottomRight.z
  };
}

/**
 * Draw coastline as connected polylines using cached contours
 */
function drawCoastlinePolygons() {
  if (state.template.spines.length === 0) return;

  // Extract contours if not cached
  if (!state.cache.coastlinePolylines) {
    const world = buildWorld();
    // Sea level is fixed at 0.1 (baseElevation is now 0 = sea floor)
    const seaLevel = 0.1;

    // Use visible bounds (with margin for smooth edges)
    const visible = getVisibleBounds();
    const margin = 0.2;
    const bounds = {
      minX: visible.minX - margin,
      maxX: visible.maxX + margin,
      minZ: visible.minZ - margin,
      maxZ: visible.maxZ + margin
    };
    const resolution = 0.015; // Finer resolution for smoother coastlines

    // Sample function
    const sampleFn = (x, z) => sampleElevation(world, x, z);

    // Extract contours and simplify
    let polylines = extractContours(sampleFn, seaLevel, bounds, resolution);
    polylines = polylines.map(pl => simplifyPolyline(pl, 0.003));

    state.cache.coastlinePolylines = polylines;
  }

  // Render polylines as smooth vector strokes
  ctx.strokeStyle = '#4ecdc4'; // Cyan (spec color)
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const polyline of state.cache.coastlinePolylines) {
    if (polyline.length < 2) continue;

    ctx.beginPath();
    const first = worldToCanvas(polyline[0].x, polyline[0].z);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < polyline.length; i++) {
      const p = worldToCanvas(polyline[i].x, polyline[i].z);
      ctx.lineTo(p.x, p.y);
    }

    ctx.stroke();
  }
}

/**
 * Draw optional elevation contours (topographic lines)
 */
function drawElevationContours() {
  if (state.template.spines.length === 0) return;

  const world = buildWorld();
  const seaLevel = world.defaults?.baseElevation ?? 0.1;

  // Extract contours if not cached
  if (!state.cache.elevationContours) {
    // Use visible bounds (with margin)
    const visible = getVisibleBounds();
    const margin = 0.1;
    const bounds = {
      minX: visible.minX - margin,
      maxX: visible.maxX + margin,
      minZ: visible.minZ - margin,
      maxZ: visible.maxZ + margin
    };
    const resolution = 0.03; // Slightly coarser for performance

    // Contour levels above sea level (every 0.1)
    const levels = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const sampleFn = (x, z) => sampleElevation(world, x, z);

    state.cache.elevationContours = new Map();

    for (const level of levels) {
      if (level <= seaLevel) continue; // Skip underwater contours

      let polylines = extractContours(sampleFn, level, bounds, resolution);
      polylines = polylines.map(pl => simplifyPolyline(pl, 0.008));
      state.cache.elevationContours.set(level, polylines);
    }
  }

  // Render contours (thin, semi-transparent)
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const [level, polylines] of state.cache.elevationContours) {
    // Progressively lighter/thinner strokes at higher elevations
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 + level * 0.2})`;
    ctx.lineWidth = 1;

    for (const polyline of polylines) {
      if (polyline.length < 2) continue;

      ctx.beginPath();
      const first = worldToCanvas(polyline[0].x, polyline[0].z);
      ctx.moveTo(first.x, first.y);

      for (let i = 1; i < polyline.length; i++) {
        const p = worldToCanvas(polyline[i].x, polyline[i].z);
        ctx.lineTo(p.x, p.y);
      }

      ctx.stroke();
    }
  }
}

/**
 * Draw highlight for the selected half-cell
 */
function drawSelectedHalfCell() {
  if (!state.selectedHalfCell) return;

  const { spineId, vertexIndex, side } = state.selectedHalfCell;
  const spine = state.template.spines.find(s => s.id === spineId);
  if (!spine) return;

  const vertex = spine.vertices[vertexIndex];
  if (!vertex) return;

  // Get visible bounds (clamped to world)
  const topLeft = canvasToWorld(0, 0);
  const bottomRight = canvasToWorld(canvas.width, canvas.height);
  const minX = Math.max(-1, topLeft.x);
  const maxX = Math.min(1, bottomRight.x);
  const minZ = Math.max(-1, topLeft.z);
  const maxZ = Math.min(1, bottomRight.z);

  // Sample visible world area and highlight points in this half-cell
  const step = 0.02;
  ctx.fillStyle = 'rgba(233, 69, 96, 0.3)';
  const pixelSize = Math.max(1, step * state.view.zoom);

  for (let wx = minX; wx <= maxX; wx += step) {
    for (let wz = minZ; wz <= maxZ; wz += step) {
      // Check if this point belongs to selected half-cell
      const p = worldToCanvas(wx, wz);
      const hit = hitTestHalfCell(p.x, p.y);
      if (hit &&
          hit.spineId === spineId &&
          hit.vertexIndex === vertexIndex &&
          hit.side === side) {
        ctx.fillRect(p.x, p.y, pixelSize, pixelSize);
      }
    }
  }
}

function drawGrid() {
  const minorStep = 0.2;
  const majorStep = 1.0;

  // Calculate visible world bounds from canvas
  const topLeft = canvasToWorld(0, 0);
  const bottomRight = canvasToWorld(canvas.width, canvas.height);

  // Extend bounds slightly and snap to grid
  const minX = Math.floor(topLeft.x / minorStep) * minorStep;
  const maxX = Math.ceil(bottomRight.x / minorStep) * minorStep;
  const minZ = Math.floor(topLeft.z / minorStep) * minorStep;
  const maxZ = Math.ceil(bottomRight.z / minorStep) * minorStep;

  // Draw minor grid lines
  ctx.strokeStyle = '#1a2a4a';
  ctx.lineWidth = 1;

  for (let x = minX; x <= maxX; x += minorStep) {
    // Skip major lines (will draw them separately)
    if (Math.abs(x % majorStep) < 0.001) continue;
    const p1 = worldToCanvas(x, minZ);
    const p2 = worldToCanvas(x, maxZ);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  for (let z = minZ; z <= maxZ; z += minorStep) {
    if (Math.abs(z % majorStep) < 0.001) continue;
    const p1 = worldToCanvas(minX, z);
    const p2 = worldToCanvas(maxX, z);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // Draw major grid lines (every 1.0 unit)
  ctx.strokeStyle = '#2a3a5a';
  ctx.lineWidth = 2;

  for (let x = Math.floor(minX); x <= Math.ceil(maxX); x += majorStep) {
    const p1 = worldToCanvas(x, minZ);
    const p2 = worldToCanvas(x, maxZ);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  for (let z = Math.floor(minZ); z <= Math.ceil(maxZ); z += majorStep) {
    const p1 = worldToCanvas(minX, z);
    const p2 = worldToCanvas(maxX, z);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // Draw origin axes (x=0 and z=0) with distinct color
  ctx.strokeStyle = '#3a4a6a';
  ctx.lineWidth = 2;

  // X axis (z=0)
  if (minZ <= 0 && maxZ >= 0) {
    const p1 = worldToCanvas(minX, 0);
    const p2 = worldToCanvas(maxX, 0);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // Z axis (x=0)
  if (minX <= 0 && maxX >= 0) {
    const p1 = worldToCanvas(0, minZ);
    const p2 = worldToCanvas(0, maxZ);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
}

function drawWorldBoundary() {
  const tl = worldToCanvas(-1, -1);
  const br = worldToCanvas(1, 1);
  
  ctx.strokeStyle = '#0f3460';
  ctx.lineWidth = 2;
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

function drawSpines() {
  for (const spine of state.template.spines) {
    if (spine.vertices.length < 2) continue;

    ctx.beginPath();
    const first = worldToCanvas(spine.vertices[0].x, spine.vertices[0].z);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < spine.vertices.length; i++) {
      const p = worldToCanvas(spine.vertices[i].x, spine.vertices[i].z);
      ctx.lineTo(p.x, p.y);
    }

    // Determine spine color based on state
    let strokeStyle = '#4a9fff';
    let lineWidth = 3;
    if (spine === state.hoveredSpine && state.currentTool === 'delete') {
      strokeStyle = '#ff4444';
      lineWidth = 5;
    } else if (spine === state.selectedSpine) {
      strokeStyle = '#e94560';
    }

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  
  // Drawing in progress
  if (state.isDrawing && state.drawingSpine && state.drawingSpine.vertices.length > 0) {
    // Draw existing vertices
    ctx.beginPath();
    const first = worldToCanvas(state.drawingSpine.vertices[0].x, state.drawingSpine.vertices[0].z);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < state.drawingSpine.vertices.length; i++) {
      const p = worldToCanvas(state.drawingSpine.vertices[i].x, state.drawingSpine.vertices[i].z);
      ctx.lineTo(p.x, p.y);
    }

    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw rubberband to mouse position
    const last = state.drawingSpine.vertices[state.drawingSpine.vertices.length - 1];
    const lastCanvas = worldToCanvas(last.x, last.z);
    ctx.beginPath();
    ctx.moveTo(lastCanvas.x, lastCanvas.y);
    ctx.lineTo(state.mousePos.x, state.mousePos.y);
    ctx.strokeStyle = 'rgba(233, 69, 96, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw vertex markers for in-progress spine
    for (const v of state.drawingSpine.vertices) {
      const p = worldToCanvas(v.x, v.z);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#e94560';
      ctx.fill();
    }
  }
}

function drawVertices() {
  for (const spine of state.template.spines) {
    for (let i = 0; i < spine.vertices.length; i++) {
      const v = spine.vertices[i];
      const p = worldToCanvas(v.x, v.z);
      
      // Influence radius
      ctx.beginPath();
      // Influence radius: value is percentage (30 = 0.3 world units)
      ctx.arc(p.x, p.y, (v.influence / 100) * state.view.zoom, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(74, 159, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      // Vertex point
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = (state.selectedSpine === spine && state.selectedVertex === i) 
        ? '#e94560' 
        : '#4a9fff';
      ctx.fill();
      
      // Elevation indicator (height of vertex)
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(v.elevation.toFixed(2), p.x, p.y - 14);
    }
  }
}

// =============================================================================
// Interaction
// =============================================================================

canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('dblclick', onDoubleClick);
canvas.addEventListener('contextmenu', onContextMenu);
canvas.addEventListener('wheel', onWheel);

function onMouseDown(e) {
  const mouse = getMousePos(e);

  // Middle mouse button for panning
  if (e.button === 1) {
    e.preventDefault();
    state.isPanning = true;
    state.panStart = { x: mouse.x, y: mouse.y };
    canvas.style.cursor = 'grabbing';
    return;
  }

  // Right click handled in contextmenu
  if (e.button === 2) return;

  const world = canvasToWorld(mouse.x, mouse.y);

  if (state.currentTool === 'draw') {
    if (!state.isDrawing) {
      // Start new spine
      state.isDrawing = true;
      state.drawingSpine = {
        id: `spine_${Date.now()}`,
        vertices: [{
          x: world.x,
          z: world.z,
          elevation: 0.7,
          influence: 30
        }]
      };
    } else {
      // Add vertex to current spine
      state.drawingSpine.vertices.push({
        x: world.x,
        z: world.z,
        elevation: 0.7,
        influence: 30
      });
    }
    render();
  } else if (state.currentTool === 'select') {
    // First try to select a vertex
    const vertexHit = hitTestVertex(mouse.x, mouse.y);
    if (vertexHit) {
      state.selectedSpine = vertexHit.spine;
      state.selectedVertex = vertexHit.vertexIndex;
      state.selectedHalfCell = null;  // Clear half-cell selection
      state.isDragging = true;
    } else {
      // Try to select a half-cell
      const halfCellHit = hitTestHalfCell(mouse.x, mouse.y);
      if (halfCellHit) {
        state.selectedHalfCell = halfCellHit;
        state.selectedSpine = null;  // Clear vertex selection
        state.selectedVertex = null;
      } else {
        // Clear all selection (clicked outside world bounds or no spines)
        state.selectedSpine = null;
        state.selectedVertex = null;
        state.selectedHalfCell = null;
      }
    }
    render();
  } else if (state.currentTool === 'delete') {
    // Delete entire spine if clicked on any of its vertices
    const hit = hitTestSpine(mouse.x, mouse.y);
    if (hit) {
      const index = state.template.spines.indexOf(hit);
      if (index !== -1) {
        state.template.spines.splice(index, 1);
        state.selectedSpine = null;
        state.selectedVertex = null;
        state.hoveredSpine = null;
      }
    }
    render();
  }
}

function onMouseMove(e) {
  const mouse = getMousePos(e);

  // Track mouse position for rubberband
  state.mousePos = { x: mouse.x, y: mouse.y };

  // Handle panning
  if (state.isPanning) {
    const dx = mouse.x - state.panStart.x;
    const dy = mouse.y - state.panStart.y;
    state.view.offsetX += dx;
    state.view.offsetY += dy;
    state.panStart = { x: mouse.x, y: mouse.y };
    render();
    return;
  }

  // Handle vertex dragging
  if (state.currentTool === 'select' && state.isDragging && state.selectedSpine !== null) {
    const world = canvasToWorld(mouse.x, mouse.y);
    const vertex = state.selectedSpine.vertices[state.selectedVertex];
    vertex.x = world.x;
    vertex.z = world.z;
    render();
    return;
  }

  // Handle rubberband update while drawing
  if (state.currentTool === 'draw' && state.isDrawing) {
    render();
    return;
  }

  // Handle delete hover highlight
  if (state.currentTool === 'delete') {
    const hit = hitTestSpine(mouse.x, mouse.y);
    if (hit !== state.hoveredSpine) {
      state.hoveredSpine = hit;
      render();
    }
  }
}

function onMouseUp(e) {
  if (state.isPanning) {
    state.isPanning = false;
    updateCursor();
  }
  if (state.isDragging) {
    state.isDragging = false;
  }
}

function onContextMenu(e) {
  e.preventDefault();
  // Right-click finishes spine drawing
  if (state.isDrawing) {
    finishDrawing();
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    // Esc cancels spine drawing
    if (state.isDrawing) {
      state.isDrawing = false;
      state.drawingSpine = null;
    }
    // Clear all selection
    state.selectedHalfCell = null;
    state.selectedSpine = null;
    state.selectedVertex = null;
    render();
  }
}

/**
 * Finish drawing current spine (if valid)
 */
function finishDrawing() {
  if (state.drawingSpine && state.drawingSpine.vertices.length >= 1) {
    state.template.spines.push(state.drawingSpine);
  }
  state.isDrawing = false;
  state.drawingSpine = null;
  render();
}

// Listen for keyboard events
document.addEventListener('keydown', onKeyDown);

function onWheel(e) {
  e.preventDefault();
  const mouse = getMousePos(e);

  // Shift+wheel: adjust elevation of hovered vertex
  if (e.shiftKey) {
    const hit = hitTestVertex(mouse.x, mouse.y);
    if (hit) {
      const vertex = hit.spine.vertices[hit.vertexIndex];
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      vertex.elevation = Math.max(0, Math.min(1, vertex.elevation + delta));

      // Update UI if this vertex is selected
      if (state.selectedSpine === hit.spine && state.selectedVertex === hit.vertexIndex) {
        document.getElementById('prop-elevation').value = vertex.elevation;
        document.getElementById('prop-elevation-value').textContent = vertex.elevation.toFixed(2);
      }

      render();
      return;
    }
  }

  // Normal wheel: zoom
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;

  // Zoom toward mouse position
  const worldBefore = canvasToWorld(mouse.x, mouse.y);
  state.view.zoom *= zoomFactor;
  state.view.zoom = Math.max(50, Math.min(2000, state.view.zoom));
  const worldAfter = canvasToWorld(mouse.x, mouse.y);

  // Adjust offset to keep mouse position stable
  state.view.offsetX += (worldAfter.x - worldBefore.x) * state.view.zoom;
  state.view.offsetY += (worldAfter.z - worldBefore.z) * state.view.zoom;

  render();
}

function updateCursor() {
  if (state.currentTool === 'draw') {
    canvas.style.cursor = 'crosshair';
  } else if (state.currentTool === 'delete') {
    canvas.style.cursor = 'not-allowed';
  } else {
    canvas.style.cursor = 'default';
  }
}

function onDoubleClick(e) {
  if (state.currentTool === 'draw' && state.isDrawing) {
    finishDrawing();
    // Note: finishDrawing already calls render() and resets state
    return;
  }
  // Legacy handling in case we reach here
  if (state.isDrawing) {
    state.drawingSpine = null;
    render();
  }
}

function hitTestVertex(cx, cy, threshold = 12) {
  for (const spine of state.template.spines) {
    for (let i = 0; i < spine.vertices.length; i++) {
      const v = spine.vertices[i];
      const p = worldToCanvas(v.x, v.z);
      const dx = cx - p.x;
      const dy = cy - p.y;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) {
        return { spine, vertexIndex: i };
      }
    }
  }
  return null;
}

/**
 * Hit test against spine lines (for delete tool)
 */
function hitTestSpine(cx, cy, threshold = 8) {
  for (const spine of state.template.spines) {
    // Check vertices first
    for (const v of spine.vertices) {
      const p = worldToCanvas(v.x, v.z);
      const dx = cx - p.x;
      const dy = cy - p.y;
      if (Math.sqrt(dx * dx + dy * dy) < threshold * 1.5) {
        return spine;
      }
    }
    // Check line segments
    for (let i = 0; i < spine.vertices.length - 1; i++) {
      const p1 = worldToCanvas(spine.vertices[i].x, spine.vertices[i].z);
      const p2 = worldToCanvas(spine.vertices[i + 1].x, spine.vertices[i + 1].z);
      const dist = distanceToLineSegment(cx, cy, p1.x, p1.y, p2.x, p2.y);
      if (dist < threshold) {
        return spine;
      }
    }
  }
  return null;
}

/**
 * Distance from point to line segment (canvas coordinates)
 */
function distanceToLineSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
}

/**
 * Distance from point to line segment (world coordinates)
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {Object} v1 - Segment start {x, z}
 * @param {Object} v2 - Segment end {x, z}
 * @returns {number} Distance
 */
function distanceToSegmentWorld(px, pz, v1, v2) {
  const dx = v2.x - v1.x;
  const dz = v2.z - v1.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.sqrt((px - v1.x) ** 2 + (pz - v1.z) ** 2);

  const t = Math.max(0, Math.min(1, ((px - v1.x) * dx + (pz - v1.z) * dz) / lengthSq));
  const closestX = v1.x + t * dx;
  const closestZ = v1.z + t * dz;
  return Math.sqrt((px - closestX) ** 2 + (pz - closestZ) ** 2);
}

/**
 * Hit test to find which half-cell a canvas point is in
 * @param {number} cx - Canvas X coordinate
 * @param {number} cy - Canvas Y coordinate
 * @returns {{spineId: string, vertexIndex: number, side: string} | null}
 */
function hitTestHalfCell(cx, cy) {
  const { x, z } = canvasToWorld(cx, cy);

  // Skip outside world bounds
  if (x < -1 || x > 1 || z < -1 || z > 1) return null;

  const world = buildWorld();
  const seeds = world.voronoi.seeds;
  if (seeds.length === 0) return null;

  // Find owning seed via power diagram
  const seedIndex = findCell(x, z, seeds);
  const seed = seeds[seedIndex];

  const spine = state.template.spines.find(s => s.id === seed.spineId);
  if (!spine) return null;

  const vertexIndex = spine.vertices.findIndex(
    v => v.x === seed.x && v.z === seed.z
  );
  if (vertexIndex === -1) return null;

  // Determine side
  const isEndpoint = (vertexIndex === 0 || vertexIndex === spine.vertices.length - 1);
  let side;

  if (isEndpoint) {
    side = 'radial';
  } else {
    const prevVertex = spine.vertices[vertexIndex - 1];
    const currVertex = spine.vertices[vertexIndex];
    const nextVertex = spine.vertices[vertexIndex + 1];

    // Compute the bisector direction at this vertex
    // Vector from prev to curr (normalized)
    const d1x = currVertex.x - prevVertex.x;
    const d1z = currVertex.z - prevVertex.z;
    const len1 = Math.sqrt(d1x * d1x + d1z * d1z);
    const n1x = len1 > 0 ? d1x / len1 : 0;
    const n1z = len1 > 0 ? d1z / len1 : 0;

    // Vector from curr to next (normalized)
    const d2x = nextVertex.x - currVertex.x;
    const d2z = nextVertex.z - currVertex.z;
    const len2 = Math.sqrt(d2x * d2x + d2z * d2z);
    const n2x = len2 > 0 ? d2x / len2 : 0;
    const n2z = len2 > 0 ? d2z / len2 : 0;

    // Bisector is average of the two directions
    const bisectX = n1x + n2x;
    const bisectZ = n1z + n2z;

    // Use cross product of bisector with point-to-vertex to determine side
    // Point relative to vertex
    const px = x - currVertex.x;
    const pz = z - currVertex.z;

    // Cross product: bisect × point
    const cross = bisectX * pz - bisectZ * px;
    side = cross < 0 ? 'left' : 'right';
  }

  return { spineId: spine.id, vertexIndex, side };
}

// =============================================================================
// UI Controls
// =============================================================================

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.disabled) return;
    document.querySelector('.tab.active').classList.remove('active');
    tab.classList.add('active');
    state.currentTab = tab.dataset.tab;
    render();
  });
});

document.querySelectorAll('.tool').forEach(tool => {
  tool.addEventListener('click', () => {
    // Auto-finish drawing when switching tools
    if (state.isDrawing) {
      finishDrawing();
    }

    document.querySelector('.tool.active').classList.remove('active');
    tool.classList.add('active');
    state.currentTool = tool.id.replace('tool-', '');
    // Set cursor based on tool
    if (state.currentTool === 'draw') {
      canvas.style.cursor = 'crosshair';
    } else if (state.currentTool === 'delete') {
      canvas.style.cursor = 'not-allowed';
    } else {
      canvas.style.cursor = 'default';
    }
  });
});

document.getElementById('seed').addEventListener('change', (e) => {
  state.seed = parseInt(e.target.value) || 0;
  render();
});

document.getElementById('randomize').addEventListener('click', () => {
  state.seed = Math.floor(Math.random() * 100000);
  document.getElementById('seed').value = state.seed;
  render();
});

document.getElementById('clear-canvas').addEventListener('click', () => {
  if (state.template.spines.length === 0) return;
  if (confirm('Clear all spines? This cannot be undone.')) {
    state.template.spines = [];
    state.template.halfCells = {};
    state.selectedSpine = null;
    state.selectedVertex = null;
    state.selectedHalfCell = null;
    state.hoveredSpine = null;
    state.isDrawing = false;
    state.drawingSpine = null;
    render();
  }
});

document.getElementById('show-elevation').addEventListener('change', (e) => {
  state.showElevation = e.target.checked;
  render();
});

document.getElementById('show-contours').addEventListener('change', (e) => {
  state.showElevationContours = e.target.checked;
  render();
});

// Property panel controls
const propElevation = document.getElementById('prop-elevation');
const propInfluence = document.getElementById('prop-influence');
const propElevationValue = document.getElementById('prop-elevation-value');
const propInfluenceValue = document.getElementById('prop-influence-value');

propElevation.addEventListener('input', (e) => {
  if (state.selectedSpine && state.selectedVertex !== null) {
    const value = parseFloat(e.target.value);
    state.selectedSpine.vertices[state.selectedVertex].elevation = value;
    propElevationValue.textContent = value.toFixed(2);
    render();
  }
});

propInfluence.addEventListener('input', (e) => {
  if (state.selectedSpine && state.selectedVertex !== null) {
    const value = parseInt(e.target.value);
    state.selectedSpine.vertices[state.selectedVertex].influence = value;
    propInfluenceValue.textContent = value;
    render();
  }
});

// Half-cell property panel controls
const propProfile = document.getElementById('prop-profile');
const propFalloff = document.getElementById('prop-falloff');
const propFalloffValue = document.getElementById('prop-falloff-value');

propProfile.addEventListener('change', (e) => {
  if (!state.selectedHalfCell) return;
  const { spineId, vertexIndex, side } = state.selectedHalfCell;
  const id = getHalfCellId(spineId, vertexIndex, side);
  if (!state.template.halfCells[id]) {
    state.template.halfCells[id] = {};
  }
  state.template.halfCells[id].profile = e.target.value;
  render();
});

propFalloff.addEventListener('input', (e) => {
  if (!state.selectedHalfCell) return;
  const { spineId, vertexIndex, side } = state.selectedHalfCell;
  const id = getHalfCellId(spineId, vertexIndex, side);
  if (!state.template.halfCells[id]) {
    state.template.halfCells[id] = {};
  }
  const value = parseFloat(e.target.value);
  state.template.halfCells[id].falloffCurve = value;
  propFalloffValue.textContent = value.toFixed(2);
  render();
});

/**
 * Update properties panel based on selection
 */
function updatePropertiesPanel() {
  const noSelection = document.getElementById('no-selection');
  const vertexProps = document.getElementById('vertex-props');
  const halfCellProps = document.getElementById('halfcell-props');

  if (state.selectedSpine && state.selectedVertex !== null) {
    // Show vertex properties
    const vertex = state.selectedSpine.vertices[state.selectedVertex];
    noSelection.style.display = 'none';
    vertexProps.style.display = 'block';
    halfCellProps.style.display = 'none';
    propElevation.value = vertex.elevation;
    propElevationValue.textContent = vertex.elevation.toFixed(2);
    propInfluence.value = vertex.influence;
    propInfluenceValue.textContent = vertex.influence;
  } else if (state.selectedHalfCell) {
    // Show half-cell properties
    noSelection.style.display = 'none';
    vertexProps.style.display = 'none';
    halfCellProps.style.display = 'block';

    const { spineId, vertexIndex, side } = state.selectedHalfCell;
    const world = buildWorld();
    const config = getHalfCellConfig(world, spineId, vertexIndex, side);

    document.getElementById('prop-profile').value = config.profile;
    document.getElementById('prop-falloff').value = config.falloffCurve;
    document.getElementById('prop-falloff-value').textContent = config.falloffCurve.toFixed(2);
  } else {
    // No selection
    noSelection.style.display = 'block';
    vertexProps.style.display = 'none';
    halfCellProps.style.display = 'none';
  }
}

// =============================================================================
// Initialize
// =============================================================================

resizeCanvas();
console.log('kosmos-gen editor initialized');
