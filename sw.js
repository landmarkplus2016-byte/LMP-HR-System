// =============================================================================
// sw.js — Service Worker
//
// Strategy:
//   • Install:   pre-cache all static assets listed in STATIC_ASSETS
//   • Activate:  delete stale caches, claim all open clients
//   • Fetch:     stale-while-revalidate for static assets; network-only for API
//   • Sync:      'attendance-sync' tag → message open clients to processQueue()
//   • Message:   SKIP_WAITING → activate new version immediately
//                PURGE_CACHES → drop every cached asset, then reply
//
// ── Why stale-while-revalidate and not cache-first ──────────────────────────
// A browser only looks for a new service worker by byte-comparing sw.js. Editing
// js/hr.js without touching this file produced an identical sw.js, so no update
// was ever detected and pure cache-first then served the stale JS forever — the
// reason the app previously needed its history cleared after every deploy.
//
// Stale-while-revalidate makes every cached asset self-healing: the cached copy
// is served instantly (fast, and still works offline), while a background fetch
// refreshes the cache for the next load. The revalidation fetch uses
// cache: 'reload' so it also bypasses the browser's own HTTP cache — GitHub
// Pages serves with max-age, which would otherwise hand back a stale file.
//
// Update *notification* is not this file's job. version.json is the single
// source of truth there — see checkAppVersion() in js/offline.js. CACHE_VERSION
// below only needs bumping for a deliberate hard reset of every cached asset.
// =============================================================================

'use strict';

const CACHE_VERSION = 'lmp-v4';

// ---------------------------------------------------------------------------
// Derive the scope (handles both '/' in dev and '/sub-path/' on GitHub Pages)
// ---------------------------------------------------------------------------
const SCOPE = self.registration.scope; // e.g. 'https://example.com/LMP-HR-System/'

// ---------------------------------------------------------------------------
// Static assets to pre-cache on install.
// Use SCOPE-relative paths so this works in any deployment sub-directory.
// ---------------------------------------------------------------------------
const STATIC_ASSETS = [
  SCOPE,
  SCOPE + 'index.html',
  SCOPE + 'manifest.json',
  SCOPE + 'css/styles.css',
  SCOPE + 'css/rtl.css',
  SCOPE + 'css/mobile.css',
  SCOPE + 'css/desktop.css',
  SCOPE + 'js/utils.js',
  SCOPE + 'js/security.js',
  SCOPE + 'js/i18n.js',
  SCOPE + 'js/config.js',
  SCOPE + 'js/api.js',
  SCOPE + 'js/auth.js',
  SCOPE + 'js/gps.js',
  SCOPE + 'js/biometric.js',
  SCOPE + 'js/offline.js',
  SCOPE + 'js/attendance.js',
  SCOPE + 'js/employee.js',
  SCOPE + 'js/manager.js',
  SCOPE + 'js/exec.js',
  SCOPE + 'js/report.js',
  SCOPE + 'js/hr.js',
  SCOPE + 'js/app.js',
  SCOPE + 'locales/ar.json',
  SCOPE + 'locales/en.json',
  SCOPE + 'assets/icon-192.png',
  SCOPE + 'assets/icon-512.png',
  SCOPE + 'assets/icon-maskable-192.png',
  SCOPE + 'assets/icon-maskable-512.png',
  SCOPE + 'assets/logo.svg',
  // Referenced from css/styles.css and the desktop sidebar in js/app.js —
  // both were missing here, so neither was available offline
  SCOPE + 'background.png',
  SCOPE + 'LMP Big Logo-Photoroom.png',
];

// Never served from cache under any circumstance. version.json is how a running
// app finds out a new build exists — a cached copy would report the version the
// app already has and the update banner would never appear.
const NEVER_CACHE = ['version.json'];

// Hostnames that must never be served from the cache.
// Apps Script API calls and CDN fonts bypass the cache entirely.
const PASSTHROUGH_HOSTS = new Set([
  'script.google.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
]);

// =============================================================================
// INSTALL — pre-cache static assets
// Each asset is added individually so a single 404 doesn't abort the install.
// =============================================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      const tasks = STATIC_ASSETS.map(url =>
        cache.add(url).catch(err => {
          // Non-fatal: log and continue. Asset will be fetched live on first use.
          console.warn('[SW] Pre-cache miss:', url, err.message);
        })
      );
      return Promise.all(tasks);
    })
  );
  // Do NOT call self.skipWaiting() here — the page controls when to activate
  // via the SKIP_WAITING message so the user can choose the moment to refresh.
});

// =============================================================================
// ACTIVATE — clean stale caches, claim clients
// =============================================================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// =============================================================================
// FETCH — stale-while-revalidate for local static assets
// =============================================================================
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Let API calls, CDN fonts, and external resources go straight to the network
  if (PASSTHROUGH_HOSTS.has(url.hostname)) return;

  // Only intercept requests within our scope
  if (!req.url.startsWith(SCOPE)) return;

  // version.json must always reflect what is actually deployed
  const rel = url.pathname.slice(new URL(SCOPE).pathname.length);
  if (NEVER_CACHE.indexOf(rel) !== -1) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(cache =>
      cache.match(req).then(cached => {

        // Revalidate in the background. cache: 'reload' skips the browser's own
        // HTTP cache, so a freshly deployed file is picked up immediately rather
        // than after GitHub Pages' max-age expires.
        const revalidate = fetch(req.url, { cache: 'reload', credentials: 'same-origin' })
          .then(response => {
            if (response && response.status === 200 && response.type === 'basic') {
              cache.put(req, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => null);

        // Cached copy answers straight away; the refresh lands for next load.
        // waitUntil keeps the worker alive long enough to finish writing it.
        if (cached) {
          event.waitUntil(revalidate);
          return cached;
        }

        // Nothing cached — this request has to wait for the network. If that
        // fails too, fall back to the app shell so a navigation still renders.
        return revalidate.then(response => {
          if (response) return response;
          if (req.destination === 'document') {
            return caches.match(SCOPE + 'index.html');
          }
          return Response.error();
        });
      })
    )
  );
});

// =============================================================================
// BACKGROUND SYNC — tag: 'attendance-sync'
// When the browser fires this event (connectivity restored), we message all
// open page clients so offline.js can call processQueue() in the page context
// where api.js is available.  If no page is open the queue is replayed the
// next time the app is opened (offline.js checks on DOMContentLoaded).
// =============================================================================
self.addEventListener('sync', event => {
  if (event.tag === 'attendance-sync') {
    event.waitUntil(_notifyClients({ type: 'SYNC_ATTENDANCE' }));
  }
});

function _notifyClients(message) {
  return self.clients
    .matchAll({ type: 'window', includeUncontrolled: false })
    .then(clients => {
      clients.forEach(client => client.postMessage(message));
    });
}

// =============================================================================
// MESSAGES — received from page via worker.postMessage()
// =============================================================================
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    // Page asked us to activate immediately (user tapped the update banner).
    self.skipWaiting();
    return;
  }

  if (event.data.type === 'PURGE_CACHES') {
    // User tapped "Update Now". Drop every cached asset so the reload that
    // follows pulls the whole app fresh from the network, then tell the page
    // it is safe to reload. Replying matters: reloading before the delete
    // resolves would just re-serve the files we are trying to get rid of.
    event.waitUntil(
      caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .catch(() => {})
        .then(() => {
          if (event.source) event.source.postMessage({ type: 'CACHES_PURGED' });
        })
    );
  }
});
