/**
 * Sprite detail panel — 1:1 and 4× pixel views, metadata info bar,
 * alpha validation with fix/download.
 */

import { el, sidebarSection } from './utils.js';

/**
 * Analyze a sprite's alpha channel for issues.
 * @param {ImageData} imageData
 * @returns {{ semiTransCount: number, bleedCount: number, colorCount: number, alphaPixelCount: number }}
 */
function analyzeAlpha(imageData) {
  const d = imageData.data;
  const len = d.length;
  let semiTransCount = 0;
  let bleedCount = 0;
  let alphaPixelCount = 0;
  const colors = new Set();

  for (let i = 0; i < len; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];

    if (a > 0 && a < 255) semiTransCount++;
    if (a < 255) alphaPixelCount++;

    if (a === 0 && (r > 0 || g > 0 || b > 0)) bleedCount++;

    if (a > 0) {
      colors.add((r << 16) | (g << 8) | b);
    }
  }

  return { semiTransCount, bleedCount, colorCount: colors.size, alphaPixelCount };
}

/**
 * Fix alpha issues: threshold semi-transparent pixels, zero-out RGB on fully transparent.
 * @param {ImageData} imageData
 * @param {number} threshold
 * @returns {ImageData}
 */
function fixAlpha(imageData, threshold = 128) {
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src);

  for (let i = 0; i < dst.length; i += 4) {
    const a = dst[i + 3];
    if (a < threshold) {
      dst[i] = 0; dst[i + 1] = 0; dst[i + 2] = 0; dst[i + 3] = 0;
    } else if (a < 255) {
      dst[i + 3] = 255;
    }
  }

  return new ImageData(dst, imageData.width, imageData.height);
}

/**
 * Draw a checkerboard pattern on a canvas context.
 */
function drawCheckerboard(ctx, w, h, size = 8) {
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#333';
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) {
        ctx.fillRect(x, y, size, size);
      }
    }
  }
}

/**
 * Download image data as a PNG file.
 */
function downloadPng(imageData, filename) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/**
 * Build the detail panel.
 * @param {HTMLElement} container
 * @param {Object} state
 * @returns {{ update: () => void, dispose: () => void }}
 */
export function initDetailPanel(container, state) {
  // Detail section
  const detailSection = sidebarSection(container, 'Sprite Detail');

  const views = el('div', 'sprite-detail-views');
  detailSection.appendChild(views);

  const canvas1x = el('canvas', 'sprite-detail-canvas');
  const canvas4x = el('canvas', 'sprite-detail-canvas');
  views.appendChild(canvas1x);
  views.appendChild(canvas4x);

  const infoBar = el('div', 'sprite-info-bar');
  detailSection.appendChild(infoBar);

  // Alpha validation section
  const alphaSection = sidebarSection(container, 'Alpha Validation');
  const alphaBox = el('div', 'alpha-validation');
  alphaSection.appendChild(alphaBox);

  const emptyMsg = el('div', 'sprite-empty');
  emptyMsg.textContent = 'Select a sprite to inspect';
  container.appendChild(emptyMsg);

  function getSelected() {
    return state.sprites.find(s => s.id === state.selectedId) || null;
  }

  function update() {
    const sprite = getSelected();

    if (!sprite) {
      detailSection.style.display = 'none';
      alphaSection.style.display = 'none';
      emptyMsg.style.display = '';
      return;
    }

    detailSection.style.display = '';
    alphaSection.style.display = '';
    emptyMsg.style.display = 'none';

    // 1:1 view
    const maxW1x = 128;
    const scale1x = Math.min(1, maxW1x / sprite.width);
    const w1 = Math.round(sprite.width * scale1x);
    const h1 = Math.round(sprite.height * scale1x);
    canvas1x.width = w1;
    canvas1x.height = h1;
    canvas1x.style.width = w1 + 'px';
    canvas1x.style.height = h1 + 'px';
    const ctx1 = canvas1x.getContext('2d');
    drawCheckerboard(ctx1, w1, h1);
    ctx1.imageSmoothingEnabled = false;
    ctx1.drawImage(sprite.image, 0, 0, w1, h1);

    // 4× view
    const max4x = 256;
    const scale4x = Math.min(4, max4x / sprite.width, max4x / sprite.height);
    const w4 = Math.round(sprite.width * scale4x);
    const h4 = Math.round(sprite.height * scale4x);
    canvas4x.width = w4;
    canvas4x.height = h4;
    canvas4x.style.width = w4 + 'px';
    canvas4x.style.height = h4 + 'px';
    const ctx4 = canvas4x.getContext('2d');
    drawCheckerboard(ctx4, w4, h4);
    ctx4.imageSmoothingEnabled = false;
    ctx4.drawImage(sprite.image, 0, 0, w4, h4);

    // Info bar
    const kb = (sprite.fileSize / 1024).toFixed(1);
    const analysis = analyzeAlpha(sprite.imageData);
    infoBar.innerHTML = '';
    const items = [
      `${sprite.width} × ${sprite.height}`,
      `${kb} KB`,
      `${analysis.colorCount} colors`,
      `${analysis.alphaPixelCount} transparent px`,
    ];
    for (const text of items) {
      const span = el('span');
      span.textContent = text;
      infoBar.appendChild(span);
    }

    // Alpha validation
    alphaBox.innerHTML = '';

    const hardOk = analysis.semiTransCount === 0;
    const bleedOk = analysis.bleedCount === 0;

    // Hard alpha row
    const row1 = el('div', 'alpha-row');
    const label1 = el('span');
    label1.textContent = 'Hard alpha:';
    const badge1 = el('span', hardOk ? 'alpha-badge pass' : 'alpha-badge warn');
    badge1.textContent = hardOk ? 'PASS' : `${analysis.semiTransCount} semi-transparent`;
    row1.appendChild(label1);
    row1.appendChild(badge1);
    alphaBox.appendChild(row1);

    // Edge bleed row
    const row2 = el('div', 'alpha-row');
    const label2 = el('span');
    label2.textContent = 'Edge bleed:';
    const badge2 = el('span', bleedOk ? 'alpha-badge pass' : 'alpha-badge warn');
    badge2.textContent = bleedOk ? 'PASS' : `${analysis.bleedCount} pixels`;
    row2.appendChild(label2);
    row2.appendChild(badge2);
    alphaBox.appendChild(row2);

    // Fix + Download buttons (only if issues)
    if (!hardOk || !bleedOk) {
      const btnRow = el('div', 'button-row');
      btnRow.style.marginTop = '8px';

      const fixBtn = el('button', 'btn btn-secondary');
      fixBtn.textContent = 'Fix & Download';
      fixBtn.addEventListener('click', () => {
        const fixed = fixAlpha(sprite.imageData);
        const baseName = sprite.name.replace(/\.png$/i, '');
        downloadPng(fixed, `${baseName}_fixed.png`);

        // Also update the sprite in-place with the fixed data
        sprite.imageData = fixed;
        // Rebuild the image from fixed data
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = sprite.width;
        tempCanvas.height = sprite.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(fixed, 0, 0);
        sprite.image = new Image();
        sprite.image.src = tempCanvas.toDataURL('image/png');
        sprite.image.onload = () => {
          if (state.onSelectionChanged) state.onSelectionChanged();
        };
      });

      btnRow.appendChild(fixBtn);
      alphaBox.appendChild(btnRow);

      // Overlay flagged pixels on 4× view
      const d = sprite.imageData.data;
      const sx = w4 / sprite.width;
      const sy = h4 / sprite.height;
      ctx4.fillStyle = 'rgba(233, 69, 96, 0.6)';
      for (let py = 0; py < sprite.height; py++) {
        for (let px = 0; px < sprite.width; px++) {
          const i = (py * sprite.width + px) * 4;
          const a = d[i + 3];
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const isSemiTrans = a > 0 && a < 255;
          const isBleed = a === 0 && (r > 0 || g > 0 || b > 0);
          if (isSemiTrans || isBleed) {
            ctx4.fillRect(Math.floor(px * sx), Math.floor(py * sy), Math.ceil(sx), Math.ceil(sy));
          }
        }
      }
    }
  }

  update();

  return {
    update,
    dispose() {},
  };
}
