/**
 * Textures tab — interactive texture generator with Three.js preview.
 *
 * Controls: preset selector, noise sliders, palette editor,
 * resolution, biome tint, view toggle, export.
 *
 * Preview: tiled flat view (3x3) or heightfield view (32x32 mesh).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TEXTURE_PRESETS, BIOME_TINTS, samplePalette } from '@/textures/palettes.js';
import { generateTexture } from '@/textures/texturegen.js';
import { generateNoiseField } from '@/textures/noisegen.js';
import { downloadTexturePng, downloadAllTextures } from '@/textures/exporter.js';
import { deriveSeed } from '@/core/seeds.js';

// =============================================================================
// Voxel preview constants
// =============================================================================

/** Face definitions: direction normal + 4 vertex offsets (CCW winding). */
const VOXEL_FACES = {
  top:    { dir: [0, 1, 0],  verts: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
  bottom: { dir: [0,-1, 0],  verts: [[0,0,1],[1,0,1],[1,0,0],[0,0,0]] },
  north:  { dir: [0, 0,-1],  verts: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] },
  south:  { dir: [0, 0, 1],  verts: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
  east:   { dir: [1, 0, 0],  verts: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]] },
  west:   { dir: [-1,0, 0],  verts: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
};

/**
 * AO neighbor offsets per face, per vertex.
 * For each vertex: [side1, corner, side2] relative to the block position.
 */
const VOXEL_FACE_AO = {
  top: [
    [[-1,1,0],[-1,1,-1],[0,1,-1]],
    [[-1,1,0],[-1,1,1],[0,1,1]],
    [[1,1,0],[1,1,1],[0,1,1]],
    [[1,1,0],[1,1,-1],[0,1,-1]],
  ],
  bottom: [
    [[0,-1,1],[-1,-1,1],[-1,-1,0]],
    [[0,-1,1],[1,-1,1],[1,-1,0]],
    [[0,-1,-1],[1,-1,-1],[1,-1,0]],
    [[0,-1,-1],[-1,-1,-1],[-1,-1,0]],
  ],
  north: [
    [[1,0,-1],[1,-1,-1],[0,-1,-1]],
    [[-1,0,-1],[-1,-1,-1],[0,-1,-1]],
    [[-1,0,-1],[-1,1,-1],[0,1,-1]],
    [[1,0,-1],[1,1,-1],[0,1,-1]],
  ],
  south: [
    [[-1,0,1],[-1,-1,1],[0,-1,1]],
    [[1,0,1],[1,-1,1],[0,-1,1]],
    [[1,0,1],[1,1,1],[0,1,1]],
    [[-1,0,1],[-1,1,1],[0,1,1]],
  ],
  east: [
    [[1,0,1],[1,-1,1],[1,-1,0]],
    [[1,0,-1],[1,-1,-1],[1,-1,0]],
    [[1,0,-1],[1,1,-1],[1,1,0]],
    [[1,0,1],[1,1,1],[1,1,0]],
  ],
  west: [
    [[-1,0,-1],[-1,-1,-1],[-1,-1,0]],
    [[-1,0,1],[-1,-1,1],[-1,-1,0]],
    [[-1,0,1],[-1,1,1],[-1,1,0]],
    [[-1,0,-1],[-1,1,-1],[-1,1,0]],
  ],
};

const VOXEL_GRID = 6;

/**
 * Generate a 6×6 integer heightmap (heights 1-4) for voxel preview.
 */
function generateVoxelHeightmap(seed) {
  const hfSeed = deriveSeed(seed, 'voxelpreview');
  const field = generateNoiseField({
    width: VOXEL_GRID,
    height: VOXEL_GRID,
    octaves: 2,
    frequency: 1.5,
    amplitude: 1.0,
    lacunarity: 2.0,
    persistence: 0.5,
    seed: hfSeed,
  });
  const heights = new Uint8Array(VOXEL_GRID * VOXEL_GRID);
  for (let i = 0; i < VOXEL_GRID * VOXEL_GRID; i++) {
    heights[i] = Math.floor(field[i] * 3.99) + 1;
  }
  return { heights, gridSize: VOXEL_GRID };
}

/**
 * Build a BufferGeometry for the voxel preview mesh.
 * Top faces use vertex color 1.0, side/bottom faces use 0.7.
 * Vertex AO darkens concave edges.
 */
function buildVoxelGeometry(heights, gridSize) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];

  function getHeight(gx, gz) {
    if (gx < 0 || gx >= gridSize || gz < 0 || gz >= gridSize) return 0;
    return heights[gz * gridSize + gx];
  }

  function isSolid(gx, y, gz) {
    if (y < 0) return true;
    return y < getHeight(gx, gz);
  }

  const offsetX = -gridSize / 2;
  const offsetZ = -gridSize / 2;
  const faceEntries = Object.entries(VOXEL_FACES);

  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const h = getHeight(gx, gz);
      for (let y = 0; y < h; y++) {
        for (const [faceName, face] of faceEntries) {
          const [nx, ny, nz] = face.dir;
          if (isSolid(gx + nx, y + ny, gz + nz)) continue;

          const isTop = faceName === 'top';
          const baseBrightness = isTop ? 1.0 : 0.7;
          const baseVertex = positions.length / 3;
          const aoNeighbors = VOXEL_FACE_AO[faceName];

          for (let i = 0; i < 4; i++) {
            const [vx, vy, vz] = face.verts[i];
            positions.push(gx + vx + offsetX, y + vy, gz + vz + offsetZ);
            normals.push(nx, ny, nz);

            const u = (i === 0 || i === 3) ? 0 : 1;
            const v = (i === 0 || i === 1) ? 0 : 1;
            uvs.push(u, v);

            // AO: check 3 neighbor positions
            const [s1Off, cOff, s2Off] = aoNeighbors[i];
            const s1 = isSolid(gx + s1Off[0], y + s1Off[1], gz + s1Off[2]) ? 1 : 0;
            const corner = isSolid(gx + cOff[0], y + cOff[1], gz + cOff[2]) ? 1 : 0;
            const s2 = isSolid(gx + s2Off[0], y + s2Off[1], gz + s2Off[2]) ? 1 : 0;
            const ao = (s1 && s2) ? 0 : 3 - (s1 + s2 + corner);
            const aoValue = 0.5 + ao * 0.125;

            const brightness = baseBrightness * aoValue;
            colors.push(brightness, brightness, brightness);
          }

          indices.push(baseVertex, baseVertex + 1, baseVertex + 2);
          indices.push(baseVertex, baseVertex + 2, baseVertex + 3);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

// =============================================================================
// UI constants
// =============================================================================

const NOISE_SLIDERS = [
  { key: 'octaves',     label: 'Octaves',     min: 1,   max: 4,   step: 1,    default: 2 },
  { key: 'frequency',   label: 'Frequency',   min: 0.5, max: 8.0, step: 0.1,  default: 3.0 },
  { key: 'amplitude',   label: 'Amplitude',   min: 0.0, max: 1.0, step: 0.01, default: 0.8 },
  { key: 'lacunarity',  label: 'Lacunarity',  min: 1.5, max: 3.0, step: 0.1,  default: 2.0 },
  { key: 'persistence', label: 'Persistence', min: 0.3, max: 0.7, step: 0.01, default: 0.5 },
];

const RESOLUTIONS = [64, 128, 256];
const PRESET_KEYS = Object.keys(TEXTURE_PRESETS);
const BIOME_KEYS = Object.keys(BIOME_TINTS);

/**
 * Initialize the textures tab.
 * @param {HTMLElement} container
 * @returns {{ dispose: () => void }}
 */
export function initTexturesTab(container) {
  // --- State ---
  const state = {
    preset: 'grass',
    noiseParams: { ...TEXTURE_PRESETS.grass.layers[0], amplitude: TEXTURE_PRESETS.grass.layers[0].amplitude ?? 0.8, lacunarity: TEXTURE_PRESETS.grass.layers[0].lacunarity ?? 2.0 },
    palette: deepCopyStops(TEXTURE_PRESETS.grass.stops),
    resolution: 128,
    biomeTint: null,
    biomeTintName: 'none',
    viewMode: 'tiled',
    seed: 42,
    currentTexture: null,
    // Per-preset customizations: { [presetKey]: { noiseParams, palette } }
    customizations: {},
  };

  // --- DOM Structure ---
  const layout = el('div', 'tab-layout');
  const sidebar = el('div', 'sidebar');
  const viewport = el('div', 'viewport');
  layout.appendChild(sidebar);
  layout.appendChild(viewport);
  container.appendChild(layout);

  // --- Sidebar Sections ---
  buildPresetSection(sidebar, state);
  buildSeedSection(sidebar, state);
  buildNoiseSection(sidebar, state);
  buildPaletteSection(sidebar, state);
  buildResolutionSection(sidebar, state);
  buildBiomeTintSection(sidebar, state);
  buildViewToggle(sidebar, state);
  buildExportSection(sidebar, state);

  // --- Three.js Viewport ---
  const threeState = initThreeViewport(viewport);

  // --- Regeneration ---
  let debounceTimer = null;

  function scheduleRegenerate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(regenerate, 80);
  }

  function regenerate() {
    const tint = state.biomeTint;
    const tex = generateTexture({
      preset: state.preset,
      width: state.resolution,
      height: state.resolution,
      seed: state.seed,
      noiseOverrides: { ...state.noiseParams },
      paletteOverrides: state.palette,
      tint,
    });
    state.currentTexture = tex;
    updateThreeTexture(threeState, tex, state);
  }

  // Wire up regeneration callback
  state.onChanged = scheduleRegenerate;

  // Initial generation
  regenerate();

  // --- Dispose ---
  return {
    dispose() {
      clearTimeout(debounceTimer);
      disposeThree(threeState);
    },
  };
}

// =============================================================================
// Sidebar builders
// =============================================================================

function buildPresetSection(sidebar, state) {
  const section = sidebarSection(sidebar, 'Preset');
  const row = el('div', 'control-row');
  const label = el('label');
  label.textContent = 'Texture';
  const select = el('select');
  for (const key of PRESET_KEYS) {
    const opt = el('option');
    opt.value = key;
    opt.textContent = TEXTURE_PRESETS[key].name;
    select.appendChild(opt);
  }
  select.value = state.preset;
  select.addEventListener('change', () => {
    // Save current preset's customizations before switching
    saveCustomizations(state);
    state.preset = select.value;
    // Restore saved customizations or use preset defaults
    restoreCustomizations(state);
    // Refresh slider and palette UI
    if (state._refreshSliders) state._refreshSliders();
    if (state._refreshPalette) state._refreshPalette();
    state.onChanged();
  });
  row.appendChild(label);
  row.appendChild(select);
  section.appendChild(row);
}

function buildSeedSection(sidebar, state) {
  const section = sidebarSection(sidebar, 'Seed');
  const row = el('div', 'control-row');
  const label = el('label');
  label.textContent = 'Seed';
  const input = el('input');
  input.type = 'number';
  input.min = 0;
  input.max = 99999;
  input.value = state.seed;
  input.addEventListener('input', () => {
    state.seed = Number(input.value) || 0;
    state.onChanged();
  });
  const randBtn = el('button', 'btn btn-secondary');
  randBtn.textContent = 'Random';
  randBtn.style.flexShrink = '0';
  randBtn.addEventListener('click', () => {
    state.seed = Math.floor(Math.random() * 100000);
    input.value = state.seed;
    state.onChanged();
  });
  row.appendChild(label);
  row.appendChild(input);
  row.appendChild(randBtn);
  section.appendChild(row);
}

function buildNoiseSection(sidebar, state) {
  const section = sidebarSection(sidebar, 'Noise Parameters');
  const sliderEls = {};
  const valueEls = {};

  for (const def of NOISE_SLIDERS) {
    const row = el('div', 'control-row');
    const label = el('label');
    label.textContent = def.label;

    const slider = el('input');
    slider.type = 'range';
    slider.min = def.min;
    slider.max = def.max;
    slider.step = def.step;
    slider.value = state.noiseParams[def.key] ?? def.default;

    const valueSpan = el('span', 'slider-value');
    valueSpan.textContent = formatValue(slider.value, def.step);

    slider.addEventListener('input', () => {
      const val = Number(slider.value);
      valueSpan.textContent = formatValue(val, def.step);
      state.noiseParams[def.key] = val;
      state.onChanged();
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(valueSpan);
    section.appendChild(row);

    sliderEls[def.key] = slider;
    valueEls[def.key] = valueSpan;
  }

  // Allow preset selector to refresh sliders
  state._refreshSliders = () => {
    for (const def of NOISE_SLIDERS) {
      const val = state.noiseParams[def.key] ?? def.default;
      sliderEls[def.key].value = val;
      valueEls[def.key].textContent = formatValue(val, def.step);
    }
  };
}

function buildPaletteSection(sidebar, state) {
  const section = sidebarSection(sidebar, 'Palette');

  // Gradient preview canvas
  const barCanvas = el('canvas', 'palette-bar');
  barCanvas.height = 24;
  section.appendChild(barCanvas);

  // Stop controls container
  const stopsContainer = el('div', 'palette-stops');
  section.appendChild(stopsContainer);

  // Add stop + Reset buttons
  const addRow = el('div', 'control-row');
  const addBtn = el('button', 'btn btn-secondary');
  addBtn.textContent = '+ Add Stop';
  addBtn.style.flex = '1';
  addBtn.addEventListener('click', () => {
    if (state.palette.length >= 5) return;
    // Insert at midpoint of largest gap
    let maxGap = 0, insertIdx = 0;
    for (let i = 0; i < state.palette.length - 1; i++) {
      const gap = state.palette[i + 1].t - state.palette[i].t;
      if (gap > maxGap) { maxGap = gap; insertIdx = i; }
    }
    const t = (state.palette[insertIdx].t + state.palette[insertIdx + 1].t) / 2;
    const color = samplePalette(t, state.palette);
    state.palette.splice(insertIdx + 1, 0, { t, color });
    refreshPalette();
    state.onChanged();
  });
  const resetBtn = el('button', 'btn btn-secondary');
  resetBtn.textContent = 'Reset';
  resetBtn.style.flexShrink = '0';
  resetBtn.addEventListener('click', () => {
    const preset = TEXTURE_PRESETS[state.preset];
    state.palette = deepCopyStops(preset.stops);
    refreshPalette();
    state.onChanged();
  });
  addRow.appendChild(addBtn);
  addRow.appendChild(resetBtn);
  section.appendChild(addRow);

  function refreshGradientBar() {
    const w = barCanvas.clientWidth || 250;
    barCanvas.width = w;
    const ctx = barCanvas.getContext('2d');
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      const c = samplePalette(t, state.palette);
      ctx.fillStyle = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
      ctx.fillRect(x, 0, 1, 24);
    }
  }

  function refreshPalette() {
    refreshGradientBar();

    // Rebuild stop controls
    stopsContainer.innerHTML = '';
    state.palette.forEach((stop, i) => {
      const stopEl = el('div', 'palette-stop');

      const colorInput = el('input');
      colorInput.type = 'color';
      colorInput.value = rgbToHex(stop.color);
      colorInput.addEventListener('input', () => {
        stop.color = hexToRgb(colorInput.value);
        refreshGradientBar();
        state.onChanged();
      });

      const tLabel = el('span');
      tLabel.textContent = stop.t.toFixed(2);
      tLabel.style.fontSize = '10px';
      tLabel.style.color = '#666';

      stopEl.appendChild(colorInput);
      stopEl.appendChild(tLabel);

      // Remove button (only if > 2 stops)
      if (state.palette.length > 2) {
        const removeBtn = el('button', 'remove-stop');
        removeBtn.textContent = '\u00d7';
        removeBtn.addEventListener('click', () => {
          state.palette.splice(i, 1);
          refreshPalette();
          state.onChanged();
        });
        stopEl.appendChild(removeBtn);
      }

      stopsContainer.appendChild(stopEl);
    });
  }

  state._refreshPalette = refreshPalette;

  // Initial render (defer to next frame so layout is computed)
  requestAnimationFrame(refreshPalette);
}

function buildResolutionSection(sidebar, state) {
  const section = sidebarSection(sidebar, 'Resolution');
  const row = el('div', 'control-row');
  const label = el('label');
  label.textContent = 'Size';
  const select = el('select');
  for (const res of RESOLUTIONS) {
    const opt = el('option');
    opt.value = res;
    opt.textContent = `${res} \u00d7 ${res}`;
    select.appendChild(opt);
  }
  select.value = state.resolution;
  select.addEventListener('change', () => {
    state.resolution = Number(select.value);
    state.onChanged();
  });
  row.appendChild(label);
  row.appendChild(select);
  section.appendChild(row);
}

function buildBiomeTintSection(sidebar, state) {
  const section = sidebarSection(sidebar, 'Biome Tint Preview');
  const row = el('div', 'control-row');
  const label = el('label');
  label.textContent = 'Biome';
  const select = el('select');
  const noneOpt = el('option');
  noneOpt.value = 'none';
  noneOpt.textContent = 'None (raw)';
  select.appendChild(noneOpt);
  for (const key of BIOME_KEYS) {
    const opt = el('option');
    opt.value = key;
    opt.textContent = key.replace(/_/g, ' ');
    select.appendChild(opt);
  }
  select.value = state.biomeTintName;
  select.addEventListener('change', () => {
    state.biomeTintName = select.value;
    state.biomeTint = select.value === 'none' ? null : BIOME_TINTS[select.value];
    state.onChanged();
  });
  row.appendChild(label);
  row.appendChild(select);
  section.appendChild(row);
}

function buildViewToggle(sidebar, state) {
  const section = sidebarSection(sidebar, 'Preview');
  const toggle = el('div', 'view-toggle');

  const modes = [
    { mode: 'tiled',       label: 'Tiled' },
    { mode: 'heightfield', label: 'Heightfield' },
    { mode: 'voxel',       label: 'Voxel' },
  ];
  const btnEls = [];

  for (const { mode, label } of modes) {
    const btn = el('button');
    btn.textContent = label;
    if (state.viewMode === mode) btn.classList.add('active');

    btn.addEventListener('click', () => {
      if (state.viewMode === mode) return;
      state.viewMode = mode;
      btnEls.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.onChanged();
    });

    toggle.appendChild(btn);
    btnEls.push(btn);
  }

  section.appendChild(toggle);
}

function buildExportSection(sidebar, state) {
  const section = sidebarSection(sidebar, 'Export');
  const row = el('div', 'button-row');

  const exportBtn = el('button', 'btn btn-primary');
  exportBtn.textContent = 'Export PNG';
  exportBtn.addEventListener('click', () => {
    if (!state.currentTexture) return;
    const { pixels, width, height } = state.currentTexture;
    downloadTexturePng(pixels, width, height, `${state.preset}.png`);
  });

  const exportAllBtn = el('button', 'btn btn-secondary');
  exportAllBtn.textContent = 'Export All';
  exportAllBtn.addEventListener('click', () => {
    // Save current preset's customizations first
    saveCustomizations(state);
    // Generate each preset with its stored customizations
    const textures = {};
    for (const key of PRESET_KEYS) {
      const custom = state.customizations[key];
      textures[key] = generateTexture({
        preset: key,
        width: state.resolution,
        height: state.resolution,
        seed: state.seed,
        noiseOverrides: custom ? { ...custom.noiseParams } : undefined,
        paletteOverrides: custom ? deepCopyStops(custom.palette) : undefined,
      });
    }
    downloadAllTextures(textures);
  });

  row.appendChild(exportBtn);
  row.appendChild(exportAllBtn);
  section.appendChild(row);
}

// =============================================================================
// Three.js viewport
// =============================================================================

function initThreeViewport(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0a0a1a);

  const w = container.clientWidth || 1;
  const h = container.clientHeight || 1;
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
  camera.position.set(0, 2.5, 2.5);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(3, 5, 4);
  scene.add(dirLight);

  // Meshes
  const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });

  // Tiled plane
  const tiledGeo = new THREE.PlaneGeometry(3, 3);
  tiledGeo.rotateX(-Math.PI / 2);
  const tiledMesh = new THREE.Mesh(tiledGeo, material);
  scene.add(tiledMesh);

  // Heightfield plane (hidden initially)
  const hfGeo = new THREE.PlaneGeometry(3, 3, 63, 63);
  hfGeo.rotateX(-Math.PI / 2);
  const hfMesh = new THREE.Mesh(hfGeo, material.clone());
  hfMesh.visible = false;
  scene.add(hfMesh);

  // Voxel preview mesh (hidden initially)
  const voxelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const initialHm = generateVoxelHeightmap(42);
  const voxelGeo = buildVoxelGeometry(initialHm.heights, initialHm.gridSize);
  const voxelMesh = new THREE.Mesh(voxelGeo, voxelMaterial);
  voxelMesh.scale.setScalar(0.5);
  voxelMesh.visible = false;
  scene.add(voxelMesh);

  // Animation loop
  let animId = null;
  function animate() {
    animId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // Handle resize
  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  });
  resizeObserver.observe(container);

  return {
    renderer, camera, controls, scene,
    material, tiledMesh, hfMesh, hfGeo,
    voxelMesh, voxelMaterial, voxelSeed: 42,
    animId, resizeObserver,
    currentTexture: null,
  };
}

function updateThreeTexture(ts, texData, state) {
  const { pixels, width, height } = texData;

  // Create DataTexture
  const data = new Uint8Array(pixels.buffer.slice(0));
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;

  if (state.viewMode === 'tiled') {
    // Tiled: wrap and repeat 3x3
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);

    ts.tiledMesh.material.map = texture;
    ts.tiledMesh.material.needsUpdate = true;
    ts.tiledMesh.visible = true;
    ts.hfMesh.visible = false;
    ts.voxelMesh.visible = false;
  } else if (state.viewMode === 'heightfield') {
    // Heightfield: tile 3x3 like the flat view
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);

    ts.hfMesh.material.map = texture;
    ts.hfMesh.material.needsUpdate = true;
    ts.hfMesh.visible = true;
    ts.tiledMesh.visible = false;
    ts.voxelMesh.visible = false;

    // Displace vertices with a separate heightmap
    const hfSeed = deriveSeed(state.seed, 'heightfield');
    const heightmap = generateNoiseField({
      width: 64,
      height: 64,
      octaves: 3,
      frequency: 3.0,
      amplitude: 1.0,
      lacunarity: 2.0,
      persistence: 0.5,
      seed: hfSeed,
    });

    const positions = ts.hfGeo.attributes.position;
    const gridSize = 64; // 64x64 segments = 65x65 vertices
    for (let iy = 0; iy <= gridSize; iy++) {
      for (let ix = 0; ix <= gridSize; ix++) {
        const vi = iy * (gridSize + 1) + ix;
        // Sample heightmap (wrap for edge vertices)
        const hx = ix % gridSize;
        const hy = iy % gridSize;
        const h = heightmap[hy * gridSize + hx];
        positions.setY(vi, h * 0.5);
      }
    }
    positions.needsUpdate = true;
    ts.hfGeo.computeVertexNormals();
  } else if (state.viewMode === 'voxel') {
    // Rebuild voxel geometry if seed changed
    if (ts.voxelSeed !== state.seed) {
      ts.voxelSeed = state.seed;
      const hm = generateVoxelHeightmap(state.seed);
      const newGeo = buildVoxelGeometry(hm.heights, hm.gridSize);
      ts.voxelMesh.geometry.dispose();
      ts.voxelMesh.geometry = newGeo;
    }

    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    ts.voxelMaterial.map = texture;
    ts.voxelMaterial.needsUpdate = true;

    ts.voxelMesh.visible = true;
    ts.tiledMesh.visible = false;
    ts.hfMesh.visible = false;
  }

  // Dispose old texture
  if (ts.currentTexture) ts.currentTexture.dispose();
  ts.currentTexture = texture;
}

function disposeThree(ts) {
  cancelAnimationFrame(ts.animId);
  ts.resizeObserver.disconnect();
  if (ts.currentTexture) ts.currentTexture.dispose();
  ts.tiledMesh.geometry.dispose();
  ts.tiledMesh.material.dispose();
  ts.hfMesh.geometry.dispose();
  ts.hfMesh.material.dispose();
  ts.voxelMesh.geometry.dispose();
  ts.voxelMaterial.dispose();
  ts.renderer.dispose();
}

// =============================================================================
// Utilities
// =============================================================================

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function sidebarSection(sidebar, title) {
  const section = el('div', 'sidebar-section');
  const h2 = el('h2');
  h2.textContent = title;
  section.appendChild(h2);
  sidebar.appendChild(section);
  return section;
}

function formatValue(val, step) {
  val = Number(val);
  if (step >= 1) return String(Math.round(val));
  if (step >= 0.1) return val.toFixed(1);
  return val.toFixed(2);
}

function deepCopyStops(stops) {
  return stops.map(s => ({ t: s.t, color: [...s.color] }));
}

/** Save current noise params and palette into per-preset customizations map. */
function saveCustomizations(state) {
  state.customizations[state.preset] = {
    noiseParams: { ...state.noiseParams },
    palette: deepCopyStops(state.palette),
  };
}

/** Restore saved customizations for current preset, or fall back to preset defaults. */
function restoreCustomizations(state) {
  const saved = state.customizations[state.preset];
  if (saved) {
    Object.assign(state.noiseParams, saved.noiseParams);
    state.palette = deepCopyStops(saved.palette);
  } else {
    const preset = TEXTURE_PRESETS[state.preset];
    const baseLayer = preset.layers[0];
    Object.assign(state.noiseParams, baseLayer);
    state.palette = deepCopyStops(preset.stops);
  }
}

function rgbToHex(rgb) {
  const r = Math.round(rgb[0] * 255);
  const g = Math.round(rgb[1] * 255);
  const b = Math.round(rgb[2] * 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
