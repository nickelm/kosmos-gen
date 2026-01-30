/**
 * 3D view controls panel
 *
 * Height exaggeration dropdown, water plane checkbox, wireframe checkbox.
 * Visible only when 3D mode is active.
 */

/**
 * @param {HTMLElement} container
 * @param {Object} callbacks
 * @param {(scale: number) => void} callbacks.onHeightScaleChange
 * @param {(visible: boolean) => void} callbacks.onWaterToggle
 * @param {(enabled: boolean) => void} callbacks.onWireframeToggle
 * @returns {{ show: () => void, hide: () => void }}
 */
export function initView3DControls(container, callbacks) {
  // Height scale slider
  const scaleRow = document.createElement('div');
  scaleRow.className = 'control-row param-row';

  const scaleLabel = document.createElement('label');
  scaleLabel.textContent = 'Scale';

  const scaleSlider = document.createElement('input');
  scaleSlider.type = 'range';
  scaleSlider.min = '0.05';
  scaleSlider.max = '1.0';
  scaleSlider.step = '0.05';
  scaleSlider.value = '0.3';

  const scaleValue = document.createElement('span');
  scaleValue.className = 'slider-value';
  scaleValue.textContent = '0.30';

  scaleRow.appendChild(scaleLabel);
  scaleRow.appendChild(scaleSlider);
  scaleRow.appendChild(scaleValue);
  container.appendChild(scaleRow);

  // Water plane row
  const waterRow = document.createElement('div');
  waterRow.className = 'control-row';

  const waterCheckbox = document.createElement('input');
  waterCheckbox.type = 'checkbox';
  waterCheckbox.id = 'view3d-water';
  waterCheckbox.checked = true;

  const waterLabel = document.createElement('label');
  waterLabel.htmlFor = 'view3d-water';
  waterLabel.textContent = 'Water plane';

  waterRow.appendChild(waterCheckbox);
  waterRow.appendChild(waterLabel);
  container.appendChild(waterRow);

  // Wireframe row
  const wireRow = document.createElement('div');
  wireRow.className = 'control-row';

  const wireCheckbox = document.createElement('input');
  wireCheckbox.type = 'checkbox';
  wireCheckbox.id = 'view3d-wireframe';
  wireCheckbox.checked = false;

  const wireLabel = document.createElement('label');
  wireLabel.htmlFor = 'view3d-wireframe';
  wireLabel.textContent = 'Wireframe';

  wireRow.appendChild(wireCheckbox);
  wireRow.appendChild(wireLabel);
  container.appendChild(wireRow);

  // Events
  scaleSlider.addEventListener('input', () => {
    const val = Number(scaleSlider.value);
    scaleValue.textContent = val.toFixed(2);
    callbacks.onHeightScaleChange(val);
  });

  waterCheckbox.addEventListener('change', () => {
    callbacks.onWaterToggle(waterCheckbox.checked);
  });

  wireCheckbox.addEventListener('change', () => {
    callbacks.onWireframeToggle(wireCheckbox.checked);
  });

  // Section container is the parent sidebar-section div
  const section = container.closest('.sidebar-section') || container;

  return {
    show() { section.style.display = ''; },
    hide() { section.style.display = 'none'; },
  };
}
