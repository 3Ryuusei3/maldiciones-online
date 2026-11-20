// Service worker mínimo para poder instalar el juego como app. No guarda nada en caché: todo va a la red como siempre.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
