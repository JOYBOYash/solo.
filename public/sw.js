/* Solo service worker — an offline app shell, no third-party caching.
   Navigation is network-first so a new deployment appears immediately; hashed
   Vite assets are cached after their first fetch. YouTube, Spotify and lyrics
   requests are never intercepted. */
const VERSION = 'solo-shell-v4';
const CORE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/Solo_white.svg',
  '/Solo_light.svg',
  '/Solo_dark.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // Cache each shell file independently so one missing icon cannot wipe
      // out the whole offline shell.
      await Promise.allSettled(CORE.map((path) => cache.add(path)));
      // Cache the hashed entry bundle as well, so the first offline launch
      // actually has the app code.
      try {
        const res = await fetch('/index.html', { cache: 'no-cache' });
        const html = await res.text();
        const assets = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)).map(
          (match) => match[1],
        );
        await cache.addAll(assets).catch(() => undefined);
      } catch {
        /* the runtime cache below still fills in */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(VERSION).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(VERSION);
          return (
            (await cache.match('/index.html', { ignoreVary: true })) ||
            (await cache.match('/', { ignoreVary: true }))
          );
        }),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      // Static hosts (Vite preview, Vercel) send `Vary: Origin`; module
      // scripts are CORS requests with an Origin header, while install-time
      // cache.addAll requests have none. Ignoring Vary keeps the cache hit.
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.endsWith('.svg'))) {
          void cache.put(request, response.clone());
        }
        return response;
      } catch {
        return cached || Response.error();
      }
    })(),
  );
});
