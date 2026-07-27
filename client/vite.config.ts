import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    allowedHosts: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
        autoRewrite: false,
        xfwd: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: false,
        autoRewrite: false,
        xfwd: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
