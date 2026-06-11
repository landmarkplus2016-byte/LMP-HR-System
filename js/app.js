// =============================================================================
// app.js — App shell: init, router, nav renderer, global state
// =============================================================================
// This file is loaded last. It assumes all other JS files are in scope.
// Functions from other modules are called by name; missing ones are handled
// gracefully so the shell works even before those modules are built.

'use strict';

// ---------------------------------------------------------------------------
// Fallback t() — overridden by i18n.js once that module is loaded.
// Defined here so the shell never crashes when i18n.js is still empty.
// ---------------------------------------------------------------------------
if (typeof window.t !== 'function') {
  window.t = function (key) { return key; };
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const App = {
  currentUser:  null,
  currentRole:  null,  // 'employee' | 'manager' | 'hr'
  _resizeTimer: null,
};

// ---------------------------------------------------------------------------
// SVG icon library — used in nav items
// ---------------------------------------------------------------------------
const Icons = {
  home: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7A1 1 0 003 11h1v6a1 1 0 001 1h4v-4h2v4h4a1 1 0 001-1v-6h1a1 1 0 00.707-1.707l-7-7z"/></svg>`,
  history: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>`,
  leave: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>`,
  team: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>`,
  clipboard: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>`,
  calendar: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm2 5a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1zm-2 4a1 1 0 100 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>`,
  dashboard: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z"/><path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z"/></svg>`,
  live: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/></svg>`,
  chart: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/></svg>`,
  people: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>`,
  building: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clip-rule="evenodd"/></svg>`,
  clock: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>`,
  pin: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/></svg>`,
  star: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`,
  settings: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>`,
  signout: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clip-rule="evenodd"/></svg>`,
  lang: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" clip-rule="evenodd"/></svg>`,
};

// ---------------------------------------------------------------------------
// Navigation item definitions — one set per role
// ---------------------------------------------------------------------------
const NAV_ITEMS = {
  employee: [
    { hash: 'home',    icon: Icons.home,      labelKey: 'nav.home'    },
    { hash: 'history', icon: Icons.history,   labelKey: 'nav.history' },
    { hash: 'leave',   icon: Icons.leave,     labelKey: 'nav.leave'   },
  ],
  manager: [
    { hash: 'team',            icon: Icons.team,      labelKey: 'nav.team'          },
    { hash: 'team-attendance', icon: Icons.clipboard, labelKey: 'nav.attendance'    },
    { hash: 'team-leaves',     icon: Icons.calendar,  labelKey: 'nav.leave_requests'},
  ],
  hr: [
    { hash: 'dashboard',      icon: Icons.dashboard, labelKey: 'nav.dashboard'     },
    { hash: 'live-status',    icon: Icons.live,      labelKey: 'nav.live_status'   },
    { hash: 'attendance',     icon: Icons.clipboard, labelKey: 'nav.attendance'    },
    { hash: 'leave-requests', icon: Icons.calendar,  labelKey: 'nav.leave_requests'},
    { hash: 'reports',        icon: Icons.chart,     labelKey: 'nav.reports'       },
    { hash: 'employees',      icon: Icons.people,    labelKey: 'nav.employees'     },
    { hash: 'departments',    icon: Icons.building,  labelKey: 'nav.departments'   },
    { hash: 'shifts',         icon: Icons.clock,     labelKey: 'nav.shifts'        },
    { hash: 'locations',      icon: Icons.pin,       labelKey: 'nav.locations'     },
    { hash: 'holidays',       icon: Icons.star,      labelKey: 'nav.holidays'      },
    { hash: 'config',         icon: Icons.settings,  labelKey: 'nav.config'        },
  ],
};

// ---------------------------------------------------------------------------
// Route permissions — which roles can access each route
// ---------------------------------------------------------------------------
const ROUTES = {
  'home':             ['employee', 'manager', 'hr'],
  'history':          ['employee'],
  'leave':            ['employee'],
  'leave-balance':    ['employee'],
  'team':             ['manager', 'hr'],
  'team-attendance':  ['manager', 'hr'],
  'team-leaves':      ['manager', 'hr'],
  'dashboard':        ['hr'],
  'live-status':      ['hr'],
  'attendance':       ['hr'],
  'leave-requests':   ['hr'],
  'reports':          ['hr'],
  'employees':        ['hr'],
  'departments':      ['hr'],
  'shifts':           ['hr'],
  'locations':        ['hr'],
  'holidays':         ['hr'],
  'config':           ['hr'],
};

// ---------------------------------------------------------------------------
// View → render function name mapping
// Render functions are defined in their respective JS modules (employee.js,
// manager.js, hr.js, auth.js). They are looked up in window scope at runtime.
// ---------------------------------------------------------------------------
const VIEW_RENDER = {
  'history':          'renderAttendanceHistory',
  'leave':            'renderLeaveForm',
  'leave-balance':    'renderLeaveBalance',
  'team':             'renderTeamStatus',
  'team-attendance':  'renderTeamAttendance',
  'team-leaves':      'renderTeamLeaves',
  'dashboard':        'renderHRDashboard',
  'live-status':      'renderLiveStatus',
  'attendance':       'renderAttendanceRecords',
  'leave-requests':   'renderLeaveRequests',
  'reports':          'renderReports',
  'employees':        'renderEmployees',
  'departments':      'renderDepartments',
  'shifts':           'renderShifts',
  'locations':        'renderLocations',
  'holidays':         'renderHolidays',
  'config':           'renderConfig',
};

// ---------------------------------------------------------------------------
// INIT — entry point, runs on DOMContentLoaded
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => App.init());

App.init = async function () {
  // 0. Load locale strings — must be first so t() returns real strings below
  if (typeof loadI18n === 'function') {
    await loadI18n();
  }

  setLoadingStatus(t('loading.starting') || 'جارٍ التحميل…');

  // 1. Load config from Apps Script (non-fatal)
  try {
    if (typeof loadConfig === 'function') {
      setLoadingStatus(t('loading.config') || 'تحميل الإعدادات…');
      await loadConfig();
    }
  } catch (e) {
    console.warn('[App] Config load failed — using fallbacks.', e.message);
  }

  // 2. Check stored session
  const token   = localStorage.getItem('lmp_session');
  const userRaw = localStorage.getItem('lmp_user');

  if (!token || !userRaw) {
    hideLoadingScreen();
    renderLoginView();
    return;
  }

  // 3. Validate the stored session with the server
  try {
    if (typeof apiValidateSession === 'function') {
      setLoadingStatus(t('loading.validating') || 'التحقق من الجلسة…');
      const result = await apiValidateSession(token);
      if (result && result.status === 'ok') {
        _activateUser(result.data.employee);
        hideLoadingScreen();
        renderNav();
        handleRoute();
        return;
      }
    } else {
      // api.js not built yet — trust the cached user (dev convenience only)
      const user = JSON.parse(userRaw);
      _activateUser(user);
      hideLoadingScreen();
      renderNav();
      handleRoute();
      return;
    }
  } catch (e) {
    console.warn('[App] Session validation failed.', e.message);
  }

  // 4. Session invalid — clear and show login
  _clearSession();
  hideLoadingScreen();
  renderLoginView();
};

// Set current user in state and update localStorage
function _activateUser(employee) {
  App.currentUser = employee;
  App.currentRole = employee.role;
  localStorage.setItem('lmp_user', JSON.stringify(employee));
}

// Clear local auth state
function _clearSession() {
  App.currentUser = null;
  App.currentRole = null;
  localStorage.removeItem('lmp_session');
  localStorage.removeItem('lmp_user');
}

// ---------------------------------------------------------------------------
// ROUTER
// ---------------------------------------------------------------------------
window.addEventListener('hashchange', handleRoute);

function handleRoute() {
  if (!App.currentUser) {
    renderLoginView();
    return;
  }

  const raw  = window.location.hash.replace('#', '').trim();
  const hash = raw || getHomeHash(App.currentRole);

  // Redirect to role home if route is unknown
  const perms = ROUTES[hash];
  if (!perms) {
    window.location.hash = getHomeHash(App.currentRole);
    return;
  }

  // Role guard — redirect to home if user lacks permission
  if (!perms.includes(App.currentRole)) {
    window.location.hash = getHomeHash(App.currentRole);
    return;
  }

  updateNavActive(hash);
  showView(hash);
}

// ---------------------------------------------------------------------------
// VIEW RENDERER
// ---------------------------------------------------------------------------
function showView(route) {
  const app = document.getElementById('app');
  if (!app) return;

  // 'home' resolves to a role-specific route
  const resolved = (route === 'home' || route === '') ? getHomeHash(App.currentRole) : route;

  // Look up the render function from the owning module
  const fnName = VIEW_RENDER[resolved];
  const fn     = fnName ? window[fnName] : null;

  app.innerHTML = '';

  if (typeof fn === 'function') {
    fn(app);
  } else {
    // Placeholder until the module for this view is built
    app.innerHTML = `
      <div class="view-placeholder">
        <div class="view-placeholder-inner">
          <span class="view-placeholder-icon" aria-hidden="true">🔧</span>
          <p class="view-placeholder-label">${t('placeholder.building') || 'قيد الإنشاء'}</p>
          <p class="view-placeholder-route">${resolved}</p>
        </div>
      </div>`;
  }
}

// ---------------------------------------------------------------------------
// NAV RENDERER
// ---------------------------------------------------------------------------
function renderNav() {
  const nav  = document.getElementById('nav');
  const app  = document.getElementById('app');
  if (!nav || !App.currentRole) return;

  const isDesktop = window.innerWidth >= 900;
  const items     = NAV_ITEMS[App.currentRole] || [];
  const curHash   = window.location.hash.replace('#', '');

  nav.innerHTML = '';

  if (isDesktop) {
    _renderSidebar(nav, app, items, curHash);
  } else {
    _renderBottomNav(nav, app, items, curHash);
  }

  // Wire up footer actions
  document.getElementById('signout-btn')?.addEventListener('click', handleSignOut);
  document.getElementById('lang-toggle-btn')?.addEventListener('click', handleLangToggle);
}

function _renderSidebar(nav, app, items, curHash) {
  nav.className = 'nav-sidebar';

  // Header
  const header = document.createElement('div');
  header.className = 'nav-sidebar-header';
  header.innerHTML = `
    <img src="assets/logo.svg" alt="LMP" class="nav-logo" width="32" height="32"
         onerror="this.style.display='none'">
    <span class="nav-app-name">${t('app.name') || 'LMP Attendance'}</span>`;
  nav.appendChild(header);

  // Nav list
  const ul = document.createElement('ul');
  ul.className  = 'nav-sidebar-list';
  ul.setAttribute('role', 'list');

  items.forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `
      <a href="#${item.hash}"
         class="nav-sidebar-item${curHash === item.hash ? ' nav-active' : ''}"
         aria-current="${curHash === item.hash ? 'page' : 'false'}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${t(item.labelKey)}</span>
      </a>`;
    ul.appendChild(li);
  });
  nav.appendChild(ul);

  // Footer: language toggle + sign out
  const currentLang = localStorage.getItem('lmp_lang') || 'ar';
  const footer = document.createElement('div');
  footer.className = 'nav-sidebar-footer';
  footer.innerHTML = `
    <button class="nav-lang-toggle" type="button" id="lang-toggle-btn"
            aria-label="${t('nav.toggle_language') || 'تبديل اللغة'}">
      <span class="nav-icon">${Icons.lang}</span>
      <span class="nav-label">${currentLang === 'ar' ? 'English' : 'العربية'}</span>
    </button>
    <button class="nav-signout" type="button" id="signout-btn"
            aria-label="${t('nav.signout') || 'تسجيل الخروج'}">
      <span class="nav-icon">${Icons.signout}</span>
      <span class="nav-label">${t('nav.signout') || 'تسجيل الخروج'}</span>
    </button>`;
  nav.appendChild(footer);

  app.classList.add('app-with-sidebar');
  app.classList.remove('app-with-bottom-nav');
}

function _renderBottomNav(nav, app, items, curHash) {
  nav.className = 'nav-bottom';

  // Mobile shows first 4 items only; HR on mobile (rare) shows first 4
  const visible = items.slice(0, 4);

  visible.forEach(item => {
    const a = document.createElement('a');
    a.href      = `#${item.hash}`;
    a.className = `nav-tab${curHash === item.hash ? ' nav-active' : ''}`;
    a.setAttribute('aria-current', curHash === item.hash ? 'page' : 'false');
    a.innerHTML = `
      <span class="nav-tab-icon">${item.icon}</span>
      <span class="nav-tab-label">${t(item.labelKey)}</span>`;
    nav.appendChild(a);
  });

  app.classList.add('app-with-bottom-nav');
  app.classList.remove('app-with-sidebar');
}

function updateNavActive(hash) {
  document.querySelectorAll('.nav-sidebar-item, .nav-tab').forEach(el => {
    const isActive = el.getAttribute('href') === '#' + hash;
    el.classList.toggle('nav-active', isActive);
    el.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

// ---------------------------------------------------------------------------
// AUTH ACTIONS
// ---------------------------------------------------------------------------

// Called when a login succeeds — sets state, renders nav, routes to home
function onLoginSuccess(employee) {
  _activateUser(employee);
  renderNav();
  window.location.hash = getHomeHash(employee.role);
}
window.onLoginSuccess = onLoginSuccess;

function renderLoginView() {
  const nav = document.getElementById('nav');
  const app = document.getElementById('app');
  if (!nav || !app) return;

  nav.innerHTML = '';
  nav.className = '';
  app.classList.remove('app-with-sidebar', 'app-with-bottom-nav');
  app.innerHTML = '';

  if (typeof renderLogin === 'function') {
    renderLogin(app);
  } else {
    // auth.js not built yet — minimal placeholder
    app.innerHTML = `
      <div class="view-placeholder">
        <div class="view-placeholder-inner">
          <span class="view-placeholder-icon" aria-hidden="true">🔐</span>
          <p class="view-placeholder-label">
            ${t('login.title') || 'تسجيل الدخول'}
          </p>
          <p class="view-placeholder-route">auth.js — Step 1.4</p>
        </div>
      </div>`;
  }
}

async function handleSignOut() {
  try {
    if (typeof apiLogout === 'function') await apiLogout();
  } catch (_) {
    // Server logout failure is non-fatal — local session is cleared regardless
  }
  _clearSession();
  window.location.hash = '';
  renderLoginView();
}

function handleLangToggle() {
  if (typeof setLanguage === 'function') {
    const current = localStorage.getItem('lmp_lang') || 'ar';
    setLanguage(current === 'ar' ? 'en' : 'ar');
  } else {
    // i18n.js not built yet — just flip the HTML dir attribute as a preview
    const html = document.documentElement;
    const next = html.getAttribute('dir') === 'rtl' ? 'ltr' : 'rtl';
    html.setAttribute('dir', next);
    html.setAttribute('lang', next === 'rtl' ? 'ar' : 'en');
    localStorage.setItem('lmp_lang', next === 'rtl' ? 'ar' : 'en');
  }
  // Re-render nav and current view with the new language
  renderNav();
  handleRoute();
}

// ---------------------------------------------------------------------------
// LOADING SCREEN
// ---------------------------------------------------------------------------
function setLoadingStatus(msg) {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = msg;
}

function hideLoadingScreen() {
  const screen = document.getElementById('loading-screen');
  if (!screen) return;
  screen.classList.add('loading-hide');
  screen.addEventListener('transitionend', () => {
    screen.style.display = 'none';
  }, { once: true });
}

// ---------------------------------------------------------------------------
// TOAST
// ---------------------------------------------------------------------------
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
  });

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}
window.showToast = showToast;

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function getHomeHash(role) {
  if (role === 'hr')      return 'dashboard';
  if (role === 'manager') return 'team';
  return 'home';
}

// Navigate to a route programmatically
function navigate(hash) {
  window.location.hash = hash || '';
}
window.navigate = navigate;

// Re-render nav on resize (debounced — switching between sidebar and bottom nav)
window.addEventListener('resize', () => {
  clearTimeout(App._resizeTimer);
  App._resizeTimer = setTimeout(() => {
    if (App.currentUser) {
      const curHash = window.location.hash.replace('#', '');
      renderNav();
      updateNavActive(curHash);
    }
  }, 150);
});
