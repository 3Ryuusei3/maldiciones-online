// Service worker mínimo para poder instalar el juego como app. No intercepta peticiones (todo va a la red como
// siempre, sin pasar por aquí), así no añade ninguna espera.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
