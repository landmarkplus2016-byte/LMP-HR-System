// =============================================================================
// Integrity.gs — Retrospective GPS spoofing analysis over stored Attendance rows
//
// Android tags every location fix with an isFromMockProvider() flag, but only
// native apps can read it — the browser Geolocation API strips it before the
// PWA ever sees the coordinates. So there is no definitive "this was faked"
// answer available to us. What we can do is look at coordinates already sitting
// in the Attendance tab and find the patterns a spoofed pin produces and a real
// phone cannot.
//
// The signals, in order of strength:
//
//   Real GPS never returns the same coordinate twice. A stationary phone still
//   jitters 5-30m between fixes — atmospheric delay, satellite geometry and
//   multipath all move the solution around. A mock app returns the pin it was
//   handed, identical every time.
//
//   Real fixes never land on the exact centre of the geofence. A spoofer copies
//   the office coordinate off a map, and that coordinate is precisely the
//   centre point stored in the Locations tab.
//
//   Real accuracy varies with sky view and satellite count. An accuracy figure
//   that never changes across weeks is being reported, not measured.
//
// This module only READS. It never writes to Attendance, never blocks a
// check-in and never alters a stored record — it hands HR a ranked list to
// investigate. Every signal is circumstantial: a high score is a reason to
// look, never proof on its own. Confront nobody on the strength of a number
// from this screen.
// =============================================================================

// ---------------------------------------------------------------------------
// Thresholds
//
// Tuned to be quiet rather than sensitive — a screen that flags half the
// workforce gets ignored. Every threshold sits well outside what a real phone
// produces, so a flag means the reading was not physically plausible, not
// merely unusual.
// ---------------------------------------------------------------------------

const INTEGRITY_DEFAULT_DAYS = 90;   // analysis window when the caller sends none
const INTEGRITY_MIN_RECORDS  = 4;    // below this there is not enough to judge
const INTEGRITY_COORD_DP     = 6;    // ~0.1m — "the same point" to this precision
const INTEGRITY_SPREAD_M     = 3;    // real check-ins scatter wider than this
const INTEGRITY_CENTRE_M     = 2;    // this close to a geofence centre is not natural
const INTEGRITY_REPEAT_MIN   = 3;    // distinct days before a repeat counts
const INTEGRITY_ACC_MIN      = 4;    // distinct days of identical accuracy
const INTEGRITY_SAMPLE_MAX   = 6;    // evidence rows returned per employee

// Signal weights sum past 100 deliberately — an employee tripping three
// independent signals is pinned at the ceiling rather than ranked by arithmetic.
const INTEGRITY_WEIGHTS = {
  exact_repeat:      40,
  zero_jitter:       30,
  pinpoint_centre:   25,
  constant_accuracy: 20,
  device_mismatch:   10
};

// ---------------------------------------------------------------------------
// getIntegrityReport — HR only
// ---------------------------------------------------------------------------
// Payload: { session_token, date_from?, date_to? }
//
// Returns every employee scoring above zero, ranked most suspicious first,
// plus the workforce-wide median scatter so HR can see what normal looks like
// on this company's actual phones before judging any individual against it.
function getIntegrityReport(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const range = _integrityRange(payload);

  // Only the attending workforce — HR, CEO and MD never check in, so they have
  // no coordinates to analyse and would only pad the report.
  const employees = {};
  sheetToObjects(getSheet('Employees')).forEach(function(e) {
    if (!e.id || !isAttendingRole(e.role)) return;
    employees[String(e.id)] = {
      name:       String(e.name || ''),
      department: String(e.department || ''),
      active:     String(e.active).toUpperCase() !== 'FALSE'
    };
  });

  const locations = _integrityLocations();
  const grouped   = _integrityGroupRecords(range, employees);

  const results = [];
  const spreads = [];
  let   scanned = 0;
  let   skipped = 0;

  Object.keys(grouped).forEach(function(empId) {
    const records = grouped[empId];
    scanned += records.length;

    if (records.length < INTEGRITY_MIN_RECORDS) { skipped++; return; }

    const verdict = _integrityAnalyse(records, locations);
    spreads.push(verdict.spread_m);

    // A device mismatch on its own is not a spoofing finding. It already has
    // its own HR screen, and a reinstall or a borrowed phone trips it honestly
    // — listing those employees here would bury the real cases in noise. It
    // appears only as corroboration alongside a coordinate signal.
    const hasCoordSignal = verdict.signals.some(function(s) {
      return s.code !== 'device_mismatch';
    });
    if (!hasCoordSignal) return;

    const emp = employees[empId];
    results.push({
      employee_id:      empId,
      employee_name:    emp.name,
      department:       emp.department,
      active:           emp.active,
      records_analysed: records.length,
      first_date:       records[0].date,
      last_date:        records[records.length - 1].date,
      score:            verdict.score,
      level:            verdict.level,
      spread_m:         verdict.spread_m,
      signals:          verdict.signals,
      samples:          verdict.samples
    });
  });

  // Highest score first; equal scores broken by the tighter scatter, which is
  // the more damning of two otherwise-equal cases.
  results.sort(function(a, b) {
    return b.score - a.score || a.spread_m - b.spread_m;
  });

  return ok({
    date_from:         range.from,
    date_to:           range.to,
    employees_covered: Object.keys(grouped).length,
    employees_skipped: skipped,
    records_analysed:  scanned,
    baseline_spread_m: _integrityMedian(spreads),
    flagged:           results.length,
    results:           results
  });
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function _integrityRange(payload) {
  const to = String(payload.date_to || '').trim() || formatDate(new Date());

  let from = String(payload.date_from || '').trim();
  if (!from) {
    const d = new Date();
    d.setDate(d.getDate() - INTEGRITY_DEFAULT_DAYS);
    from = formatDate(d);
  }
  return { from: from, to: to };
}

function _integrityLocations() {
  const out = [];
  try {
    sheetToObjects(getSheet('Locations')).forEach(function(l) {
      const lat = Number(l.lat);
      const lng = Number(l.lng);
      if (!l.id || !isFinite(lat) || !isFinite(lng)) return;
      out.push({ id: String(l.id), name: String(l.name || ''), lat: lat, lng: lng });
    });
  } catch (_) {
    // No Locations tab — the centre-point signal simply never fires
  }
  return out;
}

// Group in-range Attendance rows by employee, oldest first.
//
// Rows written by add_manual_attendance carry no coordinates at all. They are
// HR's own entries, not device readings, so they are dropped rather than
// counted as evidence against the employee.
function _integrityGroupRecords(range, employees) {
  const grouped = {};

  sheetToObjects(getSheet('Attendance')).forEach(function(r) {
    const empId = String(r.employee_id || '');
    if (!r.id || !employees[empId]) return;
    if (r.lat === '' || r.lng === '') return;

    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return;

    let date;
    try { date = formatDate(new Date(r.date)); } catch (_) { return; }
    if (!date || date < range.from || date > range.to) return;

    if (!grouped[empId]) grouped[empId] = [];
    grouped[empId].push({
      date:         date,
      check_in:     _normaliseTime(r.check_in),
      lat:          lat,
      lng:          lng,
      accuracy:     Number(r.accuracy),
      location_id:  String(r.location_id || ''),
      device_match: String(r.device_match || '').toUpperCase()
    });
  });

  Object.keys(grouped).forEach(function(k) {
    grouped[k].sort(function(a, b) { return a.date.localeCompare(b.date); });
  });

  return grouped;
}

// ---------------------------------------------------------------------------
// _integrityAnalyse — run every signal against one employee's history
// ---------------------------------------------------------------------------
// Returns { score, level, spread_m, signals[], samples[] }.
// Each signal carries a code and params; the frontend renders them through
// i18n so nothing here is user-visible text.
function _integrityAnalyse(records, locations) {
  const signals = [];

  // ── Scatter radius: furthest check-in from the employee's own centroid ────
  let sumLat = 0;
  let sumLng = 0;
  records.forEach(function(r) { sumLat += r.lat; sumLng += r.lng; });
  const cLat = sumLat / records.length;
  const cLng = sumLng / records.length;

  let spread = 0;
  records.forEach(function(r) {
    const d = haversine(r.lat, r.lng, cLat, cLng);
    if (d > spread) spread = d;
  });
  spread = Math.round(spread * 10) / 10;

  // ── Signal 1: the identical coordinate on separate days ──────────────────
  // The strongest of the five. Two real fixes agreeing to six decimal places
  // is not something GPS does, let alone three across different days.
  const byPoint = {};
  records.forEach(function(r) {
    const key = r.lat.toFixed(INTEGRITY_COORD_DP) + ',' + r.lng.toFixed(INTEGRITY_COORD_DP);
    if (!byPoint[key]) byPoint[key] = {};
    byPoint[key][r.date] = true;
  });

  let topPoint = '';
  let topDays  = 0;
  Object.keys(byPoint).forEach(function(k) {
    const days = Object.keys(byPoint[k]).length;
    if (days > topDays) { topDays = days; topPoint = k; }
  });

  if (topDays >= INTEGRITY_REPEAT_MIN) {
    signals.push({
      code:   'exact_repeat',
      weight: INTEGRITY_WEIGHTS.exact_repeat,
      params: { days: topDays, point: topPoint }
    });
  }

  // ── Signal 2: no scatter across the whole history ────────────────────────
  // Walking from the car park to a desk moves you further than this. A history
  // that fits inside a 3m circle was not produced by walking anywhere.
  if (spread < INTEGRITY_SPREAD_M) {
    signals.push({
      code:   'zero_jitter',
      weight: INTEGRITY_WEIGHTS.zero_jitter,
      params: { spread: spread, records: records.length }
    });
  }

  // ── Signal 3: fixes landing on the geofence centre itself ────────────────
  // The centre point is a number in the Locations tab, not a place a phone can
  // resolve to repeatedly. Hitting it is the signature of a copied coordinate.
  let centreHits = 0;
  let centreName = '';
  records.forEach(function(r) {
    for (let i = 0; i < locations.length; i++) {
      if (haversine(r.lat, r.lng, locations[i].lat, locations[i].lng) <= INTEGRITY_CENTRE_M) {
        centreHits++;
        centreName = locations[i].name;
        return;
      }
    }
  });

  if (centreHits >= INTEGRITY_REPEAT_MIN) {
    signals.push({
      code:   'pinpoint_centre',
      weight: INTEGRITY_WEIGHTS.pinpoint_centre,
      params: { hits: centreHits, location: centreName }
    });
  }

  // ── Signal 4: an accuracy figure that never moves ────────────────────────
  // Accuracy tracks satellite count and sky view, both of which change day to
  // day. A constant is a value the mock app was configured to report.
  const byAcc = {};
  records.forEach(function(r) {
    if (!isFinite(r.accuracy) || r.accuracy <= 0) return;
    const key = r.accuracy.toFixed(2);
    if (!byAcc[key]) byAcc[key] = {};
    byAcc[key][r.date] = true;
  });

  let topAcc     = '';
  let topAccDays = 0;
  Object.keys(byAcc).forEach(function(k) {
    const days = Object.keys(byAcc[k]).length;
    if (days > topAccDays) { topAccDays = days; topAcc = k; }
  });

  if (topAccDays >= INTEGRITY_ACC_MIN) {
    signals.push({
      code:   'constant_accuracy',
      weight: INTEGRITY_WEIGHTS.constant_accuracy,
      params: { days: topAccDays, accuracy: Number(topAcc) }
    });
  }

  // ── Signal 5: check-in from a device other than the one that logged in ───
  // Weak alone — a shared tablet or a reinstall trips it honestly — but it
  // corroborates the others, so it carries the smallest weight.
  let mismatches = 0;
  records.forEach(function(r) { if (r.device_match === 'FALSE') mismatches++; });

  if (mismatches > 0) {
    signals.push({
      code:   'device_mismatch',
      weight: INTEGRITY_WEIGHTS.device_mismatch,
      params: { count: mismatches }
    });
  }

  // ── Score ────────────────────────────────────────────────────────────────
  let score = 0;
  signals.forEach(function(s) { score += s.weight; });
  if (score > 100) score = 100;

  return {
    score:    score,
    level:    score >= 60 ? 'high' : score >= 30 ? 'medium' : score > 0 ? 'low' : 'clean',
    spread_m: spread,
    signals:  signals,
    samples:  _integritySamples(records)
  };
}

// Most recent check-ins, newest first — the raw coordinates HR needs in order
// to see the pattern for themselves rather than trust the score.
function _integritySamples(records) {
  return records.slice(-INTEGRITY_SAMPLE_MAX).reverse().map(function(r) {
    return {
      date:         r.date,
      check_in:     r.check_in,
      lat:          r.lat.toFixed(INTEGRITY_COORD_DP),
      lng:          r.lng.toFixed(INTEGRITY_COORD_DP),
      accuracy:     isFinite(r.accuracy) ? r.accuracy : '',
      device_match: r.device_match
    };
  });
}

// Median rather than mean — one spoofer with a 0m scatter would drag an
// average down and make everyone else look suspicious by comparison.
function _integrityMedian(values) {
  if (!values.length) return null;
  const s   = values.slice().sort(function(a, b) { return a - b; });
  const mid = Math.floor(s.length / 2);
  const m   = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 10) / 10;
}
