// =============================================================================
// report.js — Client-side XLSX attendance report generation
// Uses xlsx-js-style (drop-in SheetJS fork with cell-style write support).
// Entry point: generateReport(data, year, month) — called from hr.js
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// generateReport — public, exported to window
// ---------------------------------------------------------------------------
// data    : response payload from apiGetReportData → Report.gs
// year    : integer, e.g. 2026
// month   : integer 1–12
//
// Builds an XLSX workbook with one row per active employee, one column per
// calendar day, plus summary totals, then triggers an immediate download.
function generateReport(data, year, month) {
  if (typeof XLSX === 'undefined') {
    console.error('[report.js] XLSX library not loaded — check CDN');
    return;
  }

  const daysInMonth = Number(data.days_in_month) || _reportDaysInMonth(year, month);
  // working_days is already normalised to an array of integers by Report.gs
  const workingSet  = new Set(
    Array.isArray(data.working_days) ? data.working_days : [0, 1, 2, 3, 4]
  );
  const holidaySet  = new Set(data.holidays || []);

  const yyyy = String(year);
  const mm   = String(month).padStart(2, '0');

  // ── Column headers ─────────────────────────────────────────────────────────
  const headers = [
    t('reports.col_name'),
    t('reports.col_department'),
  ];
  for (let d = 1; d <= daysInMonth; d++) headers.push(String(d));
  headers.push(
    t('reports.col_total_present'),
    t('reports.col_total_absent'),
    t('reports.col_total_late'),
    t('reports.col_total_hours'),
    t('reports.col_leave_days')
  );

  // ── Data rows, one per employee ────────────────────────────────────────────
  const aoa = [headers]; // array-of-arrays for XLSX.utils.aoa_to_sheet

  for (let ei = 0; ei < data.employees.length; ei++) {
    const emp = data.employees[ei];

    // Build date → attendance record lookup
    const attMap = {};
    (data.attendance[emp.id] || []).forEach(function(rec) {
      attMap[String(rec.date)] = rec;
    });

    // Build set of leave-covered dates for this employee within this month
    const leaveSet = new Set();
    (data.leaves[emp.id] || []).forEach(function(lv) {
      const startDt = new Date(lv.start_date + 'T00:00:00');
      const endDt   = new Date(lv.end_date   + 'T00:00:00');
      for (
        var cur = new Date(startDt);
        cur <= endDt;
        cur.setDate(cur.getDate() + 1)
      ) {
        const iso =
          cur.getFullYear() + '-' +
          String(cur.getMonth() + 1).padStart(2, '0') + '-' +
          String(cur.getDate()).padStart(2, '0');
        // Only add dates that fall within the requested month
        if (iso >= yyyy + '-' + mm + '-01') leaveSet.add(iso);
      }
    });

    // Per-day status codes
    let totPresent = 0, totAbsent = 0, totLate = 0;
    let totHours   = 0, totLeave  = 0;
    const dayCodes = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = yyyy + '-' + mm + '-' + String(d).padStart(2, '0');
      const dow     = new Date(dateStr + 'T00:00:00').getDay(); // 0=Sun … 6=Sat
      const isHol   = holidaySet.has(dateStr);
      const isWork  = workingSet.has(dow);
      const isLeave = leaveSet.has(dateStr);
      const rec     = attMap[dateStr];

      let code;

      if (isHol) {
        // Company holiday takes precedence over all other states
        code = 'H';
      } else if (!isWork) {
        // Weekend or non-working day
        code = '—';
      } else if (isLeave) {
        code = 'Lv';
        totLeave++;
      } else if (rec) {
        const st = String(rec.status || '').toLowerCase();
        if (st === 'late') {
          code = 'L';
          totLate++;
          totPresent++; // Late employees are still counted as present
        } else {
          code = 'P';
          totPresent++;
        }
        const h = parseFloat(rec.hours_worked);
        if (!isNaN(h) && h > 0) totHours += h;
      } else {
        // Working day with no record, no leave, no holiday → absent
        code = 'A';
        totAbsent++;
      }

      dayCodes.push(code);
    }

    aoa.push([
      emp.name,
      emp.department,
      ...dayCodes,
      totPresent,
      totAbsent,
      totLate,
      Math.round(totHours * 100) / 100,
      totLeave,
    ]);
  }

  // ── Build workbook ─────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths: Name, Dept, then one per day, then 5 totals
  const colWidths = [{ wch: 26 }, { wch: 18 }];
  for (let d = 0; d < daysInMonth; d++) colWidths.push({ wch: 4.5 });
  colWidths.push(
    { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 9 }
  );
  ws['!cols'] = colWidths;

  // Taller header row for wrapped text
  ws['!rows'] = [{ hpt: 32 }];

  // Freeze the Name+Department columns and header row so HR can scroll freely
  ws['!freeze'] = { xSplit: 2, ySplit: 1 };

  // Cell styles — requires xlsx-js-style (standard SheetJS ignores s property)
  _styleReportSheet(ws, daysInMonth, aoa.length);

  // Sheet tab label uses localised month name or falls back to numeric
  const sheetName = _reportMonthLabel(year, month);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel sheet name max 31 chars

  const filename = 'LMP_Attendance_' + yyyy + '_' + mm + '.xlsx';
  XLSX.writeFile(wb, filename);
}

window.generateReport = generateReport;

// ---------------------------------------------------------------------------
// _styleReportSheet — apply all cell formatting
// ---------------------------------------------------------------------------
// Colour scheme follows the app's brand palette.
// Each call creates a fresh style object (never mutates shared constants).
function _styleReportSheet(ws, daysInMonth, totalRows) {
  // Palette constants
  const PRIMARY   = '1D4ED8'; // header background
  const PRIMARY_D = '1E3A8A'; // totals header background (slightly darker)

  // Day-code colours: [background, text]
  const DAY_COLORS = {
    'P':  ['DCFCE7', '15803D'],
    'L':  ['FEF3C7', '92400E'],
    'A':  ['FEE2E2', '991B1B'],
    'Lv': ['CFFAFE', '155E75'],
    'H':  ['F3E8FF', '6B21A8'],
    '—':  [null,     'CBD5E1'],
  };

  const totalColStart = 2 + daysInMonth; // 0-indexed column of first totals column
  const numCols       = totalColStart + 5;

  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: r, c: c });
      if (!ws[addr]) continue;

      if (r === 0) {
        // ── Header row ────────────────────────────────────────────────────
        const bg = c >= totalColStart ? PRIMARY_D : PRIMARY;
        ws[addr].s = {
          font:  { bold: true, color: { rgb: 'FFFFFF' }, sz: 10, name: 'Arial' },
          fill:  { patternType: 'solid', fgColor: { rgb: bg } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: { bottom: { style: 'thin', color: { rgb: 'FFFFFF' } } }
        };

      } else if (c === 0) {
        // ── Employee name ─────────────────────────────────────────────────
        ws[addr].s = {
          font:  { bold: true, sz: 10, name: 'Arial' },
          alignment: { vertical: 'center' }
        };

      } else if (c === 1) {
        // ── Department ────────────────────────────────────────────────────
        ws[addr].s = {
          font:  { sz: 10, name: 'Arial', color: { rgb: '64748B' } },
          alignment: { vertical: 'center' }
        };

      } else if (c < totalColStart) {
        // ── Day cell ──────────────────────────────────────────────────────
        const code   = String(ws[addr].v || '');
        const colors = DAY_COLORS[code];
        ws[addr].s = {
          font: {
            bold:  !!colors && code !== '—',
            color: { rgb: colors ? colors[1] : '333333' },
            sz:    9,
            name:  'Arial'
          },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
        if (colors && colors[0]) {
          ws[addr].s.fill = { patternType: 'solid', fgColor: { rgb: colors[0] } };
        }

      } else {
        // ── Summary totals ────────────────────────────────────────────────
        ws[addr].s = {
          font:      { bold: true, sz: 10, name: 'Arial' },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
        // Alternate light stripe on even/odd rows for readability
        if (r % 2 === 0) {
          ws[addr].s.fill = {
            patternType: 'solid', fgColor: { rgb: 'F8FAFC' }
          };
        }
      }
    }
  }

  // Alternating row tint for the data area (name + dept + days)
  for (let r = 1; r < totalRows; r++) {
    if (r % 2 === 0) continue; // odd rows stay white
    for (let c = 0; c < 2; c++) { // name + dept only (day cells have own colours)
      const addr = XLSX.utils.encode_cell({ r: r, c: c });
      if (!ws[addr]) continue;
      if (!ws[addr].s) ws[addr].s = {};
      ws[addr].s.fill = { patternType: 'solid', fgColor: { rgb: 'F8FAFC' } };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Days in a given month (handles leap years automatically)
function _reportDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Short localised month+year label for the Excel sheet tab
function _reportMonthLabel(year, month) {
  const lang = localStorage.getItem('lmp_lang') || 'ar';
  const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                     'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const EN_MONTHS = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
  const names = lang === 'ar' ? AR_MONTHS : EN_MONTHS;
  return (names[month - 1] || String(month)) + ' ' + year;
}
