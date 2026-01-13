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
  drawingSpine: null
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
// Rendering
// =============================================================================

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  drawGrid();
  drawWorldBoundary();
  drawSpines();
  drawVertices();
  
  // TODO: Draw Voronoi cells
  // TODO: Draw elevation preview
  // TODO: Draw coastline
}

function drawGrid() {
  ctx.strokeStyle = '#1a2a4a';
  ctx.lineWidth = 1;
  
  const gridStep = 0.2;
  for (let x = -1; x <= 1; x += gridStep) {
    const p1 = worldToCanvas(x, -1);
    const p2 = worldToCanvas(x, 1);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  for (let z = -1; z <= 1; z += gridStep) {
    const p1 = worldToCanvas(-1, z);
    const p2 = worldToCanvas(1, z);
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
    
    ctx.strokeStyle = spine === state.selectedSpine ? '#e94560' : '#4a9fff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  
  // Drawing in progress
  if (state.isDrawing && state.drawingSpine && state.drawingSpine.vertices.length > 0) {
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
  }
}

function drawVertices() {
  for (const spine of state.template.spines) {
    for (let i = 0; i < spine.vertices.length; i++) {
      const v = spine.vertices[i];
      const p = worldToCanvas(v.x, v.z);
      
      // Influence radius
      ctx.beginPath();
      ctx.arc(p.x, p.y, v.influence * state.view.zoom / 1000, 0, Math.PI * 2);
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

function onMouseDown(e) {
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
          influence: 300
        }]
      };
    } else {
      // Add vertex to current spine
      state.drawingSpine.vertices.push({
        x: world.x,
        z: world.z,
        elevation: 0.7,
        influence: 300
      });
    }
    render();
  } else if (state.currentTool === 'select') {
    // Try to select a vertex
    const hit = hitTestVertex(e.offsetX, e.offsetY);
    if (hit) {
      state.selectedSpine = hit.spine;
      state.selectedVertex = hit.vertexIndex;
    } else {
      state.selectedSpine = null;
      state.selectedVertex = null;
    }
    render();
  }
}

function onMouseMove(e) {
  // TODO: Drag selected vertex
  // TODO: Preview hover
}

function onMouseUp(e) {
  // TODO: End drag
}

function onDoubleClick(e) {
  if (state.currentTool === 'draw' && state.isDrawing) {
    // Finish spine
    if (state.drawingSpine.vertices.length >= 2) {
      state.template.spines.push(state.drawingSpine);
    }
    state.isDrawing = false;
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
    document.querySelector('.tool.active').classList.remove('active');
    tool.classList.add('active');
    state.currentTool = tool.id.replace('tool-', '');
    canvas.style.cursor = state.currentTool === 'draw' ? 'crosshair' : 'default';
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

// =============================================================================
// Initialize
// =============================================================================

resizeCanvas();
console.log('kosmos-gen editor initialized');
