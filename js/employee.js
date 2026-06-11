// =============================================================================
// employee.js — Employee-only views
//
// Exports (called by app.js router via window[fnName]):
//   renderAttendanceHistory(container)  — #history
//   renderLeaveForm(container)          — #leave
//   renderLeaveBalance(container)       — #leave-balance
// =============================================================================

'use strict';

// =============================================================================
// renderAttendanceHistory — #history
// Last 30 days of attendance records, sorted newest first.
// =============================================================================
function renderAttendanceHistory(container) {
  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">${t('attendance.my_title')}</h1>
    </div>
    <div class="view-content">
      <ul class="att-list" id="att-list" aria-label="${t('attendance.my_title')}">
        ${_attSkeletonRows(6)}
      </ul>
    </div>`;

  _loadAttHistory(container);
}

async function _loadAttHistory(container) {
  const list = container.querySelector('#att-list');
  if (!list) return;

  let result;
  try { result = await apiGetMyAttendance(); } catch (_) {}

  if (!result || result.status !== 'ok') {
    list.innerHTML = _emptyStateItem('📋', t('attendance.no_records'));
    return;
  }

  const records = (result.data.records || [])
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!records.length) {
    list.innerHTML = _emptyStateItem('📋', t('attendance.no_records'));
    return;
  }

  list.innerHTML = records.map(r => _attRowHTML(r)).join('');
}

function _attRowHTML(r) {
  const badgeCls  = _badgeClass(r.status);
  const badgeLbl  = _statusLabel(r.status);
  const ci        = r.check_in  ? _fmt24(r.check_in)  : '—';
  const co        = r.check_out ? _fmt24(r.check_out) : '—';
  const hrs       = r.hours_worked ? `${r.hours_worked} ${t('time.hours')}` : '';
  const dateLabel = typeof formatDate === 'function'
    ? formatDate(new Date(r.date + 'T00:00:00'))
    : r.date;

  return `
    <li class="att-row">
      <div class="att-row-left">
        <span class="att-date">${dateLabel}</span>
        ${hrs ? `<span class="att-hours">${hrs}</span>` : ''}
      </div>
      <div class="att-row-times">
        <span class="att-time-in">${_icoClockIn()} ${ci}</span>
        <span class="att-time-out">${_icoClockOut()} ${co}</span>
      </div>
      <div class="att-row-right">
        <span class="badge ${badgeCls}">${badgeLbl}</span>
      </div>
    </li>`;
}

// =============================================================================
// renderLeaveForm — #leave
// Leave request form + recent leave history below.
// =============================================================================
function renderLeaveForm(container) {
  const today = _isoToday();

  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">${t('leave.request')}</h1>
      <a href="#leave-balance" class="btn btn-ghost btn-sm leave-balance-link">
        ${t('leave.balance')}
      </a>
    </div>
    <div class="view-content">

      <div class="card leave-form-card" id="leave-form-card">
        <form class="leave-form" id="leave-form" novalidate>

          <div class="field">
            <label class="field-label" for="leave-type">${t('leave.type')}</label>
            <select class="field-input" id="leave-type" name="leave_type" required>
              <option value="" disabled selected>${t('leave.type')}</option>
              <option value="annual">${t('leave.type_annual')}</option>
              <option value="sick">${t('leave.type_sick')}</option>
              <option value="emergency">${t('leave.type_emergency')}</option>
              <option value="unpaid">${t('leave.type_unpaid')}</option>
            </select>
          </div>

          <div class="leave-dates-row">
            <div class="field">
              <label class="field-label" for="leave-start">${t('leave.start_date')}</label>
              <input class="field-input" type="date" id="leave-start"
                     name="start_date" required min="${today}">
            </div>
            <div class="field">
              <label class="field-label" for="leave-end">${t('leave.end_date')}</label>
              <input class="field-input" type="date" id="leave-end"
                     name="end_date" required min="${today}">
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="leave-reason">${t('leave.reason')}</label>
            <textarea class="field-input leave-reason-input" id="leave-reason"
                      name="reason" rows="3"
                      placeholder="${t('leave.reason')}"></textarea>
          </div>

          <div class="leave-form-error" id="leave-error" role="alert" hidden></div>

          <button class="btn btn-primary leave-submit-btn" type="submit" id="leave-submit">
            ${t('leave.submit')}
          </button>

        </form>
      </div>

      <section class="leave-history-section" aria-label="${t('leave.my_title')}">
        <h2 class="leave-section-title">${t('leave.my_title')}</h2>
        <ul class="leave-list" id="leave-list">
          ${_leaveSkeleton(3)}
        </ul>
      </section>

    </div>`;

  _bindLeaveForm(container);
  _loadLeaveList(container.querySelector('#leave-list'));
}

function _bindLeaveForm(container) {
  const form      = container.querySelector('#leave-form');
  const submitBtn = container.querySelector('#leave-submit');
  const errEl     = container.querySelector('#leave-error');
  const startInp  = container.querySelector('#leave-start');
  const endInp    = container.querySelector('#leave-end');

  // Keep end-date min in sync with start selection
  startInp?.addEventListener('change', () => {
    if (!endInp) return;
    const v = startInp.value || _isoToday();
    endInp.min = v;
    if (endInp.value && endInp.value < v) endInp.value = v;
  });

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    _hideEl(errEl);

    const type   = form.leave_type.value;
    const start  = form.start_date.value;
    const end    = form.end_date.value;
    const reason = (form.reason?.value || '').trim();

    if (!type)       { _showErr(errEl, t('error.required_field')); form.leave_type.focus(); return; }
    if (!start)      { _showErr(errEl, t('error.required_field')); startInp?.focus(); return; }
    if (!end)        { _showErr(errEl, t('error.required_field')); endInp?.focus(); return; }
    if (end < start) { _showErr(errEl, t('error.invalid_date'));   endInp?.focus(); return; }

    const defaultLabel = submitBtn?.textContent || t('leave.submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = t('action.loading'); }

    let result;
    try { result = await apiSubmitLeave(type, start, end, reason); } catch (_) {}

    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = defaultLabel; }

    if (!result || result.status !== 'ok') {
      _showErr(errEl, result?.message || t('error.server'));
      return;
    }

    // Replace form card with success confirmation
    const card = container.querySelector('#leave-form-card');
    if (card) {
      card.innerHTML = `
        <div class="leave-success">
          <div class="leave-success-icon" aria-hidden="true">${_icoCheckCircle()}</div>
          <p class="leave-success-msg">${t('leave.success_message')}</p>
          <button class="btn btn-ghost btn-sm" id="leave-new-btn" type="button">
            ${t('leave.new_request')}
          </button>
        </div>`;
      card.querySelector('#leave-new-btn')
        ?.addEventListener('click', () => renderLeaveForm(container));
    }

    // Refresh history
    _loadLeaveList(container.querySelector('#leave-list'));
    if (typeof showToast === 'function') showToast(t('leave.success_message'), 'success');
  });
}

async function _loadLeaveList(list) {
  if (!list) return;

  let result;
  try { result = await apiGetMyLeaves(); } catch (_) {}

  if (!result || result.status !== 'ok') {
    list.innerHTML = _emptyStateItem('📅', t('leave.no_requests'));
    return;
  }

  const requests = (result.data.requests || [])
    .slice()
    .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));

  if (!requests.length) {
    list.innerHTML = _emptyStateItem('📅', t('leave.no_requests'));
    return;
  }

  list.innerHTML = requests.map(req => _leaveRowHTML(req)).join('');
}

function _leaveRowHTML(req) {
  const typeKeys = {
    annual:    'leave.type_annual',
    sick:      'leave.type_sick',
    emergency: 'leave.type_emergency',
    unpaid:    'leave.type_unpaid',
  };
  const badgeMap = {
    pending:  'badge-pending',
    approved: 'badge-present',
    rejected: 'badge-absent',
  };

  const typeLabel   = t(typeKeys[req.leave_type] || 'leave.type_annual');
  const badgeCls    = badgeMap[req.status] || 'badge-pending';
  const statusLabel = t('status.' + (req.status || 'pending'));
  const start       = typeof formatDate === 'function'
    ? formatDate(new Date((req.start_date || '') + 'T00:00:00'))
    : (req.start_date || '');
  const end         = typeof formatDate === 'function'
    ? formatDate(new Date((req.end_date || '') + 'T00:00:00'))
    : (req.end_date || '');
  const dateRange   = start === end ? start : `${start} — ${end}`;

  return `
    <li class="leave-row">
      <div class="leave-row-info">
        <span class="leave-row-type">${typeLabel}</span>
        <span class="leave-row-dates">${dateRange}</span>
        ${req.reason ? `<span class="leave-row-reason">${_escHtml(req.reason)}</span>` : ''}
      </div>
      <span class="badge ${badgeCls}">${statusLabel}</span>
    </li>`;
}

// =============================================================================
// renderLeaveBalance — #leave-balance
// Three stat cards + full leave history.
// =============================================================================
function renderLeaveBalance(container) {
  container.innerHTML = `
    <div class="view-header">
      <a href="#leave" class="btn btn-ghost btn-sm leave-back-btn">
        ${_icoBack()} ${t('action.back')}
      </a>
      <h1 class="view-title">${t('leave.balance')}</h1>
    </div>
    <div class="view-content">
      <div class="balance-cards" id="balance-cards">
        ${_balanceSkeleton()}
      </div>
      <h2 class="leave-section-title">${t('leave.my_title')}</h2>
      <ul class="leave-list" id="balance-leave-list">
        ${_leaveSkeleton(4)}
      </ul>
    </div>`;

  _loadBalance(container);
}

async function _loadBalance(container) {
  const cards   = container.querySelector('#balance-cards');
  const list    = container.querySelector('#balance-leave-list');

  let result;
  try { result = await apiGetMyLeaves(); } catch (_) {}

  if (!result || result.status !== 'ok') {
    if (cards) cards.innerHTML = `<p class="balance-error">${t('error.server')}</p>`;
    if (list)  list.innerHTML  = _emptyStateItem('📅', t('leave.no_requests'));
    return;
  }

  const balance  = result.data.balance || {};
  const requests = (result.data.requests || [])
    .slice()
    .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));

  const remaining = balance.annual_remaining != null ? balance.annual_remaining : '—';
  const taken     = balance.annual_taken     != null ? balance.annual_taken     : '—';
  const pending   = requests.filter(r => r.status === 'pending').length;

  // Derive the "days remaining" label without the {days} placeholder
  const remainingLabel = t('leave.days_remaining').replace('{days}', '').trim()
    || t('leave.balance');

  if (cards) {
    cards.innerHTML = `
      <div class="balance-card balance-card-primary">
        <span class="balance-card-num">${remaining}</span>
        <span class="balance-card-label">${remainingLabel}</span>
      </div>
      <div class="balance-card balance-card-neutral">
        <span class="balance-card-num">${taken}</span>
        <span class="balance-card-label">${t('leave.taken_this_year')}</span>
      </div>
      <div class="balance-card balance-card-pending">
        <span class="balance-card-num">${pending}</span>
        <span class="balance-card-label">${t('status.pending')}</span>
      </div>`;
  }

  if (list) {
    list.innerHTML = requests.length
      ? requests.map(req => _leaveRowHTML(req)).join('')
      : _emptyStateItem('📅', t('leave.no_requests'));
  }
}

// =============================================================================
// Shared helpers
// =============================================================================

function _isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Convert "HH:MM" (24-hour stored format) → locale-aware 12-hour display string
function _fmt24(str) {
  if (!str) return '—';
  const [hRaw, mRaw] = String(str).split(':');
  const h = parseInt(hRaw, 10);
  const m = String(parseInt(mRaw, 10) || 0).padStart(2, '0');
  if (isNaN(h)) return str;
  const lang  = localStorage.getItem('lmp_lang') || 'ar';
  const isAm  = h < 12;
  const h12   = String(h % 12 || 12).padStart(2, '0');
  const suf   = lang === 'ar' ? (isAm ? ' ص' : ' م') : (isAm ? ' AM' : ' PM');
  return `${h12}:${m}${suf}`;
}

function _badgeClass(status) {
  return {
    present:  'badge-present',
    late:     'badge-late',
    absent:   'badge-absent',
    on_leave: 'badge-leave',
    holiday:  'badge-holiday',
  }[status] || 'badge-absent';
}

function _statusLabel(status) {
  if (!status) return '—';
  const key = status === 'on_leave' ? 'status.on_leave' : 'status.' + status;
  const val = t(key);
  return val !== key ? val : status;
}

function _showErr(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _hideEl(el) {
  if (el) el.hidden = true;
}

// Minimal HTML-escape for untrusted text inserted via innerHTML
function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _emptyStateItem(icon, msg) {
  return `<li class="emp-empty-state">
    <div class="emp-empty-icon" aria-hidden="true">${icon}</div>
    <p class="emp-empty-msg">${msg}</p>
  </li>`;
}

// =============================================================================
// Skeleton loaders
// =============================================================================

function _attSkeletonRows(n) {
  return Array.from({ length: n }, () => `
    <li class="att-row" aria-hidden="true">
      <div class="att-row-left">
        <span class="skeleton" style="width:88px;height:13px;border-radius:4px;display:block"></span>
        <span class="skeleton" style="width:56px;height:11px;border-radius:4px;display:block;margin-block-start:6px"></span>
      </div>
      <div class="att-row-times">
        <span class="skeleton" style="width:68px;height:12px;border-radius:4px;display:block"></span>
        <span class="skeleton" style="width:68px;height:12px;border-radius:4px;display:block;margin-block-start:5px"></span>
      </div>
      <div class="att-row-right">
        <span class="skeleton" style="width:48px;height:20px;border-radius:999px;display:block"></span>
      </div>
    </li>`).join('');
}

function _leaveSkeleton(n) {
  return Array.from({ length: n }, () => `
    <li class="leave-row" aria-hidden="true">
      <div class="leave-row-info">
        <span class="skeleton" style="width:110px;height:13px;border-radius:4px;display:block"></span>
        <span class="skeleton" style="width:150px;height:11px;border-radius:4px;display:block;margin-block-start:6px"></span>
      </div>
      <span class="skeleton" style="width:56px;height:22px;border-radius:999px;display:block;flex-shrink:0"></span>
    </li>`).join('');
}

function _balanceSkeleton() {
  return Array.from({ length: 3 }, () => `
    <div class="balance-card" aria-hidden="true">
      <span class="skeleton" style="width:44px;height:30px;border-radius:6px;display:block;margin:0 auto var(--sp-2)"></span>
      <span class="skeleton" style="width:72px;height:11px;border-radius:4px;display:block;margin:0 auto"></span>
    </div>`).join('');
}

// =============================================================================
// Inline SVG icons (small, used inline in list rows / buttons)
// =============================================================================

function _icoClockIn() {
  return `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>`;
}

function _icoClockOut() {
  return `<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clip-rule="evenodd"/></svg>`;
}

function _icoCheckCircle() {
  return `<svg width="32" height="32" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>`;
}

function _icoBack() {
  return `<svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd"/></svg>`;
}

// =============================================================================
// Exports
// =============================================================================
window.renderAttendanceHistory = renderAttendanceHistory;
window.renderLeaveForm         = renderLeaveForm;
window.renderLeaveBalance      = renderLeaveBalance;
