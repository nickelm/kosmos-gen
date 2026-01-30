/**
 * Controls panel
 *
 * Seed input, Archetype selector, Random button, Generate button.
 */

import { listArchetypes } from '../../src/generation/archetypes/index.js';

/**
 * Initialize the controls panel
 *
 * @param {HTMLElement} container - Container element
 * @param {Object} callbacks
 * @param {Function} callbacks.onGenerate - Called with seed number
 * @param {Function} callbacks.getSeed - Returns current seed
 * @param {Function} callbacks.setSeed - Sets seed value
 * @param {Function} callbacks.getArchetype - Returns current archetype override (or null)
 * @param {Function} callbacks.setArchetype - Sets archetype override (null for random)
 * @returns {Object} Control interface { setGenerating, getSeedInput }
 */
export function initControls(container, callbacks) {
  // Seed row
  const seedRow = document.createElement('div');
  seedRow.className = 'control-row';

  const seedLabel = document.createElement('label');
  seedLabel.textContent = 'Seed';

  const seedInput = document.createElement('input');
  seedInput.type = 'number';
  seedInput.value = callbacks.getSeed();
  seedInput.min = 0;
  seedInput.step = 1;

  seedRow.appendChild(seedLabel);
  seedRow.appendChild(seedInput);
  container.appendChild(seedRow);

  // Archetype row
  const archRow = document.createElement('div');
  archRow.className = 'control-row';

  const archLabel = document.createElement('label');
  archLabel.textContent = 'Archetype';

  const archSelect = document.createElement('select');
  // "Random" option (no override)
  const randomOpt = document.createElement('option');
  randomOpt.value = '';
  randomOpt.textContent = 'Random';
  archSelect.appendChild(randomOpt);

  // One option per archetype
  for (const name of listArchetypes()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    archSelect.appendChild(opt);
  }

  archSelect.value = callbacks.getArchetype() || '';

  archRow.appendChild(archLabel);
  archRow.appendChild(archSelect);
  container.appendChild(archRow);

  // Button row
  const btnRow = document.createElement('div');
  btnRow.className = 'control-row';

  const randomBtn = document.createElement('button');
  randomBtn.className = 'btn btn-secondary';
  randomBtn.textContent = 'Random';

  const generateBtn = document.createElement('button');
  generateBtn.className = 'btn btn-primary';
  generateBtn.textContent = 'Generate';

  btnRow.appendChild(randomBtn);
  btnRow.appendChild(generateBtn);
  container.appendChild(btnRow);

  // Events
  seedInput.addEventListener('change', () => {
    callbacks.setSeed(parseInt(seedInput.value, 10) || 0);
  });

  archSelect.addEventListener('change', () => {
    callbacks.setArchetype(archSelect.value || null);
  });

  randomBtn.addEventListener('click', () => {
    const newSeed = Math.floor(Math.random() * 999999);
    seedInput.value = newSeed;
    callbacks.setSeed(newSeed);
    callbacks.onGenerate(newSeed);
  });

  generateBtn.addEventListener('click', () => {
    callbacks.onGenerate(parseInt(seedInput.value, 10) || 0);
  });

  // Enter key triggers generate
  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      callbacks.onGenerate(parseInt(seedInput.value, 10) || 0);
    }
  });

  return {
    setGenerating(isGenerating) {
      generateBtn.disabled = isGenerating;
      generateBtn.textContent = isGenerating ? 'Generating...' : 'Generate';
    },
    getSeedInput() {
      return parseInt(seedInput.value, 10) || 0;
    },
  };
}
