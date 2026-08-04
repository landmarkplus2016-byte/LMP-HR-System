// =============================================================================
// biometric.js — WebAuthn fingerprint registration and check-in verification
//
// Orchestration:
//   registerFingerprint() — one-time setup, stores credential ID in localStorage
//   verifyFingerprint()   — called before every check-in, returns checkin_token
//
// Depends on: api.js (apiWebauthn*), i18n.js (t()), config.js (getConfig())
// =============================================================================

'use strict';

const _CRED_KEY = 'lmp_credential_id';

// ---------------------------------------------------------------------------
// Base64url helpers
//
// WebAuthn APIs require ArrayBuffer for challenge/id values and return them
// for response fields. Base64url (RFC 4648 §5) is used as the wire format
// between the browser and Apps Script.
// ---------------------------------------------------------------------------

function _bufToB64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g,  '');
}

function _b64urlToBuf(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// ---------------------------------------------------------------------------
// checkSupport — synchronous feature detection
// Returns { supported: bool }
// ---------------------------------------------------------------------------
function checkSupport() {
  return { supported: typeof window.PublicKeyCredential !== 'undefined' };
}

// ---------------------------------------------------------------------------
// checkPlatformAuth — async sensor check
// Returns true when the device has a fingerprint, face, or PIN authenticator.
// ---------------------------------------------------------------------------
async function checkPlatformAuth() {
  if (!checkSupport().supported) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// checkCapability — full pre-flight before showing any biometric prompt
//
// Phones fail registration for a handful of distinct reasons, and the browser
// reports most of them only as a generic NotAllowedError once the prompt has
// already been dismissed. Probing first lets the UI explain what to fix
// instead of showing "registration failed".
//
// Returns { ok, reasonKey, helpKey } — reasonKey/helpKey are i18n keys.
// ---------------------------------------------------------------------------
async function checkCapability() {
  // GPS and WebAuthn both need a secure context — an http:// or file:// origin
  // silently disables navigator.credentials.
  if (!window.isSecureContext) {
    return { ok: false, reasonKey: 'biometric.insecure_context', helpKey: 'biometric.help_insecure' };
  }

  if (!checkSupport().supported) {
    return { ok: false, reasonKey: 'biometric.not_supported', helpKey: 'biometric.help_browser' };
  }

  // False here means: no fingerprint/face sensor enrolled AND no screen lock
  // (PIN / pattern / password) set up. Both are user-fixable in phone settings.
  const hasPlatform = await checkPlatformAuth();
  if (!hasPlatform) {
    return { ok: false, reasonKey: 'biometric.no_screen_lock', helpKey: 'biometric.help_screen_lock' };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Map a WebAuthn DOMException to a bilingual i18n key.
//
// Android reports an unavailable sensor, a user cancellation and a prompt
// timeout all as NotAllowedError, so that key carries the broadest wording
// plus a pointer to the screen-lock fallback.
// ---------------------------------------------------------------------------
function _webauthnErrorKey(err) {
  switch (err && err.name) {
    case 'NotAllowedError':   return 'biometric.cancelled';
    case 'NotSupportedError': return 'biometric.no_sensor';
    case 'ConstraintError':   return 'biometric.no_screen_lock';
    case 'SecurityError':     return 'biometric.origin_error';
    case 'InvalidStateError': return 'biometric.already_on_device';
    case 'AbortError':        return 'biometric.timeout';
    case 'UnknownError':      return 'biometric.device_error';
    default:                  return 'biometric.not_supported';
  }
}

// ---------------------------------------------------------------------------
// isRegistered — credential presence check (synchronous)
// Returns true when a credential has been registered on this device.
// A missing credential ID means the registration flow must run first.
// ---------------------------------------------------------------------------
function isRegistered() {
  return !!localStorage.getItem(_CRED_KEY);
}

// ---------------------------------------------------------------------------
// registerFingerprint — one-time WebAuthn credential creation
//
// 1. Server issues a random 32-byte challenge (2-min TTL)
// 2. navigator.credentials.create() triggers the OS biometric prompt
// 3. Signed attestation is sent to the server for storage in Employees tab
// 4. On success: credential ID stored in localStorage lmp_credential_id
//
// Returns { success: true } or { success: false, reason: string }
// ---------------------------------------------------------------------------
async function registerFingerprint() {
  // 0 — capability pre-flight, so an unfixable device says why up front
  const cap = await checkCapability();
  if (!cap.ok) {
    return { success: false, reason: t(cap.reasonKey), helpKey: cap.helpKey };
  }

  // 1 — server challenge
  const challengeRes = await apiWebauthnRegisterChallenge();
  if (challengeRes.status !== 'ok') {
    return { success: false, reason: challengeRes.message || t('biometric.register_failed') };
  }

  const user = _currentUser();

  const publicKey = {
    challenge: _b64urlToBuf(challengeRes.data.challenge),
    rp: {
      id:   window.location.hostname,
      name: (typeof getConfig === 'function' ? getConfig('company_name') : '') || 'LMP Attendance',
    },
    user: {
      id:          new TextEncoder().encode(user.id || 'user'),
      name:        user.username || 'user',
      displayName: user.name || user.username || 'User',
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7   }, // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification:        'required',
      // Non-discoverable: the credential ID is stored server-side and replayed
      // in allowCredentials, so we never need a resident key. Asking for one
      // routes Android through the passkey/Google-account flow, which is what
      // fails on phones that are not signed in or have no passkey storage.
      residentKey:             'discouraged',
      requireResidentKey:      false,
    },
    timeout:     120000, // 2 min — rear/side sensors take longer to find
    attestation: 'none',
  };

  // 2 — OS biometric prompt, with one relaxed retry
  let credential;
  try {
    credential = await navigator.credentials.create({ publicKey });
  } catch (err) {
    // Some devices reject the strict platform-only request but succeed when
    // the attachment constraint is dropped (lets the OS offer screen-lock
    // credentials on phones whose sensor is not reported as a platform
    // authenticator). Only worth retrying for capability-shaped failures.
    const retryable = ['NotSupportedError', 'ConstraintError', 'NotReadableError', 'UnknownError'];
    if (retryable.includes(err.name)) {
      try {
        const fallbackKey = Object.assign({}, publicKey, {
          authenticatorSelection: {
            userVerification:   'required',
            residentKey:        'discouraged',
            requireResidentKey: false,
          },
        });
        credential = await navigator.credentials.create({ publicKey: fallbackKey });
      } catch (retryErr) {
        return { success: false, reason: t(_webauthnErrorKey(retryErr)), errorName: retryErr.name };
      }
    } else {
      return { success: false, reason: t(_webauthnErrorKey(err)), errorName: err.name };
    }
  }

  // 3 — send to server
  const credentialId   = _bufToB64url(credential.rawId);
  const attestationObj = _bufToB64url(credential.response.attestationObject);
  const clientDataJSON = _bufToB64url(credential.response.clientDataJSON);

  const completeRes = await apiWebauthnRegisterComplete(credentialId, attestationObj, clientDataJSON);
  if (completeRes.status !== 'ok') {
    return {
      success: false,
      reason:  completeRes.message || t('biometric.register_failed'),
      code:    completeRes.code || '',
    };
  }

  // 4 — persist locally
  localStorage.setItem(_CRED_KEY, credentialId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// verifyFingerprint — called before every check-in
//
// 1. Server issues a fresh single-use challenge (2-min TTL)
// 2. navigator.credentials.get() triggers the OS biometric prompt
// 3. Signed assertion is sent to the server
// 4. Server verifies challenge + credential ID → returns one-time checkin_token
//
// Returns { verified: true, checkin_token } or { verified: false, reason }
// ---------------------------------------------------------------------------
async function verifyFingerprint() {
  const storedCredId = localStorage.getItem(_CRED_KEY);
  if (!storedCredId) {
    return { verified: false, reason: t('biometric.not_registered'), needsRegistration: true };
  }

  // 1 — fresh server challenge
  const challengeRes = await apiWebauthnAuthChallenge();
  if (challengeRes.status !== 'ok') {
    // Server cleared this employee's credential (HR reset / new phone) — drop
    // the stale local one so the caller can send them through registration.
    if (challengeRes.code === 'biometric_not_registered') {
      clearRegistration();
      return { verified: false, reason: t('biometric.not_registered'), needsRegistration: true };
    }
    return { verified: false, reason: challengeRes.message || t('biometric.failed') };
  }

  // 2 — OS biometric prompt
  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: _b64urlToBuf(challengeRes.data.challenge),
        allowCredentials: [{
          type: 'public-key',
          id:   _b64urlToBuf(storedCredId),
          // Left unset on purpose: pinning transports to ['internal'] hides the
          // credential on devices that report their sensor differently.
        }],
        userVerification: 'required',
        timeout:          120000,
      },
    });
  } catch (err) {
    return { verified: false, reason: t(_webauthnErrorKey(err)), errorName: err.name };
  }

  // 3 — send signed assertion to server
  const signedResponse = {
    credentialId:      _bufToB64url(assertion.rawId),
    clientDataJSON:    _bufToB64url(assertion.response.clientDataJSON),
    authenticatorData: _bufToB64url(assertion.response.authenticatorData),
    signature:         _bufToB64url(assertion.response.signature),
  };

  const verifyRes = await apiWebauthnAuthVerify(signedResponse);
  if (verifyRes.status !== 'ok') {
    if (verifyRes.code === 'biometric_not_registered') {
      clearRegistration();
      return { verified: false, reason: t('biometric.not_registered'), needsRegistration: true };
    }
    return { verified: false, reason: verifyRes.message || t('biometric.failed') };
  }

  return { verified: true, checkin_token: verifyRes.data.checkin_token };
}

// ---------------------------------------------------------------------------
// clearRegistration — remove credential from this device
// Called when a new phone is detected or HR resets the employee's biometric.
// ---------------------------------------------------------------------------
function clearRegistration() {
  localStorage.removeItem(_CRED_KEY);
}

// ---------------------------------------------------------------------------
// Private: _currentUser — read stored employee profile
// ---------------------------------------------------------------------------
function _currentUser() {
  try {
    const raw = localStorage.getItem('lmp_user');
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
window.checkSupport        = checkSupport;
window.checkPlatformAuth   = checkPlatformAuth;
window.checkCapability     = checkCapability;
window.isRegistered        = isRegistered;
window.registerFingerprint = registerFingerprint;
window.verifyFingerprint   = verifyFingerprint;
window.clearRegistration   = clearRegistration;
