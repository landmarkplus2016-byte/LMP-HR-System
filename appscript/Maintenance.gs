// =============================================================================
// Maintenance.gs — Scheduled cleanup and archival tasks
// =============================================================================
//
// Two time-based triggers must be installed once after first deployment.
//
// ── OPTION A: run installTriggers() (recommended) ──────────────────────────
//   1. Open the Apps Script editor for this project
//   2. Select "installTriggers" in the function dropdown (top toolbar)
//   3. Click Run — grant any permissions Apps Script requests
//   Both triggers are created automatically. Running it again is safe (idempotent).
//
// ── OPTION B: manual via the Triggers dashboard ────────────────────────────
//   Left sidebar → Triggers (clock icon) → + Add Trigger:
//
//   Trigger 1 — Session cleanup
//     Function to run:    cleanExpiredSessions
//     Event source:       Time-driven
//     Type of time:       Day timer
//     Time of day:        2am – 3am
//
//   Trigger 2 — Attendance archive
//     Function to run:    archiveAttendance
//     Event source:       Time-driven
//     Type of time:       Month timer
//     Day of month:       1
//     Time of day:        3am – 4am
//     (archiveAttendance guards internally — only acts on January 1st)
//
// ── TIMEZONE NOTE ──────────────────────────────────────────────────────────
//   Triggers fire in the script owner's timezone.
//   Verify: Project Settings (gear icon) → Script Properties → Time zone.
//   Set it to the company's local timezone before installing triggers.
// =============================================================================

// Stale rate-limiter rows (failed_attempt, webauthn_fail) are eligible for
// cleanup once their last_attempt timestamp is older than this value.
// 35 min covers the 30-min lockout window plus a small margin.
const _STALE_RATE_LIMITER_MS = 35 * 60 * 1000;

// =============================================================================
// cleanExpiredSessions
// Purges three categories of stale rows from the Sessions tab:
//   1. Any row where expires_at < now (expired sessions, challenges, tokens)
//   2. Single-use challenge / checkin_token rows already consumed (used=TRUE)
//   3. Rate-limiter tracker rows (failed_attempt, webauthn_fail) whose
//      last_attempt timestamp is older than _STALE_RATE_LIMITER_MS
// =============================================================================
function cleanExpiredSessions() {
  const sessSheet = getSheet('Sessions');
  const allData   = sessSheet.getDataRange().getValues();
  if (allData.length < 2) {
    console.log('[cleanExpiredSessions] Sessions tab is empty — nothing to clean');
    return;
  }

  const headers      = allData[0];
  const expiresAtIdx = headers.indexOf('expires_at');
  const tokenTypeIdx = headers.indexOf('token_type');
  const usedIdx      = headers.indexOf('used');
  const deviceIdIdx  = headers.indexOf('device_id'); // holds last_attempt for rate-limiter rows

  if (expiresAtIdx === -1) {
    console.error('[cleanExpiredSessions] expires_at column not found in Sessions tab');
    return;
  }

  const now          = new Date();
  const rowsToDelete = []; // 1-based sheet row indices, collected for reverse-order deletion

  for (let i = 1; i < allData.length; i++) {
    const row       = allData[i];
    const tokenType = tokenTypeIdx !== -1 ? String(row[tokenTypeIdx]) : '';
    const usedVal   = usedIdx      !== -1 ? String(row[usedIdx]).toUpperCase() : '';
    const expiresAt = new Date(row[expiresAtIdx]);

    // Category 1: row has a valid expires_at that is in the past
    const isExpired = !isNaN(expiresAt.getTime()) && now > expiresAt;

    // Category 2: single-use tokens/challenges that have been consumed
    const isConsumed = (
      usedVal === 'TRUE' &&
      (tokenType === 'webauthn_reg'  ||
       tokenType === 'webauthn_auth' ||
       tokenType === 'checkin_token')
    );

    // Category 3: stale rate-limiter rows with no recent activity
    const isStaleRateLimiter = (
      (tokenType === 'failed_attempt' || tokenType === 'webauthn_fail') &&
      deviceIdIdx !== -1 &&
      (function () {
        const lastAttempt = new Date(row[deviceIdIdx]);
        return !isNaN(lastAttempt.getTime()) &&
               (now.getTime() - lastAttempt.getTime()) > _STALE_RATE_LIMITER_MS;
      }())
    );

    if (isExpired || isConsumed || isStaleRateLimiter) {
      rowsToDelete.push(i + 1); // slice is 0-based; sheet rows are 1-based (+1 for header)
    }
  }

  // Delete in reverse order so earlier row indices stay valid
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sessSheet.deleteRow(rowsToDelete[i]);
  }

  console.log('[cleanExpiredSessions] Deleted ' + rowsToDelete.length +
              ' stale rows from Sessions tab');
}

// =============================================================================
// archiveAttendance
// Runs on January 1st each year (the monthly trigger fires on the 1st of every
// month, but the guard below restricts execution to January only).
//
// Steps:
//   1. Collect all Attendance rows whose date column starts with the previous year
//   2. Create (or open) 'LMP_Attendance_Archive_YYYY' in the same Drive folder
//   3. Write headers + rows to 'Attendance_YYYY' sheet inside the archive
//   4. Delete the archived rows from the main Attendance tab
// =============================================================================
function archiveAttendance() {
  const today = new Date();

  // Guard: only execute on January 1st
  if (today.getMonth() !== 0 || today.getDate() !== 1) {
    console.log('[archiveAttendance] Not January 1st (month=' + today.getMonth() +
                ', day=' + today.getDate() + ') — skipping');
    return;
  }

  const prevYear = today.getFullYear() - 1;
  const yearStr  = String(prevYear);
  const ss       = getSpreadsheet();
  const attSheet = ss.getSheetByName('Attendance');

  if (!attSheet) {
    console.error('[archiveAttendance] Attendance sheet not found');
    return;
  }

  const allData = attSheet.getDataRange().getValues();
  if (allData.length < 2) {
    console.log('[archiveAttendance] Attendance tab is empty — nothing to archive');
    return;
  }

  const headers    = allData[0];
  const dateColIdx = headers.indexOf('date');
  if (dateColIdx === -1) {
    console.error('[archiveAttendance] date column not found in Attendance tab');
    return;
  }

  // Collect rows from the previous year
  const yearPrefix        = yearStr + '-';
  const rowsToArchive     = [];
  const sheetRowsToDelete = []; // 1-based row indices in the main sheet

  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][dateColIdx]).startsWith(yearPrefix)) {
      rowsToArchive.push(allData[i]);
      sheetRowsToDelete.push(i + 1); // 0-based slice → 1-based sheet row
    }
  }

  if (rowsToArchive.length === 0) {
    console.log('[archiveAttendance] No rows found for year ' + yearStr);
    return;
  }

  // Locate the Drive folder containing the main spreadsheet
  const currentFile   = DriveApp.getFileById(SPREADSHEET_ID);
  const parentFolders = currentFile.getParents();
  const parentFolder  = parentFolders.hasNext()
    ? parentFolders.next()
    : DriveApp.getRootFolder();

  // Open the archive if it exists; otherwise create it and move it to the correct folder
  const archiveName = 'LMP_Attendance_Archive_' + yearStr;
  const existing    = parentFolder.getFilesByName(archiveName);
  let   archiveSS;

  if (existing.hasNext()) {
    archiveSS = SpreadsheetApp.open(existing.next());
    console.log('[archiveAttendance] Appending to existing archive: ' + archiveName);
  } else {
    archiveSS = SpreadsheetApp.create(archiveName);
    // SpreadsheetApp.create() places the file in My Drive root — move it to the project folder
    DriveApp.getFileById(archiveSS.getId()).moveTo(parentFolder);
    console.log('[archiveAttendance] Created new archive: ' + archiveName);
  }

  const archiveSheet = archiveSS.getActiveSheet();
  archiveSheet.setName('Attendance_' + yearStr);

  // Write column headers once if the archive sheet is empty
  if (archiveSheet.getLastRow() === 0) {
    archiveSheet.appendRow(headers);
  }

  // Batch-write all rows in a single API call
  archiveSheet
    .getRange(archiveSheet.getLastRow() + 1, 1, rowsToArchive.length, headers.length)
    .setValues(rowsToArchive);

  // Delete archived rows from the main sheet in reverse order
  for (let i = sheetRowsToDelete.length - 1; i >= 0; i--) {
    attSheet.deleteRow(sheetRowsToDelete[i]);
  }

  console.log(
    '[archiveAttendance] Archived ' + rowsToArchive.length +
    ' rows for ' + yearStr + ' → ' + archiveName
  );
}

// =============================================================================
// installTriggers
// Run once from the Apps Script editor after deployment.
// Idempotent: removes any existing triggers for the two functions first.
// =============================================================================
function installTriggers() {
  // Remove existing triggers for these functions to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const fn = trigger.getHandlerFunction();
    if (fn === 'cleanExpiredSessions' || fn === 'archiveAttendance') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Daily at 02:00 — session and token cleanup
  ScriptApp.newTrigger('cleanExpiredSessions')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .nearMinute(0)
    .create();

  // Monthly on the 1st at 03:00 — archive previous year's attendance.
  // archiveAttendance() guards internally so it only acts on January 1st.
  ScriptApp.newTrigger('archiveAttendance')
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .nearMinute(0)
    .create();

  console.log('[installTriggers] cleanExpiredSessions (daily 02:00) and ' +
              'archiveAttendance (monthly day-1 03:00) triggers installed');
}
