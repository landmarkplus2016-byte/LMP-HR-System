// =============================================================================
// security.js — Device ID generation and tracking
//
// Produces a stable, per-device identifier derived from device fingerprint
// signals. Stored in localStorage on first call; returned from cache after.
// Sent with every API call so Apps Script can detect device mismatches.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// getDeviceId — synchronous, safe to call from api.js post()
//
// On first call: derives a stable ID from device fingerprint signals using
// FNV-1a (synchronous, no crypto.subtle required). Appends a creation
// timestamp segment to prevent collisions from fingerprint hash conflicts.
// On subsequent calls: returns the stored value instantly from localStorage.
// ---------------------------------------------------------------------------
function getDeviceId() {
  const stored = localStorage.getItem('lmp_device_id');
  if (stored) return stored;

  const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const raw = [navigator.userAgent, screen.width, screen.height, tz].join('|');

  // FNV-1a 32-bit — fast, deterministic, no external dependencies
  let h = 2166136261; // FNV offset basis
  for (let i = 0; i < raw.length; i++) {
    h = Math.imul(h ^ raw.charCodeAt(i), 16777619) >>> 0; // unsigned 32-bit
  }

  // Hex fingerprint + base-36 creation timestamp → stable on this device,
  // unique enough across devices even with the same fingerprint hash
  const deviceId = 'dev_' + h.toString(16).padStart(8, '0') + '_' + Date.now().toString(36);
  localStorage.setItem('lmp_device_id', deviceId);
  return deviceId;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
window.getDeviceId = getDeviceId;
