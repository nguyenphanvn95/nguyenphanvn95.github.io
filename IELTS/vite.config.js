import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Nếu deploy lên GitHub Pages, phải set base path
// https://username.github.io/ielts-practice-app/
export default defineConfig({
  plugins: [react()],
  base: './', // QUAN TRỌNG: Dùng relative path
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
});
