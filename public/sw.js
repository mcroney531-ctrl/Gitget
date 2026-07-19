const CACHE = "gitget-v3";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/fonts/radio-canada-latin.woff2",
  "/fonts/radio-canada-latin-ext.woff2",
  "/logo-mark.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache API calls
  if (
    e.request.method !== "GET" ||
    url.pathname === "/repos" ||
    url.pathname.startsWith("/repos/") ||
    url.pathname === "/sync" ||
    url.pathname === "/mcp" ||
    url.pathname === "/health"
  ) {
    return;
  }
  // Network-first for the shell so updates land, cache fallback for offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: url.pathname === "/" }))
  );
});
