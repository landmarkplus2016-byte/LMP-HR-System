// =============================================================================
// Attendance.gs — Check-in, check-out, attendance history
// =============================================================================

// ---------------------------------------------------------------------------
// checkIn
// ---------------------------------------------------------------------------
// Payload: { session_token, checkin_token?, lat, lng, accuracy,
//            location_id?, device_id }
//
// Flow:
//   1. validateSession
//   2. verify checkin_token  (skipped for biometric_exempt employees)
//   3. GPS accuracy gate     (server re-validates independently)
//   4. Server-side haversine check against Locations tab
//   5. Duplicate check       (no open check-in for this employee today)
//   6. Determine status      (present / late based on shift start + threshold)
//   7. Write Attendance row
function checkIn(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const employee = auth.employee;
  const isExempt = String(employee.biometric_exempt || '').toUpperCase() === 'TRUE';

  // 2 — checkin_token (skipped for exempt employees)
  if (!isExempt) {
    const tokenErr = _consumeCheckinToken(payload, employee.id);
    if (tokenErr) return tokenErr;
  }

  // 3 — GPS accuracy gate
  const lat      = Number(payload.lat);
  const lng      = Number(payload.lng);
  const accuracy = Number(payload.accuracy);

  if (isNaN(lat) || isNaN(lng) || lat === 0 && lng === 0) {
    return error('Invalid GPS coordinates', 'إحداثيات GPS غير صالحة');
  }
  const maxAcc = Number(getConfigValue('gps_accuracy_max_m', 200));
  if (accuracy < 5 || accuracy > maxAcc) {
    return error('GPS accuracy out of range', 'دقة GPS خارج النطاق المقبول');
  }

  // 4 — server-side geofence
  const geo = _serverGeofenceCheck(lat, lng);
  if (!geo.inRange) {
    return error('Location not within any company site', 'الموقع خارج نطاق موقع العمل');
  }

  // 5 — duplicate check
  const attSheet = getSheet('Attendance');
  const today    = formatDate(new Date());
  if (_findOpenCheckin(attSheet, employee.id, today)) {
    return error('Already checked in today', 'لقد سجّلت حضورك اليوم بالفعل');
  }

  // 6 — status: present or late
  const checkInTime = formatTime(new Date());
  const shift       = employee.shift_id ? _getShift(String(employee.shift_id)) : null;
  const status      = _determineStatus(checkInTime, shift);

  // 7 — device match flag
  const deviceMatch = String(payload.device_id || '') === String(auth.session.device_id || '')
    ? 'TRUE' : 'FALSE';

  // 8 — write row
  const recordId = generateId('att');
  appendRow(attSheet, {
    id:                 recordId,
    employee_id:        employee.id,
    date:               today,
    check_in:           checkInTime,
    check_out:          '',
    hours_worked:       '',
    location_id:        geo.locationId,
    lat:                lat,
    lng:                lng,
    accuracy:           accuracy,
    biometric_verified: isExempt ? 'FALSE' : 'TRUE',
    biometric_method:   isExempt ? 'exempt' : 'webauthn',
    device_id:          String(payload.device_id || ''),
    device_match:       deviceMatch,
    status:             status,
    notes:              '',
    corrected_by:       '',
    corrected_at:       ''
  });

  return ok({
    check_in_time:  checkInTime,
    location_name:  geo.locationName,
    status:         status,
    record_id:      recordId
  });
}

// ---------------------------------------------------------------------------
// checkOut
// ---------------------------------------------------------------------------
// Payload: { session_token, device_id }
// Finds the open check-in for today, calculates hours, updates the row.
function checkOut(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const employee = auth.employee;
  const attSheet = getSheet('Attendance');
  const today    = formatDate(new Date());

  const record = _findOpenCheckin(attSheet, employee.id, today);
  if (!record) {
    return error('No open check-in found for today', 'لم يتم العثور على تسجيل حضور مفتوح اليوم');
  }

  const now          = new Date();
  const checkOutTime = formatTime(now);

  // Reconstruct full check-in datetime from the stored date + HH:MM time
  const checkInDate  = new Date(today + 'T' + String(record.check_in).padStart(5, '0') + ':00');
  const hours        = _calcHoursWorked(checkInDate, now);

  // Re-evaluate status at checkout (in case clock drifted at check-in)
  const shift  = employee.shift_id ? _getShift(String(employee.shift_id)) : null;
  const status = _determineStatus(String(record.check_in), shift);

  updateRow(attSheet, record.__rowIndex, {
    check_out:    checkOutTime,
    hours_worked: hours,
    status:       status
  });

  return ok({
    check_out_time: checkOutTime,
    hours_worked:   hours,
    status:         status
  });
}

// ---------------------------------------------------------------------------
// getMyAttendance
// ---------------------------------------------------------------------------
// Payload: { session_token }
// Returns the calling employee's last 30 days of attendance records,
// sorted descending by date. Never returns other employees' data.
function getMyAttendance(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = formatDate(cutoff);

  const records = sheetToObjects(getSheet('Attendance'))
    .filter(r =>
      String(r.employee_id) === String(auth.employee.id) &&
      String(r.date) >= cutoffStr
    )
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  records.forEach(r => delete r.__rowIndex);
  return ok({ records });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

// Validate, consume (mark used) the one-time checkin_token from the payload.
// Returns null on success, or an error object if validation fails.
function _consumeCheckinToken(payload, employeeId) {
  const token = String(payload.checkin_token || '').trim();
  if (!token) {
    return error('Check-in token required', 'رمز تسجيل الحضور مطلوب');
  }

  const sessSheet = getSheet('Sessions');
  const row       = findRow(sessSheet, 'token', token);

  if (!row)
    return error('Invalid check-in token', 'رمز تسجيل الحضور غير صالح');
  if (String(row.token_type) !== 'checkin_token')
    return error('Invalid token type', 'نوع الرمز غير صالح');
  if (String(row.employee_id) !== String(employeeId))
    return error('Token does not match employee', 'الرمز لا يطابق الموظف');
  if (String(row.used).toUpperCase() === 'TRUE')
    return error('Token already used', 'تم استخدام الرمز بالفعل');

  const now       = new Date();
  const expiresAt = new Date(row.expires_at);
  if (isNaN(expiresAt.getTime()) || now > expiresAt) {
    deleteSheetRow(sessSheet, row.__rowIndex);
    return error('Check-in token expired', 'انتهت صلاحية رمز تسجيل الحضور');
  }

  updateRow(sessSheet, row.__rowIndex, { used: 'TRUE' });
  return null;
}

// Run haversine against every active location.
// Returns { inRange, locationId, locationName, distance }.
function _serverGeofenceCheck(lat, lng) {
  const defaultRadius = Number(getConfigValue('geofence_radius_m', 150));

  let locations;
  try {
    locations = sheetToObjects(getSheet('Locations'))
      .filter(l => String(l.active).toUpperCase() === 'TRUE');
  } catch (e) {
    return { inRange: false, locationId: null, locationName: null, distance: null };
  }

  if (locations.length === 0) {
    return { inRange: false, locationId: null, locationName: null, distance: null };
  }

  let nearest     = null;
  let nearestDist = Infinity;
  for (const loc of locations) {
    const dist = haversine(lat, lng, Number(loc.lat), Number(loc.lng));
    if (dist < nearestDist) { nearestDist = dist; nearest = loc; }
  }

  const radius = Number(nearest.radius_m) || defaultRadius;
  return {
    inRange:      nearestDist <= radius,
    locationId:   nearest.id,
    locationName: nearest.name,
    distance:     Math.round(nearestDist)
  };
}

// Find the first open check-in row for this employee on the given date.
// Open = check_in present AND check_out absent.
function _findOpenCheckin(attSheet, employeeId, today) {
  return sheetToObjects(attSheet).find(r =>
    String(r.employee_id) === String(employeeId) &&
    String(r.date)        === String(today)      &&
    r.check_in            &&
    !r.check_out
  ) || null;
}

// Look up a shift by ID. Returns null on any failure.
function _getShift(shiftId) {
  try {
    return findRow(getSheet('Shifts'), 'id', shiftId);
  } catch (_) {
    return null;
  }
}

// Compare HH:MM check-in time against shift start + late_threshold_min.
// Returns 'late' or 'present'. Falls back to 'present' on missing data.
function _determineStatus(checkInTime, shift) {
  if (!shift || !shift.start_time) return 'present';

  const threshold = Number(
    shift.late_threshold_min || getConfigValue('late_threshold_min', 15)
  );
  const parts = [String(shift.start_time), String(checkInTime)]
    .map(t => t.split(':').map(Number));

  if (parts.some(p => p.some(isNaN))) return 'present';

  const shiftMins = parts[0][0] * 60 + parts[0][1] + threshold;
  const checkMins = parts[1][0] * 60 + parts[1][1];

  return checkMins > shiftMins ? 'late' : 'present';
}

// Decimal hours with 2 d.p. (e.g. 8.25 = 8 h 15 min).
function _calcHoursWorked(checkIn, checkOut) {
  const ms = new Date(checkOut) - new Date(checkIn);
  if (ms < 0) return 0;
  return Math.round(ms / 36000) / 100;
}

// ---------------------------------------------------------------------------
// getAllAttendance — HR only
// ---------------------------------------------------------------------------
// Payload: { session_token, employee_id?, date_from?, date_to? }
// Returns all attendance records, optionally filtered, with employee names
// and location names joined in.
function getAllAttendance(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const filterEmpId  = String(payload.employee_id || '').trim();
  const filterFrom   = String(payload.date_from   || '').trim();
  const filterTo     = String(payload.date_to     || '').trim();

  // Build lookup maps so we can join without repeated sheet reads
  const empMap = {};
  sheetToObjects(getSheet('Employees')).forEach(function(e) {
    empMap[String(e.id)] = { name: e.name || '', department: e.department || '' };
  });

  const locMap = {};
  try {
    sheetToObjects(getSheet('Locations')).forEach(function(l) {
      locMap[String(l.id)] = String(l.name || '');
    });
  } catch (_) {}

  let records = sheetToObjects(getSheet('Attendance'));

  if (filterEmpId) records = records.filter(function(r) { return String(r.employee_id) === filterEmpId; });
  if (filterFrom)  records = records.filter(function(r) { return String(r.date) >= filterFrom; });
  if (filterTo)    records = records.filter(function(r) { return String(r.date) <= filterTo; });

  records.sort(function(a, b) {
    const d = String(b.date).localeCompare(String(a.date));
    return d !== 0 ? d : String(b.check_in || '').localeCompare(String(a.check_in || ''));
  });

  records = records.map(function(r) {
    const out = {};
    for (const k in r) { if (k !== '__rowIndex') out[k] = r[k]; }
    const emp          = empMap[String(r.employee_id)] || {};
    out.employee_name  = emp.name       || '';
    out.department     = emp.department || '';
    out.location_name  = locMap[String(r.location_id || '')] || '';
    return out;
  });

  return ok({ records: records });
}

// ---------------------------------------------------------------------------
// correctAttendance — HR only
// ---------------------------------------------------------------------------
// Payload: { session_token, record_id, corrections: { check_in?, check_out?,
//           status?, notes? }, hr_note }
// Saves the original to AttendanceLog then applies corrections.
function correctAttendance(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const recordId   = String(payload.record_id || '').trim();
  const hrNote     = String(payload.hr_note   || '').trim();
  const corrections = payload.corrections || {};

  if (!recordId) return error('Record ID is required',              'معرّف السجل مطلوب');
  if (!hrNote)   return error('HR note is required for corrections', 'ملاحظة المسؤول مطلوبة للتصحيح');

  const attSheet = getSheet('Attendance');
  const original = findRow(attSheet, 'id', recordId);
  if (!original) return error('Attendance record not found', 'سجل الحضور غير موجود');

  // 1 — Write original row + audit info to AttendanceLog
  const logEntry = {};
  for (const k in original) { if (k !== '__rowIndex') logEntry[k] = original[k]; }
  logEntry.hr_note      = hrNote;
  logEntry.corrected_by = String(auth.employee.id);
  logEntry.corrected_at = new Date().toISOString();
  appendRow(getSheet('AttendanceLog'), logEntry);

  // 2 — Build the update object (only whitelisted fields)
  const ALLOWED = { check_in: 1, check_out: 1, status: 1, notes: 1 };
  const updates = {
    corrected_by: String(auth.employee.id),
    corrected_at: new Date().toISOString(),
    notes:        hrNote
  };
  for (const key in corrections) {
    if (ALLOWED[key] !== undefined && corrections[key] !== null && corrections[key] !== undefined) {
      updates[key] = String(corrections[key]);
    }
  }

  // 3 — Recalculate hours_worked if both times are now available
  const ciStr  = (updates.check_in  !== undefined ? updates.check_in  : String(original.check_in  || '')).trim();
  const coStr  = (updates.check_out !== undefined ? updates.check_out : String(original.check_out || '')).trim();
  const dateStr = String(original.date || '');
  if (ciStr && coStr && dateStr) {
    try {
      const inDt  = new Date(dateStr + 'T' + ciStr.padStart(5, '0')  + ':00');
      const outDt = new Date(dateStr + 'T' + coStr.padStart(5, '0') + ':00');
      if (!isNaN(inDt.getTime()) && !isNaN(outDt.getTime()) && outDt > inDt) {
        updates.hours_worked = _calcHoursWorked(inDt, outDt);
      }
    } catch (_) {}
  }

  updateRow(attSheet, original.__rowIndex, updates);

  // Return updated record (clean copy — no internal __rowIndex)
  const updated = findRow(attSheet, 'id', recordId);
  const out = {};
  for (const k in updated) { if (k !== '__rowIndex') out[k] = updated[k]; }
  return ok({ record: out });
}

// ---------------------------------------------------------------------------
// addManualAttendance — HR only
// ---------------------------------------------------------------------------
// Payload: { session_token, employee_id, date, check_in, check_out?,
//            location_id?, hr_note }
// Inserts a manual attendance row. biometric_method is set to 'manual'.
function addManualAttendance(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const employeeId = String(payload.employee_id || '').trim();
  const date       = String(payload.date        || '').trim();
  const checkIn    = String(payload.check_in    || '').trim();
  const checkOut   = String(payload.check_out   || '').trim();
  const locationId = String(payload.location_id || '').trim();
  const hrNote     = String(payload.hr_note     || '').trim();

  if (!employeeId) return error('Employee is required',                  'الموظف مطلوب');
  if (!date)       return error('Date is required',                      'التاريخ مطلوب');
  if (!checkIn)    return error('Check-in time is required',             'وقت الحضور مطلوب');
  if (!hrNote)     return error('HR note is required for manual records', 'ملاحظة المسؤول مطلوبة للسجلات اليدوية');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return error('Invalid date — expected YYYY-MM-DD', 'تاريخ غير صالح — المتوقع YYYY-MM-DD');
  }

  const employee = findRow(getSheet('Employees'), 'id', employeeId);
  if (!employee) return error('Employee not found', 'الموظف غير موجود');

  // Calculate hours worked if checkout is provided
  let hoursWorked = '';
  if (checkIn && checkOut) {
    try {
      const inDt  = new Date(date + 'T' + checkIn.padStart(5, '0')  + ':00');
      const outDt = new Date(date + 'T' + checkOut.padStart(5, '0') + ':00');
      if (!isNaN(inDt.getTime()) && !isNaN(outDt.getTime()) && outDt > inDt) {
        hoursWorked = _calcHoursWorked(inDt, outDt);
      }
    } catch (_) {}
  }

  const shift  = employee.shift_id ? _getShift(String(employee.shift_id)) : null;
  const status = _determineStatus(checkIn, shift);
  const id     = generateId('att');

  appendRow(getSheet('Attendance'), {
    id:                 id,
    employee_id:        employeeId,
    date:               date,
    check_in:           checkIn,
    check_out:          checkOut,
    hours_worked:       hoursWorked,
    location_id:        locationId,
    lat:                '',
    lng:                '',
    accuracy:           '',
    biometric_verified: 'FALSE',
    biometric_method:   'manual',
    device_id:          '',
    device_match:       'FALSE',
    status:             status,
    notes:              hrNote,
    corrected_by:       String(auth.employee.id),
    corrected_at:       new Date().toISOString()
  });

  return ok({ record_id: id, status: status });
}

// ---------------------------------------------------------------------------
// getFlaggedRecords — HR only
// ---------------------------------------------------------------------------
// Payload: { session_token }
// Returns all Attendance rows where device_match = FALSE, sorted by date desc.
function getFlaggedRecords(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const empMap = {};
  sheetToObjects(getSheet('Employees')).forEach(function(e) {
    empMap[String(e.id)] = { name: e.name || '', department: e.department || '' };
  });

  const locMap = {};
  try {
    sheetToObjects(getSheet('Locations')).forEach(function(l) {
      locMap[String(l.id)] = String(l.name || '');
    });
  } catch (_) {}

  let records = sheetToObjects(getSheet('Attendance'))
    .filter(function(r) {
      return String(r.device_match || '').toUpperCase() === 'FALSE' && r.id;
    });

  records.sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });

  records = records.map(function(r) {
    const out = {};
    for (const k in r) { if (k !== '__rowIndex') out[k] = r[k]; }
    const emp          = empMap[String(r.employee_id)] || {};
    out.employee_name  = emp.name       || '';
    out.department     = emp.department || '';
    out.location_name  = locMap[String(r.location_id || '')] || '';
    return out;
  });

  return ok({ records: records });
}
