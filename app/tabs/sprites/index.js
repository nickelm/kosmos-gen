/**
 * Sprites tab — import, preview, validate, and tune vegetation billboard sprites.
 *
 * Layout: import panel (left) | detail + 3D preview (center) | tint grid (right)
 *         density scatter preview (bottom-center)
 */

import { el } from './utils.js';
import { initImportPanel } from './import.js';
import { initDetailPanel } from './detail.js';
import { initTintGrid } from './tintgrid.js';
import { initPreview3D } from './preview3d.js';

/**
 * Initialize the Sprites tab.
 * @param {HTMLElement} container - The #tab-content element
 * @returns {{ dispose: () => void }}
 */
export function initSpritesTab(container) {
  // Shared mutable state
  const state = {
    sprites: [],        // Array of sprite entries
    selectedId: null,   // Currently selected sprite id
    densityCount: 80,   // Density scatter instance count
    windEnabled: false,  // Wind animation toggle
    onSpriteListChanged: null,
    onSelectionChanged: null,
  };

  // Build DOM layout
  const layout = el('div', 'sprites-layout');
  const importPanel = el('div', 'sprites-import-panel');
  const center = el('div', 'sprites-center');
  const detailPanel = el('div', 'sprite-detail');
  const quadViewport = el('div', 'sprite-3d-viewport');
  const tintPanel = el('div', 'sprites-tint-panel');
  const densityPanel = el('div', 'sprites-density-panel');

  center.appendChild(detailPanel);
  center.appendChild(quadViewport);
  layout.appendChild(importPanel);
  layout.appendChild(center);
  layout.appendChild(tintPanel);
  layout.appendChild(densityPanel);
  container.appendChild(layout);

  // Initialize sub-modules
  const importModule = initImportPanel(importPanel, state);
  const detailModule = initDetailPanel(detailPanel, state);
  const previewModule = initPreview3D(quadViewport, densityPanel, state);
  const tintModule = initTintGrid(tintPanel, state);

  // Wire callbacks
  state.onSelectionChanged = () => {
    importModule.refreshList();
    detailModule.update();
    previewModule.updateQuad();
    tintModule.update();
  };

  state.onSpriteListChanged = () => {
    importModule.refreshList();
    previewModule.updateDensity();
  };

  return {
    dispose() {
      importModule.dispose();
      detailModule.dispose();
      previewModule.dispose();
      tintModule.dispose();
    },
  };
}
