// =============================================================================
// exec.js — Executive views (CEO / Managing Director)
//
// Exposes one render function called by app.js router:
//   renderOrgStatus(container)  → #org
//
// These roles are read-only by design: this file calls exactly one endpoint,
// get_org_status, and never writes anything. They do not check in, so there is
// no attendance action anywhere on this screen.
//
// Auto-refresh: polls every 60 seconds via _orgRefreshTimer, matching the
// manager team screen. The timer self-cancels when its element leaves the DOM.
//
// Helper names are prefixed _exec* on purpose — every js/ file here shares one
// global scope, so a bare _esc or _statusLabel would collide with the copies
// already defined in employee.js and manager.js.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let _orgRefreshTimer = null;

// Manager IDs whose group card is expanded. Groups render collapsed by default
// — an executive wants the exceptions, not a full roster — and this set keeps
// anything the user opened from snapping shut on the next 60s refresh.
let _orgExpanded = new Set();

// =============================================================================
// renderOrgStatus — #org
// Company-wide status for today, one card per manager.
// =============================================================================
function renderOrgStatus(container) {
  _execCancelRefresh();
  _orgExpanded = new Set();

  container.innerHTML = `
    <div class="view-content">
      <div class="view-header">
        <div>
          <h1 class="view-title">${t('exec.org_title')}</h1>
          <p class="dashboard-date" id="exec-date">${_execToday()}</p>
        </div>
        <span class="mgr-live-badge" aria-label="${t('team.live')}">
          <span class="mgr-live-dot" aria-hidden="true"></span>
          ${t('team.live')}
        </span>
      </div>

      <div id="exec-body">${_execSkeleton()}</div>
    </div>`;

  _loadOrgStatus();
  _orgRefreshTimer = setInterval(_loadOrgStatus, 60000);
}

async function _loadOrgStatus() {
  const body = document.getElementById('exec-body');
  // Element gone (user navigated away) — stop the timer
  if (!body) { _execCancelRefresh(); return; }

  let res;
  try {
    res = await apiGetOrgStatus();
  } catch (_) {
    res = null;
  }

  // Re-check after the async call — navigation could have happened
  const target = document.getElementById('exec-body');
  if (!target) { _execCancelRefresh(); return; }

  if (!res || res.status !== 'ok') {
    target.innerHTML =
      `<p class="mgr-error" role="alert">${_execEsc((res && res.message) || t('error.server'))}</p>`;
    return;
  }

  // Remember what is open before the rebuild, then restore it afterwards
  _rememberExpanded();

  const { summary, groups, unassigned } = res.data;
  const hasUnassigned = unassigned && unassigned.members && unassigned.members.length > 0;

  target.innerHTML = `
    ${_execSummaryCards(summary)}

    <div class="mgr-section-header">
      <span class="mgr-section-title">${t('exec.by_manager')}</span>
      <span class="mgr-refresh-time">${_execRefreshLabel()}</span>
    </div>

    ${(!groups.length && !hasUnassigned)
      ? `<div class="emp-empty-state">
           <span class="emp-empty-icon" aria-hidden="true">🏢</span>
           <p class="emp-empty-msg">${t('exec.no_data')}</p>
         </div>`
      : groups.map(g => _execGroupCard(g)).join('')
        + (hasUnassigned ? _execUnassignedCard(unassigned) : '')
    }`;

  _restoreExpanded();
}

// ---------------------------------------------------------------------------
// Expanded-group tracking across refreshes
// ---------------------------------------------------------------------------
function _rememberExpanded() {
  _orgExpanded = new Set();
  document.querySelectorAll('#exec-body .exec-group[open]').forEach(el => {
    const key = el.getAttribute('data-group');
    if (key) _orgExpanded.add(key);
  });
}

function _restoreExpanded() {
  document.querySelectorAll('#exec-body .exec-group').forEach(el => {
    if (_orgExpanded.has(el.getAttribute('data-group'))) el.setAttribute('open', '');
  });
}

// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

// Company-wide totals — reuses the manager stat card visual, in a grid that
// widens to four across on desktop
function _execSummaryCards(s) {
  const card = (value, label, variant) => `
    <div class="mgr-stat-card mgr-stat-${variant}" role="listitem">
      <span class="mgr-stat-num">${Number(value) || 0}</span>
      <span class="mgr-stat-label">${_execEsc(label)}</span>
    </div>`;

  return `
    <div class="exec-summary-grid" role="list" aria-label="${t('exec.company_today')}">
      ${card(s.present,  t('team.present_count'), 'present')}
      ${card(s.absent,   t('team.absent_count'),  'absent')}
      ${card(s.late,     t('team.late_count'),    'late')}
      ${card(s.on_leave, t('team.leave_count'),   'leave')}
    </div>`;
}

// One collapsible card per manager. <details>/<summary> gives collapse
// behaviour and keyboard support with no JS wiring.
function _execGroupCard(g) {
  const total = g.summary.total;

  return `
    <details class="exec-group" data-group="${_execEsc(g.manager_id)}">
      <summary class="exec-group-head">
        <span class="exec-group-info">
          <span class="exec-group-name">
            ${_execEsc(g.manager_name)}
            <span class="badge ${_execBadgeClass(g.manager_status)} exec-group-mgr-badge">
              ${_execEsc(_execStatusLabel(g.manager_status))}
            </span>
          </span>
          <span class="exec-group-dept">${_execEsc(g.department || t('exec.no_department'))}</span>
        </span>
        ${_execCounts(g.summary)}
      </summary>
      ${total === 0
        ? `<p class="exec-group-empty">${t('team.no_members')}</p>`
        : `<ul class="exec-member-list" role="list">
             ${g.members.map(m => _execMemberRow(m)).join('')}
           </ul>`
      }
    </details>`;
}

// Everyone whose manager_id is blank or points at somebody who is not in the
// active workforce. Shown so a gap in the org chart is visible rather than
// quietly dropping people off the screen.
function _execUnassignedCard(u) {
  return `
    <details class="exec-group exec-group-unassigned" data-group="__unassigned">
      <summary class="exec-group-head">
        <span class="exec-group-info">
          <span class="exec-group-name">${t('exec.unassigned')}</span>
          <span class="exec-group-dept">${t('exec.unassigned_hint')}</span>
        </span>
        ${_execCounts(u.summary)}
      </summary>
      <ul class="exec-member-list" role="list">
        ${u.members.map(m => _execMemberRow(m)).join('')}
      </ul>
    </details>`;
}

// Present-of-total, plus chips for late / absent / on-leave only when non-zero
// — so a healthy team stays visually quiet and a problem team stands out
function _execCounts(s) {
  const chips = [];
  if (s.late)     chips.push(`<span class="exec-chip exec-chip-late">${s.late} ${_execEsc(t('status.late'))}</span>`);
  if (s.absent)   chips.push(`<span class="exec-chip exec-chip-absent">${s.absent} ${_execEsc(t('status.absent'))}</span>`);
  if (s.on_leave) chips.push(`<span class="exec-chip exec-chip-leave">${s.on_leave} ${_execEsc(t('status.on_leave'))}</span>`);

  return `
    <span class="exec-group-counts">
      <span class="exec-ratio">
        <span class="exec-ratio-num">${Number(s.present) || 0}</span>
        <span class="exec-ratio-sep">/</span>
        <span class="exec-ratio-total">${Number(s.total) || 0}</span>
      </span>
      ${chips.join('')}
    </span>`;
}

function _execMemberRow(m) {
  const initials = String(m.name || '?').trim().split(/\s+/)
    .slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  const timeStr = m.check_in ? _execFmtTime(m.check_in) : '';

  return `
    <li class="mgr-member-row">
      <span class="mgr-avatar" aria-hidden="true">${_execEsc(initials)}</span>
      <span class="mgr-member-info">
        <span class="mgr-member-name">${_execEsc(m.name)}</span>
        <span class="mgr-member-dept">${_execEsc(m.department)}</span>
      </span>
      <span class="mgr-member-right">
        ${timeStr ? `<span class="mgr-member-time">${_execEsc(timeStr)}</span>` : ''}
        <span class="badge ${_execBadgeClass(m.status)}">${_execEsc(_execStatusLabel(m.status))}</span>
      </span>
    </li>`;
}

function _execSkeleton() {
  const cards = [0, 1, 2, 3]
    .map(() => `<div class="mgr-stat-card skeleton" style="height:78px"></div>`)
    .join('');
  const groups = [0, 1, 2, 3]
    .map(() => `<div class="skeleton" style="height:64px;border-radius:var(--r-lg);margin-block-end:var(--sp-2)"></div>`)
    .join('');
  return `
    <div class="exec-summary-grid">${cards}</div>
    <div class="mgr-section-header">
      <span class="skeleton" style="width:110px;height:13px;display:inline-block;border-radius:4px"></span>
    </div>
    ${groups}`;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _execCancelRefresh() {
  if (_orgRefreshTimer) {
    clearInterval(_orgRefreshTimer);
    _orgRefreshTimer = null;
  }
}

// Any hash navigation stops the poll — belt and braces alongside the
// element-presence check in _loadOrgStatus
window.addEventListener('hashchange', _execCancelRefresh);

function _execToday() {
  return typeof formatDate === 'function' ? formatDate(new Date()) : '';
}

function _execFmtTime(hhMm) {
  if (!hhMm) return '';
  try {
    if (typeof formatTime === 'function') {
      return formatTime(new Date('1970-01-01T' + String(hhMm).substring(0, 5) + ':00'));
    }
  } catch (_) { /* fall through */ }
  return String(hhMm).substring(0, 5);
}

function _execRefreshLabel() {
  const d  = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${t('exec.updated')} ${hh}:${mm}`;
}

function _execBadgeClass(status) {
  return {
    present:  'badge-present',
    late:     'badge-late',
    absent:   'badge-absent',
    on_leave: 'badge-leave'
  }[String(status).toLowerCase()] || 'badge-absent';
}

function _execStatusLabel(status) {
  return {
    present:  t('status.present'),
    late:     t('status.late'),
    absent:   t('status.absent'),
    on_leave: t('status.on_leave')
  }[String(status).toLowerCase()] || String(status);
}

// XSS-safe HTML escaping
function _execEsc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
