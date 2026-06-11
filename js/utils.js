// =============================================================================
// utils.js — Browser-side shared utilities
// Pure functions only — no DOM, no network calls, no side-effects.
// Server-side counterpart: appscript/Utils.gs (must stay in sync).
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// hashPassword — async SHA-256 via Web Crypto API
//
// Must produce identical hex output to Utils.gs hashPassword().
// Both encode the input as UTF-8 and hex-encode each byte the same way.
// ---------------------------------------------------------------------------
async function hashPassword(plain) {
  const msgBuffer  = new TextEncoder().encode(String(plain));
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// generateId — collision-resistant identifier
// Format: prefix_<timestamp>_<random9>   e.g. "att_1714567890123_k3j2n8xqp"
// ---------------------------------------------------------------------------
function generateId(prefix) {
  const rand = Math.random().toString(36).slice(2, 11);
  return (prefix || 'id') + '_' + Date.now() + '_' + rand;
}

// ---------------------------------------------------------------------------
// haversine — distance in metres between two WGS-84 coordinates
// Must match Utils.gs haversine() exactly — both sides use it for geofencing.
// ---------------------------------------------------------------------------
function haversine(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// formatDate — display-only date formatting
// CLAUDE.md rule: DD/MM/YYYY in both languages.
// Stored dates are always YYYY-MM-DD — this is for display only.
// ---------------------------------------------------------------------------
function formatDate(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  return day + '/' + mon + '/' + d.getFullYear();
}

// ---------------------------------------------------------------------------
// formatTime — 12-hour time string, language-aware
// Arabic (lmp_lang = ar): 08:52 ص / 03:45 م
// English (lmp_lang = en): 08:52 AM / 03:45 PM
// ---------------------------------------------------------------------------
function formatTime(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const lang  = localStorage.getItem('lmp_lang') || 'ar';
  let   h     = d.getHours();
  const m     = String(d.getMinutes()).padStart(2, '0');
  const isAm  = h < 12;
  h = h % 12 || 12;
  const hStr   = String(h).padStart(2, '0');
  const suffix = lang === 'ar'
    ? (isAm ? ' ص' : ' م')
    : (isAm ? ' AM' : ' PM');
  return hStr + ':' + m + suffix;
}

// ---------------------------------------------------------------------------
// formatDateTime — convenience: formatDate + space + formatTime
// ---------------------------------------------------------------------------
function formatDateTime(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return formatDate(d) + '  ' + formatTime(d);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
window.hashPassword   = hashPassword;
window.generateId     = generateId;
window.haversine      = haversine;
window.formatDate     = formatDate;
window.formatTime     = formatTime;
window.formatDateTime = formatDateTime;
