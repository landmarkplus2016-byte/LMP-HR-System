// =============================================================================
// sw.js — Service Worker
//
// Strategy:
//   • Install:   pre-cache all static assets listed in STATIC_ASSETS
//   • Activate:  delete stale caches, claim all open clients
//   • Fetch:     cache-first for static assets; network-only for API calls
//   • Sync:      'attendance-sync' tag → message open clients to processQueue()
//   • Message:   SKIP_WAITING → activate new version immediately
//
// Version bump: change CACHE_VERSION whenever the asset list or logic changes.
// The old cache is automatically deleted on the next activate event.
// =============================================================================

'use strict';

const CACHE_VERSION = 'lmp-v3';

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
];

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
// FETCH — cache-first for local static assets
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

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      // Not in cache — fetch from network and opportunistically cache the response
      return fetch(req).then(response => {
        // Only cache valid, non-opaque, same-origin responses
        if (
          !response ||
          response.status !== 200 ||
          response.type === 'opaque' ||
          response.type === 'error'
        ) {
          return response;
        }

        const clone = response.clone();
        caches.open(CACHE_VERSION)
          .then(cache => cache.put(req, clone))
          .catch(() => {});

        return response;
      }).catch(() => {
        // Network failed and nothing is cached — return a minimal offline page
        // for navigation requests; for sub-resources just fail silently.
        if (req.destination === 'document') {
          return caches.match(SCOPE + 'index.html');
        }
      });
    })
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
  if (event.data && event.data.type === 'SKIP_WAITING') {
    // Page asked us to activate immediately (user tapped the update banner).
    self.skipWaiting();
  }
});
