/**
 * PNG export utilities for generated textures.
 *
 * Uses offscreen canvas and toBlob() for browser-based PNG export.
 */

/**
 * Convert RGBA pixel data to a PNG Blob.
 *
 * @param {Uint8ClampedArray} pixels - RGBA pixel data
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Blob>} PNG blob
 */
export function pixelsToPngBlob(pixels, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(pixels, width, height);
  ctx.putImageData(imageData, 0, 0);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Download a texture as a PNG file.
 *
 * @param {Uint8ClampedArray} pixels
 * @param {number} width
 * @param {number} height
 * @param {string} filename - e.g. 'grass.png'
 */
export async function downloadTexturePng(pixels, width, height, filename) {
  const blob = await pixelsToPngBlob(pixels, width, height);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download all 8 textures as individual PNG files.
 *
 * @param {Object<string, { pixels: Uint8ClampedArray, width: number, height: number }>} textures
 */
export async function downloadAllTextures(textures) {
  for (const [name, tex] of Object.entries(textures)) {
    await downloadTexturePng(tex.pixels, tex.width, tex.height, `${name}.png`);
    // Small delay between downloads to avoid browser blocking
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}
