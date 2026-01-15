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
import { createBlob, generateBlobId, PROFILES, PROFILE_NAMES, evaluateBlobInfluence } from '../src/terrain/blob.js';
import { computeBlobCells, findBlobAt, findNearestBlob } from '../src/geometry/voronoi.js';
import { extractContours, simplifyPolyline } from '../src/geometry/contour.js';
import { extractCoastline, DEFAULT_COASTLINE_CONFIG } from '../src/terrain/coastline.js';
import { createFBmNoise, unipolar } from '../src/core/noise.js';
import { deriveSeed } from '../src/core/seeds.js';
import { generateHydrology, DEFAULT_HYDROLOGY_CONFIG } from '../src/terrain/hydrology.js';
import { createManualSource } from '../src/terrain/watersources.js';
import { computeBlobCells as computeVoronoiCells } from '../src/geometry/voronoi.js';
import {
  worldToCell,
  cellIndex,
  isValidCell,
  indexToCell,
  cellToWorld,
  D8_DIRECTIONS
} from '../src/terrain/flowgrid.js';

// Touch/gesture modules
import {
  createInteractionHandler,
  hitTestBlobCenter as touchHitTestCenter,
  hitTestBlobRadius as touchHitTestRadius,
  resizeOverlay
} from './canvas/interaction.js';
import { screenToWorld, worldToScreen, copyViewport, zoom as viewportZoom, pan as viewportPan } from './canvas/viewport.js';
import { createPropertiesPanel } from './panels/properties.js';

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
      noise: {
        enabled: true,
        roughness: 0.3,
        featureScale: 0.2,
        octaves: 4,
        lacunarity: 2.0,
        persistence: 0.5
      },
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

  // Drag preview state (for showing outline without recomputing elevation)
  dragPreview: null,  // { x, z, radius } - preview position/size during drag

  // Display options
  showElevation: true,
  showElevationContours: false,
  showVoronoiCells: true,
  showWater: true,

  // Hydrology state (Tab 3)
  hydrology: {
    rivers: [],
    lakes: [],
    waterSources: [],
    flowGrid: null,
    config: { ...DEFAULT_HYDROLOGY_CONFIG, autoDetect: false, carveEnabled: true, carveFactor: 0.04 },
    cacheKey: null,
    showFlowGrid: false,
    showWaterSources: true,
    simulationNeeded: false  // Track when simulation needs to be rerun
  },

  // Hydrology selection
  selectedSource: null,
  hoveredSource: null,

  // Layered cache with dirty flags
  cache: {
    // Layer 1: Voronoi (depends on blob positions only)
    voronoi: null,
    voronoiDirty: true,

    // Layer 2: Elevation texture (depends on all blob params + noise config)
    elevationCanvas: null,
    elevationDirty: true,

    // Layer 3: Derived features (depends on elevation)
    coastlinePolylines: null,
    elevationContours: null,
    derivedDirty: true,

    // Computed bounds covering all blobs (updated when blobs change)
    textureBounds: null
  }
};

// =============================================================================
// Cache Invalidation
// =============================================================================

const ELEVATION_TEXTURE_SIZE = 1024;

function markVoronoiDirty() {
  state.cache.voronoiDirty = true;
  state.cache.elevationDirty = true;
  state.cache.derivedDirty = true;
}

function markElevationDirty() {
  state.cache.elevationDirty = true;
  state.cache.derivedDirty = true;
}

/**
 * Mark that hydrology simulation needs to be re-run
 * Updates the Simulate Water button to show a notification indicator
 */
function markSimulationNeeded() {
  state.hydrology.simulationNeeded = true;
  updateSimulateButtonState();
}

/**
 * Update the Simulate Water button appearance based on simulation state
 */
function updateSimulateButtonState() {
  const btn = document.getElementById('simulate-water');
  if (!btn) return;

  if (state.hydrology.simulationNeeded) {
    btn.classList.add('needs-simulation');
    btn.title = 'Simulation out of date - click to update';
  } else {
    btn.classList.remove('needs-simulation');
    btn.title = 'Run water simulation';
  }
}

// Deferred regeneration to coalesce rapid edits
let regenerationScheduled = false;

function scheduleRegeneration() {
  if (regenerationScheduled) return;
  regenerationScheduled = true;

  requestAnimationFrame(() => {
    regenerationScheduled = false;
    regenerateIfNeeded();
    render();
  });
}

function regenerateIfNeeded() {
  if (state.cache.voronoiDirty) {
    // Voronoi uses fixed world bounds, not view bounds
    const worldBounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    state.cache.voronoi = computeBlobCells(state.template.blobs, worldBounds);
    state.cache.voronoiDirty = false;
  }

  if (state.cache.elevationDirty && state.template.blobs.length > 0) {
    regenerateElevationTexture();
  }

  if (state.cache.derivedDirty && state.template.blobs.length > 0) {
    regenerateDerivedFeatures();
  }
}

function computeTextureBounds() {
  // Compute bounds that cover all blobs plus their radii, with margin
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

  // Add margin for coastline rendering
  const margin = 0.2;
  return {
    minX: minX - margin,
    maxX: maxX + margin,
    minZ: minZ - margin,
    maxZ: maxZ + margin
  };
}

function regenerateElevationTexture() {
  // Include hydrology on tabs 3+ if rivers exist and carving is enabled
  const includeHydrology = state.currentTab !== 'terrain' && state.currentTab !== 'noise' &&
                           state.hydrology.rivers.length > 0 && state.hydrology.config.carveEnabled;
  const world = buildWorld(includeHydrology);

  // Compute bounds from blobs
  state.cache.textureBounds = computeTextureBounds();
  const bounds = state.cache.textureBounds;

  const size = ELEVATION_TEXTURE_SIZE;

  // Create off-screen canvas if needed
  if (!state.cache.elevationCanvas) {
    state.cache.elevationCanvas = document.createElement('canvas');
    state.cache.elevationCanvas.width = size;
    state.cache.elevationCanvas.height = size;
  }

  const offCtx = state.cache.elevationCanvas.getContext('2d');
  const imageData = offCtx.createImageData(size, size);
  const data = imageData.data;

  const applyNoise = state.currentTab !== 'terrain';
  const sample = applyNoise
    ? (x, z) => sampleElevationWithNoise(world, x, z, true, includeHydrology)
    : (x, z) => sampleElevation(world, x, z);

  // Rasterize with shading
  const gradientOffset = (bounds.maxX - bounds.minX) / size;
  const lightDir = { x: -0.577, y: 0.577, z: -0.577 };

  for (let py = 0; py < size; py++) {
    const z = bounds.minZ + (py / size) * (bounds.maxZ - bounds.minZ);
    for (let px = 0; px < size; px++) {
      const x = bounds.minX + (px / size) * (bounds.maxX - bounds.minX);
      const elevation = sample(x, z);

      // Compute shading
      let shade = 1.0;
      if (elevation > 0) {
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
        shade = 0.5 + 0.5 * Math.max(0, dot);
      }

      const [r, g, b] = elevationToColor(elevation);
      const idx = (py * size + px) * 4;
      data[idx] = Math.round(r * shade);
      data[idx + 1] = Math.round(g * shade);
      data[idx + 2] = Math.round(b * shade);
      data[idx + 3] = 255;
    }
  }

  offCtx.putImageData(imageData, 0, 0);
  state.cache.elevationDirty = false;
}

function regenerateDerivedFeatures() {
  const world = buildWorld();
  // Ensure bounds are computed (elevation texture should have set them)
  if (!state.cache.textureBounds) {
    state.cache.textureBounds = computeTextureBounds();
  }
  const bounds = state.cache.textureBounds;
  const includeNoise = state.currentTab !== 'terrain';

  state.cache.coastlinePolylines = extractCoastline(world, bounds, {
    includeNoise,
    resolution: DEFAULT_COASTLINE_CONFIG.resolution,
    simplifyEpsilon: DEFAULT_COASTLINE_CONFIG.simplifyEpsilon
  });

  // Also regenerate elevation contours if enabled
  if (state.showElevationContours) {
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

  state.cache.derivedDirty = false;
}

// =============================================================================
// Canvas Setup
// =============================================================================

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlayCanvas = document.getElementById('overlay-canvas');
const overlayCtx = overlayCanvas?.getContext('2d');

function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  const rect = container ? container.getBoundingClientRect() : canvas.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  canvas.width = width;
  canvas.height = height;

  // Resize overlay canvas to match
  if (overlayCanvas) {
    overlayCanvas.width = width;
    overlayCanvas.height = height;
  }

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

function buildWorld(includeHydrology = false) {
  const world = {
    seed: state.seed,
    template: { blobs: state.template.blobs },
    defaults: state.template.defaults
  };

  // Include hydrology data if requested and available
  if (includeHydrology && state.hydrology.rivers.length > 0) {
    world.rivers = state.hydrology.rivers;
    world.hydrologyConfig = state.hydrology.config;
  }

  return world;
}

// =============================================================================
// Noise Sampling (Tab 2)
// =============================================================================

let noiseCache = {
  cacheKey: null,
  noiseFn: null
};

// Parameterized noise cache for per-blob blended parameters
const paramNoiseCache = new Map();

function getTerrainNoise(world) {
  const noiseConfig = world.defaults?.noise ?? {
    roughness: 0.3,
    featureScale: 0.2,
    octaves: 4,
    lacunarity: 2.0,
    persistence: 0.5
  };
  const cacheKey = `${world.seed}|${noiseConfig.roughness}|${noiseConfig.featureScale}|${noiseConfig.octaves}|${noiseConfig.lacunarity}|${noiseConfig.persistence}`;

  if (noiseCache.cacheKey !== cacheKey) {
    const noiseSeed = deriveSeed(world.seed, 'terrainNoise');
    const baseFn = createFBmNoise(noiseSeed, {
      octaves: noiseConfig.octaves,
      persistence: noiseConfig.persistence,
      lacunarity: noiseConfig.lacunarity,
      frequency: 1 / noiseConfig.featureScale
    });
    noiseCache.noiseFn = unipolar(baseFn);
    noiseCache.cacheKey = cacheKey;
  }

  return noiseCache.noiseFn;
}

function getTerrainNoiseForParams(seed, params) {
  const key = `${seed}|${params.featureScale.toFixed(3)}|${params.octaves}|${params.lacunarity}|${params.persistence}`;
  if (!paramNoiseCache.has(key)) {
    const fn = createFBmNoise(deriveSeed(seed, 'terrainNoise'), {
      octaves: params.octaves,
      persistence: params.persistence,
      lacunarity: params.lacunarity,
      frequency: 1 / params.featureScale
    });
    paramNoiseCache.set(key, unipolar(fn));
    // Limit cache size
    if (paramNoiseCache.size > 50) {
      paramNoiseCache.delete(paramNoiseCache.keys().next().value);
    }
  }
  return paramNoiseCache.get(key);
}

function blendNoiseParams(contributions, defaults) {
  if (contributions.length === 0) return defaults;

  let totalWeight = 0;
  let roughness = 0;
  let featureScale = 0;

  for (const c of contributions) {
    totalWeight += c.weight;
    roughness += c.weight * (c.roughness ?? defaults.roughness);
    featureScale += c.weight * (c.featureScale ?? defaults.featureScale);
  }

  return {
    roughness: roughness / totalWeight,
    featureScale: featureScale / totalWeight,
    octaves: defaults.octaves,
    lacunarity: defaults.lacunarity,
    persistence: defaults.persistence
  };
}

function sampleElevationWithNoise(world, x, z, applyNoise, includeHydrology = false) {
  // Use sampleElevation with hydrology option if requested
  const baseElevation = includeHydrology
    ? sampleElevation(world, x, z, { includeHydrology: true })
    : sampleElevation(world, x, z);

  if (!applyNoise || baseElevation <= 0) {
    return baseElevation;
  }

  if (baseElevation <= SEA_LEVEL) {
    return baseElevation;
  }

  const defaults = world.defaults?.noise ?? {
    roughness: 0.3,
    featureScale: 0.2,
    octaves: 4,
    lacunarity: 2.0,
    persistence: 0.5
  };

  // Check if any blobs have noise overrides
  const hasOverrides = world.template.blobs.some(b => b.noiseOverride);

  let noiseValue;
  let blendedRoughness;

  if (hasOverrides) {
    // Collect noise params from influencing blobs with overrides
    const contributions = [];
    for (const blob of world.template.blobs) {
      const influence = evaluateBlobInfluence(blob, x, z);
      if (influence && influence.weight > 0) {
        const params = blob.noiseOverride ?? defaults;
        contributions.push({
          weight: influence.weight,
          roughness: params.roughness,
          featureScale: params.featureScale
        });
      }
    }

    // Blend noise parameters by weight
    const blended = blendNoiseParams(contributions, defaults);
    blendedRoughness = blended.roughness;

    // Sample with blended params
    const noiseFn = getTerrainNoiseForParams(world.seed, blended);
    noiseValue = noiseFn(x, z);
  } else {
    // No overrides - use global noise function (faster path)
    const noiseFn = getTerrainNoise(world);
    noiseValue = noiseFn(x, z);
    blendedRoughness = defaults.roughness;
  }

  const landHeight = baseElevation - SEA_LEVEL;
  const amplitude = blendedRoughness * 0.15;
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

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Regenerate cached data if dirty
  regenerateIfNeeded();

  drawOceanFill();
  drawLandElevation();

  if (state.showElevationContours) {
    drawElevationContours();
  }

  drawCoastlinePolygons();

  if (state.currentTab === 'hydrology') {
    drawFlowGrid();
  }

  // Draw water features if enabled
  if (state.showWater) {
    if (state.currentTab === 'hydrology' || state.currentTab === 'climate' ||
        state.currentTab === 'zones' || state.currentTab === 'content') {
      drawLakes();
      drawRivers();
    }

    if (state.currentTab === 'hydrology') {
      drawWaterSources();
    }
  }

  // Draw flow arrow preview for add-source tool
  if (state.currentTab === 'hydrology' && state.currentTool === 'add-source') {
    drawFlowArrowPreview();
  }

  if (state.showVoronoiCells) {
    drawVoronoiCells();
  }

  drawGrid();
  drawWorldBoundary();
  drawBlobs();
  drawDragPreview();
  drawCursorPreview();

  updatePropertiesPanel();
}

function drawOceanFill() {
  // Deep ocean color
  ctx.fillStyle = '#0a2540';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawLandElevation() {
  if (!state.showElevation || state.template.blobs.length === 0) return;
  if (!state.cache.elevationCanvas || !state.cache.textureBounds) return;

  // Draw cached elevation texture with view transform
  const bounds = state.cache.textureBounds;
  const topLeft = worldToCanvas(bounds.minX, bounds.minZ);
  const bottomRight = worldToCanvas(bounds.maxX, bounds.maxZ);

  ctx.drawImage(
    state.cache.elevationCanvas,
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y
  );
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
  if (!state.cache.coastlinePolylines) return;

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
  if (!state.cache.elevationContours) return;

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

  // Minor grid lines - subtle warm tan
  ctx.strokeStyle = 'rgba(180, 150, 100, 0.15)';
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

  // Major grid lines - more visible warm tan
  ctx.strokeStyle = 'rgba(180, 150, 100, 0.3)';
  ctx.lineWidth = 1;

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

  // Origin axes - bright warm accent
  ctx.strokeStyle = 'rgba(220, 180, 100, 0.5)';
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

  // Ghost radius circle - bright and visible
  ctx.beginPath();
  ctx.arc(p.x, p.y, state.toolDefaults.radius * state.view.zoom, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 180, 80, 0.8)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ghost center - solid and visible
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 180, 80, 0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawDragPreview() {
  if (!state.dragPreview) return;

  const p = worldToCanvas(state.dragPreview.x, state.dragPreview.z);
  const radiusPixels = state.dragPreview.radius * state.view.zoom;

  // Draw preview radius circle (dashed, bright)
  ctx.beginPath();
  ctx.arc(p.x, p.y, radiusPixels, 0, Math.PI * 2);
  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw preview center point
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#e94560';
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

/**
 * Show/hide/update the hydrology progress bar
 * @param {boolean} show - Whether to show the progress bar
 * @param {number} progress - Progress value 0-100
 * @param {string} text - Status text to display
 */
function updateHydrologyProgress(show, progress = 0, text = 'Computing...') {
  const container = document.getElementById('hydrology-progress');
  const fill = document.getElementById('hydrology-progress-fill');
  const textEl = document.getElementById('hydrology-progress-text');

  if (!container) return;

  container.style.display = show ? 'block' : 'none';
  if (fill) fill.style.width = `${progress}%`;
  if (textEl) textEl.textContent = text;
}

async function runHydrologySimulation() {
  if (state.template.blobs.length === 0) {
    state.hydrology.rivers = [];
    state.hydrology.lakes = [];
    state.hydrology.waterSources = [];
    state.hydrology.flowGrid = null;
    render();
    return;
  }

  // Show progress bar
  updateHydrologyProgress(true, 0, 'Initializing...');

  // Allow UI to update before heavy computation
  await new Promise(resolve => setTimeout(resolve, 10));

  const world = buildWorld();
  world.hydrologyConfig = state.hydrology.config;
  world.waterSources = state.hydrology.waterSources.filter(s => s.origin === 'manual');
  world.lakes = state.hydrology.lakes.filter(l => l.origin === 'manual');

  const bounds = calculateTerrainBounds();

  try {
    updateHydrologyProgress(true, 20, 'Sampling elevation...');
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = generateHydrology(world, { bounds });

    updateHydrologyProgress(true, 80, 'Tracing rivers...');
    await new Promise(resolve => setTimeout(resolve, 10));

    state.hydrology.rivers = result.rivers;
    state.hydrology.lakes = result.lakes;
    state.hydrology.waterSources = result.waterSources;
    state.hydrology.flowGrid = result.flowGrid;
    state.hydrology.cacheKey = getHydrologyCacheKey();

    updateHydrologyProgress(true, 100, `Done: ${result.rivers.length} rivers, ${result.lakes.length} lakes`);

    console.log(`Hydrology: ${result.rivers.length} rivers, ${result.lakes.length} lakes, ${result.waterSources.length} sources`);
  } catch (err) {
    console.error('Hydrology generation failed:', err);
    updateHydrologyProgress(true, 0, 'Error: simulation failed');
  }

  // Mark elevation as dirty since rivers may carve terrain
  if (state.hydrology.config.carveEnabled && state.hydrology.rivers.length > 0) {
    markElevationDirty();
  }

  // Hide progress bar after a short delay
  setTimeout(() => {
    updateHydrologyProgress(false);
  }, 1500);

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

  // Larger margin to ensure rivers can flow to the coast/sea
  const margin = 0.3;
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

/**
 * Trace a preview river path from a starting position (for hover preview)
 * Returns an array of vertices or null if no valid path
 */
function tracePreviewRiver(grid, startX, startZ, maxSteps = 500) {
  const cell = worldToCell(grid, startX, startZ);
  if (!isValidCell(grid, cell.cellX, cell.cellZ)) return null;

  const vertices = [];
  const visited = new Set();
  let currentIdx = cellIndex(grid, cell.cellX, cell.cellZ);
  let termination = 'coast';

  while (currentIdx !== null && !visited.has(currentIdx) && vertices.length < maxSteps) {
    visited.add(currentIdx);

    const { cellX, cellZ } = indexToCell(grid, currentIdx);
    const { x, z } = cellToWorld(grid, cellX, cellZ);
    const elevation = grid.elevation[currentIdx];

    vertices.push({ x, z, elevation });

    // Stop at sea level
    if (elevation <= 0.1) {
      termination = 'coast';
      break;
    }

    // Get downstream cell
    const flowDir = grid.flowDirection[currentIdx];
    if (flowDir === 255) {
      termination = 'basin';
      break;
    }

    const dir = D8_DIRECTIONS[flowDir];
    const nx = cellX + dir.dx;
    const nz = cellZ + dir.dz;

    if (!isValidCell(grid, nx, nz)) {
      termination = 'boundary';
      break;
    }

    currentIdx = cellIndex(grid, nx, nz);
  }

  return { vertices, termination };
}

/**
 * Draw flow direction arrow preview under cursor when placing water sources
 * Shows the full predicted river path and potential lake location
 */
function drawFlowArrowPreview() {
  if (state.isPanning || state.isDragging) return;

  const grid = state.hydrology.flowGrid;
  if (!grid) return;

  const { x: worldX, z: worldZ } = canvasToWorld(state.mousePos.x, state.mousePos.y);
  const cell = worldToCell(grid, worldX, worldZ);

  if (!isValidCell(grid, cell.cellX, cell.cellZ)) return;

  const idx = cellIndex(grid, cell.cellX, cell.cellZ);
  const flowDir = grid.flowDirection[idx];

  // Trace the full preview river path
  const preview = tracePreviewRiver(grid, worldX, worldZ);

  if (preview && preview.vertices.length >= 2) {
    // Draw the preview river path
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    const firstP = worldToCanvas(preview.vertices[0].x, preview.vertices[0].z);
    ctx.moveTo(firstP.x, firstP.y);

    for (let i = 1; i < preview.vertices.length; i++) {
      const p = worldToCanvas(preview.vertices[i].x, preview.vertices[i].z);
      ctx.lineTo(p.x, p.y);
    }

    ctx.strokeStyle = 'rgba(64, 164, 223, 0.4)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // If river terminates in a basin, show lake indicator
    if (preview.termination === 'basin' && preview.vertices.length > 0) {
      const lastV = preview.vertices[preview.vertices.length - 1];
      const lakeP = worldToCanvas(lastV.x, lastV.z);

      // Draw lake indicator circle
      ctx.beginPath();
      ctx.arc(lakeP.x, lakeP.y, 15, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(64, 164, 223, 0.3)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(64, 164, 223, 0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 2]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Lake label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('lake', lakeP.x, lakeP.y + 4);
    }
  }

  // Draw source preview circle at cursor
  const p = worldToCanvas(worldX, worldZ);
  ctx.beginPath();
  ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(64, 164, 223, 0.6)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw flow direction arrow if there's a valid flow direction (not sink)
  if (flowDir !== 255) {
    const dir = D8_DIRECTIONS[flowDir];
    const arrowLength = 25;
    const arrowHeadSize = 8;

    // Arrow direction (normalized)
    const dx = dir.dx;
    const dz = dir.dz;
    const len = Math.sqrt(dx * dx + dz * dz);
    const nx = dx / len;
    const nz = dz / len;

    // Arrow end point
    const endX = p.x + nx * arrowLength;
    const endY = p.y + nz * arrowLength;

    // Draw arrow line
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = 'rgba(64, 164, 223, 0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw arrow head
    const angle = Math.atan2(nz, nx);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - arrowHeadSize * Math.cos(angle - Math.PI / 6),
      endY - arrowHeadSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      endX - arrowHeadSize * Math.cos(angle + Math.PI / 6),
      endY - arrowHeadSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = 'rgba(64, 164, 223, 0.9)';
    ctx.fill();
  } else {
    // Sink indicator (water will pool here)
    ctx.fillStyle = '#fff';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('pool', p.x, p.y + 22);
  }
}

// =============================================================================
// Helper Functions for Water Sources and Blobs
// =============================================================================

/**
 * Hit test for water sources
 * @param {number} cx - Canvas X coordinate
 * @param {number} cy - Canvas Y coordinate
 * @param {number} threshold - Hit distance threshold in pixels
 * @returns {Object|null} The hit water source or null
 */
function hitTestWaterSource(cx, cy, threshold = 12) {
  const sources = state.hydrology.waterSources;
  if (!sources) return null;

  for (const source of sources) {
    const p = worldToCanvas(source.x, source.z);
    const dx = cx - p.x;
    const dy = cy - p.y;
    if (Math.sqrt(dx * dx + dy * dy) < threshold) {
      return source;
    }
  }
  return null;
}

/**
 * Delete a water source
 * @param {Object} source - The water source to delete
 */
function deleteWaterSource(source) {
  const index = state.hydrology.waterSources.indexOf(source);
  if (index !== -1) {
    state.hydrology.waterSources.splice(index, 1);
    if (state.selectedSource === source) {
      state.selectedSource = null;
    }

    // Also remove any rivers that originated from this source
    // This prevents stale carving from remaining visible
    const sourceId = source.id;
    state.hydrology.rivers = state.hydrology.rivers.filter(river => river.sourceId !== sourceId);

    // Also remove lakes created by rivers from this source
    state.hydrology.lakes = state.hydrology.lakes.filter(lake => {
      if (lake.origin === 'river_basin' && lake.inflowRiverId) {
        // Check if the inflow river was from this source
        return !lake.inflowRiverId.includes(sourceId);
      }
      return true;
    });

    // Mark elevation dirty since carving may have changed
    if (state.hydrology.config.carveEnabled) {
      markElevationDirty();
    }

    markSimulationNeeded();
    render();
  }
}

/**
 * Delete a blob and its associated water sources
 * @param {Object} blob - The blob to delete
 */
function deleteBlob(blob) {
  const index = state.template.blobs.indexOf(blob);
  if (index !== -1) {
    state.template.blobs.splice(index, 1);
    if (state.selectedBlob === blob) {
      state.selectedBlob = null;
    }
    // Also delete water sources owned by this blob
    deleteWaterSourcesForBlob(blob);
    markVoronoiDirty();
    // Mark simulation as needed since terrain changed
    if (state.hydrology.rivers.length > 0 || state.hydrology.waterSources.length > 0) {
      markSimulationNeeded();
    }
    render();
  }
}

/**
 * Delete water sources that belong to a specific blob (based on Voronoi ownership)
 * @param {Object} blob - The blob whose water sources should be deleted
 */
function deleteWaterSourcesForBlob(blob) {
  if (state.template.blobs.length === 0) {
    // If no blobs remain, delete all manual water sources
    state.hydrology.waterSources = state.hydrology.waterSources.filter(s => s.origin !== 'manual');
    return;
  }

  // Compute Voronoi cells to determine ownership
  const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  const cells = computeVoronoiCells(state.template.blobs, bounds);

  // Remove sources that were owned by the deleted blob
  state.hydrology.waterSources = state.hydrology.waterSources.filter(source => {
    if (source.origin !== 'manual') return true;
    // Check which blob's cell contains this source
    const ownerBlob = findOwnerBlob(source.x, source.z, cells, state.template.blobs);
    // Keep if owner is not the deleted blob (owner will be null if blob was deleted)
    return ownerBlob !== null && ownerBlob !== blob;
  });
}

/**
 * Find which blob owns a point based on Voronoi cells
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {Map} cells - Voronoi cells map (blobId -> polygon)
 * @param {Array} blobs - Array of blobs
 * @returns {Object|null} The owning blob or null
 */
function findOwnerBlob(x, z, cells, blobs) {
  for (const blob of blobs) {
    const polygon = cells.get(blob.id);
    if (polygon && pointInPolygon(x, z, polygon)) {
      return blob;
    }
  }
  // Fallback: find nearest blob
  return findNearestBlob(blobs, x, z);
}

/**
 * Simple point-in-polygon test
 */
function pointInPolygon(x, z, polygon) {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, zi = polygon[i].z;
    const xj = polygon[j].x, zj = polygon[j].z;

    if (((zi > z) !== (zj > z)) &&
        (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Move water sources when their owning blob moves
 * @param {Object} blob - The blob that moved
 * @param {number} oldX - Previous X position
 * @param {number} oldZ - Previous Z position
 */
function moveWaterSourcesWithBlob(blob, oldX, oldZ) {
  const dx = blob.x - oldX;
  const dz = blob.z - oldZ;

  if (dx === 0 && dz === 0) return;

  // Find manual water sources owned by this blob
  for (const source of state.hydrology.waterSources) {
    if (source.origin !== 'manual') continue;

    // Check if this source is in the blob's Voronoi cell (using old position)
    // We need to check using old position since blob already moved
    const sourceRelX = source.x - dx; // Source position relative to old blob pos
    const sourceRelZ = source.z - dz;

    // Simple heuristic: if source was closer to this blob than others, move it
    const distToBlob = Math.sqrt(
      Math.pow(sourceRelX - oldX, 2) + Math.pow(sourceRelZ - oldZ, 2)
    );

    let isClosest = true;
    for (const other of state.template.blobs) {
      if (other === blob) continue;
      const distToOther = Math.sqrt(
        Math.pow(sourceRelX - other.x, 2) + Math.pow(sourceRelZ - other.z, 2)
      );
      if (distToOther < distToBlob) {
        isClosest = false;
        break;
      }
    }

    if (isClosest) {
      source.x += dx;
      source.z += dz;
    }
  }
}

// =============================================================================
// Interaction
// =============================================================================

// Flag to track if touch handler is active (to avoid duplicate handling)
let touchHandlerActive = false;

// Create touch interaction handler
// Note: The interaction module uses 'scale' but our state uses 'zoom'
// We adapt the interface here
const touchHandler = createInteractionHandler({
  canvas,
  overlayCanvas,
  getViewport: () => ({
    offsetX: state.view.offsetX,
    offsetY: state.view.offsetY,
    scale: state.view.zoom
  }),
  setViewport: (vp) => {
    state.view.offsetX = vp.offsetX;
    state.view.offsetY = vp.offsetY;
    state.view.zoom = vp.scale;
  },
  getBlobs: () => state.template.blobs,
  getCurrentTool: () => state.currentTool,
  onTap: (e) => {
    // Handle tap based on current tool
    if (state.currentTool === 'add') {
      const newBlob = createBlob(
        generateBlobId(state.template.blobs.length),
        e.worldX,
        e.worldZ,
        state.toolDefaults.elevation,
        state.toolDefaults.radius,
        state.toolDefaults.profile
      );
      state.template.blobs.push(newBlob);
      state.selectedBlob = newBlob;
      state.toolDefaults.elevation = newBlob.elevation;
      state.toolDefaults.radius = newBlob.radius;
      state.toolDefaults.profile = newBlob.profile;
      markVoronoiDirty();
      render();
    } else if (state.currentTool === 'select') {
      const hitBlob = touchHitTestCenter(state.template.blobs, state.view, e.x, e.y) ||
                      touchHitTestRadius(state.template.blobs, state.view, e.x, e.y);
      state.selectedBlob = hitBlob;
      if (hitBlob) {
        state.toolDefaults.elevation = hitBlob.elevation;
        state.toolDefaults.radius = hitBlob.radius;
        state.toolDefaults.profile = hitBlob.profile;
      }
      render();
    } else if (state.currentTool === 'delete') {
      // Check for water source hit first (on hydrology tab)
      if (state.currentTab === 'hydrology' && state.showWater) {
        const hitSource = hitTestWaterSource(e.x, e.y);
        if (hitSource) {
          deleteWaterSource(hitSource);
          return;
        }
      }
      // Then check for blob hit
      const hitBlob = touchHitTestCenter(state.template.blobs, state.view, e.x, e.y) ||
                      touchHitTestRadius(state.template.blobs, state.view, e.x, e.y);
      if (hitBlob) {
        deleteBlob(hitBlob);
      }
    } else if (state.currentTool === 'add-source') {
      const source = createManualSource(e.worldX, e.worldZ, {
        id: `source_manual_${Date.now()}`,
        flowRate: 0.5
      });
      state.hydrology.waterSources.push(source);
      state.selectedSource = source;
      markSimulationNeeded();
      render();
    }
  },
  onDragStart: ({ target, type }) => {
    state.selectedBlob = target;
    state.toolDefaults.elevation = target.elevation;
    state.toolDefaults.radius = target.radius;
    state.toolDefaults.profile = target.profile;
  },
  onDragMove: ({ target, worldX, worldZ, radius }) => {
    // During drag, we don't update the model - outline is shown on overlay
  },
  onDragEnd: ({ target, committed }) => {
    if (committed) {
      markVoronoiDirty();
      state.toolDefaults.radius = target.radius;
    }
  },
  onViewportChange: () => {
    // Viewport changed, just render
  },
  getCurrentTab: () => state.currentTab,
  getSelectedBlob: () => state.selectedBlob,
  getNoiseDefaults: () => state.template.defaults.noise,
  onNoiseAdjust: ({ blob, roughness, featureScale }) => {
    // Two-finger noise adjustment on Noise tab
    if (!blob.noiseOverride) {
      blob.noiseOverride = {};
    }
    blob.noiseOverride.roughness = roughness;
    blob.noiseOverride.featureScale = featureScale;
    paramNoiseCache.clear();
    markElevationDirty();
    updateNoiseOverrideUI();
    render();
  },
  render
});

// Attach touch handler
touchHandler.attach();
touchHandlerActive = true;

// Legacy mouse event handlers (still used for modifier keys like shift+wheel, ctrl+wheel)
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('contextmenu', onContextMenu);
canvas.addEventListener('wheel', onWheel, { passive: false });

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

    markVoronoiDirty();
    render();
  } else if (state.currentTool === 'select') {
    // Check if clicking on a blob center
    const hitBlob = hitTestBlobCenter(mouse.x, mouse.y);
    if (hitBlob) {
      state.selectedBlob = hitBlob;
      state.isDragging = true;
      // Initialize drag preview at current blob position
      state.dragPreview = { x: hitBlob.x, z: hitBlob.z, radius: hitBlob.radius };

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
        // Initialize drag preview at current blob position/radius
        state.dragPreview = { x: radiusHit.x, z: radiusHit.z, radius: radiusHit.radius };
      } else {
        state.selectedBlob = null;
      }
    }
    render();
  } else if (state.currentTool === 'delete') {
    // Check for water source hit first (on hydrology tab)
    if (state.currentTab === 'hydrology' && state.showWater) {
      const hitSource = hitTestWaterSource(mouse.x, mouse.y);
      if (hitSource) {
        deleteWaterSource(hitSource);
        return;
      }
    }
    // Then check for blob hit
    const hitBlob = hitTestBlobCenter(mouse.x, mouse.y) || hitTestBlobRadius(mouse.x, mouse.y);
    if (hitBlob) {
      deleteBlob(hitBlob);
    }
    render();
  } else if (state.currentTool === 'add-source') {
    const source = createManualSource(world.x, world.z, {
      id: `source_manual_${Date.now()}`,
      flowRate: 0.5
    });
    state.hydrology.waterSources.push(source);
    state.selectedSource = source;
    markSimulationNeeded();
    render();
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

  if (state.isDragging && state.selectedBlob && state.dragPreview) {
    // Update preview position only (don't modify blob until mouse up)
    const world = canvasToWorld(mouse.x, mouse.y);
    state.dragPreview.x = world.x;
    state.dragPreview.z = world.z;
    render();  // Fast render - just redraws outline, no elevation recompute
    return;
  }

  if (state.isDraggingRadius && state.selectedBlob && state.dragPreview) {
    // Update preview radius only (don't modify blob until mouse up)
    const world = canvasToWorld(mouse.x, mouse.y);
    const dx = world.x - state.selectedBlob.x;
    const dz = world.z - state.selectedBlob.z;
    state.dragPreview.radius = Math.max(0.05, Math.sqrt(dx * dx + dz * dz));
    render();  // Fast render - just redraws outline, no elevation recompute
    return;
  }

  // Hover detection (for select, delete, and add tools - enables shift+wheel in all modes)
  if (state.currentTool === 'select' || state.currentTool === 'delete' || state.currentTool === 'add') {
    const hitBlob = hitTestBlobCenter(mouse.x, mouse.y) || hitTestBlobRadius(mouse.x, mouse.y);
    if (hitBlob !== state.hoveredBlob) {
      state.hoveredBlob = hitBlob;
      // Only change cursor in select/delete modes, keep crosshair in add mode
      if (state.currentTool !== 'add') {
        canvas.style.cursor = hitBlob ? 'pointer' : 'default';
      }
      render();
    } else if (state.currentTool === 'add') {
      // Still need to render for cursor preview in add mode
      render();
    }
  }

  // Render for add-source mode to show flow arrow preview under cursor
  if (state.currentTool === 'add-source' && state.currentTab === 'hydrology') {
    render();
  }
}

function onMouseUp(e) {
  if (state.isPanning) {
    state.isPanning = false;
    updateCursor();
  }

  // Commit drag preview to actual blob
  if (state.isDragging && state.selectedBlob && state.dragPreview) {
    const oldX = state.selectedBlob.x;
    const oldZ = state.selectedBlob.z;
    state.selectedBlob.x = state.dragPreview.x;
    state.selectedBlob.z = state.dragPreview.z;
    // Move water sources that belong to this blob
    moveWaterSourcesWithBlob(state.selectedBlob, oldX, oldZ);
    markVoronoiDirty();  // Now recompute elevation
    // Mark that hydrology needs re-simulation if we have rivers
    if (state.hydrology.rivers.length > 0 || state.hydrology.waterSources.length > 0) {
      markSimulationNeeded();
    }
  }

  if (state.isDraggingRadius && state.selectedBlob && state.dragPreview) {
    state.selectedBlob.radius = state.dragPreview.radius;
    state.toolDefaults.radius = state.dragPreview.radius;
    markElevationDirty();  // Now recompute elevation
    // Mark that hydrology needs re-simulation if we have rivers
    if (state.hydrology.rivers.length > 0 || state.hydrology.waterSources.length > 0) {
      markSimulationNeeded();
    }
  }

  state.isDragging = false;
  state.isDraggingRadius = false;
  state.dragPreview = null;
  render();
}

function onContextMenu(e) {
  e.preventDefault();
}

function onKeyDown(e) {
  // Don't handle keys when an input element is focused
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
    return;
  }

  if (e.key === 'Escape') {
    state.selectedBlob = null;
    state.hoveredBlob = null;
    render();
    return;
  }

  // Delete selected blob or water source with Delete or Backspace
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault(); // Prevent browser back navigation on Backspace
    // Delete selected water source if on hydrology tab
    if (state.selectedSource && state.currentTab === 'hydrology') {
      deleteWaterSource(state.selectedSource);
      return;
    }
    // Delete selected blob
    if (state.selectedBlob) {
      deleteBlob(state.selectedBlob);
    }
    return;
  }
}

document.addEventListener('keydown', onKeyDown);

function onWheel(e) {
  // Only handle modifier key wheel events here; basic zoom is handled by touch handler
  if (!e.shiftKey && !e.ctrlKey) return;

  e.preventDefault();
  const mouse = getMousePos(e);

  // Shift+wheel: adjust elevation of blob OR flow rate of water source
  if (e.shiftKey) {
    // On hydrology tab with water sources visible, check for water source first
    if (state.currentTab === 'hydrology' && state.showWater && state.hydrology.showWaterSources) {
      const hitSource = hitTestWaterSource(mouse.x, mouse.y);
      if (hitSource) {
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        hitSource.flowRate = Math.max(0.1, Math.min(1, hitSource.flowRate + delta));
        state.selectedSource = hitSource;
        markSimulationNeeded();
        render();
        return;
      }
    }

    // If hovering a blob, select it first
    if (state.hoveredBlob && state.hoveredBlob !== state.selectedBlob) {
      state.selectedBlob = state.hoveredBlob;
    }
    const blob = state.selectedBlob;
    if (blob) {
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      blob.elevation = Math.max(0, Math.min(1, blob.elevation + delta));
      state.toolDefaults.elevation = blob.elevation;
      markElevationDirty();
      render();
      return;
    }
  }

  // Ctrl+wheel: adjust radius of selected or hovered blob
  if (e.ctrlKey) {
    // If hovering a blob, select it first
    if (state.hoveredBlob && state.hoveredBlob !== state.selectedBlob) {
      state.selectedBlob = state.hoveredBlob;
    }
    const blob = state.selectedBlob;
    if (blob) {
      const delta = e.deltaY > 0 ? -0.02 : 0.02;
      blob.radius = Math.max(0.05, Math.min(1, blob.radius + delta));
      state.toolDefaults.radius = blob.radius;
      markElevationDirty();
      render();
    }
  }
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
    // Tab switch may toggle noise, so invalidate elevation
    markElevationDirty();
    updateTabUI();
    render();
  });
});

function updateTabUI() {
  const noiseSettings = document.getElementById('noise-settings');
  const hydrologySettings = document.getElementById('hydrology-settings');
  const hydrologyTools = document.querySelectorAll('.hydrology-tool');

  // Show/hide noise settings panel (but don't change the warp.enabled setting)
  if (state.currentTab === 'noise') {
    noiseSettings.style.display = 'block';
    // Sync checkbox with current state
    document.getElementById('warp-enabled').checked = state.template.defaults.warp.enabled;
  } else {
    noiseSettings.style.display = 'none';
  }

  if (hydrologySettings) {
    hydrologySettings.style.display = (state.currentTab === 'hydrology') ? 'block' : 'none';
  }

  hydrologyTools.forEach(tool => {
    tool.style.display = (state.currentTab === 'hydrology') ? 'inline-flex' : 'none';
  });

  if (state.currentTab !== 'hydrology') {
    state.selectedSource = null;
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
  markElevationDirty();
  render();
});

document.getElementById('randomize').addEventListener('click', () => {
  state.seed = Math.floor(Math.random() * 100000);
  document.getElementById('seed').value = state.seed;
  markElevationDirty();
  render();
});

document.getElementById('clear-canvas').addEventListener('click', () => {
  const hasBlobs = state.template.blobs.length > 0;
  const hasWaterSources = state.hydrology.waterSources.filter(s => s.origin === 'manual').length > 0;

  if (!hasBlobs && !hasWaterSources) return;

  if (confirm('Clear all blobs and water sources? This cannot be undone.')) {
    markVoronoiDirty();
    state.template.blobs = [];
    state.selectedBlob = null;
    state.hoveredBlob = null;
    // Also clear water sources
    state.hydrology.waterSources = [];
    state.hydrology.rivers = [];
    state.hydrology.lakes = [];
    state.hydrology.flowGrid = null;
    state.selectedSource = null;
    state.hoveredSource = null;
    render();
  }
});

document.getElementById('show-elevation').addEventListener('change', (e) => {
  state.showElevation = e.target.checked;
  render();
});

document.getElementById('show-contours').addEventListener('change', (e) => {
  state.showElevationContours = e.target.checked;
  // If enabling contours and they're not cached, mark derived as dirty
  if (e.target.checked && !state.cache.elevationContours) {
    state.cache.derivedDirty = true;
  }
  render();
});

// Voronoi cells toggle
document.getElementById('show-cells')?.addEventListener('change', (e) => {
  state.showVoronoiCells = e.target.checked;
  render();
});

// Water visibility toggle
document.getElementById('show-water')?.addEventListener('change', (e) => {
  state.showWater = e.target.checked;
  render();
});

// =============================================================================
// Noise Panel Controls (Tab 2)
// =============================================================================

document.getElementById('warp-enabled').addEventListener('change', (e) => {
  state.template.defaults.warp.enabled = e.target.checked;
  noiseCache.cacheKey = null;
  markElevationDirty();
  render();
});

document.getElementById('warp-strength').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.warp.strength = value;
  document.getElementById('warp-strength-value').textContent = value.toFixed(3);
  noiseCache.cacheKey = null;
  markElevationDirty();
  render();
});

document.getElementById('warp-scale').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.warp.scale = value;
  document.getElementById('warp-scale-value').textContent = value.toFixed(3);
  noiseCache.cacheKey = null;
  markElevationDirty();
  render();
});

document.getElementById('default-roughness').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.noise.roughness = value;
  document.getElementById('default-roughness-value').textContent = value.toFixed(2);
  noiseCache.cacheKey = null;
  markElevationDirty();
  render();
});

document.getElementById('default-feature-scale').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.noise.featureScale = value;
  document.getElementById('default-feature-scale-value').textContent = value.toFixed(2);
  noiseCache.cacheKey = null;
  markElevationDirty();
  render();
});

document.getElementById('default-octaves').addEventListener('input', (e) => {
  const value = parseInt(e.target.value);
  state.template.defaults.noise.octaves = value;
  document.getElementById('default-octaves-value').textContent = value;
  noiseCache.cacheKey = null;
  paramNoiseCache.clear();
  markElevationDirty();
  render();
});

document.getElementById('default-lacunarity').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.noise.lacunarity = value;
  document.getElementById('default-lacunarity-value').textContent = value.toFixed(1);
  noiseCache.cacheKey = null;
  paramNoiseCache.clear();
  markElevationDirty();
  render();
});

document.getElementById('default-persistence').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.noise.persistence = value;
  document.getElementById('default-persistence-value').textContent = value.toFixed(2);
  noiseCache.cacheKey = null;
  paramNoiseCache.clear();
  markElevationDirty();
  render();
});

document.getElementById('micro-detail-enabled').addEventListener('change', (e) => {
  state.template.defaults.microDetail.enabled = e.target.checked;
  markElevationDirty();
  render();
});

document.getElementById('micro-detail-amplitude').addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.template.defaults.microDetail.amplitude = value;
  document.getElementById('micro-detail-amplitude-value').textContent = value.toFixed(3);
  markElevationDirty();
  render();
});

// =============================================================================
// Hydrology Panel Controls (Tab 3)
// =============================================================================

document.getElementById('carve-factor')?.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  state.hydrology.config.carveFactor = value;
  document.getElementById('carve-factor-value').textContent = value.toFixed(3);
  state.hydrology.cacheKey = null;
  markElevationDirty(); // River carving affects elevation
  render();
});

document.getElementById('show-flow-grid')?.addEventListener('change', (e) => {
  state.hydrology.showFlowGrid = e.target.checked;
  render();
});

document.getElementById('simulate-water')?.addEventListener('click', () => {
  runHydrologySimulation();
  state.hydrology.simulationNeeded = false;
  updateSimulateButtonState();
});

document.getElementById('tool-add-source')?.addEventListener('click', () => {
  document.querySelector('.tool.active')?.classList.remove('active');
  document.getElementById('tool-add-source').classList.add('active');
  state.currentTool = 'add-source';
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
    markElevationDirty();
    render();
  }
});

propRadius?.addEventListener('input', (e) => {
  if (state.selectedBlob) {
    const value = parseFloat(e.target.value);
    state.selectedBlob.radius = value;
    state.toolDefaults.radius = value;
    propRadiusValue.textContent = value.toFixed(2);
    markElevationDirty();
    render();
  }
});

propProfile?.addEventListener('change', (e) => {
  if (state.selectedBlob) {
    state.selectedBlob.profile = e.target.value;
    state.toolDefaults.profile = e.target.value;
    markElevationDirty();
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

  // Hide blob properties entirely on hydrology tab
  const isHydrologyTab = state.currentTab === 'hydrology';

  if (state.selectedBlob && !isHydrologyTab) {
    noSelection.style.display = 'none';
    blobProps.style.display = 'block';
    if (toolProps) toolProps.style.display = 'none';

    propElevation.value = state.selectedBlob.elevation;
    propElevationValue.textContent = state.selectedBlob.elevation.toFixed(2);
    propRadius.value = state.selectedBlob.radius;
    propRadiusValue.textContent = state.selectedBlob.radius.toFixed(2);
    propProfile.value = state.selectedBlob.profile;

  } else {
    blobProps.style.display = 'none';

    // On hydrology tab, hide the "no selection" and tool props too
    if (isHydrologyTab) {
      noSelection.style.display = 'none';
      if (toolProps) toolProps.style.display = 'none';
    } else {
      noSelection.style.display = 'block';
      if (toolProps) toolProps.style.display = 'block';
    }
  }

  // Update tool defaults UI (only relevant on non-hydrology tabs)
  if (!isHydrologyTab) {
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
  document.getElementById('default-octaves').value = noise.octaves;
  document.getElementById('default-octaves-value').textContent = noise.octaves;
  document.getElementById('default-lacunarity').value = noise.lacunarity;
  document.getElementById('default-lacunarity-value').textContent = noise.lacunarity.toFixed(1);
  document.getElementById('default-persistence').value = noise.persistence;
  document.getElementById('default-persistence-value').textContent = noise.persistence.toFixed(2);

  document.getElementById('micro-detail-enabled').checked = microDetail.enabled;
  document.getElementById('micro-detail-amplitude').value = microDetail.amplitude;
  document.getElementById('micro-detail-amplitude-value').textContent = microDetail.amplitude.toFixed(3);
}

resizeCanvas();
syncNoisePanelUI();
updateTabUI();

// =============================================================================
// Properties Panel Setup
// =============================================================================

const panelElement = document.getElementById('panel');
const panelToggle = document.getElementById('panel-toggle');

const propertiesPanel = createPropertiesPanel({
  panel: panelElement,
  toggleButton: panelToggle,
  onToggle: (expanded) => {
    console.log('Panel', expanded ? 'expanded' : 'collapsed');
  }
});

propertiesPanel.attach();

// Update panel when selection changes
const originalUpdatePropertiesPanel = updatePropertiesPanel;
window.updatePropertiesPanel = function() {
  originalUpdatePropertiesPanel();
  propertiesPanel.updateSelection(!!state.selectedBlob);
};

console.log('kosmos-gen editor initialized (blob mode with touch support)');
