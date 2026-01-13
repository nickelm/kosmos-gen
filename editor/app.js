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

// =============================================================================
// State
// =============================================================================

const state = {
  // Current editor state
  currentTab: 'spines',
  currentTool: 'move',
  seed: 42,
  
  // Template being edited
  template: {
    spines: [],
    halfCells: {},
    defaults: {
      profile: 'ramp',
      baseElevation: 0.1,
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
  showElevation: true
};

// =============================================================================
// Canvas Setup
// =============================================================================

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  
  // Center the view
  state.view.offsetX = canvas.width / 2;
  state.view.offsetY = canvas.height / 2;
  state.view.zoom = Math.min(canvas.width, canvas.height) / 2.5;
  
  render();
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
 */
function elevationToColor(e) {
  const seaLevel = 0.1;
  if (e < seaLevel) {
    // Water: dark blue to light blue
    const t = e / seaLevel;
    return [
      Math.floor(20 + t * 30),
      Math.floor(40 + t * 60),
      Math.floor(100 + t * 55)
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

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Elevation layer (below everything)
  drawElevation();
  drawCoastline();

  drawGrid();
  drawWorldBoundary();
  drawSpines();
  drawVertices();

  // Update UI
  updatePropertiesPanel();

  // TODO: Draw Voronoi cells
}

/**
 * Draw elevation field as color-coded image
 */
function drawElevation() {
  if (!state.showElevation || state.template.spines.length === 0) return;

  const world = buildWorld();
  const step = 4; // Sample every 4 pixels

  const imageData = ctx.createImageData(canvas.width, canvas.height);
  const data = imageData.data;

  for (let cy = 0; cy < canvas.height; cy += step) {
    for (let cx = 0; cx < canvas.width; cx += step) {
      const { x, z } = canvasToWorld(cx, cy);

      // Skip outside world bounds
      if (x < -1 || x > 1 || z < -1 || z > 1) continue;

      const elevation = sampleElevation(world, x, z);
      const [r, g, b] = elevationToColor(elevation);

      // Fill step×step block
      for (let dy = 0; dy < step && cy + dy < canvas.height; dy++) {
        for (let dx = 0; dx < step && cx + dx < canvas.width; dx++) {
          const idx = ((cy + dy) * canvas.width + (cx + dx)) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Draw coastline where elevation crosses sea level
 */
function drawCoastline() {
  if (!state.showElevation || state.template.spines.length === 0) return;

  const world = buildWorld();
  const seaLevel = state.template.defaults.baseElevation;
  const step = 2; // Check every 2 pixels for coastline

  ctx.fillStyle = '#00ffff'; // Cyan

  for (let cy = 0; cy < canvas.height; cy += step) {
    for (let cx = 0; cx < canvas.width; cx += step) {
      const { x, z } = canvasToWorld(cx, cy);
      if (x < -1 || x > 1 || z < -1 || z > 1) continue;

      const e = sampleElevation(world, x, z);

      // Check if this point crosses sea level with a neighbor
      const neighbors = [
        canvasToWorld(cx + step, cy),
        canvasToWorld(cx, cy + step)
      ];

      for (const n of neighbors) {
        if (n.x < -1 || n.x > 1 || n.z < -1 || n.z > 1) continue;
        const ne = sampleElevation(world, n.x, n.z);

        // Crossing detected
        if ((e < seaLevel && ne >= seaLevel) || (e >= seaLevel && ne < seaLevel)) {
          ctx.fillRect(cx, cy, 2, 2);
          break;
        }
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
      ctx.fillText(v.elevation.toFixed(1), p.x, p.y - 14);
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
  // Middle mouse button for panning
  if (e.button === 1) {
    e.preventDefault();
    state.isPanning = true;
    state.panStart = { x: e.offsetX, y: e.offsetY };
    canvas.style.cursor = 'grabbing';
    return;
  }

  // Right click handled in contextmenu
  if (e.button === 2) return;

  const world = canvasToWorld(e.offsetX, e.offsetY);

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
  } else if (state.currentTool === 'move') {
    // Try to select a vertex and start dragging
    const hit = hitTestVertex(e.offsetX, e.offsetY);
    if (hit) {
      state.selectedSpine = hit.spine;
      state.selectedVertex = hit.vertexIndex;
      state.isDragging = true;
    } else {
      state.selectedSpine = null;
      state.selectedVertex = null;
    }
    render();
  } else if (state.currentTool === 'delete') {
    // Delete entire spine if clicked on any of its vertices
    const hit = hitTestSpine(e.offsetX, e.offsetY);
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
  // Track mouse position for rubberband
  state.mousePos = { x: e.offsetX, y: e.offsetY };

  // Handle panning
  if (state.isPanning) {
    const dx = e.offsetX - state.panStart.x;
    const dy = e.offsetY - state.panStart.y;
    state.view.offsetX += dx;
    state.view.offsetY += dy;
    state.panStart = { x: e.offsetX, y: e.offsetY };
    render();
    return;
  }

  // Handle vertex dragging
  if (state.currentTool === 'move' && state.isDragging && state.selectedSpine !== null) {
    const world = canvasToWorld(e.offsetX, e.offsetY);
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
    const hit = hitTestSpine(e.offsetX, e.offsetY);
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
  // Esc cancels spine drawing
  if (e.key === 'Escape' && state.isDrawing) {
    state.isDrawing = false;
    state.drawingSpine = null;
    render();
  }
}

/**
 * Finish drawing current spine (if valid)
 */
function finishDrawing() {
  if (state.drawingSpine && state.drawingSpine.vertices.length >= 2) {
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
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  const mouseX = e.offsetX;
  const mouseY = e.offsetY;

  // Zoom toward mouse position
  const worldBefore = canvasToWorld(mouseX, mouseY);
  state.view.zoom *= zoomFactor;
  state.view.zoom = Math.max(50, Math.min(2000, state.view.zoom));
  const worldAfter = canvasToWorld(mouseX, mouseY);

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
    canvas.style.cursor = 'move';
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
      canvas.style.cursor = 'move';
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
    state.selectedSpine = null;
    state.selectedVertex = null;
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

/**
 * Update properties panel based on selection
 */
function updatePropertiesPanel() {
  const noSelection = document.getElementById('no-selection');
  const vertexProps = document.getElementById('vertex-props');

  if (state.selectedSpine && state.selectedVertex !== null) {
    const vertex = state.selectedSpine.vertices[state.selectedVertex];
    noSelection.style.display = 'none';
    vertexProps.style.display = 'block';
    propElevation.value = vertex.elevation;
    propElevationValue.textContent = vertex.elevation.toFixed(2);
    propInfluence.value = vertex.influence;
    propInfluenceValue.textContent = vertex.influence;
  } else {
    noSelection.style.display = 'block';
    vertexProps.style.display = 'none';
  }
}

// =============================================================================
// Initialize
// =============================================================================

resizeCanvas();
console.log('kosmos-gen editor initialized');
