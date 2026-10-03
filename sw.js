/* RummyNest service worker — bump VERSION on every upload */
const VERSION = 'rummynest-v3';
const FILES = ['./', 'index.html', 'manifest.json', 'privacy_policy.html', 'icon-192.png', 'icon-512.png'];
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RummyNest</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#070707;color:#f3efe4;font-family:system-ui;text-align:center"><div><div style="font-size:64px">🃏</div><h2>אין חיבור לאינטרנט · You are offline</h2><p>האפליקציה תיטען כשהחיבור יחזור.</p><button onclick="location.reload()" style="font-size:18px;padding:12px 24px;border-radius:12px;border:2px solid #d4a940;background:#d4a940;color:#140f02">נסה שוב · Retry</button></div>';
// Cloudflare answers x.html with a 308 to x — every navigation answer is served as a clean (non-redirected) copy
const _respondWith = FetchEvent.prototype.respondWith;
FetchEvent.prototype.respondWith = function (p) {
  if (this.request.mode !== 'navigate') return _respondWith.call(this, p);
  return _respondWith.call(this, Promise.resolve(p).then(r => (r && r.redirected) ? r.blob().then(b => new Response(b, { status: 200, headers: { 'Content-Type': r.headers.get('Content-Type') || 'text/html; charset=utf-8' } })) : r));
};
// always a Promise (a plain Response has no .then — that slip turned every navigation into the offline page)
const clean = r => r.redirected ? r.clone().blob().then(b => new Response(b, { headers: { 'Content-Type': r.headers.get('Content-Type') || '' } })) : Promise.resolve(r.clone());
self.addEventListener('install', e => {
  // one file at a time — a single failure must not leave the cache empty
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(FILES.map(f => fetch(f, { cache: 'reload' }).then(r => { if (r.ok) return clean(r).then(x => c.put(f, x)); })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('rummynest-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const timeout = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, err => { clearTimeout(t); rej(err); }); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // NB: a navigate Request can't be re-used with an init object (TypeError) — fetch its URL instead
  if (req.mode === 'navigate') {   // network first (4 s) → cache → friendly offline page, never an error
    e.respondWith(timeout(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }), 4000).then(r => { if (r.ok && new URL(r.url).pathname.replace(/index$/, '') === new URL(self.registration.scope).pathname) clean(r).then(x => caches.open(VERSION).then(c => c.put('index.html', x))).catch(() => {}); return r; })
      .catch(() => caches.match('index.html').then(r => r || caches.match('./')).then(r => r || new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
    return;
  }
  if (/peerjs/.test(url.href)) return;                       // PeerJS library + signalling: always live
  if (url.origin === location.origin) {                        // app files: network first, cache for offline
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)).catch(() => {}); } return r; }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || Response.error())));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.host)) {   // fonts: cache first
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(n => { const cp = n.clone(); caches.open(VERSION).then(c => c.put(req, cp)).catch(() => {}); return n; })));
  }
});
