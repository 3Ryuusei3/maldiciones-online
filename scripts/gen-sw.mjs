// Genera dist/sw.js tras compilar: el service worker de la app instalada.
// - Al instalarse descarga todo lo de la web (código, cartas, iconos, fondos) para no bajarlo cada vez que se abre.
// - Imágenes y código: desde la caché (los archivos de /assets llevan huella en el nombre; el resto se renueva
//   en cada versión, porque cambia la lista y con ella el nombre de la caché).
// - La página (index.html): primero la red (para coger siempre la última versión) y, sin conexión, la guardada.
// - /api (salas, perfil, inicio de sesión) nunca pasa por la caché.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(dist, p).split('\\').join('/'));
  }
};
walk(dist);
const precache = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
const hash = createHash('sha256');
for (const f of precache) hash.update(f).update(readFileSync(join(dist, f)));
const version = hash.digest('hex').slice(0, 12);

const sw = `// Generado por scripts/gen-sw.mjs (no editar a mano).
const CACHE = 'maldiciones-${version}';
const FILES = ${JSON.stringify(['./', ...precache.map((f) => './' + f)])};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('maldiciones-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    // La página: la de la red si hay conexión (última versión); si no, la guardada.
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); return r; }).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  })));
});
`;
writeFileSync(join(dist, 'sw.js'), sw);
console.log(`sw.js: ${precache.length} archivos en caché (versión ${version})`);
