// Service worker.
// Strategy:
//   - CODE / app shell (html, css, js, manifest): NETWORK-FIRST, fall back to
//     cache when offline. So a new deploy shows up immediately online — no more
//     "stale app" after an update — while still working offline.
//   - DATA (data/*.json) + icons: CACHE-FIRST. These never change per version,
//     so cache them hard for instant, fully-offline reading.
const VERSION = "bible-v7";
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

function isStaticData(url) {
  return url.pathname.includes("/data/") || url.pathname.includes("/icons/");
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticData(url)) {
    // cache-first
    e.respondWith(
      caches.match(request).then((hit) =>
        hit || fetch(request).then((res) => {
          if (res.ok) { const c = res.clone(); caches.open(VERSION).then((x) => x.put(request, c)); }
          return res;
        })
      )
    );
    return;
  }

  // network-first for code / shell
  e.respondWith(
    fetch(request).then((res) => {
      if (res.ok) { const c = res.clone(); caches.open(VERSION).then((x) => x.put(request, c)); }
      return res;
    }).catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html")))
  );
});
