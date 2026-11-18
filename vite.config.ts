import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // En desarrollo, las salas online van al servidor local de Cloudflare (cd server && npm run dev).
  server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
});
