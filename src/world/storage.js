/**
 * World persistence via IndexedDB
 */

import { World } from './world.js';

const DB_NAME = 'kosmos-gen';
const DB_VERSION = 1;
const STORE_WORLDS = 'worlds';

let db = null;

/**
 * Initialize the database
 * @returns {Promise<IDBDatabase>}
 */
async function initDB() {
  if (db) return db;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      
      if (!database.objectStoreNames.contains(STORE_WORLDS)) {
        database.createObjectStore(STORE_WORLDS, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Save a world to storage
 * @param {World} world 
 * @returns {Promise<void>}
 */
export async function saveWorld(world) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_WORLDS, 'readwrite');
    const store = tx.objectStore(STORE_WORLDS);
    
    const data = world.toJSON();
    data.savedAt = Date.now();
    
    const request = store.put(data);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Load a world from storage
 * @param {string} id - World ID
 * @returns {Promise<World|null>}
 */
export async function loadWorld(id) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_WORLDS, 'readonly');
    const store = tx.objectStore(STORE_WORLDS);
    
    const request = store.get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (request.result) {
        resolve(World.fromJSON(request.result));
      } else {
        resolve(null);
      }
    };
  });
}

/**
 * List all saved worlds
 * @returns {Promise<Array<{id: string, seed: number, savedAt: number}>>}
 */
export async function listWorlds() {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_WORLDS, 'readonly');
    const store = tx.objectStore(STORE_WORLDS);
    
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const worlds = request.result.map(w => ({
        id: w.id,
        seed: w.seed,
        savedAt: w.savedAt
      }));
      resolve(worlds);
    };
  });
}

/**
 * Delete a world from storage
 * @param {string} id - World ID
 * @returns {Promise<void>}
 */
export async function deleteWorld(id) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_WORLDS, 'readwrite');
    const store = tx.objectStore(STORE_WORLDS);
    
    const request = store.delete(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}
