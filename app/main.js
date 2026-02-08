/**
 * kosmos-gen app entry point.
 *
 * Tab-based router for asset generation tools.
 * Phase 1: Textures tab only.
 */

import { initTexturesTab } from './tabs/textures.js';

const TABS = [
  { id: 'textures', label: 'Textures', init: initTexturesTab },
  // Phase 2: { id: 'sprites', label: 'Sprites', init: initSpritesTab },
  // Phase 3: { id: 'monsters', label: 'Monsters', init: initMonstersTab },
  // Phase 4: { id: 'buildings', label: 'Buildings', init: initBuildingsTab },
];

const tabBar = document.getElementById('tab-bar');
const tabContent = document.getElementById('tab-content');
let activeTab = null;
let activeDispose = null;

function activateTab(tab) {
  if (activeTab === tab) return;

  // Dispose previous tab
  if (activeDispose) {
    activeDispose();
    activeDispose = null;
  }
  tabContent.innerHTML = '';

  // Update active button
  activeTab = tab;
  for (const btn of tabBar.children) {
    btn.classList.toggle('active', btn.dataset.tabId === tab.id);
  }

  // Initialize new tab
  const result = tab.init(tabContent);
  if (result && result.dispose) {
    activeDispose = result.dispose;
  }
}

// Build tab buttons
for (const tab of TABS) {
  const btn = document.createElement('button');
  btn.className = 'tab-btn';
  btn.textContent = tab.label;
  btn.dataset.tabId = tab.id;
  btn.addEventListener('click', () => activateTab(tab));
  tabBar.appendChild(btn);
}

// Activate first tab
if (TABS.length > 0) {
  activateTab(TABS[0]);
}
