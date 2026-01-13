import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'editor',
  base: '/kosmos-gen/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,  // Different from golemcraft (5173)
  },
});
