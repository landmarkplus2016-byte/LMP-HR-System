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
  // 1 — server challenge
  const challengeRes = await apiWebauthnRegisterChallenge();
  if (challengeRes.status !== 'ok') {
    return { success: false, reason: challengeRes.message || t('biometric.register_failed') };
  }

  const user = _currentUser();

  // 2 — OS biometric prompt
  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
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
          residentKey:             'preferred',
        },
        timeout:     60000,
        attestation: 'none',
      },
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      return { success: false, reason: t('biometric.failed') };
    }
    return { success: false, reason: t('biometric.not_supported') };
  }

  // 3 — send to server
  const credentialId   = _bufToB64url(credential.rawId);
  const attestationObj = _bufToB64url(credential.response.attestationObject);
  const clientDataJSON = _bufToB64url(credential.response.clientDataJSON);

  const completeRes = await apiWebauthnRegisterComplete(credentialId, attestationObj, clientDataJSON);
  if (completeRes.status !== 'ok') {
    return { success: false, reason: completeRes.message || t('biometric.register_failed') };
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
    return { verified: false, reason: t('biometric.not_registered') };
  }

  // 1 — fresh server challenge
  const challengeRes = await apiWebauthnAuthChallenge();
  if (challengeRes.status !== 'ok') {
    return { verified: false, reason: challengeRes.message || t('biometric.failed') };
  }

  // 2 — OS biometric prompt
  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: _b64urlToBuf(challengeRes.data.challenge),
        allowCredentials: [{
          type:       'public-key',
          id:         _b64urlToBuf(storedCredId),
          transports: ['internal'],
        }],
        userVerification: 'required',
        timeout:          60000,
      },
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      return { verified: false, reason: t('biometric.failed') };
    }
    return { verified: false, reason: t('biometric.not_supported') };
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
window.isRegistered        = isRegistered;
window.registerFingerprint = registerFingerprint;
window.verifyFingerprint   = verifyFingerprint;
window.clearRegistration   = clearRegistration;
