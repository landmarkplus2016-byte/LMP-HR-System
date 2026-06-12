// =============================================================================
// Report.gs — Monthly attendance report data for SheetJS client-side generation
// =============================================================================

// ---------------------------------------------------------------------------
// getReportData
// ---------------------------------------------------------------------------
// Payload: { session_token, year, month, department_id? }
//
// Fetches all employees, their attendance records, approved leaves, and
// holidays for the given month, then returns a single structured payload that
// report.js turns into an XLSX file entirely client-side.
//
// Response shape:
//   { employees, attendance, leaves, holidays,
//     year, month, days_in_month, working_days }
//
//   attendance: { emp_id: [{ date, check_in, check_out, hours_worked, status }] }
//   leaves:     { emp_id: [{ start_date, end_date, type }] }
//   holidays:   ["YYYY-MM-DD", ...]
//   working_days: [0,1,2,3,4]  (0=Sun … 6=Sat)
function getReportData(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  if (String(auth.employee.role || '').toLowerCase() !== 'hr') {
    return error('Access denied', 'غير مخوّل للوصول');
  }

  const year   = parseInt(payload.year,  10);
  const month  = parseInt(payload.month, 10);
  const deptId = String(payload.department_id || '').trim();

  if (isNaN(year)  || year  < 2020 || year  > 2100)
    return error('Invalid year',  'سنة غير صالحة');
  if (isNaN(month) || month < 1    || month > 12)
    return error('Invalid month', 'شهر غير صالح');

  const mm          = String(month).padStart(2, '0');
  const daysInMonth = new Date(year, month, 0).getDate(); // day-0 of next month = last day
  const dateFrom    = year + '-' + mm + '-01';
  const dateTo      = year + '-' + mm + '-' + String(daysInMonth).padStart(2, '0');

  // ── Employees ─────────────────────────────────────────────────────────────
  var employees = sheetToObjects(getSheet('Employees'))
    .filter(function(e) { return String(e.active || '').toUpperCase() !== 'FALSE'; });

  if (deptId) {
    employees = employees.filter(function(e) {
      return String(e.department || '') === deptId;
    });
  }

  // Sort alphabetically so the Excel rows are consistently ordered
  employees.sort(function(a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  const safeEmployees = employees.map(function(e) {
    return {
      id:         String(e.id         || ''),
      name:       String(e.name       || ''),
      department: String(e.department || ''),
      shift_id:   String(e.shift_id   || '')
    };
  });

  // Fast membership lookup: id → true
  const empIdSet = {};
  safeEmployees.forEach(function(e) { empIdSet[e.id] = true; });

  // ── Attendance for the month ───────────────────────────────────────────────
  const attendance = {};
  sheetToObjects(getSheet('Attendance'))
    .filter(function(r) {
      return empIdSet[String(r.employee_id)] &&
             String(r.date) >= dateFrom &&
             String(r.date) <= dateTo;
    })
    .forEach(function(r) {
      const id = String(r.employee_id);
      if (!attendance[id]) attendance[id] = [];
      attendance[id].push({
        date:         String(r.date         || ''),
        check_in:     String(r.check_in     || ''),
        check_out:    String(r.check_out    || ''),
        hours_worked: String(r.hours_worked || ''),
        status:       String(r.status       || 'present')
      });
    });

  // ── Approved leaves that overlap this month ────────────────────────────────
  const leaves = {};
  sheetToObjects(getSheet('Leaves'))
    .filter(function(l) {
      if (!empIdSet[String(l.employee_id)]) return false;
      if (String(l.status || '').toLowerCase() !== 'approved') return false;
      // Overlap test: leave starts before month end AND ends after month start
      return String(l.end_date) >= dateFrom && String(l.start_date) <= dateTo;
    })
    .forEach(function(l) {
      const id = String(l.employee_id);
      if (!leaves[id]) leaves[id] = [];
      leaves[id].push({
        start_date: String(l.start_date || ''),
        end_date:   String(l.end_date   || ''),
        type:       String(l.type       || '')
      });
    });

  // ── Company holidays within the month ─────────────────────────────────────
  var holidays = [];
  try {
    holidays = sheetToObjects(getSheet('Holidays'))
      .filter(function(h) {
        return String(h.date) >= dateFrom && String(h.date) <= dateTo;
      })
      .map(function(h) { return String(h.date); });
  } catch (e) {
    // Holidays sheet missing or empty — non-fatal
  }

  // ── Working day numbers from Config ───────────────────────────────────────
  // Config key "working_days" stores day numbers (0=Sun…6=Sat) as a
  // comma-separated string, e.g. "0,1,2,3,4" for Sun–Thu.
  // Also accept day-name abbreviations ("Sun,Mon,...") for flexibility.
  const rawWD = String(getConfigValue('working_days', '0,1,2,3,4'));
  const DAY_ABBR = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
  const workingDayNums = rawWD.split(',')
    .map(function(s) {
      s = s.trim().toLowerCase();
      const n = parseInt(s, 10);
      return isNaN(n)
        ? (DAY_ABBR[s] !== undefined ? DAY_ABBR[s] : -1)
        : n;
    })
    .filter(function(n) { return n >= 0 && n <= 6; });

  return ok({
    employees:     safeEmployees,
    attendance:    attendance,
    leaves:        leaves,
    holidays:      holidays,
    year:          year,
    month:         month,
    days_in_month: daysInMonth,
    working_days:  workingDayNums
  });
}
