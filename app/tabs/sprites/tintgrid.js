/**
 * Biome tint preview grid — shows the selected sprite under 12 biome tints.
 * Uses Canvas 2D multiply composite for tinting.
 */

import { BIOME_TINTS } from '@/textures/palettes.js';
import { el, sidebarSection } from './utils.js';

/** Subset of biomes for the tint preview (12 representative). */
const TINT_BIOMES = [
  'plains', 'meadow', 'autumn_forest', 'deciduous_forest',
  'desert', 'red_desert', 'savanna', 'jungle',
  'taiga', 'mountains', 'beach', 'swamp',
];

/** Prettify a biome key for display. */
function formatBiomeName(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Render a tinted sprite onto a canvas.
 * Three-step composite: draw sprite → multiply tint → restore alpha mask.
 */
function renderTinted(canvas, sprite, tintColor) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // Draw sprite
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprite.image, 0, 0, w, h);

  // Multiply tint color
  ctx.globalCompositeOperation = 'multiply';
  const [r, g, b] = tintColor;
  ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  ctx.fillRect(0, 0, w, h);

  // Restore original alpha mask
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(sprite.image, 0, 0, w, h);

  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Build the biome tint preview grid.
 * @param {HTMLElement} container
 * @param {Object} state
 * @returns {{ update: () => void, dispose: () => void }}
 */
export function initTintGrid(container, state) {
  const section = sidebarSection(container, 'Biome Tints');
  const grid = el('div', 'tint-grid');
  section.appendChild(grid);

  const emptyMsg = el('div', 'sprite-empty');
  emptyMsg.textContent = 'Select a sprite';
  container.appendChild(emptyMsg);

  // Create cells
  const cells = [];
  for (const biome of TINT_BIOMES) {
    const cell = el('div', 'tint-cell');
    const canvas = el('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const label = el('div', 'tint-label');
    label.textContent = formatBiomeName(biome);
    cell.appendChild(canvas);
    cell.appendChild(label);
    grid.appendChild(cell);
    cells.push({ biome, canvas });
  }

  function update() {
    const sprite = state.sprites.find(s => s.id === state.selectedId) || null;

    if (!sprite) {
      grid.style.display = 'none';
      emptyMsg.style.display = '';
      return;
    }

    grid.style.display = '';
    emptyMsg.style.display = 'none';

    // Adjust canvas aspect ratio to match sprite
    const aspect = sprite.width / sprite.height;
    const cellW = 64;
    const cellH = Math.round(cellW / aspect);

    for (const { biome, canvas } of cells) {
      canvas.width = cellW;
      canvas.height = cellH;
      const tint = BIOME_TINTS[biome];
      if (tint) {
        renderTinted(canvas, sprite, tint);
      }
    }
  }

  update();

  return {
    update,
    dispose() {},
  };
}
