import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0', // required when running inside a Docker container
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://api:8000',
        changeOrigin: true,
        // FIX 3 (BLOCKER): backend routes are at /auth/login, /healthz, etc.
        // They are NOT under /api. This rewrite strips the prefix before forwarding.
        // Without this rule every request returns 404 from the backend.
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
