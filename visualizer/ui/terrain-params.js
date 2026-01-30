/**
 * Terrain parameter sliders
 *
 * Interactive sliders for noise and domain warp configuration.
 * Overrides seed-derived random values for real-time tuning.
 */

const SLIDERS = [
  // Noise
  { group: 'Noise', key: 'noise.octaves', label: 'Octaves', min: 1, max: 8, step: 1, default: 2 },
  { group: 'Noise', key: 'noise.persistence', label: 'Persist.', min: 0.05, max: 0.9, step: 0.05, default: 0.45 },
  { group: 'Noise', key: 'noise.frequency', label: 'Freq', min: 0.1, max: 10, step: 0.1, default: 4.8 },
  { group: 'Noise', key: 'noise.amplitude', label: 'Amp', min: 0, max: 0.5, step: 0.005, default: 0.210 },
  // Warp
  { group: 'Warp', key: 'warp.strength', label: 'Strength', min: 0, max: 0.1, step: 0.001, default: 0.061 },
  { group: 'Warp', key: 'warp.scale', label: 'Scale', min: 0, max: 0.5, step: 0.005, default: 0.170 },
  { group: 'Warp', key: 'warp.octaves', label: 'Octaves', min: 1, max: 16, step: 1, default: 10 },
  // Shape
  { group: 'Shape', key: 'elevation.foothillRadius', label: 'Fthill Rad', min: 0, max: 8, step: 0.5, default: 2.5 },
  { group: 'Shape', key: 'elevation.foothillHeight', label: 'Fthill Ht', min: 0, max: 0.3, step: 0.01, default: 0 },
  { group: 'Shape', key: 'elevation.terraceStrength', label: 'Terraces', min: 0, max: 1, step: 0.05, default: 0 },
];

/**
 * @param {HTMLElement} container
 * @param {Object} callbacks
 * @param {() => Object} callbacks.getOverrides - Current override values
 * @param {(overrides: Object) => void} callbacks.setOverrides - Set override values
 * @param {() => void} callbacks.onChanged - Trigger regeneration
 * @returns {{ getValues: () => Object }}
 */
export function initTerrainParams(container, callbacks) {
  const sliderEls = {};
  const valueEls = {};
  let debounceTimer = null;

  // Build initial overrides from defaults
  const overrides = buildDefaults();
  callbacks.setOverrides(overrides);

  let currentGroup = null;

  for (const def of SLIDERS) {
    // Group header
    if (def.group !== currentGroup) {
      currentGroup = def.group;
      const header = document.createElement('div');
      header.className = 'param-group-label';
      header.textContent = currentGroup;
      container.appendChild(header);
    }

    const row = document.createElement('div');
    row.className = 'control-row param-row';

    const label = document.createElement('label');
    label.textContent = def.label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = def.min;
    slider.max = def.max;
    slider.step = def.step;
    slider.value = def.default;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'slider-value';
    valueSpan.textContent = formatValue(def.default, def.step);

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(valueSpan);
    container.appendChild(row);

    sliderEls[def.key] = slider;
    valueEls[def.key] = valueSpan;

    slider.addEventListener('input', () => {
      const val = Number(slider.value);
      valueSpan.textContent = formatValue(val, def.step);
      setNestedValue(overrides, def.key, val);
      callbacks.setOverrides(overrides);

      // Debounce regeneration
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        callbacks.onChanged();
      }, 120);
    });
  }

  // Reset button
  const resetRow = document.createElement('div');
  resetRow.className = 'control-row';
  resetRow.style.marginTop = '8px';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn btn-secondary';
  resetBtn.textContent = 'Reset Defaults';
  resetBtn.style.flex = '1';
  resetBtn.addEventListener('click', () => {
    const defaults = buildDefaults();
    Object.assign(overrides, defaults);
    callbacks.setOverrides(overrides);

    for (const def of SLIDERS) {
      sliderEls[def.key].value = def.default;
      valueEls[def.key].textContent = formatValue(def.default, def.step);
    }

    callbacks.onChanged();
  });

  resetRow.appendChild(resetBtn);
  container.appendChild(resetRow);

  return {
    getValues() { return { ...overrides }; },
  };
}

function buildDefaults() {
  const result = { noise: {}, warp: {}, elevation: {} };
  for (const def of SLIDERS) {
    setNestedValue(result, def.key, def.default);
  }
  return result;
}

function setNestedValue(obj, key, value) {
  const [group, prop] = key.split('.');
  if (!obj[group]) obj[group] = {};
  obj[group][prop] = value;
}

function formatValue(val, step) {
  if (step >= 1) return String(Math.round(val));
  if (step >= 0.1) return val.toFixed(1);
  if (step >= 0.01) return val.toFixed(2);
  return val.toFixed(3);
}
