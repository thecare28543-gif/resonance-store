/* RESONANCE STORE · offline copy of the app files.
   Server down: the page still opens from this cache and works on the PC's own data (sync.js queues the changes).
   Network first, so a new version on the server is picked up as soon as it is reachable. /api is never cached. */
const CACHE = 'resonance-store-v4';
const FILES = ['./', 'RESONANCE_STORE.html', 'styles.css', 'sync.js', 'app.js',
  'lib/xlsx.full.min.js', 'lib/three.min.js', 'lib/OrbitControls.js', 'lib/qrcode.js', 'lib/jsQR.js', 'training-manual.pdf'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  /* the log-in and user pages always come from the server (never a cached copy) */
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/') || /\/(login|users)\.html$/.test(url.pathname)) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        /* sent to the log-in page = not logged in: let the browser follow it, keep the cached app as it is */
        if (r.redirected || /\/login\.html/.test(r.url)) return r;
        if (r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('RESONANCE_STORE.html')))
  );
});
