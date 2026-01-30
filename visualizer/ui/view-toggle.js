/**
 * View toggle button
 *
 * Segmented [2D | 3D] control that switches between canvas and Three.js views.
 */

/**
 * @param {HTMLElement} container - Element to prepend the toggle into
 * @param {{ onToggle: (mode: '2d' | '3d') => void }} callbacks
 * @returns {{ getMode: () => string, setMode: (mode: string) => void }}
 */
export function initViewToggle(container, callbacks) {
  let currentMode = '2d';

  const wrapper = document.createElement('div');
  wrapper.className = 'view-toggle';

  const btn2d = document.createElement('button');
  btn2d.textContent = '2D';
  btn2d.className = 'active';

  const btn3d = document.createElement('button');
  btn3d.textContent = '3D';

  wrapper.appendChild(btn2d);
  wrapper.appendChild(btn3d);
  container.prepend(wrapper);

  function setMode(mode) {
    currentMode = mode;
    btn2d.classList.toggle('active', mode === '2d');
    btn3d.classList.toggle('active', mode === '3d');
  }

  btn2d.addEventListener('click', () => {
    if (currentMode === '2d') return;
    setMode('2d');
    callbacks.onToggle('2d');
  });

  btn3d.addEventListener('click', () => {
    if (currentMode === '3d') return;
    setMode('3d');
    callbacks.onToggle('3d');
  });

  return {
    getMode: () => currentMode,
    setMode,
  };
}
