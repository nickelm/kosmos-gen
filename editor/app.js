/**
 * kosmos-gen Editor
 *
 * Template editor with tab-based workflow:
 * 1. Terrain - Place blobs, see elevation and coastline
 * 2. Noise - Add procedural detail
 * 3. Hydrology - Rivers and lakes
 * 4. Climate - Temperature, humidity, biomes
 * 5. Zones - Gameplay regions
 * 6. Content - Landmarks, NPCs, quests
 */

import { sampleElevation, SEA_LEVEL } from '../src/terrain/elevation.js';
import { createBlob, generateBlobId, PROFILES, PROFILE_NAMES } from '../src/terrain/blob.js';
import { computeBlobCells, findBlobAt, findNearestBlob, clearCellCache } from '../src/geometry/voronoi.js';
import { extractContours, simplifyPolyline } from '../src/geometry/contour.js';
import { extractCoastline, DEFAULT_COASTLINE_CONFIG } from '../src/terrain/coastline.js';
import { createFBmNoise, unipolar } from '../src/core/noise.js';
import { deriveSeed } from '../src/core/seeds.js';
import { generateHydrology, DEFAULT_HYDROLOGY_CONFIG } from '../src/terrain/hydrology.js';
import { createManualSource } from '../src/terrain/watersources.js';
import { createManualLake } from '../src/terrain/lakes.js';

// =============================================================================
// State
// =============================================================================

const state = {
  // Current editor state
  currentTab: 'terrain',
  currentTool: 'select',
  seed: 42,

  // Tool defaults (for new blobs)
  toolDefaults: {
    elevation: 0.5,
    radius: 0.25,
    profile: 'cone'
  },

  // Template being edited
  template: {
    blobs: [],
    defaults: {
      seaLevel: SEA_LEVEL,
      profile: 'cone',
      baseElevation: 0,
      noise: { roughness: 0.3, featureScale: 0.2 },
      surfaceNoise: { enabled: true, roughness: 0.3, featureScale: 0.1 },
      ridgeNoise: { enabled: false },
      warp: {
        enabled: false,
        strength: 0.05,
        scale: 0.015,
        octaves: 2
      },
      microDetail: {
        enabled: true,
        amplitude: 0.02
      }
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
  selectedBlob: null,
  hoveredBlob: null,
  isDragging: false,
  isDraggingRadius: false,
  isPanning: false,
  panStart: { x: 0, y: 0 },
  mousePos: { x: 0, y: 0 },

  // Display options
  showElevation: true,
  showElevationContours: false,
  showVoronoiCells: true,

  // Hydrology state (Tab 3)
  hydrology: {
    rivers: [],
    lakes: [],
    waterSources: [],
    flowGrid: null,
    config: { ...DEFAULT_HYDROLOGY_CONFIG, autoDetect: false },
    cacheKey: null,
    showFlowGrid: false,
    showWatersheds: false,
    showWaterSources: true
  },

  // Hydrology selection
  selectedSource: null,
  selectedLake: null,

  // Contour cache
  cache: {
    coastlinePolylines: null,
    elevationContours: null,
    voronoiCells: null,
    cacheKey: null
  }
};

// =============================================================================
// Canvas Setup
// =============================================================================

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  canvas.width = width;
  canvas.height = height;

  state.view.offsetX = width / 2;
  state.view.offsetY = height / 2;
  state.view.zoom = Math.min(width, height) / 2.5;

  render();
}

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
// World Building
// =============================================================================

function buildWorld() {
  return {
    seed: state.seed,
    template: { blobs: state.template.blobs },
    defaults: state.template.defaults
  };
}

// =============================================================================
// Noise Sampling (Tab 2)
// =============================================================================

let noiseCache = {
  cacheKey: null,
  noiseFn: null
};

function getTerrainNoise(world) {
  const noiseConfig = world.defaults?.noise ?? { roughness: 0.3, featureScale: 0.2 };
  const cacheKey = `${world.seed}|${noiseConfig.roughness}|${noiseConfig.featureScale}`;

  if (noiseCache.cacheKey !== cacheKey) {
    const noiseSeed = deriveSeed(world.seed, 'terrainNoise');
    const baseFn = createFBmNoise(noiseSeed, {
      octaves: 4,
      persistence: 0.5,
      lacunarity: 2.0,
      frequency: 1 / noiseConfig.featureScale
    });
    noiseCache.noiseFn = unipolar(baseFn);
    noiseCache.cacheKey = cacheKey;
  }

  return noiseCache.noiseFn;
}

function sampleElevationWithNoise(world, x, z, applyNoise) {
  const baseElevation = sampleElevation(world, x, z);

  if (!applyNoise || baseElevation <= 0) {
    return baseElevation;
  }

  const noiseConfig = world.defaults?.noise ?? { roughness: 0.3, featureScale: 0.2 };
  const noiseFn = getTerrainNoise(world);
  const noiseValue = noiseFn(x, z);

  if (baseElevation <= SEA_LEVEL) {
    return baseElevation;
  }

  const landHeight = baseElevation - SEA_LEVEL;
  const amplitude = noiseConfig.roughness * 0.15;
  const noisyElevation = baseElevation + (noiseValue - 0.5) * 2 * amplitude * landHeight;

  return Math.max(SEA_LEVEL, Math.min(1, noisyElevation));
}

function elevationToColor(e) {
  if (e < SEA_LEVEL) {
    const t = e / SEA_LEVEL;
    return [
      Math.floor(40 + t * 60),
      Math.floor(80 + t * 100),
      Math.floor(140 + t * 80)
    ];
  } else {
    const t = (e - SEA_LEVEL) / (1 - SEA_LEVEL);
    if (t < 0.4) {
      const s = t / 0.4;
      return [
        Math.floor(34 + s * 50),
        Math.floor(139 - s * 30),
        Math.floor(34 + s * 20)
      ];
    } else if (t < 0.7) {
      const s = (t - 0.4) / 0.3;
      return [
        Math.floor(84 + s * 55),
        Math.floor(109 - s * 40),
        Math.floor(54 - s * 20)
      ];
    } else {
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

function getContourCacheKey() {
  const blobData = JSON.stringify(state.template.blobs.map(b => ({
    id: b.id, x: b.x, z: b.z, elevation: b.elevation, radius: b.radius, profile: b.profile
  })));
  const defaults = JSON.stringify(state.template.defaults);
  const viewData = `${state.view.offsetX.toFixed(0)},${state.view.offsetY.toFixed(0)},${state.view.zoom.toFixed(0)}`;
  return `${blobData}|${defaults}|${viewData}`;
}

function invalidateContourCacheIfNeeded() {
  const currentKey = getContourCacheKey();
  if (state.cache.cacheKey !== currentKey) {
    state.cache.coastlinePolylines = null;
    state.cache.elevationContours = null;
    state.cache.voronoiCells = null;
    state.cache.cacheKey = currentKey;
    clearCellCache();
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  invalidateContourCacheIfNeeded();

  drawOceanFill();
  drawLandElevation();

  if (state.showElevationContours) {
    drawElevationContours();
  }

  drawCoastlinePolygons();

  if (state.currentTab === 'hydrology') {
    drawFlowGrid();
  }

  if (state.currentTab === 'hydrology' || state.currentTab === 'climate' ||
      state.currentTab === 'zones' || state.currentTab === 'content') {
    drawLakes();
    drawRivers();
  }

  if (state.currentTab === 'hydrology') {
    drawWaterSources();
  }

  if (state.showVoronoiCells) {
    drawVoronoiCells();
  }

  drawGrid();
  drawWorldBoundary();
  drawBlobs();
  drawCursorPreview();

  updatePropertiesPanel();
}

function drawOceanFill() {
  ctx.fillStyle = '#1a4c6e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawLandElevation() {
  if (!state.showElevation || state.template.blobs.length === 0) return;

  const world = buildWorld();
  const step = 4;
  const applyNoise = state.currentTab !== 'terrain';
  const gradientOffset = step * 0.5 / state.view.zoom;
  const lightDir = { x: -0.577, y: 0.577, z: -0.577 };

  const sample = (wx, wz) => applyNoise
    ? sampleElevationWithNoise(world, wx, wz, true)
    : sampleElevation(world, wx, wz);

  for (let cy = 0; cy < canvas.height; cy += step) {
    for (let cx = 0; cx < canvas.width; cx += step) {
      const { x, z } = canvasToWorld(cx, cy);
      const elevation = sample(x, z);

      if (elevation <= 0) continue;

      const elevE = sample(x + gradientOffset, z);
      const elevS = sample(x, z + gradientOffset);
      const dEdx = (elevE - elevation) / gradientOffset;
      const dEdz = (elevS - elevation) / gradientOffset;

      const slopeScale = 3.0;
      const nx = -dEdx * slopeScale;
      const ny = 1;
      const nz = -dEdz * slopeScale;
      const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const dot = (nx * lightDir.x + ny * lightDir.y + nz * lightDir.z) / nLen;
      const shade = 0.5 + 0.5 * Math.max(0, dot);

      const [r, g, b] = elevationToColor(elevation);
      ctx.fillStyle = `rgb(${Math.round(r * shade)}, ${Math.round(g * shade)}, ${Math.round(b * shade)})`;
      ctx.fillRect(cx, cy, step, step);
    }
  }
}

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

function drawCoastlinePolygons() {
  if (state.template.blobs.length === 0) return;

  if (!state.cache.coastlinePolylines) {
    const world = buildWorld();
    const visible = getVisibleBounds();
    const margin = 0.2;
    const bounds = {
      minX: visible.minX - margin,
      maxX: visible.maxX + margin,
      minZ: visible.minZ - margin,
      maxZ: visible.maxZ + margin
    };

    const includeNoise = state.currentTab !== 'terrain';
    const polylines = extractCoastline(world, bounds, {
      includeNoise,
      resolution: DEFAULT_COASTLINE_CONFIG.resolution,
      simplifyEpsilon: DEFAULT_COASTLINE_CONFIG.simplifyEpsilon
    });

    state.cache.coastlinePolylines = polylines;
  }

  ctx.strokeStyle = '#4ecdc4';
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

function drawElevationContours() {
  if (state.template.blobs.length === 0) return;

  const world = buildWorld();

  if (!state.cache.elevationContours) {
    const visible = getVisibleBounds();
    const margin = 0.1;
    const bounds = {
      minX: visible.minX - margin,
      maxX: visible.maxX + margin,
      minZ: visible.minZ - margin,
      maxZ: visible.maxZ + margin
    };
    const resolution = 0.03;
    const levels = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const sampleFn = (x, z) => sampleElevation(world, x, z);

    state.cache.elevationContours = new Map();

    for (const level of levels) {
      if (level <= SEA_LEVEL) continue;
      let polylines = extractContours(sampleFn, level, bounds, resolution);
      polylines = polylines.map(pl => simplifyPolyline(pl, 0.008));
      state.cache.elevationContours.set(level, polylines);
    }
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const [level, polylines] of state.cache.elevationContours) {
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

function drawVoronoiCells() {
  if (state.template.blobs.length === 0) return;

  const visible = getVisibleBounds();
  const bounds = {
    minX: Math.min(-10, visible.minX - 1),
    maxX: Math.max(10, visible.maxX + 1),
    minZ: Math.min(-10, visible.minZ - 1),
    maxZ: Math.max(10, visible.maxZ + 1)
  };

  const cells = computeBlobCells(state.template.blobs, bounds);

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;

  for (const [blobId, polygon] of cells) {
    if (!polygon || polygon.length < 3) continue;

    ctx.beginPath();
    const first = worldToCanvas(polygon[0].x, polygon[0].z);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < polygon.length; i++) {
      const p = worldToCanvas(polygon[i].x, polygon[i].z);
      ctx.lineTo(p.x, p.y);
    }

    ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();
}

function drawGrid() {
  const minorStep = 0.2;
  const majorStep = 1.0;

  const topLeft = canvasToWorld(0, 0);
  const bottomRight = canvasToWorld(canvas.width, canvas.height);

  const minX = Math.floor(topLeft.x / minorStep) * minorStep;
  const maxX = Math.ceil(bottomRight.x / minorStep) * minorStep;
  const minZ = Math.floor(topLeft.z / minorStep) * minorStep;
  const maxZ = Math.ceil(bottomRight.z / minorStep) * minorStep;

  ctx.strokeStyle = '#1a2a4a';
  ctx.lineWidth = 1;

  for (let x = minX; x <= maxX; x += minorStep) {
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

  ctx.strokeStyle = '#3a4a6a';
  ctx.lineWidth = 2;

  if (minZ <= 0 && maxZ >= 0) {
    const p1 = worldToCanvas(minX, 0);
    const p2 = worldToCanvas(maxX, 0);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

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

function drawBlobs() {
  for (const blob of state.template.blobs) {
    const p = worldToCanvas(blob.x, blob.z);
    const isSelected = blob === state.selectedBlob;
    const isHovered = blob === state.hoveredBlob;

    // Draw radius circle
    ctx.beginPath();
    ctx.arc(p.x, p.y, blob.radius * state.view.zoom, 0, Math.PI * 2);
    if (isSelected) {
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 2;
    } else if (isHovered) {
      ctx.strokeStyle = '#4ecdc4';
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = 'rgba(74, 159, 255, 0.4)';
      ctx.lineWidth = 1;
    }
    ctx.stroke();

    // Draw center point
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? '#e94560' : (isHovered ? '#4ecdc4' : '#4a9fff');
    ctx.fill();

    // Elevation label
    ctx.fillStyle = '#fff';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(blob.elevation.toFixed(2), p.x, p.y - 14);

    // Profile indicator (small text)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '9px sans-serif';
    ctx.fillText(blob.profile, p.x, p.y + 20);
  }
}

function drawCursorPreview() {
  if (state.currentTool !== 'add' || state.isPanning || state.isDragging) return;

  const { x, z } = canvasToWorld(state.mousePos.x, state.mousePos.y);
  const p = worldToCanvas(x, z);

  // Ghost radius circle
  ctx.beginPath();
  ctx.arc(p.x, p.y, state.toolDefaults.radius * state.view.zoom, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(233, 69, 96, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ghost center
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(233, 69, 96, 0.5)';
  ctx.fill();
}

// =============================================================================
// Hydrology Rendering (Tab 3)
// =============================================================================

function getHydrologyCacheKey() {
  const blobData = JSON.stringify(state.template.blobs.map(b => ({
    id: b.id, x: b.x, z: b.z, elevation: b.elevation, radius: b.radius, profile: b.profile
  })));
  const configData = JSON.stringify(state.hydrology.config);
  const sourcesData = JSON.stringify(state.hydrology.waterSources.filter(s => s.origin === 'manual'));
  return `${state.seed}|${blobData}|${configData}|${sourcesData}`;
}

function runHydrologySimulation() {
  if (state.template.blobs.length === 0) {
    state.hydrology.rivers = [];
    state.hydrology.lakes = [];
    state.hydrology.waterSources = [];
    state.hydrology.flowGrid = null;
    render();
    return;
  }

  const world = buildWorld();
  world.hydrologyConfig = state.hydrology.config;
  world.waterSources = state.hydrology.waterSources.filter(s => s.origin === 'manual');
  world.lakes = state.hydrology.lakes.filter(l => l.origin === 'manual');

  const bounds = calculateTerrainBounds();

  try {
    const result = generateHydrology(world, { bounds });

    state.hydrology.rivers = result.rivers;
    state.hydrology.lakes = result.lakes;
    state.hydrology.waterSources = result.waterSources;
    state.hydrology.flowGrid = result.flowGrid;
    state.hydrology.cacheKey = getHydrologyCacheKey();

    console.log(`Hydrology: ${result.rivers.length} rivers, ${result.lakes.length} lakes, ${result.waterSources.length} sources`);
  } catch (err) {
    console.error('Hydrology generation failed:', err);
  }

  render();
}

function calculateTerrainBounds() {
  if (state.template.blobs.length === 0) {
    return { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  }

  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const blob of state.template.blobs) {
    minX = Math.min(minX, blob.x - blob.radius);
    maxX = Math.max(maxX, blob.x + blob.radius);
    minZ = Math.min(minZ, blob.z - blob.radius);
    maxZ = Math.max(maxZ, blob.z + blob.radius);
  }

  const margin = 0.1;
  return {
    minX: minX - margin,
    maxX: maxX + margin,
    minZ: minZ - margin,
    maxZ: maxZ + margin
  };
}

function drawRivers() {
  const rivers = state.hydrology.rivers;
  if (!rivers || rivers.length === 0) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const river of rivers) {
    if (!river.vertices || river.vertices.length < 2) continue;

    for (let i = 0; i < river.vertices.length - 1; i++) {
      const v0 = river.vertices[i];
      const v1 = river.vertices[i + 1];

      const p0 = worldToCanvas(v0.x, v0.z);
      const p1 = worldToCanvas(v1.x, v1.z);

      const width0 = Math.max(1, v0.width * state.view.zoom);
      const width1 = Math.max(1, v1.width * state.view.zoom);
      const avgWidth = (width0 + width1) / 2;

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);

      const alpha = Math.min(0.9, 0.5 + avgWidth / 20);
      ctx.strokeStyle = `rgba(64, 164, 223, ${alpha})`;
      ctx.lineWidth = avgWidth;
      ctx.stroke();
    }
  }
}

function drawLakes() {
  const lakes = state.hydrology.lakes;
  if (!lakes || lakes.length === 0) return;

  for (const lake of lakes) {
    if (!lake.boundary || lake.boundary.length < 3) {
      const p = worldToCanvas(lake.x, lake.z);
      const radius = Math.sqrt(lake.area) * state.view.zoom * 0.5;

      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(5, radius), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(64, 164, 223, 0.6)';
      ctx.fill();
      ctx.strokeStyle = '#40a4df';
      ctx.lineWidth = 2;
      ctx.stroke();
      continue;
    }

    ctx.beginPath();
    const first = worldToCanvas(lake.boundary[0].x, lake.boundary[0].z);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < lake.boundary.length; i++) {
      const p = worldToCanvas(lake.boundary[i].x, lake.boundary[i].z);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();

    ctx.fillStyle = lake === state.selectedLake
      ? 'rgba(233, 69, 96, 0.4)'
      : 'rgba(64, 164, 223, 0.6)';
    ctx.fill();

    ctx.strokeStyle = lake === state.selectedLake ? '#e94560' : '#40a4df';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (lake.endorheic) {
      const center = worldToCanvas(lake.x, lake.z);
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('(endorheic)', center.x, center.y);
    }
  }
}

function drawWaterSources() {
  if (!state.hydrology.showWaterSources) return;

  const sources = state.hydrology.waterSources;
  if (!sources || sources.length === 0) return;

  for (const source of sources) {
    const p = worldToCanvas(source.x, source.z);

    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);

    if (source === state.selectedSource) {
      ctx.fillStyle = '#e94560';
    } else if (source.origin === 'manual') {
      ctx.fillStyle = '#40a4df';
    } else {
      ctx.fillStyle = 'rgba(64, 164, 223, 0.6)';
    }
    ctx.fill();

    ctx.strokeStyle = source.enabled ? '#fff' : '#888';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (state.currentTab === 'hydrology') {
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(source.flowRate.toFixed(2), p.x, p.y - 12);
    }
  }
}

function drawFlowGrid() {
  if (!state.hydrology.showFlowGrid) return;

  const grid = state.hydrology.flowGrid;
  if (!grid) return;

  const cellSize = grid.resolution * state.view.zoom;
  if (cellSize < 2) return;

  let maxAccum = 1;
  for (let i = 0; i < grid.accumulation.length; i++) {
    maxAccum = Math.max(maxAccum, grid.accumulation[i]);
  }

  for (let cellZ = 0; cellZ < grid.height; cellZ++) {
    for (let cellX = 0; cellX < grid.width; cellX++) {
      const idx = cellZ * grid.width + cellX;
      const accum = grid.accumulation[idx];

      if (accum <= 1) continue;

      const worldX = grid.bounds.minX + (cellX + 0.5) * grid.resolution;
      const worldZ = grid.bounds.minZ + (cellZ + 0.5) * grid.resolution;
      const p = worldToCanvas(worldX, worldZ);

      const intensity = Math.log(accum) / Math.log(maxAccum);
      const alpha = Math.min(0.8, intensity * 0.5);

      ctx.fillStyle = `rgba(64, 164, 223, ${alpha})`;
      ctx.fillRect(p.x - cellSize / 2, p.y - cellSize / 2, cellSize, cellSize);
    }
  }
}

// =============================================================================
// Interaction
// =============================================================================

canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup', onMouseUp);
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

  if (e.button === 2) return;

  const world = canvasToWorld(mouse.x, mouse.y);

  if (state.currentTool === 'add') {
    // Add new blob at click position
    const newBlob = createBlob(
      generateBlobId(state.template.blobs.length),
      world.x,
      world.z,
      state.toolDefaults.elevation,
      state.toolDefaults.radius,
      state.toolDefaults.profile
    );
    state.template.blobs.push(newBlob);
    state.selectedBlob = newBlob;

    // Update tool defaults from this blob (for clone behavior)
    state.toolDefaults.elevation = newBlob.elevation;
    state.toolDefaults.radius = newBlob.radius;
    state.toolDefaults.profile = newBlob.profile;

    render();
  } else if (state.currentTool === 'select') {
    // Check if clicking on a blob center
    const hitBlob = hitTestBlobCenter(mouse.x, mouse.y);
    if (hitBlob) {
      state.selectedBlob = hitBlob;
      state.isDragging = true;

      // Update tool defaults from selected blob
      state.toolDefaults.elevation = hitBlob.elevation;
      state.toolDefaults.radius = hitBlob.radius;
      state.toolDefaults.profile = hitBlob.profile;
    } else {
      // Check if clicking on a blob radius ring
      const radiusHit = hitTestBlobRadius(mouse.x, mouse.y);
      if (radiusHit) {
        state.selectedBlob = radiusHit;
        state.isDraggingRadius = true;
      } else {
        state.selectedBlob = null;
      }
    }
    render();
  } else if (state.currentTool === 'delete') {
    const hitBlob = hitTestBlobCenter(mouse.x, mouse.y) || hitTestBlobRadius(mouse.x, mouse.y);
    if (hitBlob) {
      const index = state.template.blobs.indexOf(hitBlob);
      if (index !== -1) {
        state.template.blobs.splice(index, 1);
        if (state.selectedBlob === hitBlob) {
          state.selectedBlob = null;
        }
      }
    }
    render();
  } else if (state.currentTool === 'add-source') {
    const source = createManualSource(world.x, world.z, {
      id: `source_manual_${Date.now()}`,
      flowRate: 0.5
    });
    state.hydrology.waterSources.push(source);
    state.selectedSource = source;
    runHydrologySimulation();
  } else if (state.currentTool === 'add-lake') {
    const lake = createManualLake(world.x, world.z, {
      id: `lake_manual_${Date.now()}`,
      waterLevel: 0.15,
      area: 0.01
    });
    state.hydrology.lakes.push(lake);
    state.selectedLake = lake;
    runHydrologySimulation();
  }
}

function onMouseMove(e) {
  const mouse = getMousePos(e);
  state.mousePos = { x: mouse.x, y: mouse.y };

  if (state.isPanning) {
    const dx = mouse.x - state.panStart.x;
    const dy = mouse.y - state.panStart.y;
    state.view.offsetX += dx;
    state.view.offsetY += dy;
    state.panStart = { x: mouse.x, y: mouse.y };
    render();
    return;
  }

  if (state.isDragging && state.selectedBlob) {
    const world = canvasToWorld(mouse.x, mouse.y);
    state.selectedBlob.x = world.x;
    state.selectedBlob.z = world.z;
    render();
    return;
  }

  if (state.isDraggingRadius && state.selectedBlob) {
    const world = canvasToWorld(mouse.x, mouse.y);
    const dx = world.x - state.selectedBlob.x;
    const dz = world.z - state.selectedBlob.z;
    state.selectedBlob.radius = Math.max(0.05, Math.sqrt(dx * dx + dz * dz));
    state.toolDefaults.radius = state.selectedBlob.radius;
    render();
    return;
  }

  // Hover detection
  if (state.currentTool === 'select' || state.currentTool === 'delete') {
    const hitBlob = hitTestBlobCenter(mouse.x, mouse.y) || hitTestBlobRadius(mouse.x, mouse.y);
    if (hitBlob !== state.hoveredBlob) {
      state.hoveredBlob = hitBlob;
      canvas.style.cursor = hitBlob ? 'pointer' : 'default';
      render();
    }
  }

  // Cursor preview for add tool
  if (state.currentTool === 'add') {
    render();
  }
}

function onMouseUp(e) {
  if (state.isPanning) {
    state.isPanning = false;
    updateCursor();
  }
  state.isDragging = false;
  state.isDraggingRadius = false;
}

function onContextMenu(e) {
  e.preventDefault();
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    state.selectedBlob = null;
    state.hoveredBlob = null;
    render();
  }

  // Delete selected blob with Delete or Backspace
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedBlob) {
    const index = state.template.blobs.indexOf(state.selectedBlob);
    if (index !== -1) {
      state.template.blobs.splice(index, 1);
      state.selectedBlob = null;
      render();
    }
  }
}

document.addEventListener('keydown', onKeyDown);

function onWheel(e) {
  e.preventDefault();
  const mouse = getMousePos(e);

  // Shift+wheel: adjust elevation of selected or hovered blob
  if (e.shiftKey) {
    const blob = state.selectedBlob || state.hoveredBlob;
    if (blob) {
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      blob.elevation = Math.max(0, Math.min(1, blob.elevation + delta));
      state.toolDefaults.elevation = blob.elevation;
      render();
      return;
    }
  }

  // Ctrl+wheel: adjust radius of selected or hovered blob
  if (e.ctrlKey) {
    const blob = state.selectedBlob || state.hoveredBlob;
    if (blob) {
      const delta = e.deltaY > 0 ? -0.02 : 0.02;
      blob.radius = Math.max(0.05, Math.min(1, blob.radius + delta));
      state.toolDefaults.radius = blob.radius;
      render();
      return;
    }
  }

  // Normal wheel: zoom
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  const worldBefore = canvasToWorld(mouse.x, mouse.y);
  state.view.zoom *= zoomFactor;
  state.view.zoom = Math.max(50, Math.min(2000, state.view.zoom));
  const worldAfter = canvasToWorld(mouse.x, mouse.y);

  state.view.offsetX += (worldAfter.x - worldBefore.x) * state.view.zoom;
  state.view.offsetY += (worldAfter.z - worldBefore.z) * state.view.zoom;

  render();
}

function updateCursor() {
  if (state.currentTool === 'add') {
    canvas.style.cursor = 'crosshair';
  } else if (state.currentTool === 'delete') {
    canvas.style.cursor = 'not-allowed';
  } else {
    canvas.style.cursor = 'default';
  }
}

function hitTestBlobCenter(cx, cy, threshold = 12) {
  for (const blob of state.template.blobs) {
    const p = worldToCanvas(blob.x, blob.z);
    const dx = cx - p.x;
    const dy = cy - p.y;
    if (Math.sqrt(dx * dx + dy * dy) < threshold) {
      return blob;
    }
  }
  return null;
}

function hitTestBlobRadius(cx, cy, threshold = 8) {
  for (const blob of state.template.blobs) {
    const p = worldToCanvas(blob.x, blob.z);
    const radiusPixels = blob.radius * state.view.zoom;
    const dx = cx - p.x;
    const dy = cy - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Check if near the radius circle edge
    if (Math.abs(dist - radiusPixels) < threshold) {
      return blob;
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
    state.cache.cacheKey = null;
    updateTabUI();
    render();
  });
});

function updateTabUI() {
  const noiseSettings = document.getElementById('noise-settings');
  const hydrologySettings = document.getElementById('hydrology-settings');
  const hydrologyTools = document.querySelectorAll('.hydrology-tool');

  if (state.currentTab === 'noise') {
    noiseSettings.style.display = 'block';
    state.template.defaults.warp.enabled = true;
    document.getElementById('warp-enabled').checked = true;
  } else {
    noiseSettings.style.display = 'none';
    if (state.currentTab === 'terrain') {
      state.template.defaults.warp.enabled = false;
      document.getElementById('warp-enabled').checked = false;
    }
  }

  if (hydrologySettings) {
    hydrologySettings.style.display = (state.currentTab === 'hydrology') ? 'block' : 'none';
  }

  hydrologyTools.forEach(tool => {
    tool.style.display = (state.currentTab === 'hydrology') ? 'inline-flex' : 'none';
  });

  if (state.currentTab !== 'hydrology') {
    state.selectedSource = null;
    state.selectedLake = null;
  }
}

document.querySelectorAll('.tool').forEach(tool => {
  tool.addEventListener('click', () => {
    document.querySelector('.tool.active').classList.remove('active');
    tool.classList.add('active');
    state.currentTool = tool.id.replace('tool-', '');
    state.hoveredBlob = null;

    if (state.currentTool === 'add') {
      canvas.style.cursor = 'crosshair';
    } else if (state.currentTool === 'delete') {
      canvas.style.cursor = 'not-allowed';
    } else {
      canvas.style.cursor = 'default';
    }
    render();
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
  if (state.template.blobs.length === 0) return;
  if (confirm('Clear all blobs? This cannot be undone.')) {
    state.template.blobs = [];
    state.selectedBlob = null;
    state.hoveredBlob = null;
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

// Voronoi cells toggle
document.getElementById('show-cells')?.addEventListener('change', (e) => {
  state.showVoronoiCells = e.target.checked;
  render();
});

// =============================================================================
// Noise Panel Controls (Tab 2)
// =============================================================================

document.getElementById('warp-enabled').addEventListener('change', (e) => {
  state.template.defaults.warp.enabled = e.target.checked;
  noiseCache.cacheKey = null;
  render();
});

document.getElementById('warp-strength').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.warp.strength = value;
  document.getElementById('warp-strength-value').textContent = value.toFixed(3);
  noiseCache.cacheKey = null;
  render();
});

document.getElementById('warp-scale').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.warp.scale = value;
  document.getElementById('warp-scale-value').textContent = value.toFixed(3);
  noiseCache.cacheKey = null;
  render();
});

document.getElementById('default-roughness').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.noise.roughness = value;
  document.getElementById('default-roughness-value').textContent = value.toFixed(2);
  noiseCache.cacheKey = null;
  render();
});

document.getElementById('default-feature-scale').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.noise.featureScale = value;
  document.getElementById('default-feature-scale-value').textContent = value.toFixed(2);
  noiseCache.cacheKey = null;
  render();
});

document.getElementById('micro-detail-enabled').addEventListener('change', (e) => {
  state.template.defaults.microDetail.enabled = e.target.checked;
  render();
});

document.getElementById('micro-detail-amplitude').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.microDetail.amplitude = value;
  document.getElementById('micro-detail-amplitude-value').textContent = value.toFixed(3);
  render();
});

// =============================================================================
// Hydrology Panel Controls (Tab 3)
// =============================================================================

document.getElementById('auto-detect-sources')?.addEventListener('change', (e) => {
  state.hydrology.config.autoDetect = e.target.checked;
  state.hydrology.cacheKey = null;
  render();
});

document.getElementById('river-carving')?.addEventListener('change', (e) => {
  state.hydrology.config.carveEnabled = e.target.checked;
  state.hydrology.cacheKey = null;
  render();
});

document.getElementById('river-threshold')?.addEventListener('input', (e) => {
  const value = parseInt(e.target.value);
  state.hydrology.config.riverThreshold = value;
  document.getElementById('river-threshold-value').textContent = value;
  state.hydrology.cacheKey = null;
  render();
});

document.getElementById('river-width-scale')?.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.hydrology.config.riverWidthScale = value;
  document.getElementById('river-width-scale-value').textContent = value.toFixed(2);
  state.hydrology.cacheKey = null;
  render();
});

document.getElementById('carve-factor')?.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.hydrology.config.carveFactor = value;
  document.getElementById('carve-factor-value').textContent = value.toFixed(3);
  state.hydrology.cacheKey = null;
  render();
});

document.getElementById('show-flow-grid')?.addEventListener('change', (e) => {
  state.hydrology.showFlowGrid = e.target.checked;
  render();
});

document.getElementById('show-watersheds')?.addEventListener('change', (e) => {
  state.hydrology.showWatersheds = e.target.checked;
  render();
});

document.getElementById('show-water-sources')?.addEventListener('change', (e) => {
  state.hydrology.showWaterSources = e.target.checked;
  render();
});

document.getElementById('simulate-water')?.addEventListener('click', () => {
  runHydrologySimulation();
});

document.getElementById('tool-add-source')?.addEventListener('click', () => {
  document.querySelector('.tool.active')?.classList.remove('active');
  document.getElementById('tool-add-source').classList.add('active');
  state.currentTool = 'add-source';
  canvas.style.cursor = 'crosshair';
  render();
});

document.getElementById('tool-add-lake')?.addEventListener('click', () => {
  document.querySelector('.tool.active')?.classList.remove('active');
  document.getElementById('tool-add-lake').classList.add('active');
  state.currentTool = 'add-lake';
  canvas.style.cursor = 'crosshair';
  render();
});

// =============================================================================
// Blob Properties Panel
// =============================================================================

const propElevation = document.getElementById('prop-elevation');
const propRadius = document.getElementById('prop-radius');
const propProfile = document.getElementById('prop-profile');
const propElevationValue = document.getElementById('prop-elevation-value');
const propRadiusValue = document.getElementById('prop-radius-value');

propElevation?.addEventListener('input', (e) => {
  if (state.selectedBlob) {
    const value = parseFloat(e.target.value);
    state.selectedBlob.elevation = value;
    state.toolDefaults.elevation = value;
    propElevationValue.textContent = value.toFixed(2);
    render();
  }
});

propRadius?.addEventListener('input', (e) => {
  if (state.selectedBlob) {
    const value = parseFloat(e.target.value);
    state.selectedBlob.radius = value;
    state.toolDefaults.radius = value;
    propRadiusValue.textContent = value.toFixed(2);
    render();
  }
});

propProfile?.addEventListener('change', (e) => {
  if (state.selectedBlob) {
    state.selectedBlob.profile = e.target.value;
    state.toolDefaults.profile = e.target.value;
    render();
  }
});

// Tool defaults panel
document.getElementById('tool-elevation')?.addEventListener('input', (e) => {
  state.toolDefaults.elevation = parseFloat(e.target.value);
  document.getElementById('tool-elevation-value').textContent = state.toolDefaults.elevation.toFixed(2);
});

document.getElementById('tool-radius')?.addEventListener('input', (e) => {
  state.toolDefaults.radius = parseFloat(e.target.value);
  document.getElementById('tool-radius-value').textContent = state.toolDefaults.radius.toFixed(2);
});

document.getElementById('tool-profile')?.addEventListener('change', (e) => {
  state.toolDefaults.profile = e.target.value;
});

function updatePropertiesPanel() {
  const noSelection = document.getElementById('no-selection');
  const blobProps = document.getElementById('blob-props');
  const toolProps = document.getElementById('tool-props');

  if (state.selectedBlob) {
    noSelection.style.display = 'none';
    blobProps.style.display = 'block';
    if (toolProps) toolProps.style.display = 'none';

    propElevation.value = state.selectedBlob.elevation;
    propElevationValue.textContent = state.selectedBlob.elevation.toFixed(2);
    propRadius.value = state.selectedBlob.radius;
    propRadiusValue.textContent = state.selectedBlob.radius.toFixed(2);
    propProfile.value = state.selectedBlob.profile;
  } else {
    noSelection.style.display = 'block';
    blobProps.style.display = 'none';
    if (toolProps) toolProps.style.display = 'block';
  }

  // Update tool defaults UI
  const toolElevation = document.getElementById('tool-elevation');
  const toolRadius = document.getElementById('tool-radius');
  const toolProfile = document.getElementById('tool-profile');

  if (toolElevation) {
    toolElevation.value = state.toolDefaults.elevation;
    document.getElementById('tool-elevation-value').textContent = state.toolDefaults.elevation.toFixed(2);
  }
  if (toolRadius) {
    toolRadius.value = state.toolDefaults.radius;
    document.getElementById('tool-radius-value').textContent = state.toolDefaults.radius.toFixed(2);
  }
  if (toolProfile) {
    toolProfile.value = state.toolDefaults.profile;
  }
}

// =============================================================================
// Initialize
// =============================================================================

function syncNoisePanelUI() {
  const warp = state.template.defaults.warp;
  const noise = state.template.defaults.noise;
  const microDetail = state.template.defaults.microDetail;

  document.getElementById('warp-enabled').checked = warp.enabled;
  document.getElementById('warp-strength').value = warp.strength;
  document.getElementById('warp-strength-value').textContent = warp.strength.toFixed(3);
  document.getElementById('warp-scale').value = warp.scale;
  document.getElementById('warp-scale-value').textContent = warp.scale.toFixed(3);

  document.getElementById('default-roughness').value = noise.roughness;
  document.getElementById('default-roughness-value').textContent = noise.roughness.toFixed(2);
  document.getElementById('default-feature-scale').value = noise.featureScale;
  document.getElementById('default-feature-scale-value').textContent = noise.featureScale.toFixed(2);

  document.getElementById('micro-detail-enabled').checked = microDetail.enabled;
  document.getElementById('micro-detail-amplitude').value = microDetail.amplitude;
  document.getElementById('micro-detail-amplitude-value').textContent = microDetail.amplitude.toFixed(3);
}

resizeCanvas();
syncNoisePanelUI();
updateTabUI();
console.log('kosmos-gen editor initialized (blob mode)');
