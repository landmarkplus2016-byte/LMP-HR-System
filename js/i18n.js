// =============================================================================
// i18n.js — Bilingual Arabic / English translation engine
// Default language: Arabic (RTL). All locale strings live in locales/*.json.
// =============================================================================

'use strict';

// Loaded locale strings and current language tag
let _strings = {};
let _lang    = 'ar';

// =============================================================================
// t — synchronous translation lookup (exported to window)
//
// Supports dot-notation keys: t('login.submit') → _strings.login.submit
// Returns the key itself when a string is missing — visible in the UI as a
// signal that a translation is needed, never silently drops text.
// =============================================================================
function t(key) {
  const parts = String(key).split('.');
  let   node  = _strings;

  for (const part of parts) {
    if (node === null || typeof node !== 'object') return key;
    node = node[part];
  }

  return (node !== undefined && node !== null) ? String(node) : key;
}

// =============================================================================
// loadI18n — async, called by App.init() before any rendering
//
// Reads lmp_lang from localStorage (defaulting to 'ar'), fetches the matching
// locale file, applies dir/lang to <html>, and populates _strings so all
// subsequent t() calls are synchronous.
// =============================================================================
async function loadI18n() {
  const lang = localStorage.getItem('lmp_lang') || 'ar';
  await _fetchLocale(lang);
  _applyHtmlAttrs(_lang);
}

// =============================================================================
// setLanguage — called by language toggle buttons and from auth screens
//
// Accepts 'ar' or 'en'. Fetches the new locale, stores the preference,
// updates the HTML element, then re-renders the current view so every
// visible string reflects the new language without a page reload.
// =============================================================================
async function setLanguage(lang) {
  const next = lang === 'en' ? 'en' : 'ar';
  await _fetchLocale(next);
  localStorage.setItem('lmp_lang', next);
  _applyHtmlAttrs(next);
  _rerenderCurrentView();
}

// =============================================================================
// Private helpers
// =============================================================================

async function _fetchLocale(lang) {
  const code = lang === 'en' ? 'en' : 'ar';
  try {
    const res = await fetch('locales/' + code + '.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _strings = await res.json();
    _lang    = code;
  } catch (err) {
    console.warn('[i18n] Failed to load locale "' + code + '":', err.message);
    // Keep _strings and _lang as-is so the app stays functional.
    // If this is the very first load and _strings is empty, t() returns keys
    // as readable fallbacks — acceptable for a network-failure edge case.
  }
}

// Apply language code and layout direction to the root HTML element.
// rtl.css uses [dir="rtl"] selectors, so this single change activates RTL.
function _applyHtmlAttrs(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
}

// Re-render nav and the current view after a language switch.
// Uses function declarations from app.js which are always on window.
function _rerenderCurrentView() {
  const hasSession = !!localStorage.getItem('lmp_session');

  if (hasSession) {
    if (typeof renderNav   === 'function') renderNav();
    if (typeof handleRoute === 'function') handleRoute();
  } else {
    if (typeof renderLoginView === 'function') renderLoginView();
  }
}

// =============================================================================
// Exports
// =============================================================================
window.t           = t;
window.loadI18n    = loadI18n;
window.setLanguage = setLanguage;
