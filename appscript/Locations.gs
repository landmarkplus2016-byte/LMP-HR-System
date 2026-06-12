// =============================================================================
// Locations.gs — Location CRUD for the HR admin screen
//
// Locations tab columns: id | name | lat | lng | radius_m | active
//
// Handlers (called from Code.gs router):
//   getLocations(payload)    — Any authenticated role
//   addLocation(payload)     — HR only
//   updateLocation(payload)  — HR only
//   toggleLocation(payload)  — HR only: flip active TRUE ↔ FALSE
// =============================================================================


// ---------------------------------------------------------------------------
// getLocations
// ---------------------------------------------------------------------------
function getLocations(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const locs = sheetToObjects(getSheet('Locations'));
  locs.forEach(function(l) { delete l.__rowIndex; });
  return ok({ locations: locs });
}


// ---------------------------------------------------------------------------
// addLocation — HR only
// ---------------------------------------------------------------------------
function addLocation(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('HR access required', 'يلزم صلاحية مدير الموارد البشرية');
  }

  const name    = String(payload.name     || '').trim();
  const lat     = parseFloat(payload.lat);
  const lng     = parseFloat(payload.lng);
  const radiusM = Number(payload.radius_m) || 150;

  if (!name)
    return error('name is required', 'اسم الموقع مطلوب');
  if (isNaN(lat) || lat < -90 || lat > 90)
    return error('Invalid latitude — must be between -90 and 90', 'خط العرض غير صالح');
  if (isNaN(lng) || lng < -180 || lng > 180)
    return error('Invalid longitude — must be between -180 and 180', 'خط الطول غير صالح');
  if (radiusM < 10 || radiusM > 10000)
    return error('radius_m must be between 10 and 10000', 'يجب أن يكون نطاق الجيوفنس بين ١٠ و١٠٠٠٠');

  const locId = generateId('lo');
  appendRow(getSheet('Locations'), {
    id:       locId,
    name:     name,
    lat:      String(lat),
    lng:      String(lng),
    radius_m: String(radiusM),
    active:   'TRUE'
  });

  return ok({ id: locId, name: name, lat: lat, lng: lng, radius_m: radiusM, active: 'TRUE' });
}


// ---------------------------------------------------------------------------
// updateLocation — HR only
// ---------------------------------------------------------------------------
function updateLocation(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('HR access required', 'يلزم صلاحية مدير الموارد البشرية');
  }

  const locId = String(payload.location_id || '').trim();
  if (!locId) return error('location_id is required', 'معرّف الموقع مطلوب');

  const sheet = getSheet('Locations');
  const loc   = findRow(sheet, 'id', locId);
  if (!loc) return error('Location not found', 'الموقع غير موجود');

  const updates = {};

  if (payload.name !== undefined) {
    const n = String(payload.name).trim();
    if (!n) return error('name cannot be empty', 'اسم الموقع لا يمكن أن يكون فارغاً');
    updates.name = n;
  }

  if (payload.lat !== undefined) {
    const v = parseFloat(payload.lat);
    if (isNaN(v) || v < -90 || v > 90)
      return error('Invalid latitude', 'خط العرض غير صالح');
    updates.lat = String(v);
  }

  if (payload.lng !== undefined) {
    const v = parseFloat(payload.lng);
    if (isNaN(v) || v < -180 || v > 180)
      return error('Invalid longitude', 'خط الطول غير صالح');
    updates.lng = String(v);
  }

  if (payload.radius_m !== undefined) {
    const r = Number(payload.radius_m);
    if (isNaN(r) || r < 10 || r > 10000)
      return error('radius_m must be between 10 and 10000', 'نطاق الجيوفنس غير صالح');
    updates.radius_m = String(r);
  }

  if (Object.keys(updates).length === 0) {
    return error('No valid fields to update', 'لا توجد حقول صالحة للتحديث');
  }

  updateRow(sheet, loc.__rowIndex, updates);
  return ok({ location_id: locId, updated: updates });
}


// ---------------------------------------------------------------------------
// toggleLocation — HR only: flips active TRUE ↔ FALSE
// ---------------------------------------------------------------------------
function toggleLocation(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('HR access required', 'يلزم صلاحية مدير الموارد البشرية');
  }

  const locId = String(payload.location_id || '').trim();
  if (!locId) return error('location_id is required', 'معرّف الموقع مطلوب');

  const sheet = getSheet('Locations');
  const loc   = findRow(sheet, 'id', locId);
  if (!loc) return error('Location not found', 'الموقع غير موجود');

  const newActive = String(loc.active || '').toUpperCase() === 'TRUE' ? 'FALSE' : 'TRUE';
  updateRow(sheet, loc.__rowIndex, { active: newActive });

  return ok({ location_id: locId, active: newActive });
}
