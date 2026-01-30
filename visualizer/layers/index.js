/**
 * Layer registry
 *
 * Maps layer names to their render functions and metadata.
 */

import { renderElevation } from './elevation.js';
import { renderUnderwater } from './underwater.js';
import { renderClimate } from './climate.js';
import { renderBiomes } from './biomes.js';
import { renderCoastline } from './coastline.js';
import { renderSpines } from './spines.js';
import { renderRivers } from './rivers.js';
import { renderLakes } from './lakes.js';
import { renderSettlements } from './settlements.js';

export { invalidateUnderwaterCache } from './underwater.js';
export { invalidateClimateCache } from './climate.js';
export { invalidateBiomesCache } from './biomes.js';
export { invalidateRiversCache } from './rivers.js';
export { invalidateLakesCache } from './lakes.js';
export { invalidateSettlementsCache } from './settlements.js';

/** All available layers with their renderers and display config */
export const LAYERS = {
  elevation: {
    name: 'Elevation',
    render: renderElevation,
    color: '#4caf50',
    defaultVisible: true,
  },
  underwater: {
    name: 'Underwater',
    render: renderUnderwater,
    color: '#1565c0',
    defaultVisible: false,
  },
  climate: {
    name: 'Climate',
    render: renderClimate,
    color: '#ff7043',
    defaultVisible: false,
  },
  biomes: {
    name: 'Biomes',
    render: renderBiomes,
    color: '#8bc34a',
    defaultVisible: false,
  },
  lakes: {
    name: 'Lakes',
    render: renderLakes,
    color: '#1e78dc',
    defaultVisible: true,
  },
  rivers: {
    name: 'Rivers',
    render: renderRivers,
    color: '#1e90ff',
    defaultVisible: true,
  },
  coastline: {
    name: 'Coastline',
    render: renderCoastline,
    color: '#222222',
    defaultVisible: true,
  },
  settlements: {
    name: 'Settlements',
    render: renderSettlements,
    color: '#daa520',
    defaultVisible: true,
  },
  spines: {
    name: 'Spines',
    render: renderSpines,
    color: '#e94560',
    defaultVisible: true,
  },
};

/**
 * Get render functions keyed by layer name
 * @returns {Object}
 */
export function getLayerRenderers() {
  const renderers = {};
  for (const [key, layer] of Object.entries(LAYERS)) {
    renderers[key] = layer.render;
  }
  return renderers;
}

/**
 * Get default visibility state
 * @returns {Object}
 */
export function getDefaultLayerVisibility() {
  const visibility = {};
  for (const [key, layer] of Object.entries(LAYERS)) {
    visibility[key] = layer.defaultVisible;
  }
  return visibility;
}
