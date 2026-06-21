import { defineConfig } from 'vite';

// Tauri expects a fixed dev port and the build output in ../dist (see tauri.conf.json).
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    emptyOutDir: true
  }
});
