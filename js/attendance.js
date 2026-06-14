// =============================================================================
// attendance.js — Employee home screen: check-in / check-out orchestration
//
// Exported: renderEmployeeHome(container) — called by app.js router for #home
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Module state — reset on every renderEmployeeHome() call
// ---------------------------------------------------------------------------
let _todayRecord  = undefined; // undefined=loading, null=none, object=found
let _isProcessing = false;

// ---------------------------------------------------------------------------
// renderEmployeeHome — entry point called by app.js router
// ---------------------------------------------------------------------------
async function renderEmployeeHome(container) {
  _todayRecord  = undefined;
  _isProcessing = false;

  const user = (typeof App !== 'undefined' && App.currentUser)
    || (typeof getCurrentUser === 'function' ? getCurrentUser() : null);
  if (!user) return;

  _renderShell(container, user);
  _loadTodayRecord(container, user); // async, updates button state when done
}

// ---------------------------------------------------------------------------
// Shell render — skeleton with button disabled until status loads
// ---------------------------------------------------------------------------
function _renderShell(container, user) {
  container.innerHTML = `
    <div class="checkin-screen">

      <div class="checkin-header">
        <div class="checkin-greeting">${_greeting(user.name || user.username || '')}</div>
        <div class="checkin-date">${typeof formatDate === 'function' ? formatDate(new Date()) : ''}</div>
      </div>

      <div class="checkin-gps-row" id="gps-bar">
        <span class="gps-dot" id="gps-dot" data-state="idle" aria-hidden="true"></span>
        <span class="checkin-gps-text" id="gps-text">${t('loading.please_wait')}</span>
      </div>

      <div class="checkin-action-area">
        <div class="checkin-btn-wrap">
          <div class="checkin-ring" id="checkin-ring" aria-hidden="true"></div>
          <button class="checkin-btn" id="checkin-btn" type="button" disabled
                  aria-label="${t('checkin.button')}">
            <span class="checkin-btn-icon" aria-hidden="true">${_svgFingerprint()}</span>
            <span class="checkin-btn-label">${t('checkin.button')}</span>
          </button>
        </div>
        <div class="checkin-msg" id="checkin-msg"
             role="alert" aria-live="assertive" aria-atomic="true" hidden></div>
      </div>

    </div>`;
}

// ---------------------------------------------------------------------------
// Load today's record async, then apply the correct button state
// ---------------------------------------------------------------------------
async function _loadTodayRecord(container, user) {
  try {
    const result = await apiGetMyAttendance();
    if (result && result.status === 'ok') {
      const today = _isoToday();
      _todayRecord = (result.data.records || []).find(r => r.date === today) || null;
    } else {
      _todayRecord = null;
    }
  } catch (_) {
    _todayRecord = null;
  }
  _applyButtonState(container, user);
}

// ---------------------------------------------------------------------------
// Apply the correct button state based on today's record
// ---------------------------------------------------------------------------
function _applyButtonState(container, user) {
  const btn  = container.querySelector('#checkin-btn');
  const ring = container.querySelector('#checkin-ring');
  if (!btn) return;

  // Both times present → day complete, show read-only summary
  if (_todayRecord && _todayRecord.check_in && _todayRecord.check_out) {
    _renderDoneState(container);
    return;
  }

  // Checked in but not out → show checkout button
  if (_todayRecord && _todayRecord.check_in && !_todayRecord.check_out) {
    _renderCheckoutState(container, user);
    return;
  }

  // Not yet checked in → enable check-in button with pulse ring
  btn.disabled = false;
  if (ring) ring.classList.add('checkin-ring-active');
  _setGpsState(container, 'idle', t('gps.locating'));
  btn.addEventListener('click', () => {
    if (!_isProcessing) _runCheckIn(container, user);
  }, { once: true });
}

// ---------------------------------------------------------------------------
// CHECK-IN FLOW
// ---------------------------------------------------------------------------
async function _runCheckIn(container, user) {
  _isProcessing = true;
  const btn = container.querySelector('#checkin-btn');
  const msg = container.querySelector('#checkin-msg');
  _hideMsg(msg);

  // 1 — biometric (unless exempt)
  const isExempt = String(user.biometric_exempt || '').toUpperCase() === 'TRUE';
  let checkinToken = '';

  if (!isExempt) {
    if (typeof isRegistered === 'function' && !isRegistered()) {
      _isProcessing = false;
      _renderRegistrationPrompt(container, user);
      return;
    }
    _setBtnState(btn, true, t('biometric.verifying'));
    const bio = await verifyFingerprint();
    if (!bio.verified) {
      _isProcessing = false;
      _setBtnState(btn, false, t('checkin.button'));
      _showMsg(msg, bio.reason || t('biometric.failed'), 'error');
      _rewireOnce(btn, () => _runCheckIn(container, user));
      return;
    }
    checkinToken = bio.checkin_token;
  }

  // 2 — GPS
  _setBtnState(btn, true, t('checkin.verifying_location'));
  _setGpsState(container, 'loading', t('gps.locating'));

  const gps = await checkGPS();
  if (!gps.ok) {
    _isProcessing = false;
    _setBtnState(btn, false, t('checkin.button'));
    _setGpsState(container, 'error', gps.error || t('gps.outside_range'));
    _showMsg(msg, gps.error || t('gps.outside_range'), 'error');
    _rewireOnce(btn, () => _runCheckIn(container, user));
    return;
  }
  _setGpsState(container, 'success', gps.locationName || '');

  // 3 — API call
  _setBtnState(btn, true, t('loading.please_wait'));
  let result = null;
  try {
    result = await apiCheckIn(gps.lat, gps.lng, gps.accuracy, gps.locationId, checkinToken);
  } catch (_) { /* network failure — handled below */ }

  _isProcessing = false;

  // Network failure → offline queue
  if (!result) {
    if (typeof queueOfflineCheckin === 'function') {
      queueOfflineCheckin({
        action: 'checkin', checkin_token: checkinToken,
        lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy, location_id: gps.locationId,
      });
    }
    _setBtnState(btn, false, t('checkin.button'));
    _showMsg(msg, t('sync.pending'), 'pending');
    _rewireOnce(btn, () => _runCheckIn(container, user));
    return;
  }

  if (result.status !== 'ok') {
    _setBtnState(btn, false, t('checkin.button'));
    _showMsg(msg, result.message || t('error.server'), 'error');
    _rewireOnce(btn, () => _runCheckIn(container, user));
    return;
  }

  // Success
  _todayRecord = { check_in: result.data.check_in_time || '', check_out: '' };
  _showCheckInSuccess(
    container,
    result.data.check_in_time || '',
    result.data.location_name || gps.locationName || '',
    () => _renderCheckoutState(container, user)
  );
}

// ---------------------------------------------------------------------------
// CHECK-OUT FLOW
// ---------------------------------------------------------------------------
async function _runCheckOut(container, user) {
  _isProcessing = true;
  const btn = container.querySelector('#checkin-btn');
  const msg = container.querySelector('#checkin-msg');
  _hideMsg(msg);

  const isExempt = String(user.biometric_exempt || '').toUpperCase() === 'TRUE';
  let checkinToken = '';

  if (!isExempt) {
    _setBtnState(btn, true, t('biometric.verifying'));
    const bio = await verifyFingerprint();
    if (!bio.verified) {
      _isProcessing = false;
      _setBtnState(btn, false, t('checkout.button'));
      _showMsg(msg, bio.reason || t('biometric.failed'), 'error');
      _rewireOnce(btn, () => _runCheckOut(container, user));
      return;
    }
    checkinToken = bio.checkin_token;
  }

  _setBtnState(btn, true, t('loading.please_wait'));
  let result = null;
  try {
    result = await apiCheckOut(checkinToken);
  } catch (_) { /* handled below */ }

  _isProcessing = false;

  if (!result || result.status !== 'ok') {
    _setBtnState(btn, false, t('checkout.button'));
    _showMsg(msg, result?.message || t('error.server'), 'error');
    _rewireOnce(btn, () => _runCheckOut(container, user));
    return;
  }

  _todayRecord = {
    ..._todayRecord,
    check_out:    result.data.check_out_time || '',
    hours_worked: result.data.hours_worked   || '',
  };
  _renderDoneState(container);
  if (typeof showToast === 'function') {
    const time = result.data.check_out_time || '';
    showToast(t('checkout.success') + (time ? ` ${time}` : ''), 'success');
  }
}

// ---------------------------------------------------------------------------
// State renderers
// ---------------------------------------------------------------------------

function _renderCheckoutState(container, user) {
  const btn  = container.querySelector('#checkin-btn');
  const ring = container.querySelector('#checkin-ring');
  const msg  = container.querySelector('#checkin-msg');
  if (!btn) return;

  btn.disabled = false;
  btn.className = 'checkin-btn checkin-btn-checkout';
  const icon  = btn.querySelector('.checkin-btn-icon');
  const label = btn.querySelector('.checkin-btn-label');
  if (icon)  icon.innerHTML   = _svgCheckout();
  if (label) label.textContent = t('checkout.button');
  if (ring)  ring.classList.remove('checkin-ring-active');
  if (msg)   msg.hidden = true;

  const cit = _todayRecord?.check_in || '';
  if (cit) _setGpsState(container, 'success', `${t('attendance.check_in')}: ${_hhmm(cit)}`);

  btn.addEventListener('click', () => {
    if (!_isProcessing) _runCheckOut(container, user);
  }, { once: true });
}

function _renderDoneState(container) {
  const btn  = container.querySelector('#checkin-btn');
  const ring = container.querySelector('#checkin-ring');
  const msg  = container.querySelector('#checkin-msg');
  if (!btn) return;

  btn.disabled  = true;
  btn.className = 'checkin-btn checkin-btn-done';
  const icon  = btn.querySelector('.checkin-btn-icon');
  const label = btn.querySelector('.checkin-btn-label');
  if (icon)  icon.innerHTML   = _svgCheckmark();
  if (label) label.textContent = t('status.present');
  if (ring)  ring.classList.remove('checkin-ring-active');

  if (msg && _todayRecord) {
    const hw = parseFloat(_todayRecord.hours_worked);
    const h  = (!isNaN(hw) && hw > 0) ? ` · ${hw} ${t('time.hours')}` : '';
    msg.textContent = `${_hhmm(_todayRecord.check_in)} → ${_hhmm(_todayRecord.check_out)}${h}`;
    msg.className   = 'checkin-msg checkin-msg-success';
    msg.hidden      = false;
  }
}

// ---------------------------------------------------------------------------
// Biometric registration interstitial
// ---------------------------------------------------------------------------
function _renderRegistrationPrompt(container, user) {
  const area = container.querySelector('.checkin-action-area');
  if (!area) return;

  area.innerHTML = `
    <div class="bio-reg-card">
      <div class="bio-reg-icon" aria-hidden="true">${_svgFingerprint()}</div>
      <p class="bio-reg-title">${t('biometric.register_prompt')}</p>
      <p class="bio-reg-sub">${t('biometric.not_registered')}</p>
      <button class="btn btn-primary bio-reg-btn" id="bio-reg-btn" type="button">
        ${t('action.confirm')}
      </button>
      <div class="checkin-msg" id="reg-msg" role="alert" aria-live="assertive" hidden></div>
    </div>`;

  const startBtn = container.querySelector('#bio-reg-btn');
  const regMsg   = container.querySelector('#reg-msg');

  startBtn?.addEventListener('click', async () => {
    startBtn.disabled    = true;
    startBtn.textContent = t('biometric.registering');
    const res = await registerFingerprint();
    if (res.success) {
      if (typeof showToast === 'function') showToast(t('biometric.register_success'), 'success');
      renderEmployeeHome(container);
    } else {
      startBtn.disabled    = false;
      startBtn.textContent = t('action.retry');
      if (regMsg) { regMsg.textContent = res.reason || t('biometric.register_failed'); regMsg.hidden = false; }
    }
  });
}

// ---------------------------------------------------------------------------
// Success animation (2 s green → checkout state)
// ---------------------------------------------------------------------------
function _showCheckInSuccess(container, checkInTime, locationName, onDone) {
  const btn  = container.querySelector('#checkin-btn');
  const ring = container.querySelector('#checkin-ring');
  const msg  = container.querySelector('#checkin-msg');

  if (btn) {
    btn.disabled  = true;
    btn.className = 'checkin-btn checkin-btn-success';
    const icon  = btn.querySelector('.checkin-btn-icon');
    const label = btn.querySelector('.checkin-btn-label');
    if (icon)  icon.innerHTML   = _svgCheckmark();
    if (label) label.textContent = '';
  }
  if (ring) ring.classList.remove('checkin-ring-active');

  if (msg) {
    const loc = locationName ? ` · ${locationName}` : '';
    msg.textContent = `${t('checkin.success')} ${checkInTime}${loc}`;
    msg.className   = 'checkin-msg checkin-msg-success';
    msg.hidden      = false;
  }

  if (typeof showToast === 'function') showToast(t('checkin.success'), 'success');

  setTimeout(() => {
    if (btn) {
      btn.className = 'checkin-btn';
      btn.disabled  = false;
      if (!btn.querySelector('.checkin-btn-icon'))
        btn.insertAdjacentHTML('afterbegin', `<span class="checkin-btn-icon" aria-hidden="true"></span>`);
      if (!btn.querySelector('.checkin-btn-label'))
        btn.insertAdjacentHTML('beforeend', `<span class="checkin-btn-label"></span>`);
    }
    onDone();
  }, 2000);
}

// ---------------------------------------------------------------------------
// UI micro-helpers
// ---------------------------------------------------------------------------

function _greeting(name) {
  const lang = localStorage.getItem('lmp_lang') || 'ar';
  const h    = new Date().getHours();
  if (lang === 'ar') {
    return `${h < 12 ? 'صباح الخير' : 'مساء الخير'}، ${name}`;
  }
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name}`;
}

function _setBtnState(btn, loading, label) {
  if (!btn) return;
  btn.disabled = loading;
  const el = btn.querySelector('.checkin-btn-label');
  if (el) el.textContent = label || '';
}

function _showMsg(msg, text, type) {
  if (!msg) return;
  msg.textContent = text;
  msg.className   = `checkin-msg checkin-msg-${type}`;
  msg.hidden      = false;
}

function _hideMsg(msg) {
  if (!msg) return;
  msg.textContent = '';
  msg.hidden      = true;
}

function _setGpsState(container, state, text) {
  const dot  = container.querySelector('#gps-dot');
  const span = container.querySelector('#gps-text');
  if (dot)  dot.dataset.state = state;
  if (span) span.textContent  = text || '';
}

function _rewireOnce(btn, fn) {
  if (!btn) return;
  btn.addEventListener('click', () => { if (!_isProcessing) fn(); }, { once: true });
}

function _isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Extract HH:MM from whatever the server returns — plain "HH:MM", a 1899-12-30 ISO string,
// or anything parseable by Date. Returns "–" for empty/invalid values.
function _hhmm(val) {
  if (!val) return '–';
  const s = String(val).trim();
  if (/^\d{1,2}:\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (!isNaN(d.getTime())) {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  return s;
}

// ---------------------------------------------------------------------------
// SVG icons
// ---------------------------------------------------------------------------

function _svgFingerprint() {
  return `<svg width="44" height="44" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">
    <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 3.5"/>
    <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
    <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
    <path d="M2 12a10 10 0 0 1 18-6"/>
    <path d="M2 17c1 0 4.5-.5 6 .5"/>
    <path d="M20 12c-1.88 0-3.19.74-4 2"/>
    <path d="M7.5 10.5c.6-3 1.7-5 3.5-6"/>
    <path d="M22 12a10 10 0 0 1-1.96 5.97"/>
  </svg>`;
}

function _svgCheckmark() {
  return `<svg width="44" height="44" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`;
}

function _svgCheckout() {
  return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
window.renderEmployeeHome = renderEmployeeHome;
