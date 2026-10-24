/**
 * Cache the static app so it runs offline after the first load.
 * Every path is relative to this file, so the site can be hosted in a
 * subfolder (GitHub Pages /repo-name/) or at the root of a static host.
 */

const CACHE = "practice-metronome-v1";

const ASSETS = [
  "index.html",
  "manifest.json",
  "css/styles.css",
  "js/app.js",
  "js/audio.js",
  "js/pattern.js",
  "js/presets.js",
  "js/scheduler.js",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (path) => {
      const response = await fetch(new Request(path, { cache: "reload" }));
      if (!response.ok) throw new Error("Cache failed for " + path);
      await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === "basic") {
          cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }

    const fresh = await network;
    if (fresh) return fresh;
    if (request.mode === "navigate") {
      const index = await cache.match("index.html");
      if (index) return index;
    }
    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  })());
});
