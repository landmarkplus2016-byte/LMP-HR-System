// =============================================================================
// Admin.gs — Shifts, Departments, Holidays, Config management
//
// Handlers (called from Code.gs router):
//
// SHIFTS (fully implemented — Stage 3)
//   getShifts(payload)      — Any authenticated role: return all shifts
//   addShift(payload)       — HR only: append a new shift row
//   updateShift(payload)    — HR only: update fields on an existing shift
//   deleteShift(payload)    — HR only: hard-delete shift (blocked if employees assigned)
//
// DEPARTMENTS (Stage 5)
//   getDepartments, addDepartment, updateDepartment
//
// HOLIDAYS (Stage 5)
//   getHolidays, addHoliday, deleteHoliday
//
// CONFIG (Stage 5)
//   updateConfig
//
// Shifts tab columns:
//   id | name | start_time | end_time | working_days | late_threshold_min
// =============================================================================


// =============================================================================
// ── SHIFTS ────────────────────────────────────────────────────────────────────
// =============================================================================

// Return all shifts. Any authenticated user may call this (employees need their
// shift name displayed; HR needs the full list for the admin screen).
function getShifts(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const shifts = sheetToObjects(getSheet('Shifts'));
  shifts.forEach(s => delete s.__rowIndex);
  return ok({ shifts });
}

// HR only — append a new shift row.
function addShift(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('HR access required', 'يلزم صلاحية مدير الموارد البشرية');
  }

  const name          = String(payload.name          || '').trim();
  const startTime     = String(payload.start_time    || '').trim();
  const endTime       = String(payload.end_time      || '').trim();
  const workingDays   = String(payload.working_days  || '').trim();
  const lateThreshold = Number(payload.late_threshold_min) || 15;

  if (!name || !startTime || !endTime) {
    return error(
      'name, start_time, and end_time are required',
      'الاسم ووقت البداية والنهاية مطلوبة'
    );
  }

  const timeRe = /^\d{2}:\d{2}$/;
  if (!timeRe.test(startTime)) {
    return error('start_time must be in HH:MM format', 'يجب أن يكون وقت البداية بصيغة HH:MM');
  }
  if (!timeRe.test(endTime)) {
    return error('end_time must be in HH:MM format', 'يجب أن يكون وقت النهاية بصيغة HH:MM');
  }

  const shiftId = generateId('sh');
  appendRow(getSheet('Shifts'), {
    id:                 shiftId,
    name:               name,
    start_time:         startTime,
    end_time:           endTime,
    working_days:       workingDays,
    late_threshold_min: lateThreshold
  });

  return ok({
    id:                 shiftId,
    name:               name,
    start_time:         startTime,
    end_time:           endTime,
    working_days:       workingDays,
    late_threshold_min: lateThreshold
  });
}

// HR only — update one or more fields on an existing shift.
function updateShift(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('HR access required', 'يلزم صلاحية مدير الموارد البشرية');
  }

  const shiftId = String(payload.shift_id || '').trim();
  if (!shiftId) return error('shift_id is required', 'معرّف الوردية مطلوب');

  const sheet = getSheet('Shifts');
  const shift = findRow(sheet, 'id', shiftId);
  if (!shift) return error('Shift not found', 'الوردية غير موجودة');

  const updates = {};
  if (payload.name              !== undefined) updates.name               = String(payload.name).trim();
  if (payload.start_time        !== undefined) updates.start_time         = String(payload.start_time).trim();
  if (payload.end_time          !== undefined) updates.end_time           = String(payload.end_time).trim();
  if (payload.working_days      !== undefined) updates.working_days       = String(payload.working_days).trim();
  if (payload.late_threshold_min !== undefined) updates.late_threshold_min = Number(payload.late_threshold_min) || 15;

  const timeRe = /^\d{2}:\d{2}$/;
  if (updates.start_time !== undefined && !timeRe.test(updates.start_time)) {
    return error('start_time must be in HH:MM format', 'يجب أن يكون وقت البداية بصيغة HH:MM');
  }
  if (updates.end_time !== undefined && !timeRe.test(updates.end_time)) {
    return error('end_time must be in HH:MM format', 'يجب أن يكون وقت النهاية بصيغة HH:MM');
  }

  if (Object.keys(updates).length === 0) {
    return error('No valid fields to update', 'لا توجد حقول صالحة للتحديث');
  }

  updateRow(sheet, shift.__rowIndex, updates);
  return ok({ shift_id: shiftId, updated: updates });
}

// HR only — hard-delete a shift.
// Blocked if any active employee is currently assigned to it.
function deleteShift(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('HR access required', 'يلزم صلاحية مدير الموارد البشرية');
  }

  const shiftId = String(payload.shift_id || '').trim();
  if (!shiftId) return error('shift_id is required', 'معرّف الوردية مطلوب');

  const sheet = getSheet('Shifts');
  const shift = findRow(sheet, 'id', shiftId);
  if (!shift) return error('Shift not found', 'الوردية غير موجودة');

  // Prevent deletion while any active employee references this shift
  const assigned = sheetToObjects(getSheet('Employees')).find(e =>
    String(e.shift_id) === shiftId &&
    String(e.active).toUpperCase() === 'TRUE'
  );
  if (assigned) {
    return error(
      'Cannot delete shift: active employees are assigned to it',
      'لا يمكن حذف الوردية: هناك موظفون نشطون مرتبطون بها'
    );
  }

  deleteSheetRow(sheet, shift.__rowIndex);
  return ok({ shift_id: shiftId, deleted: true });
}


// =============================================================================
// ── DEPARTMENTS (Stage 5) ─────────────────────────────────────────────────────
// =============================================================================

function getDepartments(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  const departments = sheetToObjects(getSheet('Departments'));
  departments.forEach(d => delete d.__rowIndex);
  return ok({ departments });
}

function addDepartment(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('HR access required', 'يلزم صلاحية مدير الموارد البشرية');
  }
  const name = String(payload.name || '').trim();
  if (!name) return error('name is required', 'اسم القسم مطلوب');
  const deptId = generateId('dp');
  appendRow(getSheet('Departments'), { id: deptId, name });
  return ok({ id: deptId, name });
}

function updateDepartment(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('HR access required', 'يلزم صلاحية مدير الموارد البشرية');
  }
  const deptId = String(payload.department_id || '').trim();
  if (!deptId) return error('department_id is required', 'معرّف القسم مطلوب');
  const sheet = getSheet('Departments');
  const dept  = findRow(sheet, 'id', deptId);
  if (!dept) return error('Department not found', 'القسم غير موجود');
  const updates = {};
  if (payload.name !== undefined) updates.name = String(payload.name).trim();
  if (Object.keys(updates).length === 0) {
    return error('No valid fields to update', 'لا توجد حقول صالحة للتحديث');
  }
  updateRow(sheet, dept.__rowIndex, updates);
  return ok({ department_id: deptId, updated: updates });
}


// =============================================================================
// ── HOLIDAYS (Stage 5) ────────────────────────────────────────────────────────
// =============================================================================

function getHolidays(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  const holidays = sheetToObjects(getSheet('Holidays'));
  holidays.forEach(h => delete h.__rowIndex);
  return ok({ holidays });
}

function addHoliday(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('HR access required', 'يلزم صلاحية مدير الموارد البشرية');
  }
  const date  = String(payload.date  || '').trim();
  const name  = String(payload.name  || '').trim();
  if (!date || !name) {
    return error('date and name are required', 'التاريخ والاسم مطلوبان');
  }
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(date)) {
    return error('date must be in YYYY-MM-DD format', 'يجب أن يكون التاريخ بصيغة YYYY-MM-DD');
  }
  const holidayId = generateId('hd');
  appendRow(getSheet('Holidays'), { id: holidayId, date, name });
  return ok({ id: holidayId, date, name });
}

function deleteHoliday(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('HR access required', 'يلزم صلاحية مدير الموارد البشرية');
  }
  const holidayId = String(payload.holiday_id || '').trim();
  if (!holidayId) return error('holiday_id is required', 'معرّف العطلة مطلوب');
  const sheet   = getSheet('Holidays');
  const holiday = findRow(sheet, 'id', holidayId);
  if (!holiday) return error('Holiday not found', 'العطلة غير موجودة');
  deleteSheetRow(sheet, holiday.__rowIndex);
  return ok({ holiday_id: holidayId, deleted: true });
}


// =============================================================================
// ── CONFIG (Stage 5) ──────────────────────────────────────────────────────────
// =============================================================================

function updateConfig(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('HR access required', 'يلزم صلاحية مدير الموارد البشرية');
  }
  const updates = payload.config;
  if (!updates || typeof updates !== 'object') {
    return error('config object is required', 'كائن الإعدادات مطلوب');
  }
  const sheet = getSheet('Config');
  const rows  = sheetToObjects(sheet);
  Object.keys(updates).forEach(key => {
    const row = rows.find(r => String(r.key) === key);
    if (row) {
      updateRow(sheet, row.__rowIndex, { value: String(updates[key]) });
    } else {
      appendRow(sheet, { key, value: String(updates[key]) });
    }
  });
  return ok({ updated: Object.keys(updates) });
}
