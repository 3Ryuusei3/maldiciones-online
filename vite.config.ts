import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // Momento de compilación (se envía en los reportes de fallos para saber qué versión tenía el jugador).
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16)) },
  // En desarrollo, las salas online van al servidor local de Cloudflare (cd server && npm run dev).
  server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
});
