/* KnockRadar service worker — instant repeat opens.
   App shell (index.html): served straight from cache, then refreshed in the background.
   If a newer version is found, open pages get a "tap to update" prompt and the next
   open uses it automatically. Google Fonts are cached forever (they are versioned URLs).
   Everything else (Supabase, Google Maps, weather, SpotCrime) goes to the network untouched. */
var SHELL = 'kr-shell-v1';
var FONTS = 'kr-fonts-v1';
var SHELL_URL = new URL('./', self.registration.scope).href;

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      return fetch(SHELL_URL, { cache: 'no-cache' }).then(function (r) {
        if (r && r.ok) return c.put(SHELL_URL, r);
      });
    }).catch(function () {})
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL && k !== FONTS) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isShell(req) {
  if (req.method !== 'GET') return false;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return false;
  if (req.mode === 'navigate') return true;
  return u.href.split('?')[0].split('#')[0] === SHELL_URL ||
         u.href.split('?')[0] === SHELL_URL + 'index.html';
}

function refreshShell(cached) {
  return fetch(SHELL_URL, { cache: 'no-cache' }).then(function (fresh) {
    if (!fresh || !fresh.ok) return;
    var copy = fresh.clone();
    return Promise.all([fresh.text(), cached ? cached.text() : Promise.resolve(null)]).then(function (t) {
      if (t[0] === t[1]) return;
      return caches.open(SHELL).then(function (c) { return c.put(SHELL_URL, copy); }).then(function () {
        if (!cached) return;
        return self.clients.matchAll({ type: 'window' }).then(function (cs) {
          cs.forEach(function (cl) { cl.postMessage({ type: 'kr-update' }); });
        });
      });
    });
  }).catch(function () {});
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (isShell(req)) {
    e.respondWith(
      caches.open(SHELL).then(function (c) { return c.match(SHELL_URL); }).then(function (hit) {
        if (hit) {
          e.waitUntil(refreshShell(hit.clone()));
          return hit;
        }
        return fetch(req).then(function (r) {
          if (r && r.ok) { var cp = r.clone(); caches.open(SHELL).then(function (c) { c.put(SHELL_URL, cp); }); }
          return r;
        });
      })
    );
    return;
  }
  var host = '';
  try { host = new URL(req.url).hostname; } catch (x) {}
  if (req.method === 'GET' && (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com')) {
    e.respondWith(
      caches.open(FONTS).then(function (c) {
        return c.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (r) {
            if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
            return r;
          });
        });
      })
    );
  }
});
