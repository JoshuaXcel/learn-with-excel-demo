/* Learn with Excel demo v3 service worker.
   App files: network first (testers always get the newest build), cached for offline.
   Pyodide from the CDN (only loaded if a learner's code needs full Python): cache first. */
var APP = "lwe-demo-v3-1", PY = "lwe-python-0.27.8";
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== APP && k !== PY; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.hostname === "cdn.jsdelivr.net" && url.pathname.indexOf("/pyodide/") === 0) {
    e.respondWith(caches.open(PY).then(function (c) {
      return c.match(req.url).then(function (hit) { return hit || fetch(req).then(function (res) { if (res.ok) c.put(req.url, res.clone()); return res; }); });
    }));
    return;
  }
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(APP).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return caches.match(req).then(function (hit) { return hit || caches.match("index.html"); }); }));
  }
});
