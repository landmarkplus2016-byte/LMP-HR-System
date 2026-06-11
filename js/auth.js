// =============================================================================
// auth.js — Login screen, password change screen, session management
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Module state
// Temporary credentials held in memory only during the forced-password-change
// flow. Never written to localStorage. Cleared on flow completion or back.
// ---------------------------------------------------------------------------
let _pendingUsername = '';
let _pendingOldHash  = '';

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------
const _EYE_OPEN = `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>`;

const _EYE_CLOSED = `<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.064 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>`;

const _GLOBE_ICON = `<svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" clip-rule="evenodd"/></svg>`;

const _BACK_ICON = `<svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd"/></svg>`;

const _LOCK_ICON = `<svg width="32" height="32" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg>`;

// ---------------------------------------------------------------------------
// _t — translation helper
// Uses i18n.js t() when available; falls back to static Arabic/English strings
// so the login screen is readable before i18n.js is built in Step 1.5.
// ---------------------------------------------------------------------------
function _t(key, ar, en) {
  if (typeof t === 'function') {
    const val = t(key);
    if (val !== key) return val;
  }
  const lang = localStorage.getItem('lmp_lang') || 'ar';
  return lang === 'ar' ? ar : en;
}

// =============================================================================
// Public: renderLogin
// Called by app.js renderLoginView() to display the login form.
// =============================================================================
function renderLogin(container) {
  // Clear any lingering password-change state when returning to login
  _pendingUsername = '';
  _pendingOldHash  = '';

  const lang = localStorage.getItem('lmp_lang') || 'ar';

  container.innerHTML = `
    <div class="auth-screen">

      <div class="auth-top-bar">
        <button class="auth-lang-btn" type="button" id="auth-lang-btn"
                aria-label="${_t('nav.toggle_language', 'تبديل اللغة', 'Toggle language')}">
          ${_GLOBE_ICON}
          <span>${lang === 'ar' ? 'EN' : 'AR'}</span>
        </button>
      </div>

      <div class="auth-card" role="main" aria-labelledby="auth-title">

        <div class="auth-card-header">
          <div class="auth-logo-wrap">
            <img src="assets/logo.svg" alt="" class="auth-logo" width="40" height="40"
                 onerror="this.style.display='none'">
            <span class="auth-logo-abbr">LMP</span>
          </div>
          <div id="auth-title" class="auth-app-name">
            ${_t('app.name', 'LMP Attendance', 'LMP Attendance')}
          </div>
          <div class="auth-app-tagline">
            ${_t('app.tagline', 'نظام متابعة الحضور والانصراف', 'Employee Attendance System')}
          </div>
        </div>

        <div class="auth-card-body">

          <div class="auth-error" id="login-error" role="alert" aria-live="assertive" hidden></div>

          <form class="auth-form" id="login-form" novalidate>

            <div class="field">
              <label class="field-label" for="login-username">
                ${_t('login.username', 'اسم المستخدم', 'Username')}
              </label>
              <input class="field-input" type="text" id="login-username"
                     name="username" autocomplete="username"
                     autocapitalize="none" autocorrect="off" spellcheck="false"
                     inputmode="text" required>
            </div>

            <div class="field">
              <label class="field-label" for="login-password">
                ${_t('login.password', 'كلمة المرور', 'Password')}
              </label>
              <div class="auth-input-wrap">
                <input class="field-input auth-pw-input" type="password"
                       id="login-password" name="password"
                       autocomplete="current-password" required>
                <button class="auth-eye-btn" type="button" tabindex="-1"
                        aria-label="${_t('login.show_password', 'إظهار كلمة المرور', 'Show password')}"
                        data-showing="false">${_EYE_OPEN}</button>
              </div>
            </div>

            <button class="btn btn-primary auth-submit" type="submit" id="login-submit">
              ${_t('login.submit', 'تسجيل الدخول', 'Sign In')}
            </button>

          </form>

          <p class="auth-footer">Landmark Plus &copy; ${new Date().getFullYear()}</p>

        </div>
      </div>
    </div>`;

  _bindLoginForm();
  _bindLangToggle('auth-lang-btn', () => renderLogin(container));

  // Defer focus so the DOM is painted and the element is measurable
  requestAnimationFrame(() => {
    document.getElementById('login-username')?.focus();
  });
}

// =============================================================================
// Private: renderPasswordChange
// Rendered after login returns { status: 'change_password' }.
// Cannot be dismissed — the user must complete the change or go back to login.
// =============================================================================
function _renderPasswordChange(container) {
  const lang = localStorage.getItem('lmp_lang') || 'ar';

  container.innerHTML = `
    <div class="auth-screen">

      <div class="auth-top-bar">
        <button class="auth-back-btn" type="button" id="auth-back-btn"
                aria-label="${_t('login.back_to_login', 'العودة إلى تسجيل الدخول', 'Back to sign in')}">
          ${_BACK_ICON}
          <span>${_t('login.back', 'العودة', 'Back')}</span>
        </button>
        <button class="auth-lang-btn" type="button" id="auth-lang-btn"
                aria-label="${_t('nav.toggle_language', 'تبديل اللغة', 'Toggle language')}">
          ${_GLOBE_ICON}
          <span>${lang === 'ar' ? 'EN' : 'AR'}</span>
        </button>
      </div>

      <div class="auth-card" role="main" aria-labelledby="change-pw-title">

        <div class="auth-card-header auth-card-header-change">
          <div class="auth-lock-icon">${_LOCK_ICON}</div>
          <div id="change-pw-title" class="auth-app-name">
            ${_t('change_pw.title', 'تغيير كلمة المرور', 'Change Password')}
          </div>
          <div class="auth-app-tagline">
            ${_t('change_pw.required', 'يجب تغيير كلمة المرور قبل المتابعة', 'Password change required before continuing')}
          </div>
        </div>

        <div class="auth-card-body">

          <div class="auth-error" id="change-error" role="alert" aria-live="assertive" hidden></div>

          <form class="auth-form" id="change-form" novalidate>

            <div class="field">
              <label class="field-label" for="new-password">
                ${_t('change_pw.new', 'كلمة المرور الجديدة', 'New password')}
              </label>
              <div class="auth-input-wrap">
                <input class="field-input auth-pw-input" type="password"
                       id="new-password" name="new-password"
                       autocomplete="new-password" required>
                <button class="auth-eye-btn" type="button" tabindex="-1"
                        aria-label="${_t('login.show_password', 'إظهار كلمة المرور', 'Show password')}"
                        data-showing="false">${_EYE_OPEN}</button>
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="confirm-password">
                ${_t('change_pw.confirm', 'تأكيد كلمة المرور', 'Confirm password')}
              </label>
              <div class="auth-input-wrap">
                <input class="field-input auth-pw-input" type="password"
                       id="confirm-password" name="confirm-password"
                       autocomplete="new-password" required>
                <button class="auth-eye-btn" type="button" tabindex="-1"
                        aria-label="${_t('login.show_password', 'إظهار كلمة المرور', 'Show password')}"
                        data-showing="false">${_EYE_OPEN}</button>
              </div>
            </div>

            <ul class="auth-requirements" aria-label="${_t('change_pw.requirements_label', 'متطلبات كلمة المرور', 'Password requirements')}">
              <li class="auth-requirement" id="req-length">
                <span class="auth-req-dot" aria-hidden="true"></span>
                ${_t('change_pw.req_length', '٨ أحرف على الأقل', '8 characters minimum')}
              </li>
              <li class="auth-requirement" id="req-match">
                <span class="auth-req-dot" aria-hidden="true"></span>
                ${_t('change_pw.req_match', 'كلمتا المرور متطابقتان', 'Passwords match')}
              </li>
            </ul>

            <button class="btn btn-primary auth-submit" type="submit" id="change-submit">
              ${_t('change_pw.submit', 'تغيير كلمة المرور', 'Change Password')}
            </button>

          </form>

        </div>
      </div>
    </div>`;

  _bindPasswordChangeForm(container);
  _bindLangToggle('auth-lang-btn', () => _renderPasswordChange(container));

  document.getElementById('auth-back-btn')?.addEventListener('click', () => {
    _pendingUsername = '';
    _pendingOldHash  = '';
    renderLogin(container);
  });

  requestAnimationFrame(() => {
    document.getElementById('new-password')?.focus();
  });
}

// =============================================================================
// Session management (public)
// =============================================================================

function getCurrentUser() {
  try {
    const raw = localStorage.getItem('lmp_user');
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function getSessionToken() {
  return localStorage.getItem('lmp_session') || null;
}

function logout() {
  localStorage.removeItem('lmp_session');
  localStorage.removeItem('lmp_user');
  _pendingUsername = '';
  _pendingOldHash  = '';
}

window.getCurrentUser  = getCurrentUser;
window.getSessionToken = getSessionToken;
window.logout          = logout;
window.renderLogin     = renderLogin;

// =============================================================================
// Private: form binding
// =============================================================================

function _bindLoginForm() {
  const form      = document.getElementById('login-form');
  const submitBtn = document.getElementById('login-submit');

  // Show/hide password toggles
  document.querySelectorAll('.auth-eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      if (input) _toggleEye(input, btn);
    });
  });

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    _clearError('login-error');

    const username = document.getElementById('login-username')?.value?.trim() || '';
    const password = document.getElementById('login-password')?.value || '';

    if (!username) {
      _showError('login-error', _t('error.username_required', 'الرجاء إدخال اسم المستخدم', 'Please enter your username'));
      document.getElementById('login-username')?.focus();
      return;
    }
    if (!password) {
      _showError('login-error', _t('error.password_required', 'الرجاء إدخال كلمة المرور', 'Please enter your password'));
      document.getElementById('login-password')?.focus();
      return;
    }

    const defaultLabel = _t('login.submit', 'تسجيل الدخول', 'Sign In');
    _setLoading(submitBtn, true, defaultLabel);

    try {
      const passwordHash = typeof hashPassword === 'function'
        ? await hashPassword(password)
        : password;

      const result = await apiLogin(username, passwordHash);

      if (result.status === 'change_password') {
        _pendingUsername = username;
        _pendingOldHash  = passwordHash;
        const container  = document.getElementById('app');
        if (container) _renderPasswordChange(container);
        return;
      }

      if (result.status === 'ok') {
        _storeSession(result.data);
        if (typeof onLoginSuccess === 'function') onLoginSuccess(result.data.employee);
        return;
      }

      // Error
      const msg = result.message || _t('error.invalid_credentials', 'بيانات الدخول غير صحيحة', 'Invalid credentials');
      _showError('login-error', msg);
      const pwField = document.getElementById('login-password');
      if (pwField) { pwField.value = ''; pwField.focus(); }

    } catch (err) {
      console.error('[Auth] login error:', err.message);
      _showError('login-error', _t('error.network', 'خطأ في الاتصال. حاول مجدداً.', 'Connection error. Please try again.'));
    } finally {
      _setLoading(submitBtn, false, defaultLabel);
    }
  });
}

function _bindPasswordChangeForm(container) {
  const form       = document.getElementById('change-form');
  const submitBtn  = document.getElementById('change-submit');
  const newPwInput = document.getElementById('new-password');
  const conPwInput = document.getElementById('confirm-password');

  // Show/hide toggles
  document.querySelectorAll('.auth-eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      if (input) _toggleEye(input, btn);
    });
  });

  // Live requirement validation
  function checkReqs() {
    const newPw = newPwInput?.value || '';
    const conPw = conPwInput?.value || '';
    _setReq('req-length', newPw.length >= 8);
    _setReq('req-match',  newPw.length > 0 && newPw === conPw);
  }
  newPwInput?.addEventListener('input', checkReqs);
  conPwInput?.addEventListener('input', checkReqs);

  const defaultLabel = _t('change_pw.submit', 'تغيير كلمة المرور', 'Change Password');

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    _clearError('change-error');

    const newPw = newPwInput?.value || '';
    const conPw = conPwInput?.value || '';

    if (newPw.length < 8) {
      _showError('change-error', _t('error.pw_too_short', 'كلمة المرور يجب أن تكون ٨ أحرف على الأقل', 'Password must be at least 8 characters'));
      newPwInput?.focus();
      return;
    }
    if (newPw !== conPw) {
      _showError('change-error', _t('error.pw_mismatch', 'كلمتا المرور غير متطابقتين', 'Passwords do not match'));
      conPwInput?.focus();
      return;
    }
    if (!_pendingUsername || !_pendingOldHash) {
      // State lost (page refresh) — go back to login
      renderLogin(container);
      return;
    }

    _setLoading(submitBtn, true, defaultLabel);

    try {
      const newHash = typeof hashPassword === 'function'
        ? await hashPassword(newPw)
        : newPw;

      const result = await apiChangePassword(_pendingUsername, _pendingOldHash, newHash);

      if (result.status === 'ok') {
        _storeSession(result.data);
        _pendingUsername = '';
        _pendingOldHash  = '';
        if (typeof onLoginSuccess === 'function') onLoginSuccess(result.data.employee);
        return;
      }

      const msg = result.message || _t('error.change_pw_failed', 'فشل تغيير كلمة المرور', 'Password change failed');
      _showError('change-error', msg);

    } catch (err) {
      console.error('[Auth] change password error:', err.message);
      _showError('change-error', _t('error.network', 'خطأ في الاتصال. حاول مجدداً.', 'Connection error. Please try again.'));
    } finally {
      _setLoading(submitBtn, false, defaultLabel);
    }
  });
}

// =============================================================================
// Private: helpers
// =============================================================================

function _storeSession(data) {
  if (data.token)    localStorage.setItem('lmp_session', data.token);
  if (data.employee) localStorage.setItem('lmp_user',    JSON.stringify(data.employee));
  if (data.config && typeof setCachedConfig === 'function') setCachedConfig(data.config);
}

function _bindLangToggle(btnId, rerender) {
  document.getElementById(btnId)?.addEventListener('click', () => {
    const current = localStorage.getItem('lmp_lang') || 'ar';
    const next    = current === 'ar' ? 'en' : 'ar';
    if (typeof setLanguage === 'function') {
      setLanguage(next);
    } else {
      localStorage.setItem('lmp_lang', next);
      document.documentElement.lang = next;
      document.documentElement.dir  = next === 'ar' ? 'rtl' : 'ltr';
      rerender();
    }
  });
}

function _showError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.hidden      = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _clearError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = '';
  el.hidden      = true;
}

function _setLoading(btn, loading, defaultText) {
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading
    ? _t('loading.verifying', 'جارٍ التحقق…', 'Verifying…')
    : defaultText;
}

function _toggleEye(input, btn) {
  const nowPassword = input.type === 'password';
  input.type        = nowPassword ? 'text' : 'password';
  btn.innerHTML     = nowPassword ? _EYE_CLOSED : _EYE_OPEN;
  btn.setAttribute('data-showing', String(nowPassword));
  btn.setAttribute('aria-label',
    nowPassword
      ? _t('login.hide_password', 'إخفاء كلمة المرور', 'Hide password')
      : _t('login.show_password', 'إظهار كلمة المرور', 'Show password')
  );
}

function _setReq(reqId, met) {
  const el = document.getElementById(reqId);
  if (!el) return;
  el.classList.toggle('met', met);
}
