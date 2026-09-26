// Offline support: cache the app shell, data and CDN libraries so the demo
// still works if the venue Wi-Fi dies. Stale-while-revalidate for everything
// except the live World Bank API check.
const CACHE = "time-machine-v1";
const SHELL = ["./", "index.html", "style.css", "manifest.webmanifest", "icons/icon.svg",
  "js/main.js", "js/state.js", "js/util.js", "js/engine.js", "js/charts.js",
  "js/explore.js", "js/play.js", "js/whatif.js", "js/world.js", "js/proof.js",
  "data/summary.json", "data/countries.json", "data/engine.json",
  "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js",
  "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js",
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || e.request.url.includes("api.worldbank.org")) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
