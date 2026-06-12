// =============================================================================
// offline.js — IndexedDB offline queue, background sync, update banner
//
// Public API (window-exported):
//   enqueue(action, payload)    — add a pending item to the queue
//   processQueue()              — replay pending items through api.js
//   getQueueCount()             — Promise<number> of pending items
//   queueOfflineCheckin(payload)— called by attendance.js on network failure
//   showUpdateBanner(worker)    — called by index.html SW registration
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const _DB_NAME    = 'lmp_offline';
const _DB_VERSION = 1;
const _STORE      = 'lmp_queue';
const _MAX_TRIES  = 3;

// Guard against concurrent processQueue() runs
let _processing = false;

// ---------------------------------------------------------------------------
// Action dispatch table — maps queue action → api.js call
// Add entries here as new offline-capable actions are introduced.
// ---------------------------------------------------------------------------
const _dispatch = {
  checkin:  p => typeof apiCheckIn  === 'function'
    ? apiCheckIn(p.lat, p.lng, p.accuracy, p.location_id, p.checkin_token)
    : Promise.resolve(null),

  checkout: p => typeof apiCheckOut === 'function'
    ? apiCheckOut(p.checkin_token)
    : Promise.resolve(null),
};

// =============================================================================
// IndexedDB helpers
// =============================================================================

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_DB_NAME, _DB_VERSION);

    req.onupgradeneeded = e => {
      const db    = e.target.result;
      if (!db.objectStoreNames.contains(_STORE)) {
        const store = db.createObjectStore(_STORE, { keyPath: 'id' });
        store.createIndex('status',    'status',    { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// Return all items with status === 'pending', sorted oldest-first.
function _getPending(db) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_STORE, 'readonly');
    const req = tx.objectStore(_STORE).index('status').getAll(IDBKeyRange.only('pending'));
    req.onsuccess = e => resolve(
      (e.target.result || []).slice().sort((a, b) => a.timestamp - b.timestamp)
    );
    req.onerror = e => reject(e.target.error);
  });
}

// Count items with status === 'pending'.
function _countPending(db) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_STORE, 'readonly');
    const req = tx.objectStore(_STORE).index('status').count(IDBKeyRange.only('pending'));
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// Overwrite specific fields on an existing record by id.
function _updateRecord(db, id, updates) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(_STORE, 'readwrite');
    const store = tx.objectStore(_STORE);
    const get   = store.get(id);
    get.onsuccess = e => {
      const item = e.target.result;
      if (item) store.put(Object.assign(item, updates));
    };
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

// =============================================================================
// Public: enqueue
// Adds one item to the pending queue and updates the UI indicator.
// =============================================================================
async function enqueue(action, payload) {
  const id = typeof generateId === 'function'
    ? generateId('q')
    : 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);

  const item = {
    id,
    action,
    payload:   { ...payload, action },
    timestamp: Date.now(),
    attempts:  0,
    status:    'pending',
  };

  const db = await _openDB();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(_STORE, 'readwrite');
    tx.objectStore(_STORE).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });

  _refreshIndicator(db);
}

// =============================================================================
// Public: getQueueCount
// =============================================================================
async function getQueueCount() {
  try {
    const db = await _openDB();
    return await _countPending(db);
  } catch (_) {
    return 0;
  }
}

// =============================================================================
// Public: processQueue
// Iterates every pending item in timestamp order, calls the matching api.js
// function, and marks it synced (or increments attempts up to _MAX_TRIES).
// =============================================================================
async function processQueue() {
  if (_processing) return;
  _processing = true;

  try {
    const db      = await _openDB();
    const pending = await _getPending(db);

    if (!pending.length) {
      _refreshIndicator(db);
      _processing = false;
      return;
    }

    for (const item of pending) {
      await _processOne(db, item);
    }

    _refreshIndicator(db);

    // If the queue is now empty, flash "All synced" briefly
    const remaining = await _countPending(db);
    if (remaining === 0) _flashSynced();

  } catch (err) {
    console.warn('[Offline] processQueue error:', err.message);
  } finally {
    _processing = false;
  }
}

async function _processOne(db, item) {
  const fn = _dispatch[item.action];

  if (!fn) {
    // Unknown action — mark failed immediately
    await _updateRecord(db, item.id, { status: 'failed', attempts: item.attempts + 1 });
    return;
  }

  let result = null;
  try { result = await fn(item.payload); } catch (_) { /* network failure — will retry */ }

  if (result && result.status === 'ok') {
    await _updateRecord(db, item.id, { status: 'synced' });
  } else {
    const attempts = item.attempts + 1;
    const status   = attempts >= _MAX_TRIES ? 'failed' : 'pending';
    await _updateRecord(db, item.id, { attempts, status });

    if (status === 'failed') {
      console.warn('[Offline] Item permanently failed after', _MAX_TRIES, 'attempts:', item.id);
      if (typeof showToast === 'function') {
        const msg = typeof t === 'function' ? t('sync.failed_records') : 'Sync failed';
        showToast(msg, 'error');
      }
    }
  }
}

// =============================================================================
// Public: queueOfflineCheckin
// Thin wrapper called by attendance.js when apiCheckIn() fails on a network
// error. Registers a Background Sync tag so the SW can replay when online.
// =============================================================================
function queueOfflineCheckin(payload) {
  const action = payload.action || 'checkin';

  enqueue(action, payload)
    .then(() => _registerSync())
    .catch(() => {});

  // Notify employee so they know the record is queued
  if (typeof showToast === 'function') {
    const msg = typeof t === 'function' ? t('offline.queued') : 'Saved — will sync when connected';
    showToast(msg, 'warning');
  }
}

// Register the Background Sync tag with the service worker.
function _registerSync() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then(reg => {
      if ('sync' in reg) return reg.sync.register('attendance-sync');
    })
    .catch(() => {});
}

// =============================================================================
// Sync indicator UI
// A small fixed bar (above the bottom nav) that shows pending count.
// Injected once into the DOM; updated by _refreshIndicator().
// =============================================================================

let _indicatorEl = null;
let _flashTimer  = null;

function _ensureIndicator() {
  if (_indicatorEl) return _indicatorEl;
  const el = document.createElement('div');
  el.id        = 'sync-bar';
  el.className = 'sync-bar sync-bar-hidden';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  document.body.appendChild(el);
  _indicatorEl = el;
  return el;
}

async function _refreshIndicator(db) {
  const el = _ensureIndicator();
  if (!db) {
    try { db = await _openDB(); } catch (_) { return; }
  }

  const count = await _countPending(db);

  if (count === 0) {
    // Hide if no pending (or currently showing the "synced" flash)
    if (!el.classList.contains('sync-bar-synced')) {
      el.classList.add('sync-bar-hidden');
    }
    return;
  }

  // Show pending count
  clearTimeout(_flashTimer);
  el.className = 'sync-bar sync-bar-pending';
  const label = (typeof t === 'function' ? t('sync.pending') : 'Pending sync') + `: ${count}`;
  el.textContent = `● ${label}`;
}

function _flashSynced() {
  const el = _ensureIndicator();
  clearTimeout(_flashTimer);

  el.className   = 'sync-bar sync-bar-synced';
  el.textContent = `✓ ${typeof t === 'function' ? t('sync.complete') : 'All synced'}`;

  _flashTimer = setTimeout(() => {
    el.classList.add('sync-bar-hidden');
  }, 3000);
}

// =============================================================================
// Public: showUpdateBanner
// Called by the SW registration script in index.html when a new version is
// waiting. Shows a non-intrusive bottom card with an "Update Now" button.
//
// worker      — ServiceWorker instance in "installed" / "waiting" state.
// Tap outside — dismisses the banner without updating.
// Tap button  — posts SKIP_WAITING → SW activates → page reloads.
// =============================================================================
function showUpdateBanner(worker) {
  // Don't stack multiple banners if the function is somehow called twice.
  const existing = document.getElementById('update-banner');
  if (existing && !existing.hidden) return;

  let banner = existing;
  if (!banner) {
    banner = document.createElement('div');
    banner.id        = 'update-banner';
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    document.body.appendChild(banner);
  }

  const lang     = localStorage.getItem('lmp_lang') || 'ar';
  const msg      = (typeof t === 'function' && t('update.available'))
                   || (lang === 'ar' ? 'إصدار جديد متاح' : 'A new version is available');
  const btnLabel = (typeof t === 'function' && t('update.now'))
                   || (lang === 'ar' ? 'تحديث الآن' : 'Update Now');

  banner.innerHTML = `
    <span class="update-banner-msg">${msg}</span>
    <button class="update-banner-btn" type="button" id="update-apply-btn">${btnLabel}</button>`;
  banner.hidden = false;

  // ── Dismiss helper — hides banner and removes the outside-click listener ──
  function dismiss() {
    banner.hidden = true;
    document.removeEventListener('click', _outsideClick);
  }

  // ── "Update Now" button ────────────────────────────────────────────────────
  document.getElementById('update-apply-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    dismiss();
    // Ask the waiting SW to take over immediately.
    worker.postMessage({ type: 'SKIP_WAITING' });
    // SW.activate runs clients.claim() → fires 'controllerchange' here → reload.
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true }
    );
  });

  // ── Tap / click outside banner → dismiss without updating ──────────────────
  // Defer by one tick so the click that triggered this call (if any) doesn't
  // immediately fire the listener and close the banner.
  function _outsideClick(e) {
    if (!banner.contains(e.target)) dismiss();
  }
  setTimeout(() => document.addEventListener('click', _outsideClick), 0);
}

// =============================================================================
// Initialisation — runs on DOMContentLoaded
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  _ensureIndicator();

  // Process any queued items immediately if we're already online
  if (navigator.onLine) {
    getQueueCount().then(n => { if (n > 0) processQueue(); });
  }

  // Re-process when connectivity is restored
  window.addEventListener('online', () => processQueue());

  // Re-process when the tab becomes visible (covers app-switcher return)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      getQueueCount().then(n => { if (n > 0) processQueue(); });
    }
  });

  // Handle SW → page messages (Background Sync trigger + SW_UPDATED)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
      const type = event.data?.type;

      if (type === 'SYNC_ATTENDANCE') {
        // Triggered by the 'attendance-sync' Background Sync event in sw.js
        processQueue();
      }
    });
  }
});

// =============================================================================
// Exports
// =============================================================================
window.enqueue             = enqueue;
window.processQueue        = processQueue;
window.getQueueCount       = getQueueCount;
window.queueOfflineCheckin = queueOfflineCheckin;
window.showUpdateBanner    = showUpdateBanner;
