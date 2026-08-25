// =============================================================================
// exec.js — Executive views (CEO / Managing Director)
//
// Exposes two render functions called by the app.js router:
//   renderOrgStatus(container)  → #org
//   renderExecLeaves(container) → #exec-leaves
//
// The company status screen is read-only — it calls exactly one endpoint,
// get_org_status, and never writes. Executives do not check in, so there is no
// attendance action anywhere on it.
//
// Leave approval is the single exception to the read-only rule: department
// managers report straight to the CEO/MD, so nobody else can clear their leave.
// The server scopes it to direct reports only — see approveLeave in Leaves.gs.
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

// Last successful get_org_status payload. The status-list modal is built from
// this rather than from a second call — the grouped response already contains
// every employee the summary counted.
let _orgData = null;

// Status whose employee list is currently open in the modal, or null.
let _orgOpenStatus = null;

// =============================================================================
// renderOrgStatus — #org
// Company-wide status for today, one card per manager.
// =============================================================================
function renderOrgStatus(container) {
  _execCancelRefresh();
  _orgExpanded   = new Set();
  _orgData       = null;
  _orgOpenStatus = null;

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
    </div>

    <div class="modal-overlay" id="exec-list-overlay" hidden>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="exec-list-title">
        <div class="modal-hd">
          <span class="modal-title" id="exec-list-title"></span>
          <button class="btn-icon" id="exec-list-close" type="button" aria-label="${t('action.close')}">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
            </svg>
          </button>
        </div>
        <div class="modal-bd" id="exec-list-bd"></div>
      </div>
    </div>`;

  // Delegated: #exec-body is rebuilt on every 60s refresh, so the listener has
  // to live on an element that survives it
  document.getElementById('exec-body')?.addEventListener('click', e => {
    const card = e.target.closest('.exec-stat-btn');
    if (card) _execOpenStatusList(card.dataset.status);
  });

  document.getElementById('exec-list-close')?.addEventListener('click', _execCloseStatusList);
  document.getElementById('exec-list-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'exec-list-overlay') _execCloseStatusList();
  });
  document.addEventListener('keydown', _execEscToClose);

  _loadOrgStatus();
  _orgRefreshTimer = setInterval(_loadOrgStatus, 60000);
}

// =============================================================================
// renderExecLeaves — #exec-leaves
// Pending leave requests raised by the executive's own direct reports.
//
// Department managers report straight to the CEO/MD, so there is nobody below
// them to clear their leave. The queue is identical to a manager's and the
// server scopes both the same way — direct reports only, pending only — so this
// delegates to renderTeamLeaves instead of keeping a second copy of that view.
// =============================================================================
function renderExecLeaves(container) {
  _execCancelRefresh();
  renderTeamLeaves(container);
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

  _orgData = res.data;

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

  // Keep an open status list in step with the refresh rather than letting it go
  // stale behind the numbers that opened it
  if (_orgOpenStatus) _execFillStatusList(_orgOpenStatus);
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
// widens to four across on desktop.
//
// Each card is a button that opens the matching employee list. A zero card is
// disabled: there is no list behind it, and a card that opens an empty dialog
// reads as a broken one.
function _execSummaryCards(s) {
  const card = (value, label, variant, status) => {
    const n = Number(value) || 0;
    return `
      <button type="button"
              class="mgr-stat-card mgr-stat-${variant} exec-stat-btn"
              data-status="${status}"
              ${n === 0 ? 'disabled' : ''}
              aria-label="${_execEsc(label)}: ${n} — ${t('exec.view_list')}">
        <span class="mgr-stat-num">${n}</span>
        <span class="mgr-stat-label">${_execEsc(label)}</span>
      </button>`;
  };

  return `
    <div class="exec-summary-grid" role="group" aria-label="${t('exec.company_today')}">
      ${card(s.present,  t('team.present_count'), 'present', 'present')}
      ${card(s.absent,   t('team.absent_count'),  'absent',  'absent')}
      ${card(s.late,     t('team.late_count'),    'late',    'late')}
      ${card(s.on_leave, t('team.leave_count'),   'leave',   'on_leave')}
    </div>`;
}

// ---------------------------------------------------------------------------
// Status list modal — every employee currently in one status
// ---------------------------------------------------------------------------

function _execOpenStatusList(status) {
  if (!status || !_orgData) return;
  _orgOpenStatus = status;

  const overlay = document.getElementById('exec-list-overlay');
  if (!overlay) return;

  _execFillStatusList(status);
  overlay.hidden = false;
  document.getElementById('exec-list-close')?.focus();
}

function _execCloseStatusList() {
  _orgOpenStatus = null;
  const overlay = document.getElementById('exec-list-overlay');
  if (overlay) overlay.hidden = true;
}

function _execEscToClose(e) {
  if (e.key !== 'Escape' || !_orgOpenStatus) return;
  // Screen gone (navigated away) — drop the listener with it
  if (!document.getElementById('exec-list-overlay')) {
    document.removeEventListener('keydown', _execEscToClose);
    return;
  }
  _execCloseStatusList();
}

// Builds the modal title and body for one status. Split out from the open
// handler so the 60s refresh can rebuild an already-open list in place.
function _execFillStatusList(status) {
  const titleEl = document.getElementById('exec-list-title');
  const bodyEl  = document.getElementById('exec-list-bd');
  if (!titleEl || !bodyEl || !_orgData) return;

  const rows = _execAllMembers(_orgData)
    .filter(m => m.status === status);

  titleEl.textContent =
    `${_execStatusLabel(status)} — ${rows.length}`;

  bodyEl.innerHTML = rows.length === 0
    ? `<p class="exec-list-empty">${t('exec.none_in_status')}</p>`
    : `<ul class="exec-member-list exec-list-modal-list" role="list">
         ${rows.map(m => _execListRow(m)).join('')}
       </ul>`;
}

// Same member row as the group cards, with the reporting line added — an
// executive scanning a company-wide list needs to know whose team each name
// sits in, which the grouped view conveys by position alone.
function _execListRow(m) {
  const initials = _execInitials(m.name);
  const timeStr  = m.check_in ? _execFmtTime(m.check_in) : '';
  const under    = m.manager_name || t('exec.unassigned');

  return `
    <li class="mgr-member-row">
      <span class="mgr-avatar" aria-hidden="true">${_execEsc(initials)}</span>
      <span class="mgr-member-info">
        <span class="mgr-member-name">${_execEsc(m.name)}</span>
        <span class="mgr-member-dept exec-list-sub">${_execEsc(m.department || t('exec.no_department'))} · ${_execEsc(t('exec.reports_to'))} ${_execEsc(under)}</span>
      </span>
      <span class="mgr-member-right">
        ${timeStr ? `<span class="mgr-member-time">${_execEsc(timeStr)}</span>` : ''}
        <span class="badge ${_execBadgeClass(m.status)}">${_execEsc(_execStatusLabel(m.status))}</span>
      </span>
    </li>`;
}

// Flattens the grouped response back into the one list of employees the
// company summary counted, each carrying the manager they sit under.
//
// Group members are pushed first so they pick up the right manager name. Group
// heads go in afterwards purely as a fallback — a head normally already appears
// as a member of whoever they report to, and only surfaces here in the odd case
// of an employee whose manager_id points at themselves, who would otherwise be
// counted in the totals but missing from every list.
function _execAllMembers(data) {
  const seen = new Set();
  const out  = [];

  const push = (m, managerName) => {
    const id = String((m && m.id) || '');
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id:           id,
      name:         String(m.name       || ''),
      department:   String(m.department || ''),
      status:       String(m.status     || 'absent').toLowerCase(),
      check_in:     String(m.check_in   || ''),
      manager_name: String(managerName  || '')
    });
  };

  (data.groups || []).forEach(g => {
    (g.members || []).forEach(m => push(m, g.manager_name));
  });

  if (data.unassigned && data.unassigned.members) {
    data.unassigned.members.forEach(m => push(m, ''));
  }

  // A head with no manager_status is not part of the attending workforce (the
  // CEO/MD themselves, or HR) — they were never in the totals, so adding them
  // here would put a name in a status list that the card's number does not count
  (data.groups || []).forEach(g => {
    if (!g.manager_status) return;
    push({
      id:         g.manager_id,
      name:       g.manager_name,
      department: g.department,
      status:     g.manager_status,
      check_in:   g.manager_check_in
    }, '');
  });

  return out.sort((a, b) => a.name.localeCompare(b.name));
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
            ${g.manager_status
              ? `<span class="badge ${_execBadgeClass(g.manager_status)} exec-group-mgr-badge">
                   ${_execEsc(_execStatusLabel(g.manager_status))}
                 </span>`
              : ''}
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

// Everyone whose manager_id is blank or points at somebody who is no longer an
// active employee. Shown so a gap in the org chart is visible rather than
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
  const initials = _execInitials(m.name);
  const timeStr  = m.check_in ? _execFmtTime(m.check_in) : '';

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

function _execInitials(name) {
  return String(name || '?').trim().split(/\s+/)
    .slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
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
