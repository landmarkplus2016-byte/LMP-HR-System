// =============================================================================
// manager.js — Manager views: team status, team attendance, leave approvals
//
// Exposes three render functions called by app.js router:
//   renderTeamStatus(container)     → #team     — manager home
//   renderTeamAttendance(container) → #team-attendance
//   renderTeamLeaves(container)     → #team-leaves
//
// Auto-refresh: team status polls every 60 seconds via _teamRefreshTimer.
// The timer self-cancels when the status element leaves the DOM.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let _teamRefreshTimer = null;

// ---------------------------------------------------------------------------
// renderTeamStatus — manager home screen
// ---------------------------------------------------------------------------
// Shows a 2×2 summary grid (Present / Absent / Late / On Leave) and a
// scrollable list of all team members with their current status badge.
// Auto-refreshes every 60 seconds.

function renderTeamStatus(container) {
  _cancelRefresh();

  container.innerHTML = `
    <div class="view-header">
      <span class="view-title">${t('team.title')}</span>
      <span class="mgr-live-badge" aria-label="${t('team.live') || 'مباشر'}">
        <span class="mgr-live-dot" aria-hidden="true"></span>
        ${t('team.live') || 'مباشر'}
      </span>
    </div>
    <div class="view-content" id="mgr-status-content">
      <div id="mgr-status-body">${_skeletonStatus()}</div>
    </div>`;

  _loadTeamStatus();
  _teamRefreshTimer = setInterval(_loadTeamStatus, 60000);
}

async function _loadTeamStatus() {
  const body = document.getElementById('mgr-status-body');
  // Element gone (user navigated away) — stop the timer
  if (!body) { _cancelRefresh(); return; }

  const res = await apiGetTeamStatus();

  // Re-check after the async call — navigation could have happened
  if (!document.getElementById('mgr-status-body')) return;

  if (res.status !== 'ok') {
    document.getElementById('mgr-status-body').innerHTML =
      `<p class="mgr-error" role="alert">${_esc(res.message || t('error.server'))}</p>`;
    return;
  }

  const { members, summary } = res.data;

  document.getElementById('mgr-status-body').innerHTML = `
    <div class="mgr-stat-grid" role="list" aria-label="${t('team.status_today')}">
      ${_mgrStatCard(summary.present,  t('team.present_count'), 'present')}
      ${_mgrStatCard(summary.absent,   t('team.absent_count'),  'absent')}
      ${_mgrStatCard(summary.late,     t('team.late_count'),    'late')}
      ${_mgrStatCard(summary.on_leave, t('team.leave_count'),   'leave')}
    </div>

    <div class="mgr-section-header">
      <span class="mgr-section-title">${t('team.status_today')}</span>
      <span class="mgr-refresh-time">${_refreshLabel()}</span>
    </div>

    <ul class="mgr-member-list" role="list">
      ${members.length === 0
        ? `<li class="emp-empty-state">
             <span class="emp-empty-icon" aria-hidden="true">👥</span>
             <p class="emp-empty-msg">${t('team.no_members')}</p>
           </li>`
        : members.map(m => _memberRow(m)).join('')
      }
    </ul>`;
}

// ---------------------------------------------------------------------------
// renderTeamAttendance — attendance for a chosen date
// ---------------------------------------------------------------------------
// Date picker defaults to today; records listed per team member.

function renderTeamAttendance(container) {
  _cancelRefresh();

  const today = _isoToday();

  container.innerHTML = `
    <div class="view-header">
      <span class="view-title">${t('nav.attendance')}</span>
    </div>
    <div class="view-content">
      <div class="mgr-date-bar">
        <label class="field-label" for="mgr-date-picker">${t('attendance.date')}</label>
        <input class="field-input mgr-date-input"
               type="date"
               id="mgr-date-picker"
               value="${today}"
               max="${today}"
               aria-label="${t('attendance.filter_date')}">
      </div>
      <ul class="mgr-att-list" id="mgr-att-body" role="list">
        ${_skeletonAtt()}
      </ul>
    </div>`;

  document.getElementById('mgr-date-picker')
    ?.addEventListener('change', e => _loadTeamAttendance(e.target.value));

  _loadTeamAttendance(today);
}

async function _loadTeamAttendance(date) {
  const body = document.getElementById('mgr-att-body');
  if (!body) return;

  body.innerHTML = _skeletonAtt();

  const res = await apiGetTeamAttendance(date);
  if (!document.getElementById('mgr-att-body')) return;

  if (res.status !== 'ok') {
    body.innerHTML = `<li class="mgr-error" role="alert">${_esc(res.message || t('error.server'))}</li>`;
    return;
  }

  const { records } = res.data;

  if (!records || records.length === 0) {
    body.innerHTML = `
      <li class="emp-empty-state">
        <span class="emp-empty-icon" aria-hidden="true">📋</span>
        <p class="emp-empty-msg">${t('attendance.no_records')}</p>
      </li>`;
    return;
  }

  body.innerHTML = records.map(r => _mgrAttRow(r)).join('');
}

// ---------------------------------------------------------------------------
// renderTeamLeaves — pending leave requests with approve / reject actions
// ---------------------------------------------------------------------------

function renderTeamLeaves(container) {
  _cancelRefresh();

  container.innerHTML = `
    <div class="view-header">
      <span class="view-title">${t('leave.title')}</span>
    </div>
    <div class="view-content">
      <ul class="mgr-leave-list" id="mgr-leave-body" role="list">
        ${_skeletonLeave()}
      </ul>

      <section class="mgr-balance-section" id="mgr-balance-section" hidden>
        <h2 class="mgr-section-title" id="mgr-balance-title">${t('leave.balances_title')}</h2>
        <ul class="mgr-balance-list" id="mgr-balance-body" role="list"></ul>
      </section>
    </div>`;

  _loadTeamLeaves();
}

async function _loadTeamLeaves() {
  const body = document.getElementById('mgr-leave-body');
  if (!body) return;

  const res = await apiGetTeamLeaves();
  if (!document.getElementById('mgr-leave-body')) return;

  if (res.status !== 'ok') {
    body.innerHTML = `<li class="mgr-error" role="alert">${_esc(res.message || t('error.server'))}</li>`;
    return;
  }

  const { requests, balances, year } = res.data;

  // Team annual balances — rendered regardless of whether anything is pending,
  // so a manager can check entitlement at any time.
  _renderTeamBalances(balances, year);

  if (!requests || requests.length === 0) {
    body.innerHTML = `
      <li class="emp-empty-state">
        <span class="emp-empty-icon" aria-hidden="true">✅</span>
        <p class="emp-empty-msg">${t('leave.no_requests')}</p>
      </li>`;
    return;
  }

  body.innerHTML = requests.map(l => _leaveCard(l)).join('');

  body.querySelectorAll('.mgr-leave-approve').forEach(btn => {
    btn.addEventListener('click', () => _handleApprove(btn.dataset.id));
  });
  body.querySelectorAll('.mgr-leave-reject').forEach(btn => {
    btn.addEventListener('click', () => _handleReject(btn.dataset.id));
  });
}

// ---------------------------------------------------------------------------
// Team annual leave balances — remaining entitlement per team member
// ---------------------------------------------------------------------------
function _renderTeamBalances(balances, year) {
  const section = document.getElementById('mgr-balance-section');
  const list    = document.getElementById('mgr-balance-body');
  if (!section || !list) return;

  if (!Array.isArray(balances) || balances.length === 0) {
    section.hidden = true;
    return;
  }

  const title = document.getElementById('mgr-balance-title');
  if (title) title.textContent = year
    ? `${t('leave.balances_title')} — ${year}`
    : t('leave.balances_title');

  list.innerHTML = balances.map(b => {
    const remaining = Number(b.annual_remaining) || 0;
    const total     = Number(b.annual_total)     || 0;
    const taken     = Number(b.annual_taken)     || 0;
    const pending   = Number(b.annual_pending)   || 0;
    const pct       = total > 0 ? Math.min(100, Math.round((taken / total) * 100)) : 0;

    return `
      <li class="mgr-balance-row">
        <span class="mgr-avatar" aria-hidden="true">${_esc(_mgrInitials(b.employee_name))}</span>
        <span class="mgr-balance-info">
          <span class="mgr-member-name">${_esc(b.employee_name || '')}</span>
          <span class="mgr-balance-bar" aria-hidden="true">
            <span class="mgr-balance-bar-fill" style="width:${pct}%"></span>
          </span>
          <span class="mgr-balance-sub">
            ${t('leave.taken_this_year')}: <span dir="ltr">${taken}</span>
            ${pending > 0 ? ` · ${t('leave.pending_days')}: <span dir="ltr">${pending}</span>` : ''}
          </span>
        </span>
        <span class="mgr-balance-right">
          <span class="badge ${_mgrBalanceBadgeClass(remaining)}" dir="ltr">${remaining} / ${total}</span>
          <span class="mgr-balance-label">${t('leave.remaining')}</span>
        </span>
      </li>`;
  }).join('');

  section.hidden = false;
}

// Requester's remaining annual balance, shown on the approval card so the
// manager can decide without opening another screen.
function _leaveBalanceChip(l) {
  if (l.annual_remaining === undefined || l.annual_remaining === null) return '';
  const remaining = Number(l.annual_remaining) || 0;
  const total     = Number(l.annual_total)     || 0;
  return `
    <div class="mgr-leave-balance">
      <span class="mgr-leave-balance-label">${t('leave.balance')}</span>
      <span class="badge ${_mgrBalanceBadgeClass(remaining)}" dir="ltr">${remaining} / ${total}</span>
    </div>`;
}

function _mgrInitials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map(w => w[0] || '').join('').toUpperCase();
}

// Green when there is room left, amber when running low, red when exhausted.
function _mgrBalanceBadgeClass(remaining) {
  if (remaining <= 0) return 'badge-absent';
  if (remaining <= 5) return 'badge-late';
  return 'badge-present';
}

async function _handleApprove(leaveId) {
  const card = document.querySelector(`.mgr-leave-card[data-id="${CSS.escape(leaveId)}"]`);
  const btn  = card?.querySelector('.mgr-leave-approve');
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const res = await apiApproveLeave(leaveId);

  if (res.status === 'ok') {
    card?.remove();
    showToast(t('status.approved'), 'success');
    _checkEmptyLeaveList();
    _loadTeamLeaves(); // approved days change the balance — refetch to keep it true
  } else {
    showToast(res.message || t('error.server'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = t('action.approve'); }
  }
}

async function _handleReject(leaveId) {
  const card = document.querySelector(`.mgr-leave-card[data-id="${CSS.escape(leaveId)}"]`);
  const btn  = card?.querySelector('.mgr-leave-reject');
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const res = await apiRejectLeave(leaveId, '');

  if (res.status === 'ok') {
    card?.remove();
    showToast(t('status.rejected'), 'warning');
    _checkEmptyLeaveList();
    _loadTeamLeaves(); // pending days drop out of the balance — refetch
  } else {
    showToast(res.message || t('error.server'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = t('action.reject'); }
  }
}

function _checkEmptyLeaveList() {
  const body = document.getElementById('mgr-leave-body');
  if (body && body.children.length === 0) {
    body.innerHTML = `
      <li class="emp-empty-state">
        <span class="emp-empty-icon" aria-hidden="true">✅</span>
        <p class="emp-empty-msg">${t('leave.no_requests')}</p>
      </li>`;
  }
}

// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

function _mgrStatCard(value, label, variant) {
  return `
    <div class="mgr-stat-card mgr-stat-${_esc(variant)}" role="listitem">
      <span class="mgr-stat-num">${Number(value) || 0}</span>
      <span class="mgr-stat-label">${_esc(label)}</span>
    </div>`;
}

function _memberRow(member) {
  const nameParts = String(member.name || '?').trim().split(/\s+/);
  const initials  = nameParts.slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  const badgeClass = _badgeClass(member.status);
  const badgeLabel = _statusLabel(member.status);
  const timeStr    = member.check_in ? _fmtTime(member.check_in) : '';

  return `
    <li class="mgr-member-row">
      <span class="mgr-avatar" aria-hidden="true">${_esc(initials)}</span>
      <span class="mgr-member-info">
        <span class="mgr-member-name">${_esc(member.name)}</span>
        <span class="mgr-member-dept">${_esc(member.department)}</span>
      </span>
      <span class="mgr-member-right">
        ${timeStr ? `<span class="mgr-member-time">${_esc(timeStr)}</span>` : ''}
        <span class="badge ${badgeClass}">${_esc(badgeLabel)}</span>
      </span>
    </li>`;
}

function _mgrAttRow(r) {
  const checkIn  = r.check_in  ? _fmtTime(r.check_in)  : '—';
  const checkOut = r.check_out ? _fmtTime(r.check_out) : '—';
  const hours    = r.hours_worked
    ? `${Number(r.hours_worked).toFixed(1)}h`
    : '—';
  const badgeClass = _badgeClass(r.status);
  const badgeLabel = _statusLabel(r.status);

  return `
    <li class="mgr-att-row">
      <span class="mgr-att-name">${_esc(r.employee_name || r.employee_id)}</span>
      <span class="mgr-att-times">
        <span class="att-time-in">↑ ${_esc(checkIn)}</span>
        <span class="att-time-out">↓ ${_esc(checkOut)}</span>
      </span>
      <span class="mgr-att-right">
        <span class="mgr-att-hours">${_esc(hours)}</span>
        <span class="badge ${badgeClass}">${_esc(badgeLabel)}</span>
      </span>
    </li>`;
}

function _leaveCard(l) {
  const typeKeyMap = {
    annual:    'type_annual',
    sick:      'type_sick',
    emergency: 'type_emergency',
    unpaid:    'type_unpaid'
  };
  const typeKey   = typeKeyMap[String(l.leave_type).toLowerCase()] || 'type_annual';
  const leaveType = t('leave.' + typeKey) || l.leave_type;

  const startFmt = _fmtDate(l.start_date);
  const endFmt   = _fmtDate(l.end_date);

  return `
    <li class="mgr-leave-card" data-id="${_esc(l.id)}">
      <div class="mgr-leave-header">
        <span class="mgr-leave-name">${_esc(l.employee_name)}</span>
        <span class="badge badge-pending">${t('leave.pending')}</span>
      </div>
      <div class="mgr-leave-meta">
        <span class="mgr-leave-type">${_esc(leaveType)}</span>
        <span class="mgr-leave-dates">${_esc(startFmt)} — ${_esc(endFmt)}</span>
      </div>
      ${_leaveBalanceChip(l)}
      ${l.reason
        ? `<p class="mgr-leave-reason">${_esc(l.reason)}</p>`
        : ''}
      <div class="mgr-leave-actions">
        <button class="btn btn-sm btn-primary mgr-leave-approve"
                data-id="${_esc(l.id)}"
                type="button">
          ${t('action.approve')}
        </button>
        <button class="btn btn-sm btn-danger mgr-leave-reject"
                data-id="${_esc(l.id)}"
                type="button">
          ${t('action.reject')}
        </button>
      </div>
    </li>`;
}

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

function _skeletonStatus() {
  const cards = [0, 1, 2, 3]
    .map(() => `<div class="mgr-stat-card skeleton" style="height:78px"></div>`)
    .join('');
  const rows = [0, 1, 2, 3, 4]
    .map(() => `<div class="mgr-member-row skeleton" style="height:60px;border-radius:var(--r-lg);margin-block-end:var(--sp-2)"></div>`)
    .join('');
  return `
    <div class="mgr-stat-grid">${cards}</div>
    <div class="mgr-section-header">
      <span class="skeleton" style="width:110px;height:13px;display:inline-block;border-radius:4px"></span>
    </div>
    ${rows}`;
}

function _skeletonAtt() {
  return [0, 1, 2, 3, 4]
    .map(() => `<li class="mgr-att-row skeleton" style="height:54px;border-radius:var(--r-lg);margin-block-end:var(--sp-2)"></li>`)
    .join('');
}

function _skeletonLeave() {
  return [0, 1, 2]
    .map(() => `<li class="mgr-leave-card skeleton" style="height:120px;border-radius:var(--r-lg);margin-block-end:var(--sp-3)"></li>`)
    .join('');
}

// ---------------------------------------------------------------------------
// Shared private helpers
// ---------------------------------------------------------------------------

function _cancelRefresh() {
  if (_teamRefreshTimer) {
    clearInterval(_teamRefreshTimer);
    _teamRefreshTimer = null;
  }
}

function _isoToday() {
  return new Date().toISOString().slice(0, 10);
}

// Format a stored HH:MM time string for display using utils.js formatTime()
function _fmtTime(hhMm) {
  if (!hhMm) return '';
  try {
    if (typeof formatTime === 'function') {
      // Build a Date object with just the time component
      return formatTime(new Date('1970-01-01T' + String(hhMm).substring(0, 5) + ':00'));
    }
  } catch (_) { /* fall through */ }
  return String(hhMm).substring(0, 5);
}

// Format a stored YYYY-MM-DD date string for display using utils.js formatDate()
function _fmtDate(isoDate) {
  if (!isoDate) return '';
  try {
    if (typeof formatDate === 'function') {
      return formatDate(new Date(isoDate + 'T00:00:00'));
    }
  } catch (_) { /* fall through */ }
  return String(isoDate);
}

// "Last updated: HH:MM" line shown next to the section header
function _refreshLabel() {
  const lang = localStorage.getItem('lmp_lang') || 'ar';
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  return lang === 'ar'
    ? `آخر تحديث: ${time}`
    : `Last updated: ${time}`;
}

function _badgeClass(status) {
  const map = {
    present:  'badge-present',
    late:     'badge-late',
    absent:   'badge-absent',
    on_leave: 'badge-leave',
    leave:    'badge-leave'
  };
  return map[String(status).toLowerCase()] || 'badge-absent';
}

function _statusLabel(status) {
  const map = {
    present:  t('status.present'),
    late:     t('status.late'),
    absent:   t('status.absent'),
    on_leave: t('status.on_leave'),
    leave:    t('status.on_leave')
  };
  return map[String(status).toLowerCase()] || String(status);
}

// XSS-safe HTML escaping
function _esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
