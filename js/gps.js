// =============================================================================
// gps.js — Geolocation, accuracy validation, mock detection, geofence check
//
// Client-side GPS is for instant UI feedback only.
// Attendance.gs re-validates every check-in independently — never skip it.
// =============================================================================

'use strict';

// High-accuracy options per CLAUDE.md spec.
const _GPS_OPTIONS = {
  enableHighAccuracy: true,
  timeout:            10000,
  maximumAge:         0,
};

// Substrings in navigator.userAgentData.brands that indicate mock GPS tooling.
const _MOCK_BRAND_FRAGMENTS = ['fakegps', 'mocklocation', 'floater', 'gps joystick'];

// ---------------------------------------------------------------------------
// getPosition — async wrapper around getCurrentPosition
//
// Resolves with { lat, lng, accuracy } on success.
// Always resolves (never rejects) so callers can use plain await.
// Error codes: 'denied' | 'timeout' | 'unavailable'
// ---------------------------------------------------------------------------
async function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ error: 'unavailable' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => {
        if      (err.code === err.PERMISSION_DENIED) resolve({ error: 'denied' });
        else if (err.code === err.TIMEOUT)           resolve({ error: 'timeout' });
        else                                         resolve({ error: 'unavailable' });
      },
      _GPS_OPTIONS
    );
  });
}

// ---------------------------------------------------------------------------
// checkAccuracy — validate reading quality
//
// accuracy < 5m  → DevTools fake GPS (Chrome DevTools returns exactly 5 or 0)
// accuracy > max → too imprecise for reliable geofencing
// max reads from getConfig('gps_accuracy_max_m'), default 200.
// ---------------------------------------------------------------------------
function checkAccuracy(accuracy) {
  if (accuracy < 5) {
    return { valid: false, reason: t('gps.fake_detected') };
  }
  const max = Number(getConfig('gps_accuracy_max_m')) || 200;
  if (accuracy > max) {
    return { valid: false, reason: t('gps.weak') };
  }
  return { valid: true, reason: '' };
}

// ---------------------------------------------------------------------------
// checkGeofence — nearest active location and in-range status
//
// locations: array of { id, name, lat, lng, radius_m, active }
// Uses per-location radius_m when set; falls back to geofence_radius_m config.
// Always returns the nearest location so the UI can display distance feedback
// even when the employee is out of range.
// ---------------------------------------------------------------------------
function checkGeofence(lat, lng, locations) {
  const empty = { inRange: false, locationId: null, locationName: null, distance: null };
  if (!Array.isArray(locations) || locations.length === 0) return empty;

  const active = locations.filter(
    l => String(l.active).toUpperCase() !== 'FALSE' && l.active !== false
  );
  if (active.length === 0) return empty;

  const defaultRadius = Number(getConfig('geofence_radius_m')) || 150;
  let nearest     = null;
  let nearestDist = Infinity;

  for (const loc of active) {
    const dist = haversine(lat, lng, Number(loc.lat), Number(loc.lng));
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest     = loc;
    }
  }

  const radius = Number(nearest.radius_m) || defaultRadius;
  return {
    inRange:      nearestDist <= radius,
    locationId:   nearest.id,
    locationName: nearest.name,
    distance:     Math.round(nearestDist),
  };
}

// ---------------------------------------------------------------------------
// detectMockLocation — heuristic via User Agent Client Hints
//
// Checks navigator.userAgentData.brands for strings associated with common
// Android mock GPS apps. Missing userAgentData (older browser / desktop) is
// treated as inconclusive — not flagged as suspicious.
// ---------------------------------------------------------------------------
function detectMockLocation() {
  try {
    const uad = navigator.userAgentData;
    if (!uad || !Array.isArray(uad.brands)) return { suspicious: false };

    const brands = uad.brands.map(b => (b.brand || '').toLowerCase());
    const suspicious = _MOCK_BRAND_FRAGMENTS.some(
      frag => brands.some(b => b.includes(frag))
    );
    return { suspicious };
  } catch (_) {
    return { suspicious: false };
  }
}

// ---------------------------------------------------------------------------
// checkGPS — orchestrated client-side GPS validation
//
// Steps in order:
//   1. getPosition()        — acquire coordinates
//   2. checkAccuracy()      — reject fake / weak readings
//   3. detectMockLocation() — flag suspicious user agents
//   4. checkGeofence()      — compare against window.appLocations cache
//
// Returns a flat result object; ok: true only when all four checks pass.
//
// IMPORTANT: This result drives UI feedback only.
// Attendance.gs runs an independent server-side geofence check on every
// check-in and is the security authority — never replace it with this.
// ---------------------------------------------------------------------------
async function checkGPS() {
  const result = {
    ok:           false,
    error:        null,
    lat:          null,
    lng:          null,
    accuracy:     null,
    accuracyValid: false,
    suspicious:   false,
    inRange:      false,
    locationId:   null,
    locationName: null,
    distance:     null,
  };

  // 1 — acquire position
  const pos = await getPosition();
  if (pos.error) {
    result.error = pos.error === 'denied'  ? t('gps.denied')
                 : pos.error === 'timeout' ? t('gps.timeout')
                 :                           t('gps.unavailable');
    return result;
  }
  result.lat      = pos.lat;
  result.lng      = pos.lng;
  result.accuracy = pos.accuracy;

  // 2 — accuracy gate
  const acc = checkAccuracy(pos.accuracy);
  result.accuracyValid = acc.valid;
  if (!acc.valid) {
    result.error = acc.reason;
    return result;
  }

  // 3 — mock location detection
  const mock = detectMockLocation();
  result.suspicious = mock.suspicious;
  if (mock.suspicious) {
    result.error = t('gps.fake_detected');
    return result;
  }

  // 4 — geofence check against cached active locations
  const locations = window.appLocations || [];
  const fence     = checkGeofence(pos.lat, pos.lng, locations);
  result.inRange      = fence.inRange;
  result.locationId   = fence.locationId;
  result.locationName = fence.locationName;
  result.distance     = fence.distance;

  if (!fence.inRange) {
    result.error = t('gps.outside_range');
    return result;
  }

  result.ok = true;
  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
window.getPosition        = getPosition;
window.checkAccuracy      = checkAccuracy;
window.checkGeofence      = checkGeofence;
window.detectMockLocation = detectMockLocation;
window.checkGPS           = checkGPS;
