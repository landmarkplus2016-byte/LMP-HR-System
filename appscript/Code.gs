// =============================================================================
// Code.gs — Single entry point for all Apps Script Web App calls
// =============================================================================
//
// SETUP — before deploying:
//   1. Open Utils.gs and replace SPREADSHEET_ID with your actual Sheet ID
//   2. Deploy → New deployment → Web App
//      Execute as: Me  |  Who has access: Anyone
//   3. Copy the Web App URL → paste into the PWA on first launch
//      (never put the URL in this code)
//
// Sessions tab must have these column headers (in any order):
//   token | employee_id | role | expires_at | device_id |
//   token_type | challenge | used
// =============================================================================

// ---------------------------------------------------------------------------
// doGet — health check endpoint
// ---------------------------------------------------------------------------
// Lets you verify the deployment is alive by opening the URL in a browser.
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'LMP Attendance API is running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// doPost — main entry point
// ---------------------------------------------------------------------------
function doPost(e) {
  let payload = {};
  let action  = '';

  try {
    payload = JSON.parse(e.postData.contents);
    action  = String(payload.action || '').trim();

    if (!action) {
      return respond(error('Missing action field', 'حقل الإجراء مفقود'));
    }

    const result = route(action, payload);
    return respond(result);

  } catch (err) {
    // Never crash silently — log the error and return a clean JSON response.
    // NOTE: this catch is why failed calls still show as "Completed" in the
    // Apps Script Executions list — the exception never escapes doPost.
    const detail = 'action=' + action + ' | ' + _errText(err);
    console.error('[doPost] ' + detail + ' stack=' + (err && err.stack ? err.stack : 'n/a'));

    // Config key debug_mode = TRUE surfaces the failing action and exception
    // message to the client so a problem on a phone can be identified without
    // reading the execution log. Default FALSE — users never see raw technical
    // strings in normal operation (CLAUDE.md).
    if (_debugEnabled()) {
      return respond(error(
        'Internal server error — ' + detail,
        'خطأ داخلي في الخادم — ' + detail,
        'internal_error'
      ));
    }
    return respond(error('Internal server error', 'خطأ داخلي في الخادم', 'internal_error'));
  }
}

// Readable text for anything that can be thrown (Error, string, object).
function _errText(err) {
  if (!err) return 'unknown error';
  if (err.message) return String(err.message);
  return String(err);
}

// Is debug_mode switched on in the Config tab?
// Wrapped in its own try/catch: this runs INSIDE doPost's catch block, and a
// throw here would escape as an HTML error page instead of our JSON envelope.
function _debugEnabled() {
  try {
    return String(getConfigValue('debug_mode', 'FALSE')).toUpperCase() === 'TRUE';
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// route — dispatch to the correct handler based on action
// ---------------------------------------------------------------------------
// The complete routing table for all 40+ actions across all stages.
// Unimplemented handlers return a graceful "not yet implemented" error
// so the router never needs to be modified as later stages are built.
function route(action, payload) {
  switch (action) {

    // ── Auth ──────────────────────────────────────────────────────────────
    case 'login':                        return login(payload);
    case 'change_password':              return changePassword(payload);
    case 'logout':                       return logout(payload);
    case 'get_config':                   return getConfig(payload);
    case 'get_profile':                  return getProfile(payload);   // session validation + profile

    // ── WebAuthn (Stage 2) ────────────────────────────────────────────────
    case 'webauthn_register_challenge':  return webauthnRegisterChallenge(payload);
    case 'webauthn_register_complete':   return webauthnRegisterComplete(payload);
    case 'webauthn_auth_challenge':      return webauthnAuthChallenge(payload);
    case 'webauthn_auth_verify':         return webauthnAuthVerify(payload);

    // ── Attendance (Stage 2 / 5) ──────────────────────────────────────────
    case 'checkin':                      return checkIn(payload);
    case 'checkout':                     return checkOut(payload);
    case 'get_my_attendance':            return getMyAttendance(payload);
    case 'get_all_attendance':           return getAllAttendance(payload);
    case 'correct_attendance':           return correctAttendance(payload);
    case 'add_manual_attendance':        return addManualAttendance(payload);
    case 'delete_attendance':            return deleteAttendance(payload);
    case 'get_flagged_records':          return getFlaggedRecords(payload);
    case 'get_integrity_report':         return getIntegrityReport(payload);

    // ── Employees (Stage 4 / 5) ───────────────────────────────────────────
    case 'get_team_status':              return getTeamStatus(payload);
    case 'get_team_attendance':          return getTeamAttendance(payload);
    case 'get_team_employees':           return getTeamEmployees(payload);
    case 'get_org_status':               return getOrgStatus(payload);
    case 'get_all_employees':            return getAllEmployees(payload);
    case 'add_employee':                 return addEmployee(payload);
    case 'update_employee':              return updateEmployee(payload);
    case 'deactivate_employee':          return deactivateEmployee(payload);
    case 'reactivate_employee':          return reactivateEmployee(payload);
    case 'hr_reset_password':            return hrResetPassword(payload);
    case 'hr_reset_biometric':           return hrResetBiometric(payload);

    // ── Leaves (Stage 3 / 4) ─────────────────────────────────────────────
    case 'submit_leave':                 return submitLeave(payload);
    case 'get_my_leaves':                return getMyLeaves(payload);
    case 'get_team_leaves':              return getTeamLeaves(payload);
    case 'approve_leave':                return approveLeave(payload);
    case 'reject_leave':                 return rejectLeave(payload);

    // ── Reports (Stage 5) ─────────────────────────────────────────────────
    case 'get_report_data':              return getReportData(payload);

    // ── Locations (Stage 5) ───────────────────────────────────────────────
    case 'get_locations':                return getLocations(payload);
    case 'add_location':                 return addLocation(payload);
    case 'update_location':              return updateLocation(payload);
    case 'toggle_location':              return toggleLocation(payload);

    // ── Admin — Shifts, Departments, Holidays, Config (Stage 5) ──────────
    case 'get_shifts':                   return getShifts(payload);
    case 'add_shift':                    return addShift(payload);
    case 'update_shift':                 return updateShift(payload);
    case 'delete_shift':                 return deleteShift(payload);
    case 'get_departments':              return getDepartments(payload);
    case 'add_department':              return addDepartment(payload);
    case 'update_department':            return updateDepartment(payload);
    case 'get_holidays':                 return getHolidays(payload);
    case 'add_holiday':                  return addHoliday(payload);
    case 'delete_holiday':               return deleteHoliday(payload);
    case 'update_config':                return updateConfig(payload);

    default:
      return error('Unknown action: ' + action, 'إجراء غير معروف: ' + action);
  }
}

// ---------------------------------------------------------------------------
// respond — serialise any result object to a JSON HTTP response
// ---------------------------------------------------------------------------
function respond(result) {
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
