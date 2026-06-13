// =============================================================================
// config.js — App configuration loader and cache
//
// Loads config from the Config tab via Apps Script on startup.
// Auth.gs returns config alongside every login response; auth.js calls
// setCachedConfig() so a second network round-trip is avoided.
// All consumers call getConfig(key) — never access _appConfig directly.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Fallback values — mirrors the Config tab defaults from CLAUDE.md.
// These are used if the network call fails so the app never halts on startup.
// ---------------------------------------------------------------------------
const _DEFAULTS = {
  app_name:              'LMP Attendance',
  company_name:          'Landmark Plus',
  geofence_radius_m:     150,
  late_threshold_min:    15,
  gps_accuracy_max_m:    200,
  session_expiry_hours:  8,
  auto_checkout_enabled: 'false',
  offline_sync_enabled:  'true',
  primary_language:      'ar',
  working_days:          '0,1,2,3,4',
  biometric_required:    'true',
};

let _appConfig = Object.assign({}, _DEFAULTS);

// ---------------------------------------------------------------------------
// loadConfig — called by App.init() on startup
//
// Uses apiGetConfig() from api.js which does NOT require a session token.
// On failure, logs a warning and continues with the fallback values above.
// ---------------------------------------------------------------------------
async function loadConfig() {
  try {
    if (typeof apiGetConfig !== 'function') return;
    const result = await apiGetConfig();
    if (result && result.status === 'ok' && result.data?.config) {
      setCachedConfig(result.data.config);
    }
  } catch (err) {
    console.warn('[Config] Load failed — using defaults.', err.message);
  }
}

// ---------------------------------------------------------------------------
// setCachedConfig — accepts the config object returned by login / get_config
//
// Merges with defaults so missing keys always have a safe value.
// Called by auth.js after a successful login response.
// ---------------------------------------------------------------------------
function setCachedConfig(config) {
  if (!config || typeof config !== 'object') return;
  _appConfig = Object.assign({}, _DEFAULTS, config);
}

// ---------------------------------------------------------------------------
// getConfig — synchronous read
//
// Pass a key to get a single value, or omit key to get the whole config.
// ---------------------------------------------------------------------------
function getConfig(key) {
  if (key === undefined || key === null) return _appConfig;
  const val = _appConfig[key];
  return val !== undefined ? val : _DEFAULTS[key];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
window.loadConfig      = loadConfig;
window.setCachedConfig = setCachedConfig;
window.getConfig       = getConfig;
