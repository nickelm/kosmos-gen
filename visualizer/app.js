/**
 * Visualizer application
 *
 * Main entry point — manages state, wires UI panels to generation pipeline,
 * and orchestrates rendering.
 */

import { generate } from '../src/generation/pipeline.js';
import { initCanvas, render } from './canvas.js';
import { getLayerRenderers, getDefaultLayerVisibility, invalidateUnderwaterCache, invalidateClimateCache, invalidateBiomesCache, invalidateRiversCache, invalidateLakesCache } from './layers/index.js';
import { invalidateElevationCache } from './layers/elevation.js';
import { invalidateCoastlineCache } from './layers/coastline.js';
import { initControls } from './ui/controls.js';
import { initStagePanel } from './ui/stage-panel.js';
import { initLayerPanel } from './ui/layer-panel.js';
import { View3D } from './view3d.js';
import { initViewToggle } from './ui/view-toggle.js';
import { initView3DControls } from './ui/view3d-controls.js';
import { initTerrainParams } from './ui/terrain-params.js';

// =============================================================================
// State
// =============================================================================

const state = {
  seed: 42,
  archetype: null, // null = random selection from seed
  currentStage: 'biomes',
  generatedData: null,
  layers: getDefaultLayerVisibility(),
  generating: false,
  viewMode: '2d',
  terrainOverrides: null,
};

// =============================================================================
// Canvas
// =============================================================================

const canvas = document.getElementById('canvas');
const { ctx, resize, viewport, resetView } = initCanvas(canvas, () => redraw());
const layerRenderers = getLayerRenderers();

// 3D view
const view3dContainer = document.getElementById('canvas-3d');
const view3d = new View3D(view3dContainer);

function redraw() {
  render(ctx, state.generatedData, state.layers, layerRenderers, viewport);
}

// Re-render on resize
window.addEventListener('resize', () => {
  resize();
  view3d.resize();
  invalidateElevationCache();
  invalidateCoastlineCache();
  invalidateUnderwaterCache();
  invalidateClimateCache();
  invalidateBiomesCache();
  invalidateRiversCache();
  invalidateLakesCache();
  redraw();
});

// =============================================================================
// Info bar
// =============================================================================

const infoSeed = document.getElementById('info-seed');
const infoArchetype = document.getElementById('info-archetype');
const infoResolution = document.getElementById('info-resolution');
const infoTiming = document.getElementById('info-timing');

function updateInfoBar() {
  const d = state.generatedData;
  if (!d) {
    infoSeed.textContent = 'Seed: --';
    infoArchetype.textContent = 'Archetype: --';
    infoResolution.textContent = 'Resolution: --';
    infoTiming.textContent = 'Time: --';
    return;
  }

  infoSeed.textContent = `Seed: ${d.seed}`;
  infoArchetype.textContent = `Archetype: ${d.params?.archetype ?? '--'}`;

  if (d.elevation) {
    infoResolution.textContent = `Resolution: ${d.elevation.width}x${d.elevation.height}`;
  } else {
    infoResolution.textContent = 'Resolution: --';
  }

  if (d.timing?.total !== undefined) {
    infoTiming.textContent = `Time: ${d.timing.total.toFixed(1)}ms`;
  } else {
    infoTiming.textContent = 'Time: --';
  }
}

// =============================================================================
// Generation
// =============================================================================

let stagePanel = null;

function doGenerate(seed) {
  state.seed = seed;
  state.generating = true;
  controls.setGenerating(true);

  // Use requestAnimationFrame to let UI update before heavy work
  requestAnimationFrame(() => {
    try {
      const result = generate(seed, {
        resolution: 512,
        upToStage: state.currentStage,
        archetype: state.archetype || undefined,
        terrainOverrides: state.terrainOverrides || undefined,
      });

      state.generatedData = result;

      // Reset view when generating new terrain
      resetView();

      invalidateElevationCache();
      invalidateCoastlineCache();
      invalidateUnderwaterCache();
      invalidateClimateCache();
      invalidateBiomesCache();
      invalidateRiversCache();
      invalidateLakesCache();
      redraw();
      updateInfoBar();

      // Update 3D view
      if (state.viewMode === '3d' && result.elevation) {
        view3d.updateTerrain(result.elevation, result.biomes, result.params, result.hydrology);
      }

      if (stagePanel) {
        stagePanel.updateTiming(result.timing);
      }
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      state.generating = false;
      controls.setGenerating(false);
    }
  });
}

// =============================================================================
// UI Panels
// =============================================================================

const controls = initControls(document.getElementById('controls'), {
  getSeed: () => state.seed,
  setSeed: (s) => { state.seed = s; },
  getArchetype: () => state.archetype,
  setArchetype: (a) => { state.archetype = a; },
  onGenerate: doGenerate,
});

stagePanel = initStagePanel(document.getElementById('stage-panel'), {
  getCurrentStage: () => state.currentStage,
  onStageChange: (stage) => {
    state.currentStage = stage;
    if (state.seed !== undefined) {
      doGenerate(state.seed);
    }
  },
});

const layerSection = document.getElementById('layer-panel').closest('.sidebar-section');

initLayerPanel(document.getElementById('layer-panel'), {
  getLayerVisibility: () => state.layers,
  onToggleLayer: (name, visible) => {
    state.layers[name] = visible;
    redraw();
  },
});

// 3D controls
const view3dControls = initView3DControls(document.getElementById('view3d-controls'), {
  onHeightScaleChange: (scale) => { view3d.setBaseHeightScale(scale); },
  onWaterToggle: (visible) => { view3d.setWaterVisible(visible); },
  onWireframeToggle: (enabled) => { view3d.setWireframe(enabled); },
});

// Terrain parameter sliders
initTerrainParams(document.getElementById('terrain-params'), {
  getOverrides: () => state.terrainOverrides,
  setOverrides: (o) => { state.terrainOverrides = o; },
  onChanged: () => {
    if (state.seed !== undefined) {
      doGenerate(state.seed);
    }
  },
});

// View toggle (2D / 3D)
initViewToggle(document.getElementById('controls'), {
  onToggle: (mode) => {
    state.viewMode = mode;
    if (mode === '3d') {
      canvas.style.display = 'none';
      view3dContainer.style.display = 'block';
      view3d.setVisible(true);
      view3d.resize();
      layerSection.style.display = 'none';
      view3dControls.show();
      if (state.generatedData && state.generatedData.elevation) {
        view3d.updateTerrain(
          state.generatedData.elevation,
          state.generatedData.biomes,
          state.generatedData.params,
          state.generatedData.hydrology,
        );
      }
    } else {
      canvas.style.display = '';
      view3dContainer.style.display = 'none';
      view3d.setVisible(false);
      layerSection.style.display = '';
      view3dControls.hide();
      redraw();
    }
  },
});

// =============================================================================
// Initial generation
// =============================================================================

doGenerate(state.seed);
