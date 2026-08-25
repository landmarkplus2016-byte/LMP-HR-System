// =============================================================================
// Missions.gs — Official off-site duty (mission / meeting / training)
//
// A mission is what stops an employee being counted Absent on a day they were
// working, just not at a company location. It is deliberately shaped as a near
// twin of a leave request — same pending/approved/rejected lifecycle, same
// direct-report approval scoping — because HR, managers and executives already
// know how leave behaves and a second, different workflow would only confuse.
//
// Handlers (called from Code.gs router):
//   submitMission(payload)   — Employee: create a pending mission request
//   getMyMissions(payload)   — Employee: own mission history
//   getTeamMissions(payload) — Manager/CEO/MD: pending for direct reports
//                              HR: every mission, all statuses, company-wide
//   approveMission(payload)  — Manager/CEO/MD/HR: approve a pending request
//   rejectMission(payload)   — Manager/CEO/MD/HR: reject a pending request
//   addMission(payload)      — HR only: record a mission directly, pre-approved
//
// Missions tab columns:
//   id | employee_id | mission_type | start_date | end_date | destination |
//   reason | status | approved_by | approved_at | reject_reason | created_at
//
// Date handling, day counting and the direct-report approval rule are shared
// with Leaves.gs (_normaliseLeaveDate, _countDays) rather than re-implemented —
// Apps Script puts every .gs file in one global scope, so these are the same
// functions, not copies that can drift apart.
// =============================================================================

// The kinds of off-site duty HR wants to tell apart in a report. Anything that
// does not fit lands in `other` with a written reason.
const _MISSION_TYPES = ['meeting', 'training', 'site_visit', 'business_trip', 'other'];

// =============================================================================
// submitMission
// Employee submits a new mission request for approval.
// =============================================================================
function submitMission(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  // HR, CEO and MD never check in, so they can never be marked absent and have
  // nothing to correct with a mission
  if (!isAttendingRole(auth.employee.role)) {
    return error('This role does not record attendance',
                 'هذا الدور لا يسجّل الحضور');
  }

  const tabMissing = _missionsTabMissing();
  if (tabMissing) return tabMissing;

  const missionType = String(payload.mission_type || '').trim().toLowerCase();
  const startDate   = String(payload.start_date   || '').trim();
  const endDate     = String(payload.end_date     || '').trim();
  const destination = String(payload.destination  || '').trim();
  const reason      = String(payload.reason       || '').trim();

  const validation = _validateMissionFields(missionType, startDate, endDate, destination);
  if (validation) return validation;

  const conflict = _missionConflict(String(auth.employee.id), startDate, endDate, '');
  if (conflict) return conflict;

  const missionId = generateId('msn');
  const now       = new Date().toISOString();

  appendRow(getSheet('Missions'), {
    id:            missionId,
    employee_id:   auth.employee.id,
    mission_type:  missionType,
    start_date:    startDate,
    end_date:      endDate,
    destination:   destination,
    reason:        reason,
    status:        'pending',
    approved_by:   '',
    approved_at:   '',
    reject_reason: '',
    created_at:    now
  });

  return ok({
    id:           missionId,
    mission_type: missionType,
    start_date:   startDate,
    end_date:     endDate,
    destination:  destination,
    status:       'pending',
    created_at:   now
  });
}

// =============================================================================
// getMyMissions
// The calling employee's own mission history, newest first.
// =============================================================================
function getMyMissions(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const requests = _missionRows()
    .filter(function(m) { return String(m.employee_id) === String(auth.employee.id); })
    .sort(function(a, b) {
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

  requests.forEach(function(m) {
    m.start_date = _normaliseLeaveDate(m.start_date);
    m.end_date   = _normaliseLeaveDate(m.end_date);
    m.days       = _countDays(m.start_date, m.end_date);
    delete m.__rowIndex;
  });

  // Approved mission days taken this calendar year — not an entitlement that
  // runs out like leave, purely a figure the employee and HR can both see
  const currentYear = String(new Date().getFullYear());
  const daysThisYear = requests
    .filter(function(m) {
      return String(m.status) === 'approved' &&
             String(m.start_date || '').startsWith(currentYear);
    })
    .reduce(function(sum, m) { return sum + m.days; }, 0);

  return ok({ requests: requests, days_this_year: daysThisYear, year: Number(currentYear) });
}

// =============================================================================
// getTeamMissions
// Manager and executives: pending requests from their own direct reports.
// HR: every mission at every status, company-wide.
//
// Scoping is identical to getTeamLeaves — see the note there on why executives
// are "direct report" approvers rather than company-wide ones.
// =============================================================================
function getTeamMissions(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const role      = String(auth.employee.role || '').toLowerCase();
  const directOnly = (role === 'manager' || isExecRole(role));
  if (!directOnly && role !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const employees = sheetToObjects(getSheet('Employees'));

  let teamIds;
  if (role === 'hr') {
    teamIds = employees
      .filter(function(e) { return String(e.active).toUpperCase() === 'TRUE'; })
      .map(function(e) { return String(e.id); });
  } else {
    teamIds = employees
      .filter(function(e) {
        return String(e.manager_id) === String(auth.employee.id) &&
               String(e.active).toUpperCase() === 'TRUE';
      })
      .map(function(e) { return String(e.id); });
  }

  const empMap = {};
  employees.forEach(function(e) {
    empMap[String(e.id)] = {
      name:       String(e.name || e.username || e.id),
      department: String(e.department || '')
    };
  });

  const requests = _missionRows()
    .filter(function(m) {
      if (teamIds.indexOf(String(m.employee_id)) === -1) return false;
      // Managers and executives get an approval queue; HR gets the full picture
      if (directOnly) return String(m.status) === 'pending';
      return true;
    })
    .sort(function(a, b) {
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

  requests.forEach(function(m) {
    const emp = empMap[String(m.employee_id)] || {};
    m.employee_name = emp.name       || '';
    m.department    = emp.department || '';
    m.start_date    = _normaliseLeaveDate(m.start_date);
    m.end_date      = _normaliseLeaveDate(m.end_date);
    m.days          = _countDays(m.start_date, m.end_date);
    delete m.__rowIndex;
  });

  return ok({ requests: requests, year: new Date().getFullYear() });
}

// =============================================================================
// approveMission
// Manager/CEO/MD/HR approves a pending request.
// Non-HR callers are confined to their own direct reports, exactly as in
// approveLeave — see the note there on the executive write exception.
// =============================================================================
function approveMission(payload) {
  return _decideMission(payload, 'approved');
}

// =============================================================================
// rejectMission
// Same rules as approveMission, plus an optional written reason.
// =============================================================================
function rejectMission(payload) {
  return _decideMission(payload, 'rejected');
}

// Private: the shared body of approveMission / rejectMission. Both differ only
// in the status written and whether a reject reason is stored, so the access
// rules live in one place and cannot drift between approve and reject.
function _decideMission(payload, decision) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const role = String(auth.employee.role || '').toLowerCase();
  if (role !== 'manager' && role !== 'hr' && !isExecRole(role)) {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const tabMissing = _missionsTabMissing();
  if (tabMissing) return tabMissing;

  const missionId = String(payload.mission_id || '').trim();
  if (!missionId) return error('mission_id is required', 'معرّف المهمة مطلوب');

  const sheet   = getSheet('Missions');
  const mission = findRow(sheet, 'id', missionId);
  if (!mission) return error('Mission not found', 'المهمة غير موجودة');

  if (String(mission.status) !== 'pending') {
    return error('Mission is no longer pending', 'المهمة لم تعد قيد الانتظار');
  }

  // HR is the only role allowed to act outside their own reporting line
  if (role !== 'hr') {
    const emp = findRow(getSheet('Employees'), 'id', String(mission.employee_id));
    if (!emp || String(emp.manager_id) !== String(auth.employee.id)) {
      return error('Employee is not in your team', 'الموظف ليس في فريقك');
    }
  }

  const updates = {
    status:      decision,
    approved_by: auth.employee.id,
    approved_at: new Date().toISOString()
  };
  if (decision === 'rejected') {
    updates.reject_reason = String(payload.reason || '').trim();
  }

  updateRow(sheet, mission.__rowIndex, updates);

  return ok({ mission_id: missionId, status: decision });
}

// =============================================================================
// addMission — HR only
// Records a mission directly against an employee, already approved. This is the
// path for a trip HR was told about after the fact, or for an employee who was
// travelling and could not file it themselves.
// =============================================================================
function addMission(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const tabMissing = _missionsTabMissing();
  if (tabMissing) return tabMissing;

  const employeeId  = String(payload.employee_id  || '').trim();
  const missionType = String(payload.mission_type || '').trim().toLowerCase();
  const startDate   = String(payload.start_date   || '').trim();
  const endDate     = String(payload.end_date     || '').trim();
  const destination = String(payload.destination  || '').trim();
  const reason      = String(payload.reason       || '').trim();

  if (!employeeId) return error('employee_id is required', 'معرّف الموظف مطلوب');

  const emp = findRow(getSheet('Employees'), 'id', employeeId);
  if (!emp) return error('Employee not found', 'الموظف غير موجود');
  if (!isAttendingRole(emp.role)) {
    return error('This role does not record attendance', 'هذا الدور لا يسجّل الحضور');
  }

  const validation = _validateMissionFields(missionType, startDate, endDate, destination, true);
  if (validation) return validation;

  const conflict = _missionConflict(employeeId, startDate, endDate, '');
  if (conflict) return conflict;

  const missionId = generateId('msn');
  const now       = new Date().toISOString();

  appendRow(getSheet('Missions'), {
    id:            missionId,
    employee_id:   employeeId,
    mission_type:  missionType,
    start_date:    startDate,
    end_date:      endDate,
    destination:   destination,
    reason:        reason,
    status:        'approved',
    approved_by:   auth.employee.id,
    approved_at:   now,
    reject_reason: '',
    created_at:    now
  });

  return ok({ id: missionId, employee_id: employeeId, status: 'approved' });
}

// =============================================================================
// Shared helpers — also called from Employees.gs and Report.gs
// =============================================================================

// Every Missions row, or [] when the tab has not been created yet.
//
// getSheet throws on a missing tab, and this is called from live status, the
// executive org screen and the monthly report. A Missions tab that has not been
// added yet must degrade to "nobody is on a mission" — never take those screens
// down for every user. Write paths call getSheet directly so that a genuinely
// missing tab surfaces as an error at the point where it matters.
function _missionRows() {
  try {
    return sheetToObjects(getSheet('Missions'));
  } catch (e) {
    return [];
  }
}

// Private: guard for the write paths. getSheet throws on a missing tab and the
// doPost catch turns that into a bare "internal server error", which tells a
// user nothing. Returns an error envelope naming the actual problem, or null
// when the tab is there.
function _missionsTabMissing() {
  try {
    getSheet('Missions');
    return null;
  } catch (e) {
    return error(
      'Missions sheet not found — the Missions tab has not been created yet',
      'ورقة المأموريات غير موجودة — لم يتم إنشاء تبويب Missions بعد'
    );
  }
}

// Approved missions covering `dateStr` (YYYY-MM-DD), keyed by employee_id.
// This is what turns an Absent into an On Mission in getTeamStatus and
// getOrgStatus — both call it rather than re-deriving the overlap test.
function _approvedMissionMap(dateStr) {
  const map = {};
  _missionRows().forEach(function(m) {
    if (String(m.status) !== 'approved') return;
    if (_normaliseLeaveDate(m.start_date) > dateStr) return;
    if (_normaliseLeaveDate(m.end_date)   < dateStr) return;
    map[String(m.employee_id)] = m;
  });
  return map;
}

// Private: shared field validation for submitMission and addMission.
// Returns an error envelope, or null when everything is valid.
function _validateMissionFields(missionType, startDate, endDate, destination, allowPast) {
  if (_MISSION_TYPES.indexOf(missionType) === -1) {
    return error('Invalid mission type', 'نوع المهمة غير صالح');
  }
  if (!startDate || !endDate) {
    return error('Start date and end date are required', 'تاريخ البداية والنهاية مطلوبان');
  }
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
    return error('Dates must be in YYYY-MM-DD format', 'يجب أن تكون التواريخ بصيغة YYYY-MM-DD');
  }
  if (endDate < startDate) {
    return error('End date must be on or after start date',
                 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو يساويه');
  }
  if (!destination) {
    return error('Destination is required', 'جهة المهمة مطلوبة');
  }
  // An employee filing their own mission cannot back-date it — that would let
  // anyone erase an absence after the fact. HR can, because HR recording a trip
  // they were told about late is the whole point of addMission.
  if (!allowPast && startDate < formatDate(new Date())) {
    return error('Mission cannot start in the past',
                 'لا يمكن أن تبدأ المهمة في تاريخ ماضٍ');
  }
  return null;
}

// Private: reject a mission that overlaps an existing mission or approved leave
// for the same employee. `excludeId` skips one mission row, so an edit does not
// collide with itself.
function _missionConflict(employeeId, startDate, endDate, excludeId) {
  const overlaps = function(rowStart, rowEnd) {
    return !(_normaliseLeaveDate(rowEnd)   < startDate ||
             _normaliseLeaveDate(rowStart) > endDate);
  };

  const missionClash = _missionRows().find(function(m) {
    return String(m.employee_id) === String(employeeId) &&
           String(m.id) !== String(excludeId) &&
           ['pending', 'approved'].indexOf(String(m.status)) !== -1 &&
           overlaps(m.start_date, m.end_date);
  });
  if (missionClash) {
    return error('This period overlaps another mission',
                 'هذه الفترة تتقاطع مع مهمة أخرى');
  }

  // A day cannot be both leave and a working mission — whichever was approved
  // first wins, and the second request is refused rather than silently ignored
  const leaveClash = sheetToObjects(getSheet('Leaves')).find(function(l) {
    return String(l.employee_id) === String(employeeId) &&
           ['pending', 'approved'].indexOf(String(l.status)) !== -1 &&
           overlaps(l.start_date, l.end_date);
  });
  if (leaveClash) {
    return error('This period overlaps a leave request',
                 'هذه الفترة تتقاطع مع طلب إجازة');
  }

  return null;
}
