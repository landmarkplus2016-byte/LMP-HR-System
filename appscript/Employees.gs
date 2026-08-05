// =============================================================================
// Employees.gs — Employee management and team-status queries
//
// Handlers (called from Code.gs router):
//   getTeamStatus(payload)      — Manager/HR: today's status for their team
//   getTeamAttendance(payload)  — Manager/HR: attendance for a specific date
//   getTeamEmployees(payload)   — Manager/HR: active employees under this manager
//   getAllEmployees(payload)     — HR only: full Employees tab (including inactive)
//   addEmployee(payload)        — HR only: validate, hash temp password, append row
//   updateEmployee(payload)     — HR only: update allowed fields only
//   deactivateEmployee(payload) — HR only: active=FALSE (cannot self-deactivate)
//   reactivateEmployee(payload) — HR only: active=TRUE
//
// Employees tab columns (full reference from CLAUDE.md):
//   id | name | username | password_hash | force_password_change | role |
//   department | shift_id | manager_id | active | biometric_exempt |
//   webauthn_credential_id | webauthn_public_key | webauthn_registered_at | device_id
// =============================================================================

// Fields HR may update via updateEmployee — all other fields are protected
const _UPDATABLE_EMPLOYEE_FIELDS = [
  'name', 'department', 'shift_id', 'manager_id', 'role', 'biometric_exempt'
];

// Fields never returned to any client
const _EMPLOYEE_HIDDEN_FIELDS = new Set([
  'password_hash', 'webauthn_public_key', '__rowIndex'
]);

// Strip sensitive fields before returning an employee object
function _safeEmployee(emp) {
  const out = {};
  for (const k in emp) {
    if (!_EMPLOYEE_HIDDEN_FIELDS.has(k)) out[k] = emp[k];
  }
  return out;
}

// =============================================================================
// getTeamStatus
// Manager sees today's status for their direct reports.
// HR sees today's status for the entire active workforce.
// =============================================================================
function getTeamStatus(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const role = String(auth.employee.role || '').toLowerCase();
  if (role !== 'manager' && role !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const employees = sheetToObjects(getSheet('Employees'));
  const teamMembers = _getTeamMembers(employees, auth.employee, role);

  const today = formatDate(new Date());

  // Build attendance lookup: employee_id → today's record
  const attToday = sheetToObjects(getSheet('Attendance'))
    .filter(r => formatDate(new Date(r.date)) === today);
  const attMap = {};
  attToday.forEach(r => { attMap[String(r.employee_id)] = r; });

  // Build leave lookup: employee_id → approved leave covering today
  const leaveMap = {};
  sheetToObjects(getSheet('Leaves')).forEach(l => {
    if (
      String(l.status) === 'approved' &&
      String(l.start_date) <= today &&
      String(l.end_date)   >= today
    ) {
      leaveMap[String(l.employee_id)] = l;
    }
  });

  const members = teamMembers.map(emp => {
    const id  = String(emp.id);
    const rec = attMap[id];
    const lv  = leaveMap[id];

    let status       = 'absent';
    let check_in     = '';
    let check_out    = '';
    let hours_worked = '';
    let location_id  = '';

    if (lv) {
      status = 'on_leave';
    } else if (rec) {
      status       = String(rec.status       || 'present').toLowerCase();
      check_in     = String(rec.check_in     || '');
      check_out    = String(rec.check_out    || '');
      hours_worked = String(rec.hours_worked || '');
      location_id  = String(rec.location_id  || '');
    }

    return {
      id,
      name:        String(emp.name       || emp.username || ''),
      department:  String(emp.department || ''),
      shift_id:    String(emp.shift_id   || ''),
      // Lets a manager's own row be marked in the team list and drive the
      // "my attendance" card on the team screen
      is_self:     id === String(auth.employee.id),
      status,
      check_in,
      check_out,
      hours_worked,
      location_id
    };
  });

  const summary = {
    present:  members.filter(m => m.status === 'present').length,
    late:     members.filter(m => m.status === 'late').length,
    absent:   members.filter(m => m.status === 'absent').length,
    on_leave: members.filter(m => m.status === 'on_leave').length,
    total:    members.length
  };

  return ok({ date: today, members, summary });
}

// =============================================================================
// getTeamAttendance
// Returns attendance records for the team on the requested date.
// Also synthesises absent rows for team members with no record that day.
// =============================================================================
function getTeamAttendance(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const role = String(auth.employee.role || '').toLowerCase();
  if (role !== 'manager' && role !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const date = String(payload.date || formatDate(new Date())).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return error('Invalid date format — expected YYYY-MM-DD', 'صيغة التاريخ غير صالحة');
  }

  const employees = sheetToObjects(getSheet('Employees'));
  const teamMembers = _getTeamMembers(employees, auth.employee, role);
  const teamIdSet = new Set(teamMembers.map(e => String(e.id)));

  // Name lookup
  const nameMap = {};
  employees.forEach(e => {
    nameMap[String(e.id)] = String(e.name || e.username || '');
  });

  // Attendance records for this team on this date
  const records = sheetToObjects(getSheet('Attendance'))
    .filter(r => formatDate(new Date(r.date)) === date && teamIdSet.has(String(r.employee_id)))
    .map(r => {
      const out = {};
      for (const k in r) {
        if (k !== '__rowIndex') out[k] = r[k];
      }
      out.employee_name = nameMap[String(r.employee_id)] || '';
      return out;
    })
    .sort((a, b) =>
      String(a.employee_name).localeCompare(String(b.employee_name))
    );

  // Synthesise absent rows for team members with no record that day
  const recordedIds = new Set(records.map(r => String(r.employee_id)));
  const absentRows = teamMembers
    .filter(e => !recordedIds.has(String(e.id)))
    .map(e => ({
      id:            '',
      employee_id:   String(e.id),
      employee_name: nameMap[String(e.id)] || '',
      date,
      check_in:      '',
      check_out:     '',
      hours_worked:  '',
      status:        'absent',
      location_id:   '',
      biometric_verified: '',
      device_match:  '',
      notes:         '',
      corrected_by:  '',
      corrected_at:  ''
    }));

  return ok({ date, records: [...records, ...absentRows] });
}

// =============================================================================
// getTeamEmployees
// Manager: active employees whose manager_id matches the caller.
// HR: all active employees.
// =============================================================================
function getTeamEmployees(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const role = String(auth.employee.role || '').toLowerCase();
  if (role !== 'manager' && role !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const employees = sheetToObjects(getSheet('Employees'));
  const team = _getTeamMembers(employees, auth.employee, role).map(_safeEmployee);

  return ok({ employees: team });
}

// =============================================================================
// getAllEmployees — HR only
// Returns the full Employees tab, including inactive records.
// =============================================================================
function getAllEmployees(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const employees = sheetToObjects(getSheet('Employees')).map(_safeEmployee);
  return ok({ employees });
}

// =============================================================================
// addEmployee — HR only
// Validates unique username → hashes temp password → appends row with
// force_password_change=TRUE so the new employee must set their own password.
// =============================================================================
function addEmployee(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const name       = String(payload.name          || '').trim();
  const username   = String(payload.username       || '').trim().toLowerCase();
  const tempPw     = String(payload.temp_password  || '').trim();
  const department = String(payload.department     || '').trim();
  const shiftId    = String(payload.shift_id       || '').trim();
  const managerId  = String(payload.manager_id     || '').trim();
  const role       = String(payload.role           || 'employee').trim().toLowerCase();
  const bioExempt  = String(payload.biometric_exempt || '').toUpperCase() === 'TRUE'
    ? 'TRUE' : 'FALSE';

  if (!name)     return error('Name is required', 'الاسم مطلوب');
  if (!username) return error('Username is required', 'اسم المستخدم مطلوب');
  if (!tempPw)   return error('Temporary password is required', 'كلمة المرور المؤقتة مطلوبة');
  if (tempPw.length < 4) {
    return error('Temporary password must be at least 4 characters', 'كلمة المرور المؤقتة يجب أن تكون ٤ أحرف على الأقل');
  }

  const validRoles = ['employee', 'manager', 'hr'];
  if (!validRoles.includes(role)) {
    return error('Invalid role', 'الدور الوظيفي غير صالح');
  }

  const empSheet = getSheet('Employees');

  // Unique username check (case-insensitive — usernames are stored lowercase)
  if (findRow(empSheet, 'username', username)) {
    return error('Username already exists', 'اسم المستخدم مستخدم بالفعل');
  }

  const id = generateId('emp');

  appendRow(empSheet, {
    id,
    name,
    username,
    password_hash:          hashPassword(tempPw),
    force_password_change:  'TRUE',
    role,
    department,
    shift_id:               shiftId,
    manager_id:             managerId,
    active:                 'TRUE',
    biometric_exempt:       bioExempt,
    webauthn_credential_id: '',
    webauthn_public_key:    '',
    webauthn_registered_at: '',
    device_id:              ''
  });

  return ok({ id, name, username, role, department, active: 'TRUE' });
}

// =============================================================================
// updateEmployee — HR only
// Only fields in _UPDATABLE_EMPLOYEE_FIELDS may be changed, plus optional
// username (unique check) and new_password_hash (pre-hashed by the client).
// WebAuthn keys and session data are never touched here.
// =============================================================================
function updateEmployee(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const employeeId = String(payload.employee_id || '').trim();
  if (!employeeId) return error('employee_id is required', 'معرّف الموظف مطلوب');

  const empSheet = getSheet('Employees');
  const emp = findRow(empSheet, 'id', employeeId);
  if (!emp) return error('Employee not found', 'الموظف غير موجود');

  // Build updates object — only allowed fields, skip undefined
  const updates = {};
  for (const field of _UPDATABLE_EMPLOYEE_FIELDS) {
    if (payload[field] !== undefined) {
      updates[field] = String(payload[field]);
    }
  }

  // Validate role if being changed
  if (updates.role !== undefined) {
    const validRoles = ['employee', 'manager', 'hr'];
    if (!validRoles.includes(updates.role)) {
      return error('Invalid role', 'الدور الوظيفي غير صالح');
    }
  }

  // Username change — unique (case-insensitive), excluding this employee's own row
  if (payload.username !== undefined) {
    const newUsername = String(payload.username).trim().toLowerCase();
    if (!newUsername) return error('Username is required', 'اسم المستخدم مطلوب');
    const existing = findRow(empSheet, 'username', newUsername);
    if (existing && String(existing.id) !== employeeId) {
      return error('Username already exists', 'اسم المستخدم مستخدم بالفعل');
    }
    updates.username = newUsername;
  }

  // Password change — caller sends an already-hashed value (never plain text)
  if (payload.new_password_hash !== undefined) {
    const newHash = String(payload.new_password_hash).trim();
    if (!newHash) return error('New password is required', 'كلمة المرور الجديدة مطلوبة');
    updates.password_hash = newHash;
    updates.force_password_change =
      String(payload.force_password_change || 'TRUE').toUpperCase() !== 'FALSE' ? 'TRUE' : 'FALSE';
  }

  if (Object.keys(updates).length === 0) {
    return error('No valid fields to update', 'لا توجد حقول صالحة للتحديث');
  }

  updateRow(empSheet, emp.__rowIndex, updates);

  return ok({ employee_id: employeeId, updated: Object.keys(updates) });
}

// =============================================================================
// deactivateEmployee — HR only
// Sets active = FALSE. HR cannot deactivate their own account.
// =============================================================================
function deactivateEmployee(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const employeeId = String(payload.employee_id || '').trim();
  if (!employeeId) return error('employee_id is required', 'معرّف الموظف مطلوب');

  if (employeeId === String(auth.employee.id)) {
    return error('You cannot deactivate your own account', 'لا يمكنك تعطيل حسابك الخاص');
  }

  const empSheet = getSheet('Employees');
  const emp = findRow(empSheet, 'id', employeeId);
  if (!emp) return error('Employee not found', 'الموظف غير موجود');

  if (String(emp.active).toUpperCase() !== 'TRUE') {
    return error('Employee is already inactive', 'الموظف غير نشط بالفعل');
  }

  updateRow(empSheet, emp.__rowIndex, { active: 'FALSE' });
  return ok({ employee_id: employeeId, active: false });
}

// =============================================================================
// reactivateEmployee — HR only
// =============================================================================
function reactivateEmployee(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const employeeId = String(payload.employee_id || '').trim();
  if (!employeeId) return error('employee_id is required', 'معرّف الموظف مطلوب');

  const empSheet = getSheet('Employees');
  const emp = findRow(empSheet, 'id', employeeId);
  if (!emp) return error('Employee not found', 'الموظف غير موجود');

  if (String(emp.active).toUpperCase() === 'TRUE') {
    return error('Employee is already active', 'الموظف نشط بالفعل');
  }

  updateRow(empSheet, emp.__rowIndex, { active: 'TRUE' });
  return ok({ employee_id: employeeId, active: true });
}

// =============================================================================
// Private: return team members array for the calling user's role
// =============================================================================
function _getTeamMembers(employees, callingEmployee, role) {
  if (role === 'hr') {
    return employees.filter(e => String(e.active).toUpperCase() === 'TRUE');
  }
  // Manager sees their direct reports plus themselves — a manager records
  // attendance like anyone else, so their own row belongs in team status and
  // team attendance.
  //
  // Leave approvals deliberately do NOT use this helper: getTeamLeaves,
  // approveLeave and rejectLeave (Leaves.gs) scope by manager_id only, which
  // keeps a manager out of their own approval queue.
  return employees.filter(e =>
    String(e.active).toUpperCase() === 'TRUE' &&
    (String(e.manager_id) === String(callingEmployee.id) ||
     String(e.id)         === String(callingEmployee.id))
  );
}
