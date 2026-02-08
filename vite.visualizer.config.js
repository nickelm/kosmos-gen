import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'visualizer',
  base: '/kosmos-gen/',
  build: {
    outDir: '../dist-visualizer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5175,
  },
});
