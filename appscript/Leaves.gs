// =============================================================================
// Leaves.gs — Leave request management
//
// Handlers (called from Code.gs router):
//   submitLeave(payload)    — Employee: create a pending leave request
//   getMyLeaves(payload)    — Employee: own requests + annual balance
//   getTeamLeaves(payload)  — Manager/HR: requests + annual balances for their team
//   approveLeave(payload)   — Manager/HR: approve a pending request
//   rejectLeave(payload)    — Manager/HR: reject a pending request
//
// Leaves tab columns:
//   id | employee_id | leave_type | start_date | end_date | reason |
//   status | approved_by | approved_at | reject_reason | created_at
//
// Config key used:
//   annual_leave_days  (default 21) — total annual leave entitlement per year
// =============================================================================

// =============================================================================
// submitLeave
// Employee submits a new leave request.
// =============================================================================
function submitLeave(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const leaveType  = String(payload.leave_type  || '').trim().toLowerCase();
  const startDate  = String(payload.start_date  || '').trim();
  const endDate    = String(payload.end_date    || '').trim();
  const reason     = String(payload.reason      || '').trim();

  const validTypes = ['annual', 'sick', 'emergency', 'unpaid'];
  if (!validTypes.includes(leaveType)) {
    return error('Invalid leave type', 'نوع الإجازة غير صالح');
  }

  if (!startDate || !endDate) {
    return error('Start date and end date are required', 'تاريخ البداية والنهاية مطلوبان');
  }
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
    return error('Dates must be in YYYY-MM-DD format', 'يجب أن تكون التواريخ بصيغة YYYY-MM-DD');
  }
  if (endDate < startDate) {
    return error(
      'End date must be on or after start date',
      'تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو يساويه'
    );
  }

  // Block overlapping pending or approved leaves for this employee
  const existing = sheetToObjects(getSheet('Leaves'));
  const overlap  = existing.find(l =>
    String(l.employee_id) === String(auth.employee.id) &&
    ['pending', 'approved'].includes(String(l.status)) &&
    !(_normaliseLeaveDate(l.end_date) < startDate || _normaliseLeaveDate(l.start_date) > endDate)
  );
  if (overlap) {
    return error(
      'You already have a leave request that overlaps this period',
      'لديك طلب إجازة بالفعل يتقاطع مع هذه الفترة'
    );
  }

  const leaveId = generateId('lv');
  const now     = new Date().toISOString();

  appendRow(getSheet('Leaves'), {
    id:            leaveId,
    employee_id:   auth.employee.id,
    leave_type:    leaveType,
    start_date:    startDate,
    end_date:      endDate,
    reason:        reason,
    status:        'pending',
    approved_by:   '',
    approved_at:   '',
    reject_reason: '',
    created_at:    now
  });

  return ok({
    id:         leaveId,
    leave_type: leaveType,
    start_date: startDate,
    end_date:   endDate,
    status:     'pending',
    created_at: now
  });
}

// =============================================================================
// getMyLeaves
// Returns the calling employee's full leave history plus their annual balance.
// =============================================================================
function getMyLeaves(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const all = sheetToObjects(getSheet('Leaves'));

  const requests = all
    .filter(l => String(l.employee_id) === String(auth.employee.id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  // Google Sheets returns date-formatted cells as Date objects, not strings.
  // Normalise start/end to YYYY-MM-DD so both the balance math below and the
  // frontend receive clean strings.
  requests.forEach(r => {
    r.start_date = _normaliseLeaveDate(r.start_date);
    r.end_date   = _normaliseLeaveDate(r.end_date);
    delete r.__rowIndex;
  });

  // Annual balance — sum approved annual-type days that started this calendar year
  const annualTotal = Number(getConfigValue('annual_leave_days', 21)) || 21;
  const currentYear = String(new Date().getFullYear());

  const annualThisYear = requests.filter(l =>
    String(l.leave_type) === 'annual' &&
    String(l.start_date  || '').startsWith(currentYear)
  );

  const annualTaken = annualThisYear
    .filter(l => String(l.status) === 'approved')
    .reduce((sum, l) => sum + _countDays(l.start_date, l.end_date), 0);

  const annualPending = annualThisYear
    .filter(l => String(l.status) === 'pending')
    .reduce((sum, l) => sum + _countDays(l.start_date, l.end_date), 0);

  const balance = {
    annual_total:     annualTotal,
    annual_taken:     annualTaken,
    annual_pending:   annualPending,
    annual_remaining: Math.max(0, annualTotal - annualTaken)
  };

  return ok({ requests, balance });
}

// =============================================================================
// getTeamLeaves
// Manager sees pending leaves for their direct reports.
// CEO / MD see pending leaves for the department managers who report straight
// to them — scoped identically to a manager, never company-wide.
// HR sees all leaves company-wide.
//
// Also returns `balances` — the annual leave balance for every employee in
// scope — so approvers can see how much entitlement someone has left before
// approving a request. Each returned request also carries the requester's
// annual_total / annual_taken / annual_remaining inline.
// =============================================================================
function getTeamLeaves(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const role = String(auth.employee.role || '').toLowerCase();
  // Managers and executives are both "direct report" approvers — they only ever
  // see and act on people whose manager_id points at them. HR is the only role
  // with a company-wide view here.
  const directOnly = (role === 'manager' || isExecRole(role));
  if (!directOnly && role !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const employees = sheetToObjects(getSheet('Employees'));

  let teamIds;
  if (role === 'hr') {
    teamIds = employees
      .filter(e => String(e.active).toUpperCase() === 'TRUE')
      .map(e => String(e.id));
  } else {
    teamIds = employees
      .filter(e =>
        String(e.manager_id) === String(auth.employee.id) &&
        String(e.active).toUpperCase() === 'TRUE'
      )
      .map(e => String(e.id));
  }

  // id → { name, department } lookup so the frontend can display these without a second call
  const empMap = {};
  employees.forEach(function(e) {
    empMap[String(e.id)] = { name: String(e.name || e.username || e.id), department: String(e.department || '') };
  });

  const allLeaves = sheetToObjects(getSheet('Leaves'));

  // Balances are computed from every leave row of the team — not just the
  // filtered/visible ones — otherwise a manager's pending-only view would
  // report a zero balance for everyone.
  const balanceMap = _annualBalances(teamIds, allLeaves);

  const requests = allLeaves
    .filter(function(l) {
      if (!teamIds.includes(String(l.employee_id))) return false;
      // Managers and executives only see pending requests (their approval queue).
      // HR sees all statuses so the Leave Requests screen shows the full picture.
      if (directOnly) return String(l.status) === 'pending';
      return true;
    })
    .sort(function(a, b) {
      // Newest first — most relevant for HR; still useful for managers too.
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

  requests.forEach(function(l) {
    const emp = empMap[String(l.employee_id)] || {};
    l.employee_name = emp.name       || '';
    l.department    = emp.department || '';

    // Sheets hands back date-formatted cells as Date objects — normalise so the
    // frontend always receives YYYY-MM-DD strings.
    l.start_date = _normaliseLeaveDate(l.start_date);
    l.end_date   = _normaliseLeaveDate(l.end_date);

    // Requester's balance inline — lets the approver see what's left without a lookup
    const bal = balanceMap[String(l.employee_id)];
    if (bal) {
      l.annual_total     = bal.annual_total;
      l.annual_taken     = bal.annual_taken;
      l.annual_pending   = bal.annual_pending;
      l.annual_remaining = bal.annual_remaining;
    }

    delete l.__rowIndex;
  });

  // One balance row per team member, sorted by name for a stable table
  const balances = teamIds
    .map(function(id) {
      const emp = empMap[id] || {};
      const bal = balanceMap[id];
      return {
        employee_id:      id,
        employee_name:    emp.name       || id,
        department:       emp.department || '',
        annual_total:     bal.annual_total,
        annual_taken:     bal.annual_taken,
        annual_pending:   bal.annual_pending,
        annual_remaining: bal.annual_remaining
      };
    })
    .sort(function(a, b) {
      return String(a.employee_name).localeCompare(String(b.employee_name));
    });

  return ok({ requests, balances, year: new Date().getFullYear() });
}

// =============================================================================
// Private: annual leave balance for a set of employees.
//
// Counts approved and pending annual-leave days that START in the current
// calendar year. Pending days are reported separately — they are not yet
// deducted from the remaining balance, but an approver needs to see them.
//
// Returns { employeeId: { annual_total, annual_taken, annual_pending, annual_remaining } }
// =============================================================================
function _annualBalances(employeeIds, allLeaves) {
  const annualTotal = Number(getConfigValue('annual_leave_days', 21)) || 21;
  const currentYear = String(new Date().getFullYear());

  const map = {};
  employeeIds.forEach(function(id) {
    map[String(id)] = {
      annual_total:     annualTotal,
      annual_taken:     0,
      annual_pending:   0,
      annual_remaining: annualTotal
    };
  });

  allLeaves.forEach(function(l) {
    const bucket = map[String(l.employee_id)];
    if (!bucket) return;
    if (String(l.leave_type || '').toLowerCase() !== 'annual') return;

    const start = _normaliseLeaveDate(l.start_date);
    if (!start.startsWith(currentYear)) return;

    const days   = _countDays(start, l.end_date);
    const status = String(l.status || '').toLowerCase();

    if (status === 'approved')     bucket.annual_taken   += days;
    else if (status === 'pending') bucket.annual_pending += days;
  });

  Object.keys(map).forEach(function(id) {
    map[id].annual_remaining = Math.max(0, map[id].annual_total - map[id].annual_taken);
  });

  return map;
}

// =============================================================================
// approveLeave
// Manager/CEO/MD/HR approves a pending request.
//
// This is the ONE write path open to the executive roles — department managers
// report straight to the CEO/MD, so nobody else can clear their leave. Every
// non-HR caller is confined to their own direct reports by the manager_id check
// below; executives get no company-wide write reach from this.
// =============================================================================
function approveLeave(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const role = String(auth.employee.role || '').toLowerCase();
  if (role !== 'manager' && role !== 'hr' && !isExecRole(role)) {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const leaveId = String(payload.leave_id || '').trim();
  if (!leaveId) return error('leave_id is required', 'معرّف طلب الإجازة مطلوب');

  const sheet = getSheet('Leaves');
  const leave = findRow(sheet, 'id', leaveId);
  if (!leave) return error('Leave request not found', 'طلب الإجازة غير موجود');

  if (String(leave.status) !== 'pending') {
    return error('Leave request is no longer pending', 'طلب الإجازة لم يعد قيد الانتظار');
  }

  // HR is the only role allowed to act outside their own reporting line
  if (role !== 'hr') {
    const emp = findRow(getSheet('Employees'), 'id', String(leave.employee_id));
    if (!emp || String(emp.manager_id) !== String(auth.employee.id)) {
      return error('Employee is not in your team', 'الموظف ليس في فريقك');
    }
  }

  updateRow(sheet, leave.__rowIndex, {
    status:      'approved',
    approved_by: auth.employee.id,
    approved_at: new Date().toISOString()
  });

  return ok({ leave_id: leaveId, status: 'approved' });
}

// =============================================================================
// rejectLeave
// Manager/CEO/MD/HR rejects a pending request with an optional reason.
// Same scoping rule as approveLeave — non-HR callers act on direct reports only.
// =============================================================================
function rejectLeave(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const role = String(auth.employee.role || '').toLowerCase();
  if (role !== 'manager' && role !== 'hr' && !isExecRole(role)) {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const leaveId      = String(payload.leave_id || '').trim();
  const rejectReason = String(payload.reason   || '').trim();
  if (!leaveId) return error('leave_id is required', 'معرّف طلب الإجازة مطلوب');

  const sheet = getSheet('Leaves');
  const leave = findRow(sheet, 'id', leaveId);
  if (!leave) return error('Leave request not found', 'طلب الإجازة غير موجود');

  if (String(leave.status) !== 'pending') {
    return error('Leave request is no longer pending', 'طلب الإجازة لم يعد قيد الانتظار');
  }

  // HR is the only role allowed to act outside their own reporting line
  if (role !== 'hr') {
    const emp = findRow(getSheet('Employees'), 'id', String(leave.employee_id));
    if (!emp || String(emp.manager_id) !== String(auth.employee.id)) {
      return error('Employee is not in your team', 'الموظف ليس في فريقك');
    }
  }

  updateRow(sheet, leave.__rowIndex, {
    status:        'rejected',
    approved_by:   auth.employee.id,
    approved_at:   new Date().toISOString(),
    reject_reason: rejectReason
  });

  return ok({ leave_id: leaveId, status: 'rejected' });
}

// =============================================================================
// Private: normalise a Leaves date cell to a YYYY-MM-DD string.
// Sheets returns date-formatted cells as Date objects; plain-text cells as
// strings. Either way this yields the stored YYYY-MM-DD format.
// =============================================================================
function _normaliseLeaveDate(val) {
  if (!val) return '';
  if (val instanceof Date) return formatDate(val);
  return String(val).trim();
}

// =============================================================================
// Private: count inclusive calendar days between two dates.
// Accepts YYYY-MM-DD strings or Date objects (Sheets date cells).
// 2026-06-01 → 2026-06-03  =  3 days
// =============================================================================
function _countDays(startDate, endDate) {
  const s = new Date(_normaliseLeaveDate(startDate) + 'T00:00:00Z');
  const e = new Date(_normaliseLeaveDate(endDate)   + 'T00:00:00Z');
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  return Math.max(0, Math.round((e - s) / 86400000) + 1);
}
