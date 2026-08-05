// =============================================================================
// hr.js — HR role views: Dashboard + all 11 admin screens
// Stage 5, Step 1: Dashboard screen implemented.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Auto-refresh timer — cancelled on navigation away from the dashboard
// ---------------------------------------------------------------------------
let _dashTimer = null;

function _cancelDashTimer() {
  if (_dashTimer !== null) {
    clearInterval(_dashTimer);
    _dashTimer = null;
  }
}

// Any hash navigation cancels the dashboard timer
window.addEventListener('hashchange', _cancelDashTimer);

// =============================================================================
// renderHRDashboard — entry point called by app.js router
// =============================================================================
async function renderHRDashboard(container) {
  _cancelDashTimer();

  // Render shell immediately with skeletons so the layout snaps in before data
  container.innerHTML = `
    <div class="hr-dashboard view-content">

      <div class="view-header">
        <div>
          <h1 class="view-title">${t('hr.dashboard_title')}</h1>
          <p class="dashboard-date">${_todayLabel()}</p>
        </div>
        <div class="dashboard-refresh-indicator" id="dash-live-indicator"
             aria-label="${t('team.live')}">
          <span class="live-dot" aria-hidden="true"></span>
          <span class="live-label">${t('team.live')}</span>
        </div>
      </div>

      <div class="stat-grid" id="dash-stat-grid">
        ${_skeletonStatCard()}
        ${_skeletonStatCard()}
        ${_skeletonStatCard()}
        ${_skeletonStatCard()}
      </div>

      <div class="activity-card" id="dash-activity-card" role="region"
           aria-label="${t('hr.recent_activity')}">
        <div class="activity-header">
          <h2 class="activity-title">${t('hr.recent_activity')}</h2>
        </div>
        <div class="activity-skeleton">
          ${[0,1,2,3,4,5].map(() => `
            <div class="activity-row-skeleton">
              <div class="skeleton"
                   style="width:34px;height:34px;border-radius:50%;flex-shrink:0"></div>
              <div style="flex:1;display:flex;flex-direction:column;gap:5px">
                <div class="skeleton" style="height:13px;width:55%;border-radius:4px"></div>
                <div class="skeleton" style="height:11px;width:35%;border-radius:4px"></div>
              </div>
              <div class="skeleton" style="height:13px;width:60px;border-radius:4px"></div>
              <div class="skeleton"
                   style="height:22px;width:56px;border-radius:999px"></div>
            </div>`).join('')}
        </div>
      </div>

    </div>`;

  // Fetch and paint real data
  await _fetchAndRenderDashboard();

  // Auto-refresh every 60 seconds
  _dashTimer = setInterval(() => {
    if (document.querySelector('.hr-dashboard')) {
      _fetchAndRenderDashboard();
    } else {
      _cancelDashTimer();
    }
  }, 60_000);
}

// Make available to app.js router
window.renderHRDashboard = renderHRDashboard;

// =============================================================================
// _fetchAndRenderDashboard — fetch data then repaint stat cards + feed
// =============================================================================
async function _fetchAndRenderDashboard() {
  const today = _isoToday();

  // Both requests in parallel
  const [attendanceRes, leavesRes] = await Promise.all([
    apiGetAllAttendance(null, today, today),
    apiGetTeamLeaves(),
  ]);

  // ── Parse attendance ───────────────────────────────────────────────────────
  const records = (attendanceRes?.status === 'ok' && Array.isArray(attendanceRes.data?.records))
    ? attendanceRes.data.records
    : [];

  const counts = { present: 0, absent: 0, late: 0, on_leave: 0 };
  for (const rec of records) {
    const s = (rec.status || '').toLowerCase();
    if      (s === 'present')              counts.present++;
    else if (s === 'absent')               counts.absent++;
    else if (s === 'late')                 counts.late++;
    else if (s === 'leave' || s === 'on_leave') counts.on_leave++;
  }

  // ── Parse pending leave requests ───────────────────────────────────────────
  const allLeaves = (leavesRes?.status === 'ok' && Array.isArray(leavesRes.data?.requests))
    ? leavesRes.data.requests
    : [];
  const pendingCount = allLeaves.filter(
    l => (l.status || '').toLowerCase() === 'pending'
  ).length;

  // ── Recent check-ins: last 10, sorted most-recent first ───────────────────
  const recent = records
    .filter(r => r.check_in)
    .sort((a, b) => new Date(b.check_in) - new Date(a.check_in))
    .slice(0, 10);

  // ── Update stat grid ───────────────────────────────────────────────────────
  const grid = document.getElementById('dash-stat-grid');
  if (grid) {
    grid.innerHTML = [
      _statCard(t('hr.present_today'), counts.present, 'present'),
      _statCard(t('hr.absent_today'),  counts.absent,  'absent'),
      _statCard(t('hr.late_today'),    counts.late,    'late'),
      _statCard(t('hr.on_leave'),      counts.on_leave,'leave'),
    ].join('');
  }

  // ── Update activity card ───────────────────────────────────────────────────
  const actCard = document.getElementById('dash-activity-card');
  if (actCard) {
    actCard.innerHTML = `
      <div class="activity-header">
        <h2 class="activity-title">${t('hr.recent_activity')}</h2>
        ${pendingCount > 0 ? _pendingLeaveBtn(pendingCount) : ''}
      </div>
      ${recent.length > 0
        ? `<div class="activity-list" role="list">${recent.map(_activityRow).join('')}</div>`
        : `<div class="activity-empty">
             <span class="empty-icon" aria-hidden="true">📋</span>
             <p>${t('attendance.no_records')}</p>
           </div>`}`;
  }

  // ── Update sidebar badge on the Leave Requests nav item ───────────────────
  _updateNavBadge(pendingCount);
}

// =============================================================================
// DOM helpers
// =============================================================================

// ── Stat card ──────────────────────────────────────────────────────────────
function _statCard(label, value, type) {
  const iconPaths = {
    present: `<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>`,
    absent:  `<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>`,
    late:    `<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/>`,
    leave:   `<path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/>`,
  };
  const icon = iconPaths[type] || '';

  return `
    <div class="stat-card stat-card-${type}">
      <div class="stat-card-top">
        <span class="stat-card-label">${label}</span>
        <span class="stat-card-icon stat-icon-${type}" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="currentColor">${icon}</svg>
        </span>
      </div>
      <div class="stat-card-value stat-${type}">${value}</div>
    </div>`;
}

// ── Skeleton stat card (shown while loading) ───────────────────────────────
function _skeletonStatCard() {
  return `
    <div class="stat-card">
      <div class="stat-card-top">
        <div class="skeleton" style="height:13px;width:65%;border-radius:4px"></div>
        <div class="skeleton" style="width:28px;height:28px;border-radius:50%"></div>
      </div>
      <div class="skeleton" style="height:36px;width:45%;border-radius:6px;margin-block-start:4px"></div>
    </div>`;
}

// ── One activity feed row ──────────────────────────────────────────────────
function _activityRow(record) {
  const rawName = record.employee_name || record.name || '';
  const name    = rawName || record.employee_id || '—';
  const dept    = record.department || record.department_name || '';
  const timeStr = record.check_in ? formatTime(record.check_in) : '—';
  const status  = (record.status || 'present').toLowerCase();

  // First letter of each word, max 2 chars
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase() || '?';

  const badgeClass = {
    present:  'badge-present',
    late:     'badge-late',
    absent:   'badge-absent',
    leave:    'badge-leave',
    on_leave: 'badge-leave',
  }[status] || 'badge-pending';

  const badgeLabel = {
    present:  t('status.present'),
    late:     t('status.late'),
    absent:   t('status.absent'),
    leave:    t('status.on_leave'),
    on_leave: t('status.on_leave'),
  }[status] || t('status.present');

  return `
    <div class="activity-row" role="listitem">
      <div class="activity-avatar avatar-${status}" aria-hidden="true">${initials}</div>
      <div class="activity-info">
        <span class="activity-name">${_esc(name)}</span>
        ${dept ? `<span class="activity-dept">${_esc(dept)}</span>` : ''}
      </div>
      <span class="activity-time">${timeStr}</span>
      <span class="badge ${badgeClass}">${badgeLabel}</span>
    </div>`;
}

// ── Pending leave requests button ─────────────────────────────────────────
function _pendingLeaveBtn(count) {
  return `
    <a href="#leave-requests" class="pending-leave-btn"
       aria-label="${count} ${t('leave.pending')}">
      <span class="pending-leave-count" aria-hidden="true">${count > 99 ? '99+' : count}</span>
      ${t('nav.leave_requests')}
    </a>`;
}

// ── Update the sidebar Leave Requests badge ────────────────────────────────
function _updateNavBadge(count) {
  const leaveLink = document.querySelector('a[href="#leave-requests"]');
  if (!leaveLink) return;

  const existing = leaveLink.querySelector('.nav-badge');
  if (existing) existing.remove();

  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'nav-badge';
    badge.setAttribute('aria-label', `${count} ${t('leave.pending')}`);
    badge.textContent = count > 99 ? '99+' : String(count);
    leaveLink.appendChild(badge);
  }
}

// =============================================================================
// Utility helpers
// =============================================================================

// Returns current local time as HH:MM (for pre-filling time inputs)
function _nowTimeHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Returns today as YYYY-MM-DD in local time
function _isoToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Localised human-readable date for the dashboard header
function _todayLabel() {
  const lang = localStorage.getItem('lmp_lang') || 'ar';
  const d    = new Date();

  if (lang === 'ar') {
    const days   = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                    'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    return `${days[d.getDay()]}، ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Minimal HTML-escape for user-supplied strings rendered into innerHTML
function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =============================================================================
// LIVE STATUS SCREEN
// renderLiveStatus — full company roster with today's status, auto-refreshes
// =============================================================================

let _liveTimer   = null;
let _liveAllRows = []; // cached after fetch so search filters without re-fetching

function _cancelLiveTimer() {
  if (_liveTimer !== null) { clearInterval(_liveTimer); _liveTimer = null; }
}

async function renderLiveStatus(container) {
  _cancelLiveTimer();

  container.innerHTML = `
    <div class="view-content">
      <div class="view-header">
        <div>
          <h1 class="view-title">${t('nav.live_status')}</h1>
          <p class="dashboard-date">${_todayLabel()}</p>
        </div>
        <div class="dashboard-refresh-indicator" aria-label="${t('team.live')}">
          <span class="live-dot" aria-hidden="true"></span>
          <span class="live-label">${t('team.live')}</span>
        </div>
      </div>

      <div class="data-table-wrap">
        <div class="table-toolbar" id="live-toolbar">
          <input type="search" class="table-toolbar-search" id="live-search"
                 placeholder="${t('employees.search')}" autocomplete="off">
          <div class="table-toolbar-actions">
            <span class="count-badge" id="live-count">—</span>
          </div>
        </div>
        <table class="data-table" id="live-table">
          <thead>
            <tr>
              <th>${t('employees.name')}</th>
              <th>${t('employees.department')}</th>
              <th>${t('attendance.check_in')}</th>
              <th>${t('attendance.location')}</th>
              <th>${t('attendance.status')}</th>
            </tr>
          </thead>
          <tbody id="live-tbody">
            ${_skeletonTableRows(5, 5)}
          </tbody>
        </table>
      </div>
    </div>`;

  await _fetchAndRenderLive();

  document.getElementById('live-search')?.addEventListener('input', function() {
    _renderLiveTbody(this.value.trim().toLowerCase());
  });

  _liveTimer = setInterval(function() {
    if (document.getElementById('live-tbody')) _fetchAndRenderLive();
    else _cancelLiveTimer();
  }, 60_000);
}

window.renderLiveStatus = renderLiveStatus;

async function _fetchAndRenderLive() {
  const [statusRes, locsRes] = await Promise.all([
    apiGetTeamStatus(),
    apiGetLocations().catch(function() { return null; }),
  ]);

  const members = (statusRes?.status === 'ok' && Array.isArray(statusRes.data?.members))
    ? statusRes.data.members : [];

  const locMap = {};
  const locs = locsRes?.data?.locations || locsRes?.data || [];
  if (Array.isArray(locs)) locs.forEach(function(l) { locMap[String(l.id)] = l.name || ''; });

  _liveAllRows = members.map(function(m) {
    return Object.assign({}, m, { location_name: locMap[String(m.location_id || '')] || '' });
  });

  const searchEl = document.getElementById('live-search');
  _renderLiveTbody(searchEl ? searchEl.value.trim().toLowerCase() : '');
}

function _renderLiveTbody(query) {
  const tbody = document.getElementById('live-tbody');
  if (!tbody) return;

  const rows = query
    ? _liveAllRows.filter(function(r) {
        return (r.name || '').toLowerCase().includes(query) ||
               (r.department || '').toLowerCase().includes(query);
      })
    : _liveAllRows;

  const countEl = document.getElementById('live-count');
  if (countEl) countEl.textContent = rows.length;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:var(--sp-8);color:var(--c-text-muted)">${t('team.no_members')}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(_liveRow).join('');
}

function _liveRow(member) {
  const status   = (member.status || 'absent').toLowerCase();
  const checkIn  = member.check_in ? _fmtTime(member.check_in) : '—';
  const locName  = member.location_name || '—';
  const initials = _initials(member.name || '');

  const badgeMap = {
    present:  'badge-present', late: 'badge-late',
    absent:   'badge-absent',  on_leave: 'badge-leave',
  };
  const labelMap = {
    present:  t('status.present'), late: t('status.late'),
    absent:   t('status.absent'),  on_leave: t('status.on_leave'),
  };

  return `
    <tr class="${status === 'absent' ? 'row-absent' : ''}">
      <td>
        <div style="display:flex;align-items:center;gap:var(--sp-2)">
          <div class="activity-avatar avatar-${status}" aria-hidden="true">${_esc(initials)}</div>
          <span>${_esc(member.name || '')}</span>
        </div>
      </td>
      <td>${_esc(member.department || '—')}</td>
      <td style="font-variant-numeric:tabular-nums">${_esc(checkIn)}</td>
      <td>${_esc(locName)}</td>
      <td><span class="badge ${badgeMap[status] || 'badge-absent'}">${labelMap[status] || status}</span></td>
    </tr>`;
}

// =============================================================================
// ATTENDANCE RECORDS SCREEN
// renderAttendanceRecords — full CRUD table with slide-out panel and modal
// =============================================================================

// Screen-level state (reset on each navigation to this view)
let _attAllRecords = [];
let _attFiltered   = [];
let _attPage       = 1;
const _ATT_PGS     = 25;
let _attSelRecord  = null;
let _attEmployees  = [];
let _attLocations  = [];

async function renderAttendanceRecords(container) {
  _cancelLiveTimer();

  // Reset state for this navigation
  _attAllRecords = []; _attFiltered = []; _attPage = 1;
  _attSelRecord  = null; _attEmployees = []; _attLocations = [];

  const dateFrom = _nDaysAgo(30);
  const dateTo   = _isoToday();

  container.innerHTML = `
    <div class="view-content" id="att-view">
      <div class="view-header">
        <div><h1 class="view-title">${t('attendance.title')}</h1></div>
        <button class="btn btn-primary btn-sm" id="att-add-manual-btn">
          + ${t('attendance.add_manual')}
        </button>
      </div>

      <div class="data-table-wrap">
        <div class="table-toolbar" id="att-toolbar">
          <select class="table-toolbar-select" id="att-emp-filter"
                  aria-label="${t('attendance.filter_employee')}">
            <option value="">${t('attendance.filter_employee')}</option>
          </select>
          <input type="date" class="table-toolbar-date" id="att-date-from"
                 value="${_esc(dateFrom)}" aria-label="${t('date.from')}">
          <span class="toolbar-sep" aria-hidden="true">—</span>
          <input type="date" class="table-toolbar-date" id="att-date-to"
                 value="${_esc(dateTo)}" aria-label="${t('date.to')}">
          <button class="btn btn-secondary btn-sm" id="att-filter-btn">
            ${t('action.filter')}
          </button>
          <div class="table-toolbar-actions">
            <input type="search" class="table-toolbar-search" id="att-search"
                   placeholder="${t('action.search')}" autocomplete="off">
            <span class="count-badge" id="att-count">—</span>
          </div>
        </div>

        <table class="data-table" id="att-table">
          <thead>
            <tr>
              <th>${t('attendance.employee')}</th>
              <th>${t('attendance.date')}</th>
              <th>${t('attendance.check_in')}</th>
              <th>${t('attendance.check_out')}</th>
              <th>${t('attendance.hours')}</th>
              <th>${t('attendance.status')}</th>
              <th title="${t('biometric.prompt')}">✓</th>
            </tr>
          </thead>
          <tbody id="att-tbody">${_skeletonTableRows(8, 7)}</tbody>
        </table>
      <div class="pagination-bar" id="att-pagination" hidden></div>
      </div>
    </div>

    <div class="panel-overlay" id="att-overlay"></div>
    <div class="slide-panel" id="att-panel" role="dialog"
         aria-modal="true" aria-labelledby="att-panel-title">
      <div class="slide-panel-hd">
        <span class="slide-panel-title" id="att-panel-title">${t('attendance.title')}</span>
        <button class="btn-icon" id="att-panel-close"
                aria-label="${t('action.close')}">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>
      <div class="slide-panel-bd" id="att-panel-bd"></div>
    </div>

    <div class="modal-overlay" id="manual-overlay" hidden>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="manual-modal-title">
        <div class="modal-hd">
          <span class="modal-title" id="manual-modal-title">${t('attendance.add_manual')}</span>
          <button class="btn-icon" id="manual-modal-close" aria-label="${t('action.close')}">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
            </svg>
          </button>
        </div>
        <div class="modal-bd" id="manual-modal-bd"></div>
        <div class="modal-ft">
          <button class="btn btn-primary" id="manual-save-btn">${t('action.save')}</button>
          <button class="btn btn-ghost"   id="manual-cancel-btn">${t('action.cancel')}</button>
        </div>
      </div>
    </div>`;

  // Wire persistent event listeners (delegated on stable elements)
  document.getElementById('att-panel-close')?.addEventListener('click', _closeAttPanel);
  document.getElementById('att-overlay')?.addEventListener('click', _closeAttPanel);
  document.getElementById('att-filter-btn')?.addEventListener('click', _fetchAttRecords);
  document.getElementById('att-search')?.addEventListener('input', function() {
    _attPage = 1; _applyAttSearch(this.value.trim().toLowerCase());
  });
  document.getElementById('att-add-manual-btn')?.addEventListener('click', _openManualModal);
  document.getElementById('manual-cancel-btn')?.addEventListener('click', _closeManualModal);
  document.getElementById('manual-modal-close')?.addEventListener('click', _closeManualModal);
  document.getElementById('manual-save-btn')?.addEventListener('click', _saveManualRecord);

  // Click any row → open panel
  document.getElementById('att-tbody')?.addEventListener('click', function(e) {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const rec = _attAllRecords.find(function(r) { return r.id === row.dataset.id; });
    if (rec) _openAttPanel(rec);
  });

  // Fetch employees + locations in parallel before the first records fetch
  const [empRes, locRes] = await Promise.all([
    apiGetAllEmployees().catch(function() { return null; }),
    apiGetLocations().catch(function() { return null; }),
  ]);

  _attEmployees = empRes?.data?.employees || [];
  const locData  = locRes?.data?.locations || locRes?.data || [];
  _attLocations  = Array.isArray(locData) ? locData : [];

  // Populate employee dropdown
  const empSel = document.getElementById('att-emp-filter');
  if (empSel && _attEmployees.length) {
    _attEmployees
      .filter(function(e) { return String(e.active || '').toUpperCase() !== 'FALSE'; })
      .sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); })
      .forEach(function(e) {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = e.name + (e.department ? ' — ' + e.department : '');
        empSel.appendChild(opt);
      });
  }

  // Initial records fetch
  await _fetchAttRecords();
}

window.renderAttendanceRecords = renderAttendanceRecords;

// Fetch records from server using current filter bar values
async function _fetchAttRecords() {
  const empId    = document.getElementById('att-emp-filter')?.value  || null;
  const dateFrom = document.getElementById('att-date-from')?.value   || null;
  const dateTo   = document.getElementById('att-date-to')?.value     || null;

  const tbody = document.getElementById('att-tbody');
  if (tbody) tbody.innerHTML = _skeletonTableRows(8, 7);

  const res = await apiGetAllAttendance(empId || null, dateFrom, dateTo);
  _attAllRecords = (res?.status === 'ok' && Array.isArray(res.data?.records))
    ? res.data.records : [];

  _attPage = 1;
  const searchEl = document.getElementById('att-search');
  _applyAttSearch(searchEl ? searchEl.value.trim().toLowerCase() : '');
}

// Filter the in-memory record set then re-render table
function _applyAttSearch(query) {
  _attFiltered = query
    ? _attAllRecords.filter(function(r) {
        return (r.employee_name || '').toLowerCase().includes(query) ||
               (r.department    || '').toLowerCase().includes(query) ||
               (r.status        || '').toLowerCase().includes(query);
      })
    : _attAllRecords.slice();

  _renderAttTable();
  _renderAttPagination();
}

function _renderAttTable() {
  const tbody = document.getElementById('att-tbody');
  if (!tbody) return;

  const start = (_attPage - 1) * _ATT_PGS;
  const page  = _attFiltered.slice(start, start + _ATT_PGS);

  const countEl = document.getElementById('att-count');
  if (countEl) countEl.textContent = _attFiltered.length;

  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:var(--sp-8);color:var(--c-text-muted)">${t('attendance.no_records')}</td></tr>`;
    return;
  }

  tbody.innerHTML = page.map(_attRow).join('');
}

function _attRow(rec) {
  const status   = (rec.status || '').toLowerCase();
  const badgeMap = {
    present: 'badge-present', late: 'badge-late',
    absent:  'badge-absent',  leave: 'badge-leave', on_leave: 'badge-leave',
  };
  const labelMap = {
    present:  t('status.present'), late: t('status.late'),
    absent:   t('status.absent'),  leave: t('status.on_leave'), on_leave: t('status.on_leave'),
  };

  // Biometric verified column: ✓ green | exempt label | empty
  const bioVerified = String(rec.biometric_verified || '').toUpperCase() === 'TRUE';
  const bioExempt   = String(rec.biometric_method   || '') === 'exempt';
  const bioCell     = bioVerified
    ? `<span style="color:var(--c-present);font-weight:var(--fw-semi)">✓</span>`
    : bioExempt
    ? `<span style="color:var(--c-text-muted);font-size:var(--text-xs)">${t('employees.biometric_exempt').slice(0,3)}</span>`
    : '';

  // Device mismatch: small warning flag
  const devMismatch = String(rec.device_match || '').toUpperCase() === 'FALSE' && rec.device_id;
  const devFlag     = devMismatch
    ? ` <span class="device-mismatch-flag" title="${t('attendance.flagged')}">⚠</span>`
    : '';

  return `
    <tr data-id="${_esc(rec.id)}">
      <td>
        <span>${_esc(rec.employee_name || rec.employee_id || '—')}</span>${devFlag}
        ${rec.department ? `<br><span style="font-size:var(--text-xs);color:var(--c-text-muted)">${_esc(rec.department)}</span>` : ''}
      </td>
      <td style="white-space:nowrap">${_esc(_fmtDate(rec.date))}</td>
      <td style="font-variant-numeric:tabular-nums;white-space:nowrap">${rec.check_in ? _esc(_fmtTime(rec.check_in)) : '—'}</td>
      <td style="font-variant-numeric:tabular-nums;white-space:nowrap">${rec.check_out ? _esc(_fmtTime(rec.check_out)) : '—'}</td>
      <td style="font-variant-numeric:tabular-nums">${rec.hours_worked ? _esc(String(rec.hours_worked)) : '—'}</td>
      <td><span class="badge ${badgeMap[status] || ''}">${labelMap[status] || _esc(status)}</span></td>
      <td style="text-align:center">${bioCell}</td>
    </tr>`;
}

function _renderAttPagination() {
  const bar = document.getElementById('att-pagination');
  if (!bar) return;

  const total    = _attFiltered.length;
  const pages    = Math.ceil(total / _ATT_PGS);
  const start    = (_attPage - 1) * _ATT_PGS + 1;
  const end      = Math.min(_attPage * _ATT_PGS, total);

  if (pages <= 1) { bar.hidden = true; return; }
  bar.hidden = false;

  bar.innerHTML = `
    <span class="pagination-info">${start}–${end} / ${total}</span>
    <div class="pagination-controls">
      <button class="pagination-btn" id="att-pg-prev" ${_attPage <= 1 ? 'disabled' : ''}>
        ‹ ${t('action.back')}
      </button>
      <button class="pagination-btn" id="att-pg-next" ${_attPage >= pages ? 'disabled' : ''}>
        ${t('action.filter')} ›
      </button>
    </div>`;

  document.getElementById('att-pg-prev')?.addEventListener('click', function() {
    if (_attPage > 1) { _attPage--; _renderAttTable(); _renderAttPagination(); }
  });
  document.getElementById('att-pg-next')?.addEventListener('click', function() {
    if (_attPage < pages) { _attPage++; _renderAttTable(); _renderAttPagination(); }
  });
}

// ── Slide panel ──────────────────────────────────────────────────────────────

function _openAttPanel(record) {
  _attSelRecord = record;
  const panel   = document.getElementById('att-panel');
  const overlay = document.getElementById('att-overlay');
  if (!panel || !overlay) return;

  document.getElementById('att-panel-bd').innerHTML = _renderRecordDetail(record);

  // Wire correct button inside the panel (rendered fresh each open)
  document.getElementById('att-correct-btn')?.addEventListener('click', function() {
    document.getElementById('att-panel-bd').innerHTML = _renderCorrectionForm(record);
    document.getElementById('att-panel-title').textContent = t('attendance.correct');
    document.getElementById('att-correction-cancel')?.addEventListener('click', function() {
      _openAttPanel(record);
    });
    document.getElementById('att-correction-save')?.addEventListener('click', function() {
      _saveCorrectionForm(record);
    });
  });

  _rewireDeleteBtn(record);

  overlay.classList.add('overlay-visible');
  panel.classList.add('panel-open');
  document.getElementById('att-panel-title').textContent = t('attendance.title');
  panel.focus?.();
}

function _closeAttPanel() {
  const panel   = document.getElementById('att-panel');
  const overlay = document.getElementById('att-overlay');
  if (panel)   panel.classList.remove('panel-open');
  if (overlay) overlay.classList.remove('overlay-visible');
  _attSelRecord = null;
}

// Wire the delete button in the detail panel.
// First click shows inline confirmation; confirm fires the API call.
function _rewireDeleteBtn(record) {
  const deleteBtn = document.getElementById('att-delete-btn');
  if (!deleteBtn) return;

  deleteBtn.addEventListener('click', function onDeleteClick() {
    deleteBtn.removeEventListener('click', onDeleteClick);

    const actions = deleteBtn.closest('.detail-actions');
    if (!actions) return;

    actions.innerHTML = `
      <span style="font-size:var(--text-sm);color:var(--c-absent);flex:1">
        ${t('attendance.delete_confirm') || 'Delete this record permanently?'}
      </span>
      <button class="btn btn-danger btn-sm" id="att-delete-confirm">
        ${t('action.confirm') || 'Confirm'}
      </button>
      <button class="btn btn-ghost btn-sm" id="att-delete-cancel">
        ${t('action.cancel') || 'Cancel'}
      </button>`;

    document.getElementById('att-delete-cancel')?.addEventListener('click', function() {
      // Re-open the panel to restore all buttons and listeners cleanly
      _openAttPanel(record);
    });

    document.getElementById('att-delete-confirm')?.addEventListener('click', async function() {
      const btn = document.getElementById('att-delete-confirm');
      if (btn) { btn.disabled = true; btn.textContent = t('action.loading') || '…'; }

      const res = await apiDeleteAttendance(record.id);
      if (res?.status === 'ok') {
        _closeAttPanel();
        if (typeof showToast === 'function') showToast(t('attendance.deleted') || 'Record deleted', 'success');
        await _fetchAttRecords();
      } else {
        if (btn) { btn.disabled = false; btn.textContent = t('action.confirm') || 'Confirm'; }
        if (typeof showToast === 'function') showToast(res?.message || t('error.server'), 'error');
      }
    });
  }, { once: false });
}

function _renderRecordDetail(rec) {
  const status   = (rec.status || '').toLowerCase();
  const badgeMap = {
    present: 'badge-present', late: 'badge-late',
    absent:  'badge-absent',  leave: 'badge-leave', on_leave: 'badge-leave',
  };
  const labelMap = {
    present:  t('status.present'), late: t('status.late'),
    absent:   t('status.absent'),  leave: t('status.on_leave'), on_leave: t('status.on_leave'),
  };

  const devMismatch = String(rec.device_match || '').toUpperCase() === 'FALSE' && rec.device_id;
  const initials    = _initials(rec.employee_name || '');

  return `
    <div class="detail-emp-hd">
      <div class="detail-avatar">${_esc(initials)}</div>
      <div>
        <div class="detail-emp-name">${_esc(rec.employee_name || rec.employee_id || '—')}</div>
        ${rec.department ? `<div class="detail-emp-dept">${_esc(rec.department)}</div>` : ''}
      </div>
    </div>

    <div class="detail-fields">
      <div class="detail-field">
        <span class="detail-field-label">${t('attendance.date')}</span>
        <span class="detail-field-value">${_esc(_fmtDate(rec.date))}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${t('attendance.check_in')}</span>
        <span class="detail-field-value">${rec.check_in ? _esc(_fmtTime(rec.check_in)) : '—'}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${t('attendance.check_out')}</span>
        <span class="detail-field-value">${rec.check_out ? _esc(_fmtTime(rec.check_out)) : '—'}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${t('attendance.hours')}</span>
        <span class="detail-field-value">${rec.hours_worked ? _esc(String(rec.hours_worked)) : '—'}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${t('attendance.status')}</span>
        <span class="detail-field-value">
          <span class="badge ${badgeMap[status] || ''}">${labelMap[status] || _esc(status)}</span>
        </span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${t('attendance.location')}</span>
        <span class="detail-field-value">${_esc(rec.location_name || '—')}</span>
      </div>
    </div>

    <p class="detail-section-title">${t('biometric.prompt')}</p>
    <div class="detail-fields">
      <div class="detail-field">
        <span class="detail-field-label">${t('employees.biometric_exempt')}</span>
        <span class="detail-field-value">
          ${String(rec.biometric_verified || '').toUpperCase() === 'TRUE'
            ? `<span style="color:var(--c-present)">✓ ${t('status.approved')}</span>`
            : String(rec.biometric_method || '') === 'exempt'
            ? `<span style="color:var(--c-text-muted)">${t('employees.biometric_exempt')}</span>`
            : String(rec.biometric_method || '') === 'manual'
            ? `<span style="color:var(--c-text-muted)">${t('attendance.add_manual')}</span>`
            : '—'}
        </span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${t('attendance.flagged')}</span>
        <span class="detail-field-value">
          ${devMismatch
            ? `<span class="device-mismatch-flag">⚠ ${t('attendance.flagged')}</span>`
            : `<span style="color:var(--c-text-muted)">—</span>`}
        </span>
      </div>
    </div>

    ${rec.notes ? `
    <p class="detail-section-title">${t('attendance.notes')}</p>
    <p style="font-size:var(--text-sm);color:var(--c-text)">${_esc(rec.notes)}</p>` : ''}

    ${rec.corrected_by ? `
    <p class="detail-section-title">${t('attendance.corrected_by')}</p>
    <p style="font-size:var(--text-sm);color:var(--c-text-secondary)">${_esc(rec.corrected_at || '')}</p>` : ''}

    <div class="detail-actions">
      <button class="btn btn-secondary btn-sm" id="att-correct-btn">
        ✎ ${t('attendance.correct')}
      </button>
      <button class="btn btn-danger btn-sm" id="att-delete-btn" style="margin-inline-start:auto">
        ${t('action.delete') || 'Delete'}
      </button>
    </div>`;
}

function _renderCorrectionForm(rec) {
  const statusOptions = ['present', 'late', 'absent', 'on_leave'].map(function(s) {
    const labels = {
      present: t('status.present'), late: t('status.late'),
      absent:  t('status.absent'),  on_leave: t('status.on_leave'),
    };
    const sel = (rec.status || '').toLowerCase() === s ? ' selected' : '';
    return `<option value="${s}"${sel}>${labels[s]}</option>`;
  }).join('');

  return `
    <div class="panel-form">
      <p class="panel-form-title">${t('attendance.correct')}</p>

      <div class="form-row">
        <div class="form-group">
          <label for="corr-ci">${t('attendance.check_in')}</label>
          <input type="time" id="corr-ci" value="${_esc(rec.check_in || '')}">
        </div>
        <div class="form-group">
          <label for="corr-co">${t('attendance.check_out')}</label>
          <input type="time" id="corr-co" value="${_esc(rec.check_out || '')}">
        </div>
      </div>

      <div class="form-group">
        <label for="corr-status">${t('attendance.status')}</label>
        <select id="corr-status">${statusOptions}</select>
      </div>

      <div class="form-group">
        <label for="corr-note">
          ${t('attendance.hr_note')}<span class="form-required">*</span>
        </label>
        <textarea id="corr-note" placeholder="${t('attendance.hr_note')}"
                  rows="3"></textarea>
        <span class="form-field-error" id="corr-note-err" hidden></span>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary btn-sm" id="att-correction-save">
          ${t('action.save')}
        </button>
        <button class="btn btn-ghost btn-sm" id="att-correction-cancel">
          ${t('action.cancel')}
        </button>
      </div>
    </div>`;
}

async function _saveCorrectionForm(rec) {
  const noteEl  = document.getElementById('corr-note');
  const noteErr = document.getElementById('corr-note-err');
  const hrNote  = (noteEl?.value || '').trim();

  if (!hrNote) {
    if (noteErr) { noteErr.textContent = t('error.required_field'); noteErr.hidden = false; }
    noteEl?.focus();
    return;
  }
  if (noteErr) noteErr.hidden = true;

  const saveBtn = document.getElementById('att-correction-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = t('action.loading'); }

  const corrections = {
    check_in:  document.getElementById('corr-ci')?.value     || undefined,
    check_out: document.getElementById('corr-co')?.value     || undefined,
    status:    document.getElementById('corr-status')?.value || undefined,
  };
  // Remove empty strings (not sent when clearing a time field is intentional)
  for (const k in corrections) { if (!corrections[k]) delete corrections[k]; }

  const res = await apiCorrectAttendance(rec.id, corrections, hrNote);

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('action.save'); }

  if (res?.status !== 'ok') {
    if (noteErr) { noteErr.textContent = res?.message || t('error.server'); noteErr.hidden = false; }
    return;
  }

  _closeAttPanel();
  await _fetchAttRecords();
}

// ── Manual record modal ──────────────────────────────────────────────────────

function _openManualModal() {
  const bd = document.getElementById('manual-modal-bd');
  if (!bd) return;

  if (_attEmployees.length === 0) {
    showToast(t('error.server') || 'Employee list not loaded. Please reload the page.', 'error');
    return;
  }

  const empOptions = _attEmployees
    .filter(function(e) { return String(e.active || '').toUpperCase() !== 'FALSE'; })
    .sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); })
    .map(function(e) {
      return `<option value="${_esc(e.id)}">${_esc(e.name)}${e.department ? ' — ' + _esc(e.department) : ''}</option>`;
    }).join('');

  const locOptions = _attLocations
    .filter(function(l) { return String(l.active || '').toUpperCase() !== 'FALSE'; })
    .map(function(l) {
      return `<option value="${_esc(l.id)}">${_esc(l.name)}</option>`;
    }).join('');

  bd.innerHTML = `
    <div class="form-group">
      <label for="manual-emp">
        ${t('attendance.employee')}<span class="form-required">*</span>
      </label>
      <select id="manual-emp">
        <option value="">— ${t('attendance.filter_employee')} —</option>
        ${empOptions}
      </select>
      <span class="form-field-error" id="manual-emp-err" hidden></span>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="manual-date">
          ${t('attendance.date')}<span class="form-required">*</span>
        </label>
        <input type="date" id="manual-date" value="${_esc(_isoToday())}">
      </div>
      <div class="form-group">
        <label for="manual-loc">${t('attendance.location')}</label>
        <select id="manual-loc">
          <option value="">—</option>
          ${locOptions}
        </select>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="manual-ci">
          ${t('attendance.check_in')}<span class="form-required">*</span>
        </label>
        <input type="time" id="manual-ci" value="${_nowTimeHHMM()}">
        <span class="form-field-error" id="manual-ci-err" hidden></span>
      </div>
      <div class="form-group">
        <label for="manual-co">${t('attendance.check_out')}</label>
        <input type="time" id="manual-co">
      </div>
    </div>

    <div class="form-group">
      <label for="manual-note">
        ${t('attendance.hr_note')}<span class="form-required">*</span>
      </label>
      <textarea id="manual-note" rows="3"
                placeholder="${t('attendance.hr_note')}"></textarea>
      <span class="form-field-error" id="manual-note-err" hidden></span>
    </div>`;

  const overlay = document.getElementById('manual-overlay');
  if (overlay) overlay.hidden = false;
}

function _closeManualModal() {
  const overlay = document.getElementById('manual-overlay');
  if (overlay) overlay.hidden = true;
}

async function _saveManualRecord() {
  const empId   = (document.getElementById('manual-emp')?.value   || '').trim();
  const date    = (document.getElementById('manual-date')?.value  || '').trim();
  const checkIn = (document.getElementById('manual-ci')?.value    || '').trim();
  const hrNote  = (document.getElementById('manual-note')?.value  || '').trim();

  const empErr  = document.getElementById('manual-emp-err');
  const ciErr   = document.getElementById('manual-ci-err');
  const noteErr = document.getElementById('manual-note-err');

  const _showErr = function(el, msg) { if (el) { el.textContent = msg; el.hidden = false; } };
  const _hideErr = function(el)      { if (el) el.hidden = true; };

  let valid = true;
  if (!empId)   { _showErr(empErr,  t('error.required_field')); valid = false; }
  else           { _hideErr(empErr); }
  if (!checkIn) { _showErr(ciErr,   t('error.required_field')); valid = false; }
  else           { _hideErr(ciErr); }
  if (!hrNote)  { _showErr(noteErr, t('error.required_field')); valid = false; }
  else           { _hideErr(noteErr); }

  if (!valid) {
    const firstInvalid = !empId   ? document.getElementById('manual-emp')
                       : !checkIn ? document.getElementById('manual-ci')
                                  : document.getElementById('manual-note');
    if (firstInvalid) firstInvalid.focus();
    return;
  }

  const saveBtn = document.getElementById('manual-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = t('action.loading'); }

  const checkOut   = (document.getElementById('manual-co')?.value   || '').trim();
  const locationId = (document.getElementById('manual-loc')?.value  || '').trim();

  const res = await apiAddManualAttendance(
    empId, date, checkIn, checkOut || null, locationId || null, hrNote
  );

  console.log('[Manual save] response:', res);

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('action.save'); }

  if (!res || res.status !== 'ok') {
    const errMsg = (res && res.message) || t('error.server');
    _showErr(noteErr, errMsg);
    showToast(errMsg, 'error');
    return;
  }

  _closeManualModal();
  showToast(t('attendance.manual_saved') || 'Record saved', 'success');
  await _fetchAttRecords();
}

// =============================================================================
// SHARED SCREEN HELPERS
// =============================================================================

// Return a date N days before today as YYYY-MM-DD
function _nDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// Format a stored "HH:MM" time string using i18n-aware formatTime from utils.js
function _fmtTime(hhmm) {
  if (!hhmm) return '—';
  try {
    return formatTime(new Date('2000-01-01T' + String(hhmm).padStart(5, '0') + ':00'));
  } catch (_) { return String(hhmm); }
}

// Format a stored "YYYY-MM-DD" date string using i18n-aware formatDate from utils.js
function _fmtDate(iso) {
  if (!iso) return '—';
  try {
    return formatDate(new Date(String(iso)));
  } catch (_) { return String(iso); }
}

// Two-char initials from a display name (first letter of each word, max 2)
function _initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(function(w) { return w[0]; })
    .join('')
    .toUpperCase() || '?';
}

// =============================================================================
// REPORTS SCREEN
// renderReports — monthly report generator: month picker + dept filter + download
// =============================================================================

async function renderReports(container) {
  const now          = new Date();
  const defaultMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  container.innerHTML = `
    <div class="view-content">
      <div class="view-header">
        <div>
          <h1 class="view-title">${t('reports.title')}</h1>
        </div>
      </div>

      <div class="card" style="padding:var(--sp-6);max-width:640px">
        <h2 style="font-size:var(--text-md);font-weight:var(--fw-semi);color:var(--c-text);
                   margin-block-end:var(--sp-1)">
          ${t('reports.monthly')}
        </h2>
        <p style="font-size:var(--text-sm);color:var(--c-text-secondary);
                  margin-block-end:var(--sp-5)">
          ${t('reports.col_name')} · ${t('reports.col_total_present')} · ${t('reports.col_total_hours')} …
        </p>

        <div class="form-row" style="margin-block-end:var(--sp-4)">
          <div class="form-group">
            <label for="rpt-month" class="field-label">
              ${t('reports.select_month')}<span class="form-required">*</span>
            </label>
            <input type="month" id="rpt-month" class="field-input"
                   value="${_esc(defaultMonth)}">
          </div>
          <div class="form-group">
            <label for="rpt-dept" class="field-label">
              ${t('reports.select_department')}
            </label>
            <select id="rpt-dept" class="field-input">
              <option value="">${t('reports.all_departments')}</option>
            </select>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary" id="rpt-generate-btn">
            ↓ ${t('reports.generate')}
          </button>
        </div>

        <div id="rpt-result" style="margin-block-start:var(--sp-4)" hidden></div>
      </div>
    </div>`;

  // Populate department dropdown
  const deptRes = await apiGetDepartments().catch(function() { return null; });
  const depts   = deptRes?.data?.departments || [];
  const deptSel = document.getElementById('rpt-dept');
  if (deptSel && depts.length) {
    depts
      .sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); })
      .forEach(function(d) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        deptSel.appendChild(opt);
      });
  }

  document.getElementById('rpt-generate-btn')
    ?.addEventListener('click', _handleGenerateReport);
}

window.renderReports = renderReports;

async function _handleGenerateReport() {
  const monthInput = document.getElementById('rpt-month');
  const deptInput  = document.getElementById('rpt-dept');
  const btn        = document.getElementById('rpt-generate-btn');
  const resultEl   = document.getElementById('rpt-result');

  if (!monthInput?.value) {
    if (resultEl) {
      resultEl.hidden = false;
      resultEl.innerHTML = `<p class="form-field-error">${t('error.required_field')}</p>`;
    }
    monthInput?.focus();
    return;
  }

  const parts = monthInput.value.split('-');
  const year  = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const deptId = (deptInput?.value || '').trim() || null;

  if (btn) {
    btn.disabled    = true;
    btn.textContent = t('reports.generating');
  }
  if (resultEl) resultEl.hidden = true;

  const res = await apiGetReportData(year, month, deptId);

  if (btn) {
    btn.disabled    = false;
    btn.textContent = '↓ ' + t('reports.generate');
  }

  if (res?.status !== 'ok') {
    if (resultEl) {
      resultEl.hidden  = false;
      resultEl.innerHTML = `<p class="form-field-error">${_esc(res?.message || t('error.server'))}</p>`;
    }
    return;
  }

  const data = res.data;
  if (!data.employees || data.employees.length === 0) {
    if (resultEl) {
      resultEl.hidden   = false;
      resultEl.innerHTML = `<p style="font-size:var(--text-sm);color:var(--c-text-muted)">${t('reports.no_data')}</p>`;
    }
    return;
  }

  // Trigger XLSX download — report.js handles the rest
  try {
    generateReport(data, year, month);
    if (resultEl) {
      resultEl.hidden = false;
      resultEl.innerHTML = `
        <p style="font-size:var(--text-sm);color:var(--c-present);font-weight:var(--fw-medium)">
          ✓ ${t('reports.download')} — LMP_Attendance_${year}_${String(month).padStart(2,'0')}.xlsx
        </p>`;
    }
  } catch (e) {
    if (resultEl) {
      resultEl.hidden   = false;
      resultEl.innerHTML = `<p class="form-field-error">${t('error.server')}</p>`;
    }
    console.error('[renderReports] generateReport threw:', e);
  }
}

// =============================================================================
// SKELETON TABLE ROWS (shared utility)
// =============================================================================

// Skeleton table rows while data loads
function _skeletonTableRows(numRows, numCols) {
  const cellW = ['40%', '18%', '14%', '14%', '10%', '12%', '6%'];
  return Array.from({ length: numRows }, function() {
    const cells = Array.from({ length: numCols }, function(_, i) {
      return `<td><div class="skeleton" style="height:13px;width:${cellW[i] || '60%'};border-radius:4px"></div></td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
}

// =============================================================================
// EMPLOYEES SCREEN
// =============================================================================

let _empAllRecords = [], _empFiltered = [], _empPage = 1;
const _EMP_PGS = 25;
let _empShifts = [], _empDepts = [], _empManagers = [];
let _empDeactTarget = null;
let _empBiometricTarget = null;

async function renderEmployees(container) {
  container.innerHTML = `
    <div class="view-content">
    <div class="view-hd">
      <h1 class="view-title">${t('employees.title')}</h1>
    </div>
    <div class="data-table-wrap">
      <div class="table-toolbar" id="emp-toolbar">
        <input id="emp-search" type="search" class="table-toolbar-search"
          placeholder="${t('employees.search')}" autocomplete="off">
        <div class="table-toolbar-actions">
          <span class="count-badge" id="emp-count">—</span>
          <button id="emp-add-btn" class="btn btn-primary btn-sm">+ ${t('employees.add')}</button>
        </div>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>${t('employees.name')}</th>
          <th>${t('employees.username')}</th>
          <th>${t('employees.role')}</th>
          <th>${t('employees.department')}</th>
          <th>${t('employees.shift')}</th>
          <th>${t('employees.status')}</th>
          <th>${t('employees.biometric_exempt')}</th>
        </tr></thead>
        <tbody id="emp-tbody">${_skeletonTableRows(10, 7)}</tbody>
      </table>
      <div id="emp-pagination" class="pagination-bar" hidden></div>
    </div>

    <div class="panel-overlay" id="emp-overlay"></div>
    <div class="slide-panel" id="emp-panel" role="dialog" aria-modal="true">
      <div class="slide-panel-hd">
        <span class="slide-panel-title" id="emp-panel-title"></span>
        <button class="btn-icon" id="emp-panel-close" aria-label="${t('action.close')}">✕</button>
      </div>
      <div class="slide-panel-bd" id="emp-panel-bd"></div>
    </div>

    <div class="modal-overlay" id="emp-deact-modal" hidden>
      <div class="modal" role="alertdialog" aria-modal="true">
        <div class="modal-hd">
          <span class="modal-title">${t('employees.deactivate')}</span>
          <button class="btn-icon" id="emp-deact-x" aria-label="${t('action.close')}">✕</button>
        </div>
        <div class="modal-bd">
          <p style="font-size:var(--text-sm);color:var(--c-text)">${t('employees.deactivate_confirm')}</p>
        </div>
        <div class="modal-ft">
          <button class="btn btn-danger btn-sm" id="emp-deact-confirm">${t('action.confirm')}</button>
          <button class="btn btn-ghost btn-sm" id="emp-deact-cancel">${t('action.cancel')}</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="emp-biometric-modal" hidden>
      <div class="modal" role="alertdialog" aria-modal="true">
        <div class="modal-hd">
          <span class="modal-title">${t('employees.reset_biometric')}</span>
          <button class="btn-icon" id="emp-biometric-x" aria-label="${t('action.close')}">✕</button>
        </div>
        <div class="modal-bd">
          <p style="font-size:var(--text-sm);color:var(--c-text)">${t('employees.reset_biometric_confirm')}</p>
        </div>
        <div class="modal-ft">
          <button class="btn btn-danger btn-sm" id="emp-biometric-confirm">${t('action.confirm')}</button>
          <button class="btn btn-ghost btn-sm" id="emp-biometric-cancel">${t('action.cancel')}</button>
        </div>
      </div>
    </div>
    </div>
  `;

  document.getElementById('emp-search').addEventListener('input', function(e) {
    _applyEmpFilter(e.target.value);
  });
  document.getElementById('emp-add-btn').addEventListener('click', function() { _openEmpPanel(null); });
  document.getElementById('emp-panel-close').addEventListener('click', _closeEmpPanel);
  document.getElementById('emp-overlay').addEventListener('click', _closeEmpPanel);
  document.getElementById('emp-deact-x').addEventListener('click', function() {
    document.getElementById('emp-deact-modal').hidden = true;
  });
  document.getElementById('emp-deact-cancel').addEventListener('click', function() {
    document.getElementById('emp-deact-modal').hidden = true;
  });
  document.getElementById('emp-deact-confirm').addEventListener('click', function() {
    _executeDeactivate(_empDeactTarget);
  });
  document.getElementById('emp-biometric-x').addEventListener('click', function() {
    document.getElementById('emp-biometric-modal').hidden = true;
  });
  document.getElementById('emp-biometric-cancel').addEventListener('click', function() {
    document.getElementById('emp-biometric-modal').hidden = true;
  });
  document.getElementById('emp-biometric-confirm').addEventListener('click', function() {
    _executeResetBiometric(_empBiometricTarget);
  });

  const [empRes, shiftRes, deptRes] = await Promise.all([
    apiGetAllEmployees(), apiGetShifts(), apiGetDepartments()
  ]);

  _empShifts  = shiftRes?.data?.shifts      || [];
  _empDepts   = deptRes?.data?.departments  || [];

  if (empRes?.status === 'ok') {
    _empAllRecords = empRes.data.employees || [];
    _empManagers   = _empAllRecords.filter(function(e) {
      return String(e.role || '').toLowerCase() === 'manager' &&
             String(e.active || '').toUpperCase() !== 'FALSE';
    });
    _empFiltered = _empAllRecords.slice();
    _empPage = 1;
    _renderEmpTable();
    _renderEmpPagination();
  } else {
    document.getElementById('emp-tbody').innerHTML =
      `<tr><td colspan="7" class="table-empty">${t('employees.no_employees')}</td></tr>`;
  }
}
window.renderEmployees = renderEmployees;

function _applyEmpFilter(query) {
  const q = String(query || '').toLowerCase().trim();
  _empFiltered = q
    ? _empAllRecords.filter(function(e) {
        return String(e.name       || '').toLowerCase().includes(q) ||
               String(e.username   || '').toLowerCase().includes(q) ||
               String(e.department || '').toLowerCase().includes(q);
      })
    : _empAllRecords.slice();
  _empPage = 1;
  _renderEmpTable();
  _renderEmpPagination();
}

function _renderEmpTable() {
  const tbody  = document.getElementById('emp-tbody');
  const paginEl = document.getElementById('emp-pagination');
  if (!tbody) return;

  const countEl = document.getElementById('emp-count');
  if (countEl) countEl.textContent = _empFiltered.length;

  const shiftMap = {};
  _empShifts.forEach(function(s) { shiftMap[s.id] = s.name; });

  if (_empFiltered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${t('employees.no_employees')}</td></tr>`;
    if (paginEl) paginEl.hidden = true;
    return;
  }

  const start    = (_empPage - 1) * _EMP_PGS;
  const pageData = _empFiltered.slice(start, start + _EMP_PGS);

  tbody.innerHTML = pageData.map(function(emp) {
    const isActive = String(emp.active || '').toUpperCase() !== 'FALSE';
    const rowCls   = isActive ? 'table-row-click' : 'table-row-click row-inactive';
    const bioEx    = String(emp.biometric_exempt || '').toUpperCase() === 'TRUE';
    return `<tr class="${rowCls}" data-emp-id="${_esc(emp.id)}">
      <td>
        <div style="display:flex;align-items:center;gap:var(--sp-2)">
          <div class="detail-avatar" style="width:28px;height:28px;font-size:10px;flex-shrink:0">${_initials(emp.name)}</div>
          <span style="font-weight:var(--fw-medium)">${_esc(emp.name || '')}</span>
        </div>
      </td>
      <td dir="ltr" style="color:var(--c-text-secondary)">${_esc(emp.username || '')}</td>
      <td>${_empRoleBadge(emp.role)}</td>
      <td>${_esc(emp.department || '—')}</td>
      <td>${_esc(shiftMap[emp.shift_id] || '—')}</td>
      <td>${_empStatusBadge(emp.active)}</td>
      <td>${bioEx
        ? `<span class="badge" style="background:var(--c-primary-dim);color:var(--c-primary);font-size:10px">${t('employees.biometric_exempt')}</span>`
        : `<span style="color:var(--c-text-muted);font-size:var(--text-xs)">—</span>`
      }</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-emp-id]').forEach(function(row) {
    row.addEventListener('click', function() {
      const id  = row.getAttribute('data-emp-id');
      const emp = _empAllRecords.find(function(e) { return e.id === id; });
      if (emp) _openEmpPanel(emp);
    });
  });
}

function _renderEmpPagination() {
  const el = document.getElementById('emp-pagination');
  if (!el) return;
  const total = _empFiltered.length;
  const pages = Math.ceil(total / _EMP_PGS);
  if (pages <= 1) { el.hidden = true; return; }
  el.hidden = false;
  const start = (_empPage - 1) * _EMP_PGS + 1;
  const end   = Math.min(_empPage * _EMP_PGS, total);
  el.innerHTML = `
    <span class="pagination-info">${start}–${end} ${t('date.from').toLowerCase()} ${total}</span>
    <div class="pagination-controls">
      <button class="pagination-btn" id="emp-prev" ${_empPage === 1 ? 'disabled' : ''}>‹</button>
      <button class="pagination-btn" id="emp-next" ${_empPage >= pages ? 'disabled' : ''}>›</button>
    </div>`;
  document.getElementById('emp-prev')?.addEventListener('click', function() {
    if (_empPage > 1) { _empPage--; _renderEmpTable(); _renderEmpPagination(); }
  });
  document.getElementById('emp-next')?.addEventListener('click', function() {
    if (_empPage < pages) { _empPage++; _renderEmpTable(); _renderEmpPagination(); }
  });
}

function _empStatusBadge(active) {
  return String(active || '').toUpperCase() !== 'FALSE'
    ? `<span class="badge badge-present">${t('status.active')}</span>`
    : `<span class="badge badge-absent">${t('status.inactive')}</span>`;
}

function _empRoleBadge(role) {
  const r = String(role || '').toLowerCase();
  // Solid navy — the brand sidebar colour, deliberately heavier than the tinted
  // role badges so the two executive accounts stand out in the employee table
  if (r === 'ceo' || r === 'md')
    return `<span class="badge" style="background:var(--c-navy);color:var(--c-text-inverse)">${t(r === 'ceo' ? 'employees.role_ceo' : 'employees.role_md')}</span>`;
  if (r === 'hr')
    return `<span class="badge" style="background:var(--c-primary-dim);color:var(--c-primary)">${t('employees.role_hr')}</span>`;
  if (r === 'manager')
    return `<span class="badge" style="background:rgba(217,119,6,.12);color:var(--c-late)">${t('employees.role_manager')}</span>`;
  return `<span class="badge" style="background:var(--c-surface-raised);color:var(--c-text-secondary)">${t('employees.role_employee')}</span>`;
}

function _openEmpPanel(emp) {
  document.getElementById('emp-overlay').classList.add('overlay-visible');
  document.getElementById('emp-panel').classList.add('panel-open');
  if (emp) {
    _renderEmpDetail(emp);
  } else {
    _renderEmpAddForm();
  }
}

function _closeEmpPanel() {
  document.getElementById('emp-panel')?.classList.remove('panel-open');
  document.getElementById('emp-overlay')?.classList.remove('overlay-visible');
  const modal = document.getElementById('emp-deact-modal');
  if (modal) modal.hidden = true;
  const bioModal = document.getElementById('emp-biometric-modal');
  if (bioModal) bioModal.hidden = true;
}

function _renderEmpDetail(emp) {
  const titleEl = document.getElementById('emp-panel-title');
  const bd      = document.getElementById('emp-panel-bd');
  if (!bd) return;
  titleEl.textContent = emp.name;

  const shiftMap = {};
  _empShifts.forEach(function(s) { shiftMap[s.id] = s.name; });
  const isActive    = String(emp.active || '').toUpperCase() !== 'FALSE';
  const bioEx       = String(emp.biometric_exempt || '').toUpperCase() === 'TRUE';
  const bioRegistered = !!String(emp.webauthn_credential_id || '').trim();

  bd.innerHTML = `
    <div class="detail-emp-hd">
      <div class="detail-avatar">${_initials(emp.name)}</div>
      <div>
        <div class="detail-emp-name">${_esc(emp.name)}</div>
        <div class="detail-emp-dept">${_esc(emp.department || '—')}</div>
      </div>
    </div>
    <div class="detail-fields">
      <div class="detail-field">
        <span class="detail-field-label">${t('employees.username')}</span>
        <span class="detail-field-value" dir="ltr">${_esc(emp.username || '')}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${t('employees.role')}</span>
        <span class="detail-field-value">${_empRoleBadge(emp.role)}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${t('employees.shift')}</span>
        <span class="detail-field-value">${_esc(shiftMap[emp.shift_id] || '—')}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${t('employees.status')}</span>
        <span class="detail-field-value">${_empStatusBadge(emp.active)}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${t('employees.biometric_exempt')}</span>
        <span class="detail-field-value">${bioEx ? t('status.active') : '—'}</span>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">${t('employees.biometric_registered')}</span>
        <span class="detail-field-value">${bioRegistered ? t('status.active') : '—'}</span>
      </div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-secondary btn-sm" id="emp-edit-btn">${t('action.edit')}</button>
      <button class="btn btn-secondary btn-sm" id="emp-resetpw-btn">${t('employees.reset_password')}</button>
      ${bioRegistered
        ? `<button class="btn btn-secondary btn-sm" id="emp-biometric-btn">${t('employees.reset_biometric')}</button>`
        : ''
      }
      ${isActive
        ? `<button class="btn btn-danger btn-sm" id="emp-deact-btn">${t('employees.deactivate')}</button>`
        : `<button class="btn btn-primary btn-sm" id="emp-react-btn">${t('employees.reactivate')}</button>`
      }
    </div>`;

  document.getElementById('emp-edit-btn')?.addEventListener('click', function() {
    _renderEmpEditForm(emp);
  });
  document.getElementById('emp-resetpw-btn')?.addEventListener('click', function() {
    _renderEmpResetPwForm(emp);
  });
  document.getElementById('emp-biometric-btn')?.addEventListener('click', function() {
    _empBiometricTarget = emp.id;
    document.getElementById('emp-biometric-modal').hidden = false;
  });
  document.getElementById('emp-deact-btn')?.addEventListener('click', function() {
    _empDeactTarget = emp.id;
    document.getElementById('emp-deact-modal').hidden = false;
  });
  document.getElementById('emp-react-btn')?.addEventListener('click', function() {
    _executeReactivate(emp.id);
  });
}

function _renderEmpEditForm(emp) {
  const titleEl = document.getElementById('emp-panel-title');
  const bd      = document.getElementById('emp-panel-bd');
  titleEl.textContent = t('employees.edit');

  const shiftOpts = `<option value="">—</option>` +
    _empShifts.map(function(s) {
      return `<option value="${_esc(s.id)}" ${emp.shift_id === s.id ? 'selected' : ''}>${_esc(s.name)}</option>`;
    }).join('');

  const deptOpts = `<option value="">—</option>` +
    _empDepts.map(function(d) {
      return `<option value="${_esc(d.name)}" ${emp.department === d.name ? 'selected' : ''}>${_esc(d.name)}</option>`;
    }).join('');

  const mgrOpts = `<option value="">—</option>` +
    _empManagers.filter(function(m) { return m.id !== emp.id; }).map(function(m) {
      return `<option value="${_esc(m.id)}" ${emp.manager_id === m.id ? 'selected' : ''}>${_esc(m.name)}</option>`;
    }).join('');

  bd.innerHTML = `
    <div class="panel-form">
      <div class="form-group">
        <label>${t('employees.name')} <span class="form-required">*</span></label>
        <input id="emp-f-name" type="text" class="input" value="${_esc(emp.name || '')}">
      </div>
      <div class="form-group">
        <label>${t('employees.username')} <span class="form-required">*</span></label>
        <input id="emp-f-username" type="text" class="input" dir="ltr" autocomplete="off"
          value="${_esc(emp.username || '')}">
      </div>
      <div class="form-group">
        <label>${t('employees.role')}</label>
        <select id="emp-f-role" class="table-toolbar-select" style="max-width:unset">
          <option value="employee" ${emp.role === 'employee' ? 'selected' : ''}>${t('employees.role_employee')}</option>
          <option value="manager"  ${emp.role === 'manager'  ? 'selected' : ''}>${t('employees.role_manager')}</option>
          <option value="hr"       ${emp.role === 'hr'       ? 'selected' : ''}>${t('employees.role_hr')}</option>
          <option value="ceo"      ${emp.role === 'ceo'      ? 'selected' : ''}>${t('employees.role_ceo')}</option>
          <option value="md"       ${emp.role === 'md'       ? 'selected' : ''}>${t('employees.role_md')}</option>
        </select>
      </div>
      <div class="form-group">
        <label>${t('employees.department')}</label>
        <select id="emp-f-dept" class="table-toolbar-select" style="max-width:unset">${deptOpts}</select>
      </div>
      <div class="form-group">
        <label>${t('employees.shift')}</label>
        <select id="emp-f-shift" class="table-toolbar-select" style="max-width:unset">${shiftOpts}</select>
      </div>
      <div class="form-group">
        <label>${t('employees.manager')}</label>
        <select id="emp-f-mgr" class="table-toolbar-select" style="max-width:unset">${mgrOpts}</select>
      </div>
      <div class="form-group">
        <label class="wd-check-label" style="border:none;padding:0;gap:var(--sp-2)">
          <input type="checkbox" id="emp-f-bioexempt"
            ${String(emp.biometric_exempt || '').toUpperCase() === 'TRUE' ? 'checked' : ''}>
          ${t('employees.biometric_exempt')}
        </label>
      </div>
      <div class="form-group">
        <label>${t('employees.new_password_label')}</label>
        <input id="emp-f-newpw" type="text" class="input" dir="ltr" autocomplete="off"
          placeholder="${t('change_pw.req_length')}">
      </div>
      <div class="form-group">
        <label class="wd-check-label" style="border:none;padding:0;gap:var(--sp-2)">
          <input type="checkbox" id="emp-f-force-change" checked>
          ${t('employees.reset_pw_force')}
        </label>
      </div>
      <p id="emp-edit-err" class="form-field-error" hidden></p>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" id="emp-save-edit">${t('action.save')}</button>
        <button class="btn btn-ghost btn-sm" id="emp-back-btn">${t('action.back')}</button>
      </div>
    </div>`;

  document.getElementById('emp-save-edit').addEventListener('click', function() { _saveEmpEdit(emp); });
  document.getElementById('emp-back-btn').addEventListener('click', function() { _renderEmpDetail(emp); });
}

function _renderEmpResetPwForm(emp) {
  const titleEl = document.getElementById('emp-panel-title');
  const bd      = document.getElementById('emp-panel-bd');
  titleEl.textContent = t('employees.reset_password');

  bd.innerHTML = `
    <div class="detail-emp-hd">
      <div class="detail-avatar">${_initials(emp.name)}</div>
      <div>
        <div class="detail-emp-name">${_esc(emp.name)}</div>
        <div class="detail-emp-dept" dir="ltr">${_esc(emp.username || '')}</div>
      </div>
    </div>
    <div class="panel-form">
      <div class="form-group">
        <label>${t('employees.reset_pw_label')} <span class="form-required">*</span></label>
        <input id="emp-new-pw" type="text" class="input" dir="ltr" autocomplete="off"
          placeholder="${t('change_pw.req_length')}">
      </div>
      <div class="form-group">
        <label class="wd-check-label" style="border:none;padding:0;gap:var(--sp-2)">
          <input type="checkbox" id="emp-force-change" checked>
          ${t('employees.reset_pw_force')}
        </label>
      </div>
      <p id="emp-resetpw-err" class="form-field-error" hidden></p>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" id="emp-resetpw-save">${t('employees.reset_pw_confirm')}</button>
        <button class="btn btn-ghost btn-sm" id="emp-resetpw-back">${t('action.back')}</button>
      </div>
    </div>`;

  document.getElementById('emp-resetpw-back').addEventListener('click', function() {
    _renderEmpDetail(emp);
  });

  document.getElementById('emp-resetpw-save').addEventListener('click', async function() {
    const btn     = document.getElementById('emp-resetpw-save');
    const errEl   = document.getElementById('emp-resetpw-err');
    const newPw   = (document.getElementById('emp-new-pw')?.value || '').trim();
    const force   = document.getElementById('emp-force-change')?.checked !== false;

    errEl.hidden = true;

    if (newPw.length < 4) {
      errEl.textContent = t('error.pw_too_short');
      errEl.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = t('action.loading');

    try {
      const hash = await hashPassword(newPw);
      const res  = await apiHrResetPassword(emp.id, hash, force);
      if (res?.status === 'ok') {
        showToast(t('employees.reset_pw_success'), 'success');
        _renderEmpDetail(emp);
      } else {
        errEl.textContent = res?.message || t('error.server');
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = t('employees.reset_pw_confirm');
      }
    } catch (_) {
      errEl.textContent = t('error.network');
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = t('employees.reset_pw_confirm');
    }
  });
}

function _renderEmpAddForm() {
  const titleEl = document.getElementById('emp-panel-title');
  const bd      = document.getElementById('emp-panel-bd');
  titleEl.textContent = t('employees.add');

  const shiftOpts = `<option value="">—</option>` +
    _empShifts.map(function(s) {
      return `<option value="${_esc(s.id)}">${_esc(s.name)}</option>`;
    }).join('');

  const deptOpts = `<option value="">—</option>` +
    _empDepts.map(function(d) {
      return `<option value="${_esc(d.name)}">${_esc(d.name)}</option>`;
    }).join('');

  const mgrOpts = `<option value="">—</option>` +
    _empManagers.map(function(m) {
      return `<option value="${_esc(m.id)}">${_esc(m.name)}</option>`;
    }).join('');

  bd.innerHTML = `
    <div class="panel-form">
      <div class="form-group">
        <label>${t('employees.name')} <span class="form-required">*</span></label>
        <input id="emp-f-name" type="text" class="input">
      </div>
      <div class="form-group">
        <label>${t('employees.username')} <span class="form-required">*</span></label>
        <input id="emp-f-username" type="text" class="input" dir="ltr" autocomplete="off">
      </div>
      <div class="form-group">
        <label>${t('employees.temp_password')} <span class="form-required">*</span></label>
        <input id="emp-f-pw" type="text" class="input" dir="ltr" autocomplete="off"
          placeholder="${t('change_pw.req_length')}">
      </div>
      <div class="form-group">
        <label>${t('employees.role')}</label>
        <select id="emp-f-role" class="table-toolbar-select" style="max-width:unset">
          <option value="employee">${t('employees.role_employee')}</option>
          <option value="manager">${t('employees.role_manager')}</option>
          <option value="hr">${t('employees.role_hr')}</option>
          <option value="ceo">${t('employees.role_ceo')}</option>
          <option value="md">${t('employees.role_md')}</option>
        </select>
      </div>
      <div class="form-group">
        <label>${t('employees.department')}</label>
        <select id="emp-f-dept" class="table-toolbar-select" style="max-width:unset">${deptOpts}</select>
      </div>
      <div class="form-group">
        <label>${t('employees.shift')}</label>
        <select id="emp-f-shift" class="table-toolbar-select" style="max-width:unset">${shiftOpts}</select>
      </div>
      <div class="form-group">
        <label>${t('employees.manager')}</label>
        <select id="emp-f-mgr" class="table-toolbar-select" style="max-width:unset">${mgrOpts}</select>
      </div>
      <div class="form-group">
        <label class="wd-check-label" style="border:none;padding:0;gap:var(--sp-2)">
          <input type="checkbox" id="emp-f-bioexempt">
          ${t('employees.biometric_exempt')}
        </label>
      </div>
      <p id="emp-add-err" class="form-field-error" hidden></p>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" id="emp-save-add">${t('employees.add')}</button>
        <button class="btn btn-ghost btn-sm" id="emp-add-cancel">${t('action.cancel')}</button>
      </div>
    </div>`;

  document.getElementById('emp-save-add').addEventListener('click', _saveEmpAdd);
  document.getElementById('emp-add-cancel').addEventListener('click', _closeEmpPanel);
}

async function _saveEmpAdd() {
  const name     = (document.getElementById('emp-f-name')?.value     || '').trim();
  const username = (document.getElementById('emp-f-username')?.value  || '').trim().toLowerCase();
  const tempPw   = (document.getElementById('emp-f-pw')?.value        || '').trim();
  const role     = document.getElementById('emp-f-role')?.value       || 'employee';
  const dept     = document.getElementById('emp-f-dept')?.value       || '';
  const shiftId  = document.getElementById('emp-f-shift')?.value      || '';
  const mgrId    = document.getElementById('emp-f-mgr')?.value        || '';
  const bioEx    = document.getElementById('emp-f-bioexempt')?.checked ? 'TRUE' : 'FALSE';
  const errEl    = document.getElementById('emp-add-err');

  if (!name || !username || !tempPw) {
    if (errEl) { errEl.hidden = false; errEl.textContent = t('error.required_field'); }
    return;
  }
  if (tempPw.length < 4) {
    if (errEl) { errEl.hidden = false; errEl.textContent = t('error.pw_too_short'); }
    return;
  }
  if (errEl) errEl.hidden = true;

  const btn = document.getElementById('emp-save-add');
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const res = await apiAddEmployee({
    name, username, temp_password: tempPw,
    role, department: dept, shift_id: shiftId, manager_id: mgrId, biometric_exempt: bioEx
  });

  if (btn) { btn.disabled = false; btn.textContent = t('employees.add'); }

  if (res?.status === 'ok') {
    _closeEmpPanel();
    await _fetchEmployees();
  } else {
    if (errEl) { errEl.hidden = false; errEl.textContent = res?.message || t('error.server'); }
  }
}

async function _saveEmpEdit(emp) {
  const name     = (document.getElementById('emp-f-name')?.value     || '').trim();
  const username = (document.getElementById('emp-f-username')?.value || '').trim().toLowerCase();
  const role     = document.getElementById('emp-f-role')?.value      || 'employee';
  const dept     = document.getElementById('emp-f-dept')?.value      || '';
  const shiftId  = document.getElementById('emp-f-shift')?.value     || '';
  const mgrId    = document.getElementById('emp-f-mgr')?.value       || '';
  const bioEx    = document.getElementById('emp-f-bioexempt')?.checked ? 'TRUE' : 'FALSE';
  const newPw    = (document.getElementById('emp-f-newpw')?.value    || '').trim();
  const force    = document.getElementById('emp-f-force-change')?.checked !== false;
  const errEl    = document.getElementById('emp-edit-err');

  if (!name || !username) {
    if (errEl) { errEl.hidden = false; errEl.textContent = t('error.required_field'); }
    return;
  }
  if (newPw && newPw.length < 4) {
    if (errEl) { errEl.hidden = false; errEl.textContent = t('error.pw_too_short'); }
    return;
  }
  if (errEl) errEl.hidden = true;

  const btn = document.getElementById('emp-save-edit');
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const updates = {
    name, username, role, department: dept, shift_id: shiftId, manager_id: mgrId, biometric_exempt: bioEx
  };
  if (newPw) {
    updates.new_password_hash = await hashPassword(newPw);
    updates.force_password_change = force ? 'TRUE' : 'FALSE';
  }

  const res = await apiUpdateEmployee(emp.id, updates);

  if (btn) { btn.disabled = false; btn.textContent = t('action.save'); }

  if (res?.status === 'ok') {
    _closeEmpPanel();
    await _fetchEmployees();
  } else {
    if (errEl) { errEl.hidden = false; errEl.textContent = res?.message || t('error.server'); }
  }
}

async function _executeDeactivate(empId) {
  if (!empId) return;
  document.getElementById('emp-deact-modal').hidden = true;
  const res = await apiDeactivateEmployee(empId);
  if (res?.status === 'ok') {
    _closeEmpPanel();
    await _fetchEmployees();
  }
}

async function _executeReactivate(empId) {
  const res = await apiReactivateEmployee(empId);
  if (res?.status === 'ok') {
    _closeEmpPanel();
    await _fetchEmployees();
  }
}

async function _executeResetBiometric(empId) {
  if (!empId) return;
  document.getElementById('emp-biometric-modal').hidden = true;
  const res = await apiHrResetBiometric(empId);
  if (res?.status === 'ok') {
    showToast(t('employees.reset_biometric_success'), 'success');
    _closeEmpPanel();
    await _fetchEmployees();
  } else {
    showToast(res?.message || t('error.server'), 'error');
  }
}

async function _fetchEmployees() {
  const res = await apiGetAllEmployees();
  if (res?.status === 'ok') {
    _empAllRecords = res.data.employees || [];
    _empManagers   = _empAllRecords.filter(function(e) {
      return String(e.role || '').toLowerCase() === 'manager' &&
             String(e.active || '').toUpperCase() !== 'FALSE';
    });
    const q = document.getElementById('emp-search')?.value || '';
    _applyEmpFilter(q);
  }
}

// =============================================================================
// LOCATIONS SCREEN
// =============================================================================

let _locAllRecords = [];
let _locMap        = null;
let _locPickerMap  = null;
let _locPickerMkr  = null;

async function renderLocations(container) {
  container.innerHTML = `
    <div class="view-content">
    <div class="view-hd">
      <h1 class="view-title">${t('locations.title')}</h1>
      <button id="loc-add-btn" class="btn btn-primary btn-sm">+ ${t('locations.add')}</button>
    </div>
    <div class="loc-map-wrap"><div id="loc-map" class="loc-map"></div></div>
    <div class="data-table-wrap">
      <div class="table-toolbar">
        <span class="count-badge" id="loc-count-badge"></span>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>${t('locations.name')}</th>
          <th>${t('locations.lat')}</th>
          <th>${t('locations.lng')}</th>
          <th>${t('locations.radius')}</th>
          <th>${t('attendance.status')}</th>
          <th></th>
        </tr></thead>
        <tbody id="loc-tbody">${_skeletonTableRows(4, 6)}</tbody>
      </table>
    </div>

    <div class="panel-overlay" id="loc-overlay"></div>
    <div class="slide-panel" id="loc-panel" role="dialog" aria-modal="true">
      <div class="slide-panel-hd">
        <span class="slide-panel-title" id="loc-panel-title"></span>
        <button class="btn-icon" id="loc-panel-close" aria-label="${t('action.close')}">✕</button>
      </div>
      <div class="slide-panel-bd" id="loc-panel-bd"></div>
    </div>
    </div>`;

  document.getElementById('loc-add-btn').addEventListener('click', function() { _openLocPanel(null); });
  document.getElementById('loc-panel-close').addEventListener('click', _closeLocPanel);
  document.getElementById('loc-overlay').addEventListener('click', _closeLocPanel);

  const res = await apiGetLocations();
  _locAllRecords = res?.data?.locations || [];
  _renderLocTable(_locAllRecords);
  _initLocMainMap(document.getElementById('loc-map'), _locAllRecords);
}
window.renderLocations = renderLocations;

function _initLocMainMap(mapEl, locations) {
  if (_locMap) { try { _locMap.remove(); } catch(e) {} _locMap = null; }
  if (!mapEl) return;

  let center = [24.7, 46.7]; // Riyadh default
  const first = locations.find(function(l) { return String(l.active).toUpperCase() === 'TRUE'; }) || locations[0];
  if (first) {
    const lat = parseFloat(first.lat), lng = parseFloat(first.lng);
    if (!isNaN(lat) && !isNaN(lng)) center = [lat, lng];
  }

  _locMap = L.map(mapEl, { zoomControl: true }).setView(center, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  }).addTo(_locMap);

  locations.forEach(function(loc) {
    const lat = parseFloat(loc.lat), lng = parseFloat(loc.lng);
    if (isNaN(lat) || isNaN(lng)) return;
    const active = String(loc.active || '').toUpperCase() === 'TRUE';
    const color  = active ? '#1d4ed8' : '#94a3b8';
    L.circle([lat, lng], { radius: Number(loc.radius_m) || 150, color, fillOpacity: 0.15, weight: 2 }).addTo(_locMap);
    const mkr = L.marker([lat, lng]).addTo(_locMap);
    mkr.bindPopup(`<strong>${_esc(loc.name)}</strong><br>${t('locations.radius')}: ${loc.radius_m || 150} m`);
    mkr.on('click', function() { _openLocPanel(loc); });
  });

  setTimeout(function() { if (_locMap) _locMap.invalidateSize(); }, 120);
}

function _renderLocTable(locations) {
  const tbody   = document.getElementById('loc-tbody');
  const countEl = document.getElementById('loc-count-badge');
  if (!tbody) return;
  if (countEl) countEl.textContent = locations.length;

  if (locations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">${t('locations.no_locations')}</td></tr>`;
    return;
  }

  tbody.innerHTML = locations.map(function(loc) {
    const active = String(loc.active || '').toUpperCase() === 'TRUE';
    const lat    = parseFloat(loc.lat), lng = parseFloat(loc.lng);
    return `<tr class="table-row-click" data-loc-id="${_esc(loc.id)}">
      <td style="font-weight:var(--fw-medium)">${_esc(loc.name || '')}</td>
      <td dir="ltr" style="font-variant-numeric:tabular-nums">${isNaN(lat) ? '—' : lat.toFixed(5)}</td>
      <td dir="ltr" style="font-variant-numeric:tabular-nums">${isNaN(lng) ? '—' : lng.toFixed(5)}</td>
      <td dir="ltr">${_esc(String(loc.radius_m || '150'))} m</td>
      <td>${active
        ? `<span class="badge badge-present">${t('locations.active')}</span>`
        : `<span class="badge badge-absent">${t('locations.inactive')}</span>`
      }</td>
      <td><button class="btn btn-ghost btn-sm" data-edit-loc="${_esc(loc.id)}">${t('action.edit')}</button></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-edit-loc]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const id  = btn.getAttribute('data-edit-loc');
      const loc = _locAllRecords.find(function(l) { return l.id === id; });
      if (loc) _openLocPanel(loc);
    });
  });

  tbody.querySelectorAll('tr[data-loc-id]').forEach(function(row) {
    row.addEventListener('click', function(e) {
      if (e.target.closest('[data-edit-loc]')) return;
      const id  = row.getAttribute('data-loc-id');
      const loc = _locAllRecords.find(function(l) { return l.id === id; });
      if (loc) _openLocPanel(loc);
    });
  });
}

function _openLocPanel(loc) {
  document.getElementById('loc-overlay').classList.add('overlay-visible');
  document.getElementById('loc-panel').classList.add('panel-open');
  document.getElementById('loc-panel-title').textContent = loc ? t('locations.edit') : t('locations.add');
  if (loc) {
    _renderLocEditForm(loc);
  } else {
    _renderLocAddForm();
  }
}

function _closeLocPanel() {
  if (_locPickerMap) { try { _locPickerMap.remove(); } catch(e) {} _locPickerMap = null; _locPickerMkr = null; }
  document.getElementById('loc-panel')?.classList.remove('panel-open');
  document.getElementById('loc-overlay')?.classList.remove('overlay-visible');
}

function _renderLocAddForm() {
  document.getElementById('loc-panel-bd').innerHTML = `
    <div class="panel-form">
      <p style="font-size:var(--text-xs);color:var(--c-text-muted);margin-block-end:var(--sp-2)">${t('locations.picker_hint')}</p>
      <div id="loc-picker-map" class="loc-picker-map"></div>
      <div class="form-group">
        <label>${t('locations.name')} <span class="form-required">*</span></label>
        <input id="loc-f-name" type="text" class="input">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${t('locations.lat')}</label>
          <input id="loc-f-lat" type="number" step="any" class="input" dir="ltr" placeholder="24.7000">
        </div>
        <div class="form-group">
          <label>${t('locations.lng')}</label>
          <input id="loc-f-lng" type="number" step="any" class="input" dir="ltr" placeholder="46.7000">
        </div>
      </div>
      <div class="form-group">
        <label>${t('locations.radius')}</label>
        <input id="loc-f-radius" type="number" min="10" max="10000" value="150" class="input" dir="ltr">
      </div>
      <p id="loc-form-err" class="form-field-error" hidden></p>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" id="loc-save-btn">${t('action.save')}</button>
        <button class="btn btn-ghost btn-sm" id="loc-cancel-btn">${t('action.cancel')}</button>
      </div>
    </div>`;

  document.getElementById('loc-save-btn').addEventListener('click', _saveLocAdd);
  document.getElementById('loc-cancel-btn').addEventListener('click', _closeLocPanel);
  requestAnimationFrame(function() { _initLocPickerMap(null); });
}

function _renderLocEditForm(loc) {
  document.getElementById('loc-panel-bd').innerHTML = `
    <div class="panel-form">
      <div id="loc-picker-map" class="loc-picker-map"></div>
      <div class="form-group">
        <label>${t('locations.name')} <span class="form-required">*</span></label>
        <input id="loc-f-name" type="text" class="input" value="${_esc(loc.name || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${t('locations.lat')}</label>
          <input id="loc-f-lat" type="number" step="any" class="input" dir="ltr"
            value="${_esc(String(loc.lat || ''))}">
        </div>
        <div class="form-group">
          <label>${t('locations.lng')}</label>
          <input id="loc-f-lng" type="number" step="any" class="input" dir="ltr"
            value="${_esc(String(loc.lng || ''))}">
        </div>
      </div>
      <div class="form-group">
        <label>${t('locations.radius')}</label>
        <input id="loc-f-radius" type="number" min="10" max="10000" class="input" dir="ltr"
          value="${_esc(String(loc.radius_m || '150'))}">
      </div>
      <p id="loc-form-err" class="form-field-error" hidden></p>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" id="loc-save-btn">${t('action.save')}</button>
        <button class="btn btn-secondary btn-sm" id="loc-toggle-btn">
          ${String(loc.active || '').toUpperCase() === 'TRUE' ? t('action.deactivate') : t('action.reactivate')}
        </button>
        <button class="btn btn-ghost btn-sm" id="loc-cancel-btn">${t('action.cancel')}</button>
      </div>
    </div>`;

  document.getElementById('loc-save-btn').addEventListener('click', function() { _saveLocEdit(loc); });
  document.getElementById('loc-toggle-btn').addEventListener('click', function() { _toggleLoc(loc.id); });
  document.getElementById('loc-cancel-btn').addEventListener('click', _closeLocPanel);
  requestAnimationFrame(function() { _initLocPickerMap(loc); });
}

function _initLocPickerMap(existingLoc) {
  const el = document.getElementById('loc-picker-map');
  if (!el) return;
  if (_locPickerMap) { try { _locPickerMap.remove(); } catch(e) {} _locPickerMap = null; _locPickerMkr = null; }

  let center = [24.7, 46.7];
  if (existingLoc) {
    const lat = parseFloat(existingLoc.lat), lng = parseFloat(existingLoc.lng);
    if (!isNaN(lat) && !isNaN(lng)) center = [lat, lng];
  }

  _locPickerMap = L.map(el, { attributionControl: false }).setView(center, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(_locPickerMap);

  if (existingLoc) {
    _locPickerMkr = L.marker(center, { draggable: true }).addTo(_locPickerMap);
    _locPickerMkr.on('dragend', _syncPickerCoords);
  }

  _locPickerMap.on('click', function(e) {
    if (_locPickerMkr) _locPickerMap.removeLayer(_locPickerMkr);
    _locPickerMkr = L.marker([e.latlng.lat, e.latlng.lng], { draggable: true }).addTo(_locPickerMap);
    _locPickerMkr.on('dragend', _syncPickerCoords);
    _syncPickerCoords();
  });

  setTimeout(function() { if (_locPickerMap) _locPickerMap.invalidateSize(); }, 150);
}

function _syncPickerCoords() {
  if (!_locPickerMkr) return;
  const ll   = _locPickerMkr.getLatLng();
  const latEl = document.getElementById('loc-f-lat');
  const lngEl = document.getElementById('loc-f-lng');
  if (latEl) latEl.value = ll.lat.toFixed(6);
  if (lngEl) lngEl.value = ll.lng.toFixed(6);
}

async function _saveLocAdd() {
  const name   = (document.getElementById('loc-f-name')?.value   || '').trim();
  const lat    = parseFloat(document.getElementById('loc-f-lat')?.value  || '');
  const lng    = parseFloat(document.getElementById('loc-f-lng')?.value  || '');
  const radius = Number(document.getElementById('loc-f-radius')?.value   || '') || 150;
  const errEl  = document.getElementById('loc-form-err');

  if (!name) { if (errEl) { errEl.hidden = false; errEl.textContent = t('error.required_field'); } return; }
  if (isNaN(lat) || isNaN(lng)) {
    if (errEl) { errEl.hidden = false; errEl.textContent = t('locations.coords_required'); }
    return;
  }
  if (errEl) errEl.hidden = true;

  const btn = document.getElementById('loc-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const res = await apiAddLocation(name, lat, lng, radius);
  if (btn) { btn.disabled = false; btn.textContent = t('action.save'); }

  if (res?.status === 'ok') {
    _closeLocPanel();
    await _refreshLocations();
  } else {
    if (errEl) { errEl.hidden = false; errEl.textContent = res?.message || t('error.server'); }
  }
}

async function _saveLocEdit(loc) {
  const name   = (document.getElementById('loc-f-name')?.value   || '').trim();
  const lat    = parseFloat(document.getElementById('loc-f-lat')?.value  || '');
  const lng    = parseFloat(document.getElementById('loc-f-lng')?.value  || '');
  const radius = Number(document.getElementById('loc-f-radius')?.value   || '') || 150;
  const errEl  = document.getElementById('loc-form-err');

  if (!name) { if (errEl) { errEl.hidden = false; errEl.textContent = t('error.required_field'); } return; }
  if (isNaN(lat) || isNaN(lng)) {
    if (errEl) { errEl.hidden = false; errEl.textContent = t('locations.coords_required'); }
    return;
  }
  if (errEl) errEl.hidden = true;

  const btn = document.getElementById('loc-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const res = await apiUpdateLocation(loc.id, { name, lat, lng, radius_m: radius });
  if (btn) { btn.disabled = false; btn.textContent = t('action.save'); }

  if (res?.status === 'ok') {
    _closeLocPanel();
    await _refreshLocations();
  } else {
    if (errEl) { errEl.hidden = false; errEl.textContent = res?.message || t('error.server'); }
  }
}

async function _toggleLoc(locId) {
  const res = await apiToggleLocation(locId);
  if (res?.status === 'ok') {
    _closeLocPanel();
    await _refreshLocations();
  }
}

async function _refreshLocations() {
  const res2 = await apiGetLocations();
  _locAllRecords = res2?.data?.locations || [];
  _renderLocTable(_locAllRecords);
  _initLocMainMap(document.getElementById('loc-map'), _locAllRecords);
}

// =============================================================================
// HOLIDAYS SCREEN
// =============================================================================

let _holYear        = new Date().getFullYear();
let _holAllRecords  = [];

async function renderHolidays(container) {
  _holYear = new Date().getFullYear();

  container.innerHTML = `
    <div class="view-content">
    <div class="view-hd">
      <h1 class="view-title">${t('holidays.title')}</h1>
    </div>
    <div class="cal-year-nav">
      <button class="btn-icon" id="hol-prev-yr" aria-label="${t('action.back')}">‹</button>
      <span class="cal-year-label" id="hol-yr-label">${_holYear}</span>
      <button class="btn-icon" id="hol-next-yr" aria-label="">›</button>
    </div>
    <div id="hol-cal-wrap"></div>

    <div class="modal-overlay" id="hol-modal" hidden>
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-hd">
          <span class="modal-title" id="hol-modal-title"></span>
          <button class="btn-icon" id="hol-modal-x" aria-label="${t('action.close')}">✕</button>
        </div>
        <div class="modal-bd" id="hol-modal-bd"></div>
        <div class="modal-ft" id="hol-modal-ft"></div>
      </div>
    </div>
    </div>`;

  document.getElementById('hol-prev-yr').addEventListener('click', async function() {
    _holYear--;
    document.getElementById('hol-yr-label').textContent = _holYear;
    await _loadHolidays();
  });
  document.getElementById('hol-next-yr').addEventListener('click', async function() {
    _holYear++;
    document.getElementById('hol-yr-label').textContent = _holYear;
    await _loadHolidays();
  });
  document.getElementById('hol-modal-x').addEventListener('click', function() {
    document.getElementById('hol-modal').hidden = true;
  });

  await _loadHolidays();
}
window.renderHolidays = renderHolidays;

async function _loadHolidays() {
  const res = await apiGetHolidays(_holYear);
  const all = res?.data?.holidays || [];
  const yrStr = String(_holYear);
  _holAllRecords = all.filter(function(h) { return String(h.date || '').startsWith(yrStr); });

  const wrap = document.getElementById('hol-cal-wrap');
  if (wrap) wrap.innerHTML = _buildCalGrid(_holYear, _holAllRecords);

  document.querySelectorAll('.cal-day[data-date]').forEach(function(el) {
    el.addEventListener('click', function() {
      const dateStr  = el.getAttribute('data-date');
      const existing = _holAllRecords.find(function(h) { return h.date === dateStr; });
      _openHolModal(dateStr, existing || null);
    });
  });
}

function _buildCalGrid(year, holidays) {
  const holidayMap = {};
  holidays.forEach(function(h) { holidayMap[h.date] = h; });

  const lang      = localStorage.getItem('lmp_lang') || 'ar';
  const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                     'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const EN_MONTHS = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
  const MONTHS    = lang === 'ar' ? AR_MONTHS : EN_MONTHS;

  const DAY_HDRS = [
    t('date.sun'), t('date.mon'), t('date.tue'),
    t('date.wed'), t('date.thu'), t('date.fri'), t('date.sat')
  ];

  const todayStr = new Date().toISOString().slice(0, 10);
  let html = '<div class="cal-grid">';

  for (var m = 0; m < 12; m++) {
    const firstDow   = new Date(year, m, 1).getDay();
    const daysInMon  = new Date(year, m + 1, 0).getDate();
    const mm         = String(m + 1).padStart(2, '0');

    html += `<div class="cal-month-block">
      <div class="cal-month-name">${MONTHS[m]}</div>
      <div class="cal-days-grid">`;

    DAY_HDRS.forEach(function(dn) {
      html += `<div class="cal-day-name">${dn.slice(0, 2)}</div>`;
    });

    for (var i = 0; i < firstDow; i++) {
      html += `<div class="cal-day cal-day--empty"></div>`;
    }

    for (var d = 1; d <= daysInMon; d++) {
      const dd     = String(d).padStart(2, '0');
      const dStr   = `${year}-${mm}-${dd}`;
      const isHol  = !!holidayMap[dStr];
      const isTod  = dStr === todayStr;
      let cls = 'cal-day';
      if (isHol) cls += ' cal-day--holiday';
      if (isTod) cls += ' cal-day--today';
      const title = isHol ? _esc(holidayMap[dStr].name) : '';
      html += `<div class="${cls}" data-date="${dStr}" title="${title}">${d}</div>`;
    }

    html += `</div></div>`;
  }

  return html + '</div>';
}

function _openHolModal(dateStr, existing) {
  const modal   = document.getElementById('hol-modal');
  const titleEl = document.getElementById('hol-modal-title');
  const bdEl    = document.getElementById('hol-modal-bd');
  const ftEl    = document.getElementById('hol-modal-ft');

  titleEl.textContent = _fmtDate(dateStr);

  if (existing) {
    bdEl.innerHTML = `
      <div class="form-group">
        <p style="font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--c-text)">${_esc(existing.name)}</p>
      </div>`;
    ftEl.innerHTML = `
      <button class="btn btn-danger btn-sm" id="hol-del-btn">${t('action.delete')}</button>
      <button class="btn btn-ghost btn-sm" id="hol-close-btn">${t('action.close')}</button>`;
    document.getElementById('hol-del-btn').addEventListener('click', function() {
      _deleteHolAndRefresh(existing.id);
    });
    document.getElementById('hol-close-btn').addEventListener('click', function() {
      modal.hidden = true;
    });
  } else {
    titleEl.textContent = `${t('holidays.add')} — ${_fmtDate(dateStr)}`;
    bdEl.innerHTML = `
      <div class="form-group">
        <label>${t('holidays.name')} <span class="form-required">*</span></label>
        <input id="hol-f-name" type="text" class="input">
      </div>
      <p id="hol-form-err" class="form-field-error" hidden></p>`;
    ftEl.innerHTML = `
      <button class="btn btn-primary btn-sm" id="hol-save-btn">${t('action.save')}</button>
      <button class="btn btn-ghost btn-sm" id="hol-cancel-btn">${t('action.cancel')}</button>`;
    document.getElementById('hol-save-btn').addEventListener('click', function() {
      _saveHolAndRefresh(dateStr);
    });
    document.getElementById('hol-cancel-btn').addEventListener('click', function() {
      modal.hidden = true;
    });
    setTimeout(function() { document.getElementById('hol-f-name')?.focus(); }, 60);
  }

  modal.hidden = false;
}

async function _saveHolAndRefresh(dateStr) {
  const name  = (document.getElementById('hol-f-name')?.value || '').trim();
  const errEl = document.getElementById('hol-form-err');
  if (!name) { if (errEl) { errEl.hidden = false; errEl.textContent = t('error.required_field'); } return; }
  if (errEl) errEl.hidden = true;

  const btn = document.getElementById('hol-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const res = await apiAddHoliday(dateStr, name);
  if (res?.status === 'ok') {
    document.getElementById('hol-modal').hidden = true;
    await _loadHolidays();
  } else {
    if (errEl) { errEl.hidden = false; errEl.textContent = res?.message || t('error.server'); }
    if (btn) { btn.disabled = false; btn.textContent = t('action.save'); }
  }
}

async function _deleteHolAndRefresh(holidayId) {
  const res = await apiDeleteHoliday(holidayId);
  if (res?.status === 'ok') {
    document.getElementById('hol-modal').hidden = true;
    await _loadHolidays();
  }
}

// =============================================================================
// CONFIG SCREEN
// =============================================================================

async function renderConfig(container) {
  container.innerHTML = `
    <div class="view-content">
    <div class="view-hd">
      <h1 class="view-title">${t('config.title')}</h1>
    </div>
    <div id="cfg-wrap">
      <p style="color:var(--c-text-muted);font-size:var(--text-sm)">${t('action.loading')}</p>
    </div>
    </div>`;

  const cfg = (typeof getConfig === 'function') ? getConfig() : {};
  _renderConfigForm(cfg);
}
window.renderConfig = renderConfig;

function _renderConfigForm(cfg) {
  const wrap = document.getElementById('cfg-wrap');
  if (!wrap) return;

  const wd = String(cfg.working_days || '0,1,2,3,4').split(',').map(function(s) { return parseInt(s.trim(), 10); });
  const DAY_MAP = [
    [0, t('date.sun')], [1, t('date.mon')], [2, t('date.tue')],
    [3, t('date.wed')], [4, t('date.thu')], [5, t('date.fri')], [6, t('date.sat')]
  ];

  const wdChecks = DAY_MAP.map(function(pair) {
    return `<label class="wd-check-label">
      <input type="checkbox" class="cfg-wd-check" value="${pair[0]}" ${wd.includes(pair[0]) ? 'checked' : ''}>
      ${_esc(pair[1])}
    </label>`;
  }).join('');

  const autoChk  = String(cfg.auto_checkout_enabled  || '').toUpperCase() === 'TRUE' ? 'checked' : '';
  const syncChk  = String(cfg.offline_sync_enabled   || '').toUpperCase() !== 'FALSE' ? 'checked' : '';
  const bioChk   = String(cfg.biometric_required     || '').toUpperCase() !== 'FALSE' ? 'checked' : '';
  const langEn   = String(cfg.primary_language       || '') === 'en';

  wrap.innerHTML = `
    <div class="config-form">

      <div class="config-section">
        <div class="config-section-title">${t('config.company_name')}</div>
        <div class="form-row">
          <div class="form-group">
            <label>${t('config.app_name')}</label>
            <input id="cfg-app-name" type="text" class="input" value="${_esc(cfg.app_name || '')}">
          </div>
          <div class="form-group">
            <label>${t('config.company_name')}</label>
            <input id="cfg-company" type="text" class="input" value="${_esc(cfg.company_name || '')}">
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-title">${t('nav.attendance')}</div>
        <div class="form-row">
          <div class="form-group">
            <label>${t('config.geofence_radius')}</label>
            <input id="cfg-geofence" type="number" min="50" max="5000" class="input" dir="ltr"
              value="${_esc(String(cfg.geofence_radius_m || '150'))}">
          </div>
          <div class="form-group">
            <label>${t('config.late_threshold')}</label>
            <input id="cfg-late" type="number" min="0" max="120" class="input" dir="ltr"
              value="${_esc(String(cfg.late_threshold_min || '15'))}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>${t('config.gps_accuracy_max')}</label>
            <input id="cfg-gps-acc" type="number" min="10" max="500" class="input" dir="ltr"
              value="${_esc(String(cfg.gps_accuracy_max_m || '200'))}">
          </div>
          <div class="form-group">
            <label>${t('config.session_expiry')}</label>
            <input id="cfg-session" type="number" min="1" max="24" class="input" dir="ltr"
              value="${_esc(String(cfg.session_expiry_hours || '8'))}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>${t('config.annual_leave_days')}</label>
            <input id="cfg-annual-leave" type="number" min="0" max="60" class="input" dir="ltr"
              value="${_esc(String(cfg.annual_leave_days || '21'))}">
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-title">${t('config.working_days')}</div>
        <div class="wd-checkboxes">${wdChecks}</div>
      </div>

      <div class="config-section">
        <div class="config-section-title">${t('config.primary_language')}</div>
        <div class="form-group">
          <select id="cfg-lang" class="table-toolbar-select" style="max-width:unset">
            <option value="ar" ${langEn ? '' : 'selected'}>العربية</option>
            <option value="en" ${langEn ? 'selected' : ''}>English</option>
          </select>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-title">${t('config.auto_checkout')}</div>
        <div class="cfg-toggles">
          <div class="cfg-toggle-row">
            <span class="cfg-toggle-label">${t('config.auto_checkout')}</span>
            <label class="toggle-switch">
              <input type="checkbox" id="cfg-auto-checkout" ${autoChk}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="cfg-toggle-row">
            <span class="cfg-toggle-label">${t('config.offline_sync')}</span>
            <label class="toggle-switch">
              <input type="checkbox" id="cfg-offline-sync" ${syncChk}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="cfg-toggle-row">
            <span class="cfg-toggle-label">${t('config.biometric_required')}</span>
            <label class="toggle-switch">
              <input type="checkbox" id="cfg-biometric-req" ${bioChk}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <p id="cfg-msg" class="form-field-error" style="display:none"></p>
      <div style="padding-block-start:var(--sp-2)">
        <button class="btn btn-primary" id="cfg-save-btn">${t('config.save')}</button>
      </div>
    </div>`;

  document.getElementById('cfg-save-btn').addEventListener('click', _saveConfig);
}

async function _saveConfig() {
  const wdVals = Array.from(document.querySelectorAll('.cfg-wd-check:checked')).map(function(c) {
    return c.value;
  });

  const updates = {
    app_name:              (document.getElementById('cfg-app-name')?.value   || '').trim(),
    company_name:          (document.getElementById('cfg-company')?.value    || '').trim(),
    geofence_radius_m:     document.getElementById('cfg-geofence')?.value    || '150',
    late_threshold_min:    document.getElementById('cfg-late')?.value        || '15',
    gps_accuracy_max_m:    document.getElementById('cfg-gps-acc')?.value     || '200',
    session_expiry_hours:  document.getElementById('cfg-session')?.value     || '8',
    annual_leave_days:     document.getElementById('cfg-annual-leave')?.value || '21',
    primary_language:      document.getElementById('cfg-lang')?.value        || 'ar',
    working_days:          wdVals.join(','),
    auto_checkout_enabled: document.getElementById('cfg-auto-checkout')?.checked  ? 'TRUE' : 'FALSE',
    offline_sync_enabled:  document.getElementById('cfg-offline-sync')?.checked   ? 'TRUE' : 'FALSE',
    biometric_required:    document.getElementById('cfg-biometric-req')?.checked  ? 'TRUE' : 'FALSE'
  };

  const btn   = document.getElementById('cfg-save-btn');
  const msgEl = document.getElementById('cfg-msg');
  if (btn)   { btn.disabled = true; btn.textContent = t('action.loading'); }
  if (msgEl) { msgEl.style.display = 'none'; }

  const res = await apiUpdateConfig(updates);
  if (btn)   { btn.disabled = false; btn.textContent = t('config.save'); }

  if (res?.status === 'ok') {
    if (typeof setCachedConfig === 'function') {
      setCachedConfig(Object.assign({}, (typeof getConfig === 'function' ? getConfig() : {}), updates));
    }
    if (msgEl) {
      msgEl.style.cssText = 'display:block;color:var(--c-present);font-weight:var(--fw-medium)';
      msgEl.textContent = '✓ ' + t('action.save');
      setTimeout(function() { if (msgEl) msgEl.style.display = 'none'; }, 3000);
    }
  } else {
    if (msgEl) {
      msgEl.style.cssText = 'display:block;color:var(--c-absent)';
      msgEl.textContent = res?.message || t('error.server');
    }
  }
}

// =============================================================================
// DEPARTMENTS SCREEN
// =============================================================================

let _deptAllRecords = [];
let _deptShiftList  = [];

async function renderDepartments(container) {
  container.innerHTML = `
    <div class="view-content">
    <div class="view-hd">
      <h1 class="view-title">${t('departments.title')}</h1>
      <button id="dept-add-btn" class="btn btn-primary btn-sm">+ ${t('departments.add')}</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>${t('departments.name')}</th>
          <th>${t('departments.default_shift')}</th>
          <th>${t('departments.employee_count')}</th>
        </tr></thead>
        <tbody id="dept-tbody">${_skeletonTableRows(5, 3)}</tbody>
      </table>
    </div>

    <div class="panel-overlay" id="dept-overlay"></div>
    <div class="slide-panel" id="dept-panel" role="dialog" aria-modal="true">
      <div class="slide-panel-hd">
        <span class="slide-panel-title" id="dept-panel-title"></span>
        <button class="btn-icon" id="dept-panel-close" aria-label="${t('action.close')}">✕</button>
      </div>
      <div class="slide-panel-bd" id="dept-panel-bd"></div>
    </div>
    </div>`;

  document.getElementById('dept-add-btn').addEventListener('click', function() { _openDeptPanel(null); });
  document.getElementById('dept-panel-close').addEventListener('click', _closeDeptPanel);
  document.getElementById('dept-overlay').addEventListener('click', _closeDeptPanel);

  const [deptRes, shiftRes, empRes] = await Promise.all([
    apiGetDepartments(), apiGetShifts(), apiGetAllEmployees()
  ]);

  _deptAllRecords = deptRes?.data?.departments || [];
  _deptShiftList  = shiftRes?.data?.shifts     || [];
  const employees  = empRes?.data?.employees   || [];

  const empCountMap = {};
  employees.filter(function(e) {
    return String(e.active || '').toUpperCase() !== 'FALSE';
  }).forEach(function(e) {
    const dept = String(e.department || '');
    empCountMap[dept] = (empCountMap[dept] || 0) + 1;
  });

  _renderDeptTable(empCountMap);
}
window.renderDepartments = renderDepartments;

function _renderDeptTable(empCountMap) {
  const tbody = document.getElementById('dept-tbody');
  if (!tbody) return;

  if (_deptAllRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="table-empty">${t('departments.no_departments')}</td></tr>`;
    return;
  }

  const shiftMap = {};
  _deptShiftList.forEach(function(s) { shiftMap[s.id] = s.name; });

  tbody.innerHTML = _deptAllRecords.map(function(dept) {
    return `<tr class="table-row-click" data-dept-id="${_esc(dept.id)}">
      <td style="font-weight:var(--fw-medium)">${_esc(dept.name || '')}</td>
      <td>${_esc(shiftMap[dept.default_shift_id || ''] || '—')}</td>
      <td>${empCountMap[dept.name] || 0}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-dept-id]').forEach(function(row) {
    row.addEventListener('click', function() {
      const id   = row.getAttribute('data-dept-id');
      const dept = _deptAllRecords.find(function(d) { return d.id === id; });
      if (dept) _openDeptPanel(dept);
    });
  });
}

function _openDeptPanel(dept) {
  const titleEl = document.getElementById('dept-panel-title');
  const bd      = document.getElementById('dept-panel-bd');
  titleEl.textContent = dept ? t('departments.edit') : t('departments.add');

  const shiftOpts = `<option value="">—</option>` +
    _deptShiftList.map(function(s) {
      const sel = dept && (dept.default_shift_id === s.id) ? 'selected' : '';
      return `<option value="${_esc(s.id)}" ${sel}>${_esc(s.name)}</option>`;
    }).join('');

  bd.innerHTML = `
    <div class="panel-form">
      <div class="form-group">
        <label>${t('departments.name')} <span class="form-required">*</span></label>
        <input id="dept-f-name" type="text" class="input" value="${dept ? _esc(dept.name) : ''}">
      </div>
      <div class="form-group">
        <label>${t('departments.default_shift')}</label>
        <select id="dept-f-shift" class="table-toolbar-select" style="max-width:unset">${shiftOpts}</select>
      </div>
      <p id="dept-form-err" class="form-field-error" hidden></p>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" id="dept-save-btn">${t('action.save')}</button>
        <button class="btn btn-ghost btn-sm" id="dept-cancel-btn">${t('action.cancel')}</button>
      </div>
    </div>`;

  document.getElementById('dept-save-btn').addEventListener('click', function() { _saveDept(dept); });
  document.getElementById('dept-cancel-btn').addEventListener('click', _closeDeptPanel);

  document.getElementById('dept-overlay').classList.add('overlay-visible');
  document.getElementById('dept-panel').classList.add('panel-open');
}

function _closeDeptPanel() {
  document.getElementById('dept-panel')?.classList.remove('panel-open');
  document.getElementById('dept-overlay')?.classList.remove('overlay-visible');
}

async function _saveDept(existingDept) {
  const name    = (document.getElementById('dept-f-name')?.value  || '').trim();
  const shiftId = document.getElementById('dept-f-shift')?.value  || '';
  const errEl   = document.getElementById('dept-form-err');

  if (!name) { if (errEl) { errEl.hidden = false; errEl.textContent = t('error.required_field'); } return; }
  if (errEl) errEl.hidden = true;

  const btn = document.getElementById('dept-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const res = existingDept
    ? await apiUpdateDepartment(existingDept.id, { name, default_shift_id: shiftId })
    : await apiAddDepartment(name, shiftId);

  if (btn) { btn.disabled = false; btn.textContent = t('action.save'); }

  if (res?.status === 'ok') {
    _closeDeptPanel();
    const [deptRes, empRes] = await Promise.all([apiGetDepartments(), apiGetAllEmployees()]);
    _deptAllRecords = deptRes?.data?.departments || [];
    const empCounts = {};
    (empRes?.data?.employees || []).filter(function(e) {
      return String(e.active || '').toUpperCase() !== 'FALSE';
    }).forEach(function(e) {
      const d = String(e.department || '');
      empCounts[d] = (empCounts[d] || 0) + 1;
    });
    _renderDeptTable(empCounts);
  } else {
    if (errEl) { errEl.hidden = false; errEl.textContent = res?.message || t('error.server'); }
  }
}

// =============================================================================
// SHIFTS SCREEN
// =============================================================================

let _shiftAllRecords = [];

async function renderShifts(container) {
  container.innerHTML = `
    <div class="view-content">
    <div class="view-hd">
      <h1 class="view-title">${t('shifts.title')}</h1>
      <button id="shift-add-btn" class="btn btn-primary btn-sm">+ ${t('shifts.add')}</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>${t('shifts.name')}</th>
          <th>${t('shifts.start_time')}</th>
          <th>${t('shifts.end_time')}</th>
          <th>${t('shifts.working_days')}</th>
          <th>${t('shifts.late_threshold')}</th>
        </tr></thead>
        <tbody id="shift-tbody">${_skeletonTableRows(4, 5)}</tbody>
      </table>
    </div>

    <div class="panel-overlay" id="shift-overlay"></div>
    <div class="slide-panel" id="shift-panel" role="dialog" aria-modal="true">
      <div class="slide-panel-hd">
        <span class="slide-panel-title" id="shift-panel-title"></span>
        <button class="btn-icon" id="shift-panel-close" aria-label="${t('action.close')}">✕</button>
      </div>
      <div class="slide-panel-bd" id="shift-panel-bd"></div>
    </div>
    </div>`;

  document.getElementById('shift-add-btn').addEventListener('click', function() { _openShiftPanel(null); });
  document.getElementById('shift-panel-close').addEventListener('click', _closeShiftPanel);
  document.getElementById('shift-overlay').addEventListener('click', _closeShiftPanel);

  const res = await apiGetShifts();
  _shiftAllRecords = res?.data?.shifts || [];
  _renderShiftTable();
}
window.renderShifts = renderShifts;

function _renderShiftTable() {
  const tbody = document.getElementById('shift-tbody');
  if (!tbody) return;

  if (_shiftAllRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${t('shifts.no_shifts')}</td></tr>`;
    return;
  }

  tbody.innerHTML = _shiftAllRecords.map(function(shift) {
    return `<tr class="table-row-click" data-shift-id="${_esc(shift.id)}">
      <td style="font-weight:var(--fw-medium)">${_esc(shift.name || '')}</td>
      <td dir="ltr">${_esc(shift.start_time || '')}</td>
      <td dir="ltr">${_esc(shift.end_time   || '')}</td>
      <td>${_fmtWorkingDays(shift.working_days)}</td>
      <td dir="ltr">${_esc(String(shift.late_threshold_min || '15'))} ${t('time.minutes')}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-shift-id]').forEach(function(row) {
    row.addEventListener('click', function() {
      const id    = row.getAttribute('data-shift-id');
      const shift = _shiftAllRecords.find(function(s) { return s.id === id; });
      if (shift) _openShiftPanel(shift);
    });
  });
}

function _fmtWorkingDays(wdStr) {
  if (!wdStr) return '—';
  const keys = ['date.sun','date.mon','date.tue','date.wed','date.thu','date.fri','date.sat'];
  const nums = String(wdStr).split(',').map(function(s) {
    return parseInt(s.trim(), 10);
  }).filter(function(n) { return n >= 0 && n <= 6; });
  const sep = localStorage.getItem('lmp_lang') === 'ar' ? '، ' : ', ';
  return nums.map(function(n) { return t(keys[n]).slice(0, 3); }).join(sep) || '—';
}

function _openShiftPanel(shift) {
  const titleEl = document.getElementById('shift-panel-title');
  const bd      = document.getElementById('shift-panel-bd');
  titleEl.textContent = shift ? t('shifts.edit') : t('shifts.add');

  const selDays = shift
    ? String(shift.working_days || '').split(',').map(function(s) { return parseInt(s.trim(), 10); })
    : [0, 1, 2, 3, 4];

  const DAY_MAP = [
    [0, t('date.sun')], [1, t('date.mon')], [2, t('date.tue')],
    [3, t('date.wed')], [4, t('date.thu')], [5, t('date.fri')], [6, t('date.sat')]
  ];

  const wdChecks = DAY_MAP.map(function(pair) {
    return `<label class="wd-check-label">
      <input type="checkbox" class="shift-wd-check" value="${pair[0]}"
        ${selDays.includes(pair[0]) ? 'checked' : ''}>
      ${_esc(pair[1])}
    </label>`;
  }).join('');

  bd.innerHTML = `
    <div class="panel-form">
      <div class="form-group">
        <label>${t('shifts.name')} <span class="form-required">*</span></label>
        <input id="shift-f-name" type="text" class="input" value="${shift ? _esc(shift.name) : ''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${t('shifts.start_time')} <span class="form-required">*</span></label>
          <input id="shift-f-start" type="time" class="input" dir="ltr"
            value="${shift ? _esc(shift.start_time || '') : '08:00'}">
        </div>
        <div class="form-group">
          <label>${t('shifts.end_time')} <span class="form-required">*</span></label>
          <input id="shift-f-end" type="time" class="input" dir="ltr"
            value="${shift ? _esc(shift.end_time || '') : '17:00'}">
        </div>
      </div>
      <div class="form-group">
        <label>${t('shifts.working_days')}</label>
        <div class="wd-checkboxes">${wdChecks}</div>
      </div>
      <div class="form-group">
        <label>${t('shifts.late_threshold')}</label>
        <input id="shift-f-late" type="number" min="0" max="120" class="input" dir="ltr"
          value="${shift ? _esc(String(shift.late_threshold_min || '15')) : '15'}">
      </div>
      <p id="shift-form-err" class="form-field-error" hidden></p>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" id="shift-save-btn">${t('action.save')}</button>
        ${shift ? `<button class="btn btn-danger btn-sm" id="shift-del-btn">${t('action.delete')}</button>` : ''}
        <button class="btn btn-ghost btn-sm" id="shift-cancel-btn">${t('action.cancel')}</button>
      </div>
    </div>`;

  document.getElementById('shift-save-btn').addEventListener('click', function() { _saveShift(shift); });
  document.getElementById('shift-cancel-btn').addEventListener('click', _closeShiftPanel);
  if (shift) {
    document.getElementById('shift-del-btn')?.addEventListener('click', function() {
      _deleteShift(shift.id);
    });
  }

  document.getElementById('shift-overlay').classList.add('overlay-visible');
  document.getElementById('shift-panel').classList.add('panel-open');
}

function _closeShiftPanel() {
  document.getElementById('shift-panel')?.classList.remove('panel-open');
  document.getElementById('shift-overlay')?.classList.remove('overlay-visible');
}

async function _saveShift(existingShift) {
  const name  = (document.getElementById('shift-f-name')?.value  || '').trim();
  const start = document.getElementById('shift-f-start')?.value  || '';
  const end   = document.getElementById('shift-f-end')?.value    || '';
  const wdNums = Array.from(document.querySelectorAll('.shift-wd-check:checked')).map(function(c) {
    return c.value;
  });
  const late  = Number(document.getElementById('shift-f-late')?.value || '') || 15;
  const errEl = document.getElementById('shift-form-err');

  if (!name || !start || !end) {
    if (errEl) { errEl.hidden = false; errEl.textContent = t('error.required_field'); }
    return;
  }
  if (errEl) errEl.hidden = true;

  const btn = document.getElementById('shift-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const payload = { name, start_time: start, end_time: end, working_days: wdNums.join(','), late_threshold_min: late };
  const res = existingShift
    ? await apiUpdateShift(existingShift.id, payload)
    : await apiAddShift(payload);

  if (btn) { btn.disabled = false; btn.textContent = t('action.save'); }

  if (res?.status === 'ok') {
    _closeShiftPanel();
    const res2 = await apiGetShifts();
    _shiftAllRecords = res2?.data?.shifts || [];
    _renderShiftTable();
  } else {
    if (errEl) { errEl.hidden = false; errEl.textContent = res?.message || t('error.server'); }
  }
}

async function _deleteShift(shiftId) {
  const btn   = document.getElementById('shift-del-btn');
  const errEl = document.getElementById('shift-form-err');
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const res = await apiDeleteShift(shiftId);

  if (res?.status === 'ok') {
    _closeShiftPanel();
    const res2 = await apiGetShifts();
    _shiftAllRecords = res2?.data?.shifts || [];
    _renderShiftTable();
  } else {
    if (btn)   { btn.disabled = false; btn.textContent = t('action.delete'); }
    if (errEl) { errEl.hidden = false; errEl.textContent = res?.message || t('error.server'); }
  }
}

// =============================================================================
// LEAVE REQUESTS SCREEN — HR desktop
// Shows all company leave requests (pending + approved + rejected) with
// approve/reject actions for pending ones.
// =============================================================================

let _leavesAllRecords   = [];
let _leavesStatusFilter = '';
let _leaveBalances      = [];
let _balancesSupported  = true;

async function renderLeaveRequests(container) {
  _cancelLiveTimer();
  _leavesAllRecords   = [];
  _leavesStatusFilter = '';
  _leaveBalances      = [];
  _balancesSupported  = true;

  container.innerHTML = `
    <div class="view-content">
      <div class="view-header">
        <div><h1 class="view-title">${t('nav.leave_requests')}</h1></div>
      </div>

      <div class="data-table-wrap">
        <div class="table-toolbar" id="leave-toolbar">
          <div class="filter-tabs" id="leave-filter-tabs" role="tablist">
            <button class="filter-tab active" data-status=""         role="tab" aria-selected="true">${t('leave.filter_all')}</button>
            <button class="filter-tab"         data-status="pending"  role="tab" aria-selected="false">${t('leave.pending')}</button>
            <button class="filter-tab"         data-status="approved" role="tab" aria-selected="false">${t('status.approved')}</button>
            <button class="filter-tab"         data-status="rejected" role="tab" aria-selected="false">${t('status.rejected')}</button>
          </div>
          <div class="table-toolbar-actions">
            <input type="search" class="table-toolbar-search" id="leave-search"
                   placeholder="${t('action.search')}" autocomplete="off">
            <span class="count-badge" id="leave-count">—</span>
          </div>
        </div>

        <table class="data-table" id="leave-table">
          <thead>
            <tr>
              <th>${t('employees.name')}</th>
              <th>${t('employees.department')}</th>
              <th>${t('leave.type')}</th>
              <th>${t('date.from')}</th>
              <th>${t('date.to')}</th>
              <th>${t('leave.days')}</th>
              <th>${t('leave.remaining')}</th>
              <th>${t('leave.reason')}</th>
              <th>${t('attendance.status')}</th>
              <th>${t('action.actions')}</th>
            </tr>
          </thead>
          <tbody id="leave-tbody">${_skeletonTableRows(6, 10)}</tbody>
        </table>
      </div>

      <div class="view-header" style="margin-block-start:var(--sp-6)">
        <div>
          <h2 class="view-title" style="font-size:var(--text-lg)">${t('leave.balances_title')}</h2>
          <p class="dashboard-date" id="balance-subtitle">${t('leave.balances_hint')}</p>
        </div>
      </div>

      <div class="data-table-wrap">
        <div class="table-toolbar">
          <div class="table-toolbar-actions">
            <input type="search" class="table-toolbar-search" id="balance-search"
                   placeholder="${t('action.search')}" autocomplete="off">
            <span class="count-badge" id="balance-count">—</span>
          </div>
        </div>

        <table class="data-table" id="balance-table">
          <thead>
            <tr>
              <th>${t('employees.name')}</th>
              <th>${t('employees.department')}</th>
              <th>${t('leave.entitlement')}</th>
              <th>${t('leave.taken_this_year')}</th>
              <th>${t('leave.pending_days')}</th>
              <th>${t('leave.remaining')}</th>
            </tr>
          </thead>
          <tbody id="balance-tbody">${_skeletonTableRows(6, 6)}</tbody>
        </table>
      </div>
    </div>`;

  const res = await apiGetTeamLeaves();
  if (!document.getElementById('leave-tbody')) return;

  if (res.status !== 'ok') {
    document.getElementById('leave-tbody').innerHTML =
      `<tr><td colspan="10" class="table-empty">${_esc(res.message || t('error.server'))}</td></tr>`;
    document.getElementById('balance-tbody').innerHTML =
      `<tr><td colspan="6" class="table-empty">${_esc(res.message || t('error.server'))}</td></tr>`;
    return;
  }

  _leavesAllRecords = Array.isArray(res.data?.requests) ? res.data.requests : [];
  _leaveBalances    = Array.isArray(res.data?.balances) ? res.data.balances : [];
  // A response with no `balances` key at all means the Apps Script Web App is
  // still running a version older than the balance feature.
  _balancesSupported = Array.isArray(res.data?.balances);
  _renderLeaveTable('');
  _renderBalanceTable('');

  const year = res.data?.year;
  const subtitle = document.getElementById('balance-subtitle');
  if (subtitle && year) subtitle.textContent = `${t('leave.balances_hint')} — ${year}`;

  document.getElementById('balance-search')?.addEventListener('input', function() {
    _renderBalanceTable(this.value.trim().toLowerCase());
  });

  document.getElementById('leave-filter-tabs')?.addEventListener('click', function(e) {
    const tab = e.target.closest('[data-status]');
    if (!tab) return;
    document.querySelectorAll('#leave-filter-tabs .filter-tab').forEach(function(b) {
      b.classList.toggle('active', b === tab);
      b.setAttribute('aria-selected', String(b === tab));
    });
    _leavesStatusFilter = tab.dataset.status;
    _renderLeaveTable((document.getElementById('leave-search')?.value || '').trim().toLowerCase());
  });

  document.getElementById('leave-search')?.addEventListener('input', function() {
    _renderLeaveTable(this.value.trim().toLowerCase());
  });
}

window.renderLeaveRequests = renderLeaveRequests;

function _renderLeaveTable(query) {
  const tbody = document.getElementById('leave-tbody');
  if (!tbody) return;

  let rows = _leavesAllRecords;
  if (_leavesStatusFilter) {
    rows = rows.filter(function(l) {
      return String(l.status || '').toLowerCase() === _leavesStatusFilter;
    });
  }
  if (query) {
    rows = rows.filter(function(l) {
      return (l.employee_name || '').toLowerCase().includes(query) ||
             (l.department    || '').toLowerCase().includes(query) ||
             (l.leave_type    || '').toLowerCase().includes(query) ||
             (l.reason        || '').toLowerCase().includes(query);
    });
  }

  const countEl = document.getElementById('leave-count');
  if (countEl) countEl.textContent = rows.length;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="table-empty">${t('leave.no_requests')}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(_hrLeaveRow).join('');

  tbody.querySelectorAll('.leave-approve-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { _hrApproveLeave(btn.dataset.id); });
  });
  tbody.querySelectorAll('.leave-reject-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { _hrRejectLeave(btn.dataset.id); });
  });
}

function _hrLeaveRow(l) {
  const typeKeyMap = {
    annual: 'type_annual', sick: 'type_sick',
    emergency: 'type_emergency', unpaid: 'type_unpaid'
  };
  const typeKey   = typeKeyMap[String(l.leave_type || '').toLowerCase()] || 'type_annual';
  const typeLabel = t('leave.' + typeKey) || l.leave_type || '';

  const status      = String(l.status || '').toLowerCase();
  const statusClass = { pending: 'badge-pending', approved: 'badge-present', rejected: 'badge-absent' }[status] || 'badge-pending';
  const statusLabel = t('leave.' + status) || status;

  const days      = _leaveDaysCount(l.start_date, l.end_date);
  const isPending = status === 'pending';

  return `
    <tr>
      <td style="font-weight:var(--fw-medium)">${_esc(l.employee_name || l.employee_id || '')}</td>
      <td>${_esc(l.department || '')}</td>
      <td>${_esc(typeLabel)}</td>
      <td dir="ltr">${_esc(_fmtDate(_leaveDateOnly(l.start_date)))}</td>
      <td dir="ltr">${_esc(_fmtDate(_leaveDateOnly(l.end_date)))}</td>
      <td style="text-align:center" dir="ltr">${days}</td>
      <td style="text-align:center">${_leaveBalanceCell(l)}</td>
      <td class="leave-reason-cell">${_esc(l.reason || '—')}</td>
      <td><span class="badge ${_esc(statusClass)}">${_esc(statusLabel)}</span></td>
      <td>
        ${isPending
          ? `<div class="row-actions">
               <button class="btn btn-sm btn-primary leave-approve-btn"
                       data-id="${_esc(l.id)}" type="button">${t('action.approve')}</button>
               <button class="btn btn-sm btn-danger leave-reject-btn"
                       data-id="${_esc(l.id)}" type="button">${t('action.reject')}</button>
             </div>`
          : '—'}
      </td>
    </tr>`;
}

// Sheets date cells reach us either as "YYYY-MM-DD" or, when the server has
// not normalised them, as a full ISO timestamp. Keep only the date part so
// every caller works with the same shape.
function _leaveDateOnly(val) {
  const s = String(val || '').trim();
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s;
}

function _leaveDaysCount(startDate, endDate) {
  try {
    const s = new Date(_leaveDateOnly(startDate) + 'T00:00:00Z');
    const e = new Date(_leaveDateOnly(endDate)   + 'T00:00:00Z');
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return '—';
    return Math.max(0, Math.round((e - s) / 86400000) + 1);
  } catch (_) { return '—'; }
}

// ── Annual balance ────────────────────────────────────────────────────────────
// Remaining annual days of the employee who filed this request, shown inline so
// HR can judge an approval without leaving the row.
function _leaveBalanceCell(l) {
  if (l.annual_remaining === undefined || l.annual_remaining === null) return '—';
  const remaining = Number(l.annual_remaining) || 0;
  const total     = Number(l.annual_total)     || 0;
  return `<span class="badge ${_balanceBadgeClass(remaining)}" dir="ltr"
                title="${_esc(t('leave.remaining'))}">${remaining} / ${total}</span>`;
}

// Green when there is room left, amber when running low, red when exhausted.
function _balanceBadgeClass(remaining) {
  if (remaining <= 0) return 'badge-absent';
  if (remaining <= 5) return 'badge-late';
  return 'badge-present';
}

// Recompute one employee's annual balance from the records already in memory,
// so approving or rejecting updates the balance table without another round
// trip. Mirrors the server calculation in Leaves.gs _annualBalances().
function _recomputeBalanceFor(employeeId) {
  const bal = _leaveBalances.find(function(b) {
    return String(b.employee_id) === String(employeeId);
  });
  if (!bal) return;

  const year = String(new Date().getFullYear());
  let taken = 0, pending = 0;

  _leavesAllRecords.forEach(function(l) {
    if (String(l.employee_id) !== String(employeeId)) return;
    if (String(l.leave_type || '').toLowerCase() !== 'annual') return;
    if (!_leaveDateOnly(l.start_date).startsWith(year)) return;

    const days = Number(_leaveDaysCount(l.start_date, l.end_date));
    if (isNaN(days)) return;

    const status = String(l.status || '').toLowerCase();
    if (status === 'approved')     taken   += days;
    else if (status === 'pending') pending += days;
  });

  bal.annual_taken     = taken;
  bal.annual_pending   = pending;
  bal.annual_remaining = Math.max(0, (Number(bal.annual_total) || 0) - taken);

  // Keep the inline per-request balance in step with the table
  _leavesAllRecords.forEach(function(l) {
    if (String(l.employee_id) !== String(employeeId)) return;
    l.annual_taken     = bal.annual_taken;
    l.annual_pending   = bal.annual_pending;
    l.annual_remaining = bal.annual_remaining;
  });
}

// ── Annual leave balance table — one row per active employee ──────────────────
function _renderBalanceTable(query) {
  const tbody = document.getElementById('balance-tbody');
  if (!tbody) return;

  let rows = _leaveBalances;
  if (query) {
    rows = rows.filter(function(b) {
      return (b.employee_name || '').toLowerCase().includes(query) ||
             (b.department    || '').toLowerCase().includes(query);
    });
  }

  const countEl = document.getElementById('balance-count');
  if (countEl) countEl.textContent = rows.length;

  if (rows.length === 0) {
    const emptyMsg = _balancesSupported
      ? t('placeholder.no_data')
      : t('leave.balances_unavailable');
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">${_esc(emptyMsg)}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(function(b) {
    const remaining = Number(b.annual_remaining) || 0;
    const pending   = Number(b.annual_pending)   || 0;
    return `
      <tr>
        <td style="font-weight:var(--fw-medium)">${_esc(b.employee_name || '')}</td>
        <td>${_esc(b.department || '')}</td>
        <td style="text-align:center" dir="ltr">${Number(b.annual_total) || 0}</td>
        <td style="text-align:center" dir="ltr">${Number(b.annual_taken) || 0}</td>
        <td style="text-align:center" dir="ltr">
          ${pending > 0 ? `<span class="badge badge-pending" dir="ltr">${pending}</span>` : '—'}
        </td>
        <td style="text-align:center">
          <span class="badge ${_balanceBadgeClass(remaining)}" dir="ltr">${remaining}</span>
        </td>
      </tr>`;
  }).join('');
}

async function _hrApproveLeave(leaveId) {
  const btn = document.querySelector(`.leave-approve-btn[data-id="${CSS.escape(leaveId)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const res = await apiApproveLeave(leaveId);

  if (res.status === 'ok') {
    showToast(t('status.approved'), 'success');
    const rec = _leavesAllRecords.find(function(l) { return l.id === leaveId; });
    if (rec) {
      rec.status = 'approved';
      _recomputeBalanceFor(rec.employee_id);
    }
    _renderLeaveTable((document.getElementById('leave-search')?.value || '').trim().toLowerCase());
    _renderBalanceTable((document.getElementById('balance-search')?.value || '').trim().toLowerCase());
  } else {
    showToast(res.message || t('error.server'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = t('action.approve'); }
  }
}

async function _hrRejectLeave(leaveId) {
  const btn = document.querySelector(`.leave-reject-btn[data-id="${CSS.escape(leaveId)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = t('action.loading'); }

  const res = await apiRejectLeave(leaveId, '');

  if (res.status === 'ok') {
    showToast(t('status.rejected'), 'warning');
    const rec = _leavesAllRecords.find(function(l) { return l.id === leaveId; });
    if (rec) {
      rec.status = 'rejected';
      _recomputeBalanceFor(rec.employee_id);
    }
    _renderLeaveTable((document.getElementById('leave-search')?.value || '').trim().toLowerCase());
    _renderBalanceTable((document.getElementById('balance-search')?.value || '').trim().toLowerCase());
  } else {
    showToast(res.message || t('error.server'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = t('action.reject'); }
  }
}

// =============================================================================
// GPS INTEGRITY SCREEN
// renderIntegrity — read-only review of coordinate patterns in stored check-ins
//
// Reads get_integrity_report and does nothing else. Nothing on this screen
// edits, blocks or deletes anything: it exists so HR can see which check-in
// histories are not physically plausible and go look into them.
//
// The disclaimer at the top is not decoration. Every signal here is
// circumstantial and the screen must never read as a verdict.
// =============================================================================

// Maps each signal's server-side params onto the {n}/{m}/{loc} placeholders
// used by the locale strings, so Integrity.gs stays free of display text.
const _INT_SIG_PARAMS = {
  exact_repeat:      function(p) { return { n: p.days }; },
  zero_jitter:       function(p) { return { n: p.records, m: p.spread }; },
  pinpoint_centre:   function(p) { return { n: p.hits,    loc: p.location }; },
  constant_accuracy: function(p) { return { n: p.days,    m: p.accuracy }; },
  device_mismatch:   function(p) { return { n: p.count }; },
};

const _INT_LEVEL_BADGE = {
  high:   'badge-absent',
  medium: 'badge-late',
  low:    'badge-pending',
};

// Storage-format date for any Date — the date inputs and Integrity.gs both
// speak YYYY-MM-DD, unlike utils.js formatDate() which is display-only.
function _isoDate(d) {
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

// Substitute {placeholder} tokens in a translated string.
function _fill(key, params) {
  let s = t(key);
  Object.keys(params || {}).forEach(function(k) {
    s = s.split('{' + k + '}').join(String(params[k]));
  });
  return s;
}

async function renderIntegrity(container) {
  _cancelDashTimer();
  _cancelLiveTimer();

  // Default window matches Integrity.gs — the last 90 days
  const to   = _isoToday();
  const back = new Date();
  back.setDate(back.getDate() - 90);
  const from = _isoDate(back);

  container.innerHTML = `
    <div class="view-content">
      <div class="view-header">
        <div>
          <h1 class="view-title">${t('integrity.title')}</h1>
          <p class="dashboard-date">${t('integrity.subtitle')}</p>
        </div>
      </div>

      <div class="int-disclaimer" role="note">
        <span class="int-disclaimer-icon" aria-hidden="true">⚠</span>
        <p>${t('integrity.disclaimer')}</p>
      </div>

      <div class="card int-controls">
        <div class="form-row">
          <div class="form-group">
            <label for="int-from" class="field-label">${t('integrity.from')}</label>
            <input type="date" id="int-from" class="field-input" value="${_esc(from)}">
          </div>
          <div class="form-group">
            <label for="int-to" class="field-label">${t('integrity.to')}</label>
            <input type="date" id="int-to" class="field-input" value="${_esc(to)}">
          </div>
          <div class="form-group int-controls-action">
            <button class="btn btn-primary" id="int-run-btn">${t('integrity.run')}</button>
          </div>
        </div>
      </div>

      <div id="int-summary"></div>
      <div id="int-results"></div>
    </div>`;

  document.getElementById('int-run-btn')?.addEventListener('click', _runIntegrityScan);

  await _runIntegrityScan();
}

window.renderIntegrity = renderIntegrity;

async function _runIntegrityScan() {
  const btn      = document.getElementById('int-run-btn');
  const summary  = document.getElementById('int-summary');
  const results  = document.getElementById('int-results');
  if (!results) return;

  const from = document.getElementById('int-from')?.value || '';
  const to   = document.getElementById('int-to')?.value   || '';

  if (btn) { btn.disabled = true; btn.textContent = t('loading.please_wait') || '…'; }
  if (summary) summary.innerHTML = '';
  results.innerHTML = `
    <p class="int-running">${t('integrity.running')}</p>`;

  const res = await apiGetIntegrityReport(from, to).catch(function() { return null; });

  if (btn) { btn.disabled = false; btn.textContent = t('integrity.run'); }

  if (!res || res.status !== 'ok') {
    results.innerHTML = '';
    showToast(res?.message || t('error.server'), 'error');
    return;
  }

  const data = res.data || {};
  if (summary) summary.innerHTML = _integritySummary(data);
  results.innerHTML = _integrityResults(data);
}

// Four-tile strip: how much was looked at, and what normal looks like here.
function _integritySummary(data) {
  const baseline = (data.baseline_spread_m === null || data.baseline_spread_m === undefined)
    ? '—'
    : data.baseline_spread_m + ' m';

  const skipped = data.employees_skipped
    ? `<p class="int-skipped">${_fill('integrity.skipped', { n: data.employees_skipped })}</p>`
    : '';

  return `
    <div class="int-summary-grid">
      ${_intTile(t('integrity.scanned'), data.records_analysed || 0, '')}
      ${_intTile(t('integrity.covered'), data.employees_covered || 0, '')}
      ${_intTile(t('integrity.flagged'), data.flagged || 0, data.flagged ? 'int-tile-alert' : '')}
      ${_intTile(t('integrity.baseline'), baseline, '', t('integrity.baseline_hint'))}
    </div>
    ${skipped}`;
}

function _intTile(label, value, cls, hint) {
  return `
    <div class="int-tile ${cls}"${hint ? ` title="${_esc(hint)}"` : ''}>
      <span class="int-tile-label">${_esc(label)}</span>
      <span class="int-tile-value">${_esc(value)}</span>
      ${hint ? `<span class="int-tile-hint">${_esc(hint)}</span>` : ''}
    </div>`;
}

function _integrityResults(data) {
  const results = Array.isArray(data.results) ? data.results : [];

  if (!data.records_analysed) {
    return _intEmpty('🛰', t('integrity.no_data_title'), t('integrity.no_data_body'));
  }
  if (results.length === 0) {
    return _intEmpty('✓', t('integrity.no_findings_title'), t('integrity.no_findings_body'));
  }

  return `<div class="int-findings">
    ${results.map(function(r) { return _integrityCard(r, data.baseline_spread_m); }).join('')}
  </div>`;
}

function _intEmpty(icon, title, body) {
  return `
    <div class="empty-state">
      <span class="empty-state-icon" aria-hidden="true">${icon}</span>
      <p class="empty-state-title">${_esc(title)}</p>
      <p class="empty-state-description">${_esc(body)}</p>
    </div>`;
}

function _integrityCard(r, baseline) {
  const level = r.level || 'low';
  const badge = _INT_LEVEL_BADGE[level] || 'badge-pending';
  const label = t('integrity.level_' + level);

  // Scatter shown next to the workforce median — a bare "0.4m" means nothing
  // without knowing that everyone else sits around 20m.
  const scatter = (baseline === null || baseline === undefined)
    ? `${t('integrity.spread')} ${r.spread_m} m`
    : `${t('integrity.spread')} ${r.spread_m} m / ${baseline} m`;

  const meta = [
    r.department || '—',
    `${r.records_analysed} ${t('integrity.records')}`,
    scatter,
    `${_fmtDate(r.first_date)} – ${_fmtDate(r.last_date)}`,
  ].map(_esc).join(' · ');

  return `
    <article class="int-card int-card-${_esc(level)}">
      <header class="int-card-head">
        <div class="activity-avatar avatar-absent" aria-hidden="true">${_esc(_initials(r.employee_name))}</div>
        <div class="int-card-id">
          <span class="int-card-name">${_esc(r.employee_name || r.employee_id)}</span>
          <span class="int-card-meta">${meta}</span>
        </div>
        <div class="int-card-score">
          <span class="badge ${badge}">${_esc(label)}</span>
          <span class="int-score-value">${_esc(r.score)}</span>
        </div>
      </header>

      <div class="int-meter" role="img"
           aria-label="${_esc(t('integrity.score'))}: ${_esc(r.score)}/100">
        <span class="int-meter-fill" style="width:${Number(r.score)}%"></span>
      </div>

      <ul class="int-signals">
        ${(r.signals || []).map(_integritySignal).join('')}
      </ul>

      <details class="int-evidence">
        <summary>${t('integrity.evidence')}</summary>
        ${_integrityEvidence(r.samples || [])}
      </details>
    </article>`;
}

function _integritySignal(sig) {
  const mapper = _INT_SIG_PARAMS[sig.code];
  const params = mapper ? mapper(sig.params || {}) : (sig.params || {});

  return `
    <li class="int-signal">
      <span class="int-signal-title">${_esc(_fill('integrity.sig_' + sig.code, params))}</span>
      <span class="int-signal-why">${_esc(t('integrity.sig_' + sig.code + '_why'))}</span>
    </li>`;
}

function _integrityEvidence(samples) {
  if (!samples.length) return '';

  const rows = samples.map(function(s) {
    const mismatch = s.device_match === 'FALSE';
    return `
      <tr>
        <td>${_esc(_fmtDate(s.date))}</td>
        <td class="int-num">${_esc(_fmtTime(s.check_in))}</td>
        <td class="int-num">${_esc(s.lat)}, ${_esc(s.lng)}</td>
        <td class="int-num">${s.accuracy === '' ? '—' : _esc(s.accuracy) + ' m'}</td>
        <td>${mismatch
          ? `<span class="device-mismatch-flag">⚠ ${t('integrity.device_bad')}</span>`
          : t('integrity.device_ok')}</td>
      </tr>`;
  }).join('');

  return `
    <div class="data-table-wrap int-evidence-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>${t('integrity.col_date')}</th>
            <th>${t('integrity.col_time')}</th>
            <th>${t('integrity.col_coords')}</th>
            <th>${t('integrity.col_accuracy')}</th>
            <th>${t('integrity.col_device')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
