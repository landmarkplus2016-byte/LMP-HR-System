// =============================================================================
// api.js — The ONLY file that communicates with Apps Script.
// Every fetch() call in the entire app goes through post() in this file.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Private state
// ---------------------------------------------------------------------------

// Flipped to true after the first successful API response.
// Used to show/hide the "Connecting…" cold-start indicator exactly once.
let _connected = false;

// ---------------------------------------------------------------------------
// Core: post()
// ---------------------------------------------------------------------------
// Builds the full request payload, fires a single POST to the Apps Script
// Web App URL, and returns the parsed response object.
//
// Design notes:
//   • Content-Type: text/plain  — avoids the CORS preflight that
//     application/json triggers. Apps Script still receives the full JSON
//     string in e.postData.contents and Code.gs parses it normally.
//   • redirect: 'follow'        — Apps Script sometimes 302-redirects on the
//     first call after a cold start; this handles it transparently.
//   • The URL is read fresh from localStorage on every call so that changing
//     it in the setup screen takes effect immediately without a reload.
//   • The URL is NEVER written to console — only sanitised error messages are.

async function post(action, payload) {
  // ── 1. Resolve the Apps Script URL ──────────────────────────────────────
  const url = localStorage.getItem('lmp_script_url');

  if (!url) {
    _showSetupScreen();
    return _clientError('No API URL configured. Please complete the setup.', 'لم يتم إعداد رابط الخادم.');
  }

  // ── 2. Show the cold-start "Connecting…" indicator on the first call ────
  if (!_connected) {
    _showConnecting();
  }

  // ── 3. Build the request body ────────────────────────────────────────────
  // session_token and device_id are injected automatically so callers never
  // have to remember to include them.
  const body = Object.assign(
    {
      action,
      session_token: localStorage.getItem('lmp_session') || '',
      device_id:     _getDeviceId(),
    },
    payload
  );

  // ── 4. Fetch ─────────────────────────────────────────────────────────────
  let response;
  try {
    response = await fetch(url, {
      method:   'POST',
      headers:  { 'Content-Type': 'text/plain;charset=utf-8' },
      body:     JSON.stringify(body),
      redirect: 'follow',
    });
  } catch (networkErr) {
    // fetch() itself throws only on genuine network failures (no connection,
    // DNS failure, etc.). Never include the URL in logged messages.
    console.error('[API] Network error during action:', action);
    return _clientError(
      'Network error — check your connection and try again.',
      'خطأ في الشبكة — تحقق من اتصالك وحاول مجدداً.'
    );
  }

  // ── 5. Parse the response ────────────────────────────────────────────────
  let result;
  try {
    const text = await response.text();
    result = JSON.parse(text);
  } catch (_) {
    // Apps Script sometimes returns an HTML error page (e.g. quota exceeded,
    // unhandled script exception). Parse failure means we got HTML, not JSON.
    console.error('[API] Response was not valid JSON for action:', action);
    return _clientError(
      'Unexpected server response. Please try again.',
      'استجابة غير متوقعة من الخادم. حاول مجدداً.'
    );
  }

  // ── 6. First success → hide the cold-start indicator ────────────────────
  if (!_connected) {
    _connected = true;
    _hideConnecting();
  }

  // ── 7. Localise error messages before returning to the UI ────────────────
  // CLAUDE.md: api.js reads lmp_lang and picks message_ar or message_en.
  return _localise(result);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

// Read device ID from security.js if available, otherwise fall back to
// whatever is already in localStorage from a previous session.
function _getDeviceId() {
  if (typeof getDeviceId === 'function') return getDeviceId();
  return localStorage.getItem('lmp_device_id') || '';
}

// Attach the correct `message` field to error responses based on lmp_lang.
// The server always sends both message_en and message_ar; the UI reads .message.
function _localise(result) {
  if (!result || result.status !== 'error') return result;
  const lang = localStorage.getItem('lmp_lang') || 'ar';
  result.message = lang === 'ar'
    ? (result.message_ar || result.message_en || 'حدث خطأ')
    : (result.message_en || result.message_ar || 'An error occurred');
  return result;
}

// Build a client-side error object in the same shape as server errors.
function _clientError(messageEn, messageAr) {
  return _localise({ status: 'error', message_en: messageEn, message_ar: messageAr });
}

// ---------------------------------------------------------------------------
// Cold-start "Connecting…" indicator
// ---------------------------------------------------------------------------
// Preferred: updates the loading screen's status text (visible during init).
// Fallback: injects a small fixed banner if the loading screen is gone.

function _showConnecting() {
  const loadingStatus = document.getElementById('loading-status');
  if (loadingStatus) {
    // Loading screen is still visible — update its status line
    loadingStatus.textContent = (typeof t === 'function' ? t('api.connecting') : '') || 'جارٍ الاتصال…';
    return;
  }
  // Loading screen was already hidden — create a subtle fixed banner
  let banner = document.getElementById('api-connecting-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id        = 'api-connecting-banner';
    banner.className = 'api-connecting-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    document.body.appendChild(banner);
  }
  banner.textContent  = (typeof t === 'function' ? t('api.connecting') : '') || 'جارٍ الاتصال…';
  banner.style.display = '';
}

function _hideConnecting() {
  const loadingStatus = document.getElementById('loading-status');
  if (loadingStatus) {
    loadingStatus.textContent = '';
    return;
  }
  const banner = document.getElementById('api-connecting-banner');
  if (banner) banner.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Setup screen
// ---------------------------------------------------------------------------
// The markup lives in index.html (#setup-screen). api.js owns show/hide/save.

function _showSetupScreen() {
  // Hydrate text nodes with the current locale (i18n is always loaded before
  // this function is ever called, because post() runs after App.init() which
  // calls loadI18n() first).
  const _s = id => document.getElementById(id);
  if (_s('setup-title'))     _s('setup-title').textContent     = (typeof t === 'function' ? t('setup.title')       : '') || 'إعداد الخادم';
  if (_s('setup-desc'))      _s('setup-desc').textContent      = (typeof t === 'function' ? t('setup.description') : '') || 'أدخل رابط Apps Script الخاص بالمشروع';
  if (_s('setup-url-label')) _s('setup-url-label').textContent = (typeof t === 'function' ? t('setup.url_label')   : '') || 'رابط Apps Script';
  if (_s('setup-save-btn'))  _s('setup-save-btn').textContent  = (typeof t === 'function' ? t('setup.save')        : '') || 'حفظ';
  const input = _s('setup-url-input');
  if (input) input.placeholder = (typeof t === 'function' ? t('setup.url_placeholder') : '') || 'https://script.google.com/macros/s/…/exec';

  const screen = document.getElementById('setup-screen');
  if (screen) screen.hidden = false;
  // Hide the loading screen so the setup screen is not obscured
  const loading = document.getElementById('loading-screen');
  if (loading) loading.style.display = 'none';
}

function _hideSetupScreen() {
  const screen = document.getElementById('setup-screen');
  if (screen) screen.hidden = true;
}

function _showSetupError(msg) {
  const el = document.getElementById('setup-error');
  if (el) {
    el.textContent = msg;
    el.hidden = false;
  }
}

function _clearSetupError() {
  const el = document.getElementById('setup-error');
  if (el) {
    el.textContent = '';
    el.hidden = true;
  }
}

async function _handleSetupSave() {
  const input  = document.getElementById('setup-url-input');
  const rawUrl = (input?.value || '').trim();

  _clearSetupError();

  // Basic URL validation — must be a Google Apps Script exec URL
  if (!rawUrl) {
    _showSetupError((typeof t === 'function' ? t('setup.url_required') : '') || 'الرجاء إدخال الرابط.');
    return;
  }
  if (!rawUrl.startsWith('https://script.google.com')) {
    _showSetupError((typeof t === 'function' ? t('setup.url_invalid') : '') || 'الرابط يجب أن يبدأ بـ https://script.google.com');
    return;
  }

  // Save to localStorage — api.js will pick it up on the next call
  localStorage.setItem('lmp_script_url', rawUrl);
  _connected = false; // reset so "Connecting…" shows on first call with new URL

  _hideSetupScreen();

  // Re-run app init now that a URL is available
  if (typeof App !== 'undefined' && typeof App.init === 'function') {
    App.init();
  } else {
    window.location.reload();
  }
}

// Wire up setup screen controls after the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('setup-save-btn')
    ?.addEventListener('click', _handleSetupSave);

  document.getElementById('setup-url-input')
    ?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _handleSetupSave();
    });
});

// =============================================================================
// Named API functions
// =============================================================================
// Each function is a thin wrapper around post() with the correct action string.
// Auth functions are fully wired; later-stage functions are stubs whose bodies
// will be fleshed out in their respective stages — no edits to this file needed.
// =============================================================================

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Validates a stored session token by fetching the employee profile.
// Used by app.js on startup to restore an existing session without re-login.
// The session token is auto-included by post() from localStorage.
async function apiValidateSession() {
  return post('get_profile', {});
}

async function apiLogin(username, passwordHash, deviceId) {
  return post('login', {
    username,
    password_hash: passwordHash,
    device_id:     deviceId || _getDeviceId(),
  });
}

async function apiLogout() {
  return post('logout', {});
}

async function apiChangePassword(username, oldPasswordHash, newPasswordHash) {
  return post('change_password', {
    username,
    old_password_hash: oldPasswordHash,
    new_password_hash: newPasswordHash,
    device_id:         _getDeviceId(),
  });
}

async function apiGetConfig() {
  return post('get_config', {});
}

// ---------------------------------------------------------------------------
// WebAuthn — Stage 2
// ---------------------------------------------------------------------------

async function apiWebauthnRegisterChallenge() {
  return post('webauthn_register_challenge', {});
}

async function apiWebauthnRegisterComplete(credentialId, publicKey, signedChallenge) {
  return post('webauthn_register_complete', { credentialId, publicKey, signedChallenge });
}

async function apiWebauthnAuthChallenge() {
  return post('webauthn_auth_challenge', {});
}

async function apiWebauthnAuthVerify(signedResponse) {
  return post('webauthn_auth_verify', { signedResponse });
}

// ---------------------------------------------------------------------------
// Attendance — Stage 2 / 5
// ---------------------------------------------------------------------------

async function apiCheckIn(lat, lng, accuracy, locationId, checkinToken) {
  return post('checkin', { lat, lng, accuracy, location_id: locationId, checkin_token: checkinToken });
}

async function apiCheckOut(checkinToken) {
  return post('checkout', { checkin_token: checkinToken });
}

async function apiGetMyAttendance() {
  return post('get_my_attendance', {});
}

async function apiGetAllAttendance(employeeId, dateFrom, dateTo) {
  return post('get_all_attendance', { employee_id: employeeId, date_from: dateFrom, date_to: dateTo });
}

async function apiCorrectAttendance(recordId, corrections, hrNote) {
  return post('correct_attendance', { record_id: recordId, corrections, hr_note: hrNote });
}

async function apiAddManualAttendance(employeeId, date, checkIn, checkOut, locationId, hrNote) {
  return post('add_manual_attendance', {
    employee_id: employeeId, date, check_in: checkIn, check_out: checkOut,
    location_id: locationId, hr_note: hrNote,
  });
}

async function apiGetFlaggedRecords() {
  return post('get_flagged_records', {});
}

async function apiDeleteAttendance(recordId) {
  return post('delete_attendance', { record_id: recordId });
}

// ---------------------------------------------------------------------------
// Leaves — Stage 3 / 4
// ---------------------------------------------------------------------------

async function apiSubmitLeave(leaveType, startDate, endDate, reason) {
  return post('submit_leave', { leave_type: leaveType, start_date: startDate, end_date: endDate, reason });
}

async function apiGetMyLeaves() {
  return post('get_my_leaves', {});
}

async function apiGetTeamLeaves() {
  return post('get_team_leaves', {});
}

async function apiApproveLeave(leaveId) {
  return post('approve_leave', { leave_id: leaveId });
}

async function apiRejectLeave(leaveId, reason) {
  return post('reject_leave', { leave_id: leaveId, reason });
}

// ---------------------------------------------------------------------------
// Employees — Stage 4 / 5
// ---------------------------------------------------------------------------

async function apiGetTeamStatus() {
  return post('get_team_status', {});
}

async function apiGetTeamAttendance(date) {
  return post('get_team_attendance', { date });
}

async function apiGetTeamEmployees() {
  return post('get_team_employees', {});
}

async function apiGetAllEmployees() {
  return post('get_all_employees', {});
}

async function apiAddEmployee(employeeData) {
  return post('add_employee', employeeData);
}

async function apiUpdateEmployee(employeeId, updates) {
  return post('update_employee', { employee_id: employeeId, ...updates });
}

async function apiHrResetPassword(employeeId, newPasswordHash, forceChange) {
  return post('hr_reset_password', {
    employee_id:       employeeId,
    new_password_hash: newPasswordHash,
    force_change:      forceChange !== false ? 'true' : 'false'
  });
}

async function apiDeactivateEmployee(employeeId) {
  return post('deactivate_employee', { employee_id: employeeId });
}

async function apiReactivateEmployee(employeeId) {
  return post('reactivate_employee', { employee_id: employeeId });
}

// ---------------------------------------------------------------------------
// Reports — Stage 5
// ---------------------------------------------------------------------------

async function apiGetReportData(year, month, departmentId) {
  return post('get_report_data', { year, month, department_id: departmentId || '' });
}

// ---------------------------------------------------------------------------
// Locations — Stage 5
// ---------------------------------------------------------------------------

async function apiGetLocations() {
  return post('get_locations', {});
}

async function apiAddLocation(name, lat, lng, radiusM) {
  return post('add_location', { name, lat, lng, radius_m: radiusM });
}

async function apiUpdateLocation(locationId, updates) {
  return post('update_location', { location_id: locationId, ...updates });
}

async function apiToggleLocation(locationId) {
  return post('toggle_location', { location_id: locationId });
}

// ---------------------------------------------------------------------------
// Admin — Shifts / Departments / Holidays / Config — Stage 5
// ---------------------------------------------------------------------------

async function apiGetShifts() {
  return post('get_shifts', {});
}

async function apiAddShift(shiftData) {
  return post('add_shift', shiftData);
}

async function apiUpdateShift(shiftId, updates) {
  return post('update_shift', { shift_id: shiftId, ...updates });
}

async function apiDeleteShift(shiftId) {
  return post('delete_shift', { shift_id: shiftId });
}

async function apiGetDepartments() {
  return post('get_departments', {});
}

async function apiAddDepartment(name, defaultShiftId) {
  return post('add_department', { name, default_shift_id: defaultShiftId });
}

async function apiUpdateDepartment(departmentId, updates) {
  return post('update_department', { department_id: departmentId, ...updates });
}

async function apiGetHolidays(year) {
  return post('get_holidays', { year });
}

async function apiAddHoliday(date, name) {
  return post('add_holiday', { date, name });
}

async function apiDeleteHoliday(holidayId) {
  return post('delete_holiday', { holiday_id: holidayId });
}

async function apiUpdateConfig(updates) {
  return post('update_config', { updates });
}
