/**
 * Sprite import panel — drag-and-drop / file picker, sprite list with thumbnails.
 */

import { el, sidebarSection } from './utils.js';

/**
 * Load a PNG file into a sprite entry.
 * @param {File} file
 * @returns {Promise<Object>} Sprite entry
 */
function loadSpriteFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Extract ImageData via temp canvas
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);

        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          image: img,
          imageData,
          width: img.width,
          height: img.height,
          fileSize: file.size,
          dataUrl: reader.result,
        });
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Build the import panel.
 * @param {HTMLElement} container
 * @param {Object} state
 * @returns {{ refreshList: () => void, dispose: () => void }}
 */
export function initImportPanel(container, state) {
  // Import section
  const importSection = sidebarSection(container, 'Import');

  const dropZone = el('div', 'sprite-drop-zone');
  dropZone.textContent = 'Drop PNG files here or click to browse';
  importSection.appendChild(dropZone);

  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  importSection.appendChild(fileInput);

  // Sprite list section
  const listSection = sidebarSection(container, 'Sprites');
  const listEl = el('div', 'sprite-list');
  listSection.appendChild(listEl);

  // --- File handling ---

  async function processFiles(files) {
    const pngFiles = Array.from(files).filter(
      f => f.type === 'image/png' || f.name.toLowerCase().endsWith('.png')
    );
    if (pngFiles.length === 0) return;

    const results = await Promise.allSettled(pngFiles.map(loadSpriteFile));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        state.sprites.push(result.value);
      }
    }

    // Auto-select first if nothing selected
    if (!state.selectedId && state.sprites.length > 0) {
      state.selectedId = state.sprites[0].id;
      if (state.onSelectionChanged) state.onSelectionChanged();
    }

    if (state.onSpriteListChanged) state.onSpriteListChanged();
  }

  // Click to browse
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      processFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  // Drag-and-drop
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    processFiles(e.dataTransfer.files);
  });

  // --- List rendering ---

  function refreshList() {
    listEl.innerHTML = '';

    if (state.sprites.length === 0) {
      const empty = el('div', 'sprite-empty');
      empty.textContent = 'No sprites loaded';
      empty.style.padding = '12px 0';
      empty.style.fontSize = '12px';
      listEl.appendChild(empty);
      return;
    }

    for (const sprite of state.sprites) {
      const item = el('div', 'sprite-list-item');
      if (sprite.id === state.selectedId) item.classList.add('active');

      const thumb = el('img');
      thumb.src = sprite.dataUrl;
      thumb.alt = sprite.name;

      const nameSpan = el('span', 'sprite-name');
      nameSpan.textContent = sprite.name;

      const removeBtn = el('button', 'sprite-remove');
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove';

      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = state.sprites.findIndex(s => s.id === sprite.id);
        if (idx >= 0) state.sprites.splice(idx, 1);

        // Fix selection
        if (state.selectedId === sprite.id) {
          if (state.sprites.length > 0) {
            const newIdx = Math.min(idx, state.sprites.length - 1);
            state.selectedId = state.sprites[newIdx].id;
          } else {
            state.selectedId = null;
          }
          if (state.onSelectionChanged) state.onSelectionChanged();
        }
        if (state.onSpriteListChanged) state.onSpriteListChanged();
      });

      item.addEventListener('click', () => {
        if (state.selectedId !== sprite.id) {
          state.selectedId = sprite.id;
          if (state.onSelectionChanged) state.onSelectionChanged();
          refreshList();
        }
      });

      item.appendChild(thumb);
      item.appendChild(nameSpan);
      item.appendChild(removeBtn);
      listEl.appendChild(item);
    }
  }

  refreshList();

  return {
    refreshList,
    dispose() {},
  };
}
