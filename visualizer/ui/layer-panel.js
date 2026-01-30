/**
 * Layer toggle panel
 *
 * Checkboxes for each visualization layer.
 */

import { LAYERS } from '../layers/index.js';

/**
 * Initialize the layer panel
 *
 * @param {HTMLElement} container
 * @param {Object} callbacks
 * @param {Function} callbacks.getLayerVisibility - Returns visibility map
 * @param {Function} callbacks.onToggleLayer - Called with (layerName, visible)
 */
export function initLayerPanel(container, callbacks) {
  const list = document.createElement('div');
  list.className = 'layer-list';

  const visibility = callbacks.getLayerVisibility();

  for (const [key, layer] of Object.entries(LAYERS)) {
    const item = document.createElement('label');
    item.className = 'layer-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = visibility[key] ?? true;

    const swatch = document.createElement('span');
    swatch.className = 'layer-swatch';
    swatch.style.background = layer.color;

    const label = document.createTextNode(layer.name);

    item.appendChild(checkbox);
    item.appendChild(swatch);
    item.appendChild(label);

    checkbox.addEventListener('change', () => {
      callbacks.onToggleLayer(key, checkbox.checked);
    });

    list.appendChild(item);
  }

  container.appendChild(list);
}
