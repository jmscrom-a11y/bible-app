// Service worker: app-shell precache + cache-first for everything under scope
// (incl. data/*.json) so the whole Bible works offline once visited.
const VERSION = "bible-v6";
const SHELL = [
  "./", "./index.html", "./css/style.css", "./js/app.js",
  "./manifest.webmanifest", "./icons/icon.svg", "./data/books.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  e.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        // Cache same-origin successful responses (app shell + lazily-loaded book data).
        if (res.ok && new URL(request.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
