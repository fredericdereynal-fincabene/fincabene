// ============================================================
// FINCABENE - Service Worker
// Strategie : "network-first, cache fallback"
//   - Si internet -> on prend la version fraiche du serveur
//                    ET on la garde en cache sur le telephone
//   - Si pas d'internet -> on ressert la derniere version cachee
// ============================================================

const CACHE = 'fincabene-v1';

// Fichiers de base toujours mis en cache
const CORE = [
  'menu-fb.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

// ---------- Installation ----------
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {}))
  );
});

// ---------- Activation : nettoyage + precache de toutes les pages ----------
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    await precacheDesdeMenu();
  })());
});

// Lit menu-fb.html, extrait tous les liens .html et les met en cache.
// => les pages sont dispo hors-ligne meme si l'operario ne les a jamais ouvertes.
async function precacheDesdeMenu() {
  try {
    const cache = await caches.open(CACHE);
    const resp = await fetch('menu-fb.html', { cache: 'no-store' });
    if (!resp || !resp.ok) return;
    const html = await resp.clone().text();
    await cache.put('menu-fb.html', resp);

    const hrefs = [...html.matchAll(/href="([^"?#]+\.html)"/g)].map(m => m[1]);
    const unicos = [...new Set(hrefs)];
    for (const h of unicos) {
      try {
        const r = await fetch(h, { cache: 'no-store' });
        if (r && r.ok) await cache.put(h, r);
      } catch (err) { /* page indisponible : on continue */ }
    }
  } catch (err) { /* pas de reseau a l'activation : tant pis */ }
}

// ---------- Fetch avec timeout ----------
function fetchConTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => { ctrl.abort(); reject(new Error('timeout')); }, ms);
    fetch(req, { signal: ctrl.signal, cache: 'no-store' })
      .then(r => { clearTimeout(t); resolve(r); })
      .catch(err => { clearTimeout(t); reject(err); });
  });
}

// ---------- Interception des requetes ----------
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // clef de cache SANS ?v=... pour que le cache-busting ne casse pas le hors-ligne
    const key = url.pathname;

    try {
      const fresh = await fetchConTimeout(req, 5000);
      if (fresh && fresh.ok) {
        cache.put(key, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      const hit = await cache.match(key) ||
                  await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const menu = await cache.match('menu-fb.html', { ignoreSearch: true });
        if (menu) return menu;
      }
      throw err;
    }
  })());
});

// ---------- Rafraichissement force depuis la page ----------
self.addEventListener('message', (e) => {
  if (e.data === 'ACTUALIZAR_CACHE') {
    e.waitUntil(precacheDesdeMenu());
  }
});
