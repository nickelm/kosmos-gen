/**
 * Stage selection panel
 *
 * Radio buttons for each generation stage with timing display.
 */

import { STAGES } from '../../src/generation/pipeline.js';

/** Human-readable stage names */
const STAGE_LABELS = {
  params: 'Params',
  spines: 'Spines',
  elevation: 'Elevation',
  hydrology: 'Hydrology',
  climate: 'Climate',
  biomes: 'Biomes',
};

/**
 * Initialize the stage panel
 *
 * @param {HTMLElement} container
 * @param {Object} callbacks
 * @param {Function} callbacks.getCurrentStage - Returns current stage name
 * @param {Function} callbacks.onStageChange - Called with new stage name
 * @returns {Object} Panel interface { updateTiming }
 */
export function initStagePanel(container, callbacks) {
  const list = document.createElement('div');
  list.className = 'stage-list';

  const timingSpans = {};

  for (const stage of STAGES) {
    const item = document.createElement('label');
    item.className = 'stage-item';
    if (stage === callbacks.getCurrentStage()) {
      item.classList.add('active');
    }

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'stage';
    radio.value = stage;
    radio.checked = stage === callbacks.getCurrentStage();

    const label = document.createTextNode(STAGE_LABELS[stage] || stage);

    const timing = document.createElement('span');
    timing.className = 'stage-timing';
    timing.textContent = '--';
    timingSpans[stage] = timing;

    item.appendChild(radio);
    item.appendChild(label);
    item.appendChild(timing);

    radio.addEventListener('change', () => {
      // Update active state
      list.querySelectorAll('.stage-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      callbacks.onStageChange(stage);
    });

    list.appendChild(item);
  }

  container.appendChild(list);

  return {
    updateTiming(timingData) {
      for (const [stage, span] of Object.entries(timingSpans)) {
        if (timingData && timingData[stage] !== undefined) {
          span.textContent = `${timingData[stage].toFixed(1)}ms`;
          span.classList.add('has-value');
        } else {
          span.textContent = '--';
          span.classList.remove('has-value');
        }
      }
    },
  };
}
