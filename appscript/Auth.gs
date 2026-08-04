// =============================================================================
// Auth.gs — Login, session management, password change, WebAuthn
// =============================================================================
//
// Employees tab additions required for biometric rate-limiting (Stage 6):
//   Add two columns to the Employees sheet:
//     biometric_locked     — 'TRUE' / 'FALSE' / ''
//     biometric_locked_at  — ISO timestamp set when lock is applied, '' otherwise
//   HR screens can display these to flag locked employees.

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------
// Payload: { username, password_hash, device_id }
// Returns:
//   { status: 'locked', minutes_remaining }     — rate limited
//   { status: 'change_password', employee_id }  — first login
//   ok({ token, employee, config })             — normal login
//   error(...)                                  — bad credentials / inactive
function login(payload) {
  const username     = String(payload.username      || '').trim();
  const passwordHash = String(payload.password_hash || '').trim();
  const deviceId     = String(payload.device_id     || '');

  if (!username || !passwordHash) {
    return error('Username and password are required', 'اسم المستخدم وكلمة المرور مطلوبان');
  }

  // Rate limiting — check for account lockout before touching credentials
  const loginLock = _checkLoginLock(username);
  if (loginLock.locked) {
    return {
      status:            'locked',
      minutes_remaining: loginLock.minutes_remaining,
      message_en: 'Account locked due to too many failed attempts. Try again in ' +
                  loginLock.minutes_remaining + ' minute(s).',
      message_ar: 'تم قفل الحساب بسبب كثرة محاولات الدخول الفاشلة. حاول مرة أخرى خلال ' +
                  loginLock.minutes_remaining + ' دقيقة.'
    };
  }

  const empSheet = getSheet('Employees');
  const employee  = findRow(empSheet, 'username', username);

  if (!employee) {
    _recordFailedLogin(username);
    return error('Invalid credentials', 'بيانات الدخول غير صحيحة');
  }

  if (String(employee.active).toUpperCase() !== 'TRUE') {
    return error('Account is inactive', 'الحساب غير نشط');
  }

  if (String(employee.password_hash) !== passwordHash) {
    _recordFailedLogin(username);
    return error('Invalid credentials', 'بيانات الدخول غير صحيحة');
  }

  // Successful auth — clear any failed attempt counter
  _clearFailedLogin(username);

  if (String(employee.force_password_change).toUpperCase() === 'TRUE') {
    // No session created yet — frontend must show password change screen first
    return { status: 'change_password', employee_id: employee.id };
  }

  const token  = createSession(employee.id, employee.role, deviceId);
  const config = getAllConfig();

  return ok({ token, employee: safeEmployee(employee), config });
}

// ---------------------------------------------------------------------------
// changePassword
// ---------------------------------------------------------------------------
// Called from the force-change screen (no session yet) and from profile settings.
// Payload: { username, old_password_hash, new_password_hash, device_id }
// Returns: ok({ token, employee, config }) on success — creates session immediately.
function changePassword(payload) {
  const username  = String(payload.username          || '').trim();
  const oldHash   = String(payload.old_password_hash || '').trim();
  const newHash   = String(payload.new_password_hash || '').trim();
  const deviceId  = String(payload.device_id         || '');

  if (!username || !oldHash || !newHash) {
    return error('Missing required fields', 'الحقول المطلوبة مفقودة');
  }

  const empSheet = getSheet('Employees');
  const employee  = findRow(empSheet, 'username', username);

  if (!employee) {
    return error('Invalid credentials', 'بيانات الدخول غير صحيحة');
  }

  if (String(employee.active).toUpperCase() !== 'TRUE') {
    return error('Account is inactive', 'الحساب غير نشط');
  }

  if (String(employee.password_hash) !== oldHash) {
    return error('Current password is incorrect', 'كلمة المرور الحالية غير صحيحة');
  }

  updateRow(empSheet, employee.__rowIndex, {
    password_hash:         newHash,
    force_password_change: 'FALSE'
  });

  const token  = createSession(employee.id, employee.role, deviceId);
  const config = getAllConfig();

  // Re-read so the returned profile reflects the updated fields
  const updated = findRow(empSheet, 'id', employee.id);
  return ok({ token, employee: safeEmployee(updated), config });
}

// ---------------------------------------------------------------------------
// validateSession
// ---------------------------------------------------------------------------
// Called at the top of every authenticated handler.
// Returns { valid: true, employee, session } or { valid: false, error: <obj> }.
// Never throws — callers check .valid before proceeding.
function validateSession(payload) {
  const token    = String(payload.session_token || '').trim();

  if (!token) {
    return { valid: false, error: error('Session token required', 'رمز الجلسة مطلوب') };
  }

  const sessSheet = getSheet('Sessions');
  const session   = findRow(sessSheet, 'token', token);

  if (!session) {
    return { valid: false, error: error('Invalid session', 'جلسة غير صالحة') };
  }

  // Only validate auth sessions here — WebAuthn challenge rows are handled
  // separately in the webauthn* functions below
  if (session.token_type && String(session.token_type) !== 'session') {
    return { valid: false, error: error('Invalid session', 'جلسة غير صالحة') };
  }

  const now       = new Date();
  const expiresAt = new Date(session.expires_at);

  if (isNaN(expiresAt.getTime()) || now > expiresAt) {
    deleteSheetRow(sessSheet, session.__rowIndex);
    return {
      valid: false,
      error: error(
        'Session expired. Please log in again.',
        'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً'
      )
    };
  }

  const empSheet = getSheet('Employees');
  const employee  = findRow(empSheet, 'id', String(session.employee_id));

  if (!employee) {
    return { valid: false, error: error('Employee not found', 'الموظف غير موجود') };
  }

  if (String(employee.active).toUpperCase() !== 'TRUE') {
    return { valid: false, error: error('Account is inactive', 'الحساب غير نشط') };
  }

  return { valid: true, employee, session };
}

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------
// Payload: { session_token, device_id }
function logout(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const sessSheet = getSheet('Sessions');
  deleteSheetRow(sessSheet, auth.session.__rowIndex);

  return ok({ message: 'Logged out successfully' });
}

// ---------------------------------------------------------------------------
// createSession  (called internally by login and changePassword)
// ---------------------------------------------------------------------------
function createSession(employeeId, role, deviceId) {
  const token       = Utilities.getUuid();
  const expiryHours = Number(getConfigValue('session_expiry_hours', 8)) || 8;
  const expiresAt   = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

  appendRow(getSheet('Sessions'), {
    token,
    employee_id: employeeId,
    role,
    expires_at:  expiresAt.toISOString(),
    device_id:   deviceId || '',
    token_type:  'session',
    challenge:   '',
    used:        ''
  });

  return token;
}

// ---------------------------------------------------------------------------
// hrResetPassword  (HR-only — sets a new password for any employee)
// ---------------------------------------------------------------------------
// Payload: { session_token, device_id, employee_id, new_password_hash, force_change }
// force_change: 'true' (default) → employee must change on next login
function hrResetPassword(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role).toLowerCase() !== 'hr') {
    return error('Access denied — HR role required', 'رفض الوصول — يلزم دور مدير الموارد البشرية');
  }

  const employeeId  = String(payload.employee_id       || '').trim();
  const newHash     = String(payload.new_password_hash  || '').trim();
  const forceChange = String(payload.force_change || 'true').toUpperCase() !== 'FALSE';

  if (!employeeId || !newHash) {
    return error('Missing required fields', 'الحقول المطلوبة مفقودة');
  }

  const empSheet = getSheet('Employees');
  const employee  = findRow(empSheet, 'id', employeeId);

  if (!employee) {
    return error('Employee not found', 'الموظف غير موجود');
  }

  if (employee.id === auth.employee.id) {
    return error('Use "Change Password" to update your own password',
                 'استخدم "تغيير كلمة المرور" لتحديث كلمة مرورك الخاصة');
  }

  updateRow(empSheet, employee.__rowIndex, {
    password_hash:         newHash,
    force_password_change: forceChange ? 'TRUE' : 'FALSE'
  });

  return ok({ reset: true, employee_id: employeeId });
}

// ---------------------------------------------------------------------------
// hrResetBiometric  (HR-only — clears a registered fingerprint credential)
// ---------------------------------------------------------------------------
// Payload: { session_token, device_id, employee_id }
// Required before an employee can register biometrics on a new phone — see
// the registration guard in webauthnRegisterComplete below. Also clears any
// active biometric lockout so the employee isn't stuck after re-registering.
function hrResetBiometric(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  if (String(auth.employee.role).toLowerCase() !== 'hr') {
    return error('Access denied — HR role required', 'رفض الوصول — يلزم دور مدير الموارد البشرية');
  }

  const employeeId = String(payload.employee_id || '').trim();
  if (!employeeId) return error('employee_id is required', 'معرّف الموظف مطلوب');

  const empSheet = getSheet('Employees');
  const employee  = findRow(empSheet, 'id', employeeId);
  if (!employee) return error('Employee not found', 'الموظف غير موجود');

  updateRow(empSheet, employee.__rowIndex, {
    webauthn_credential_id:  '',
    webauthn_public_key:     '',
    webauthn_registered_at:  '',
    biometric_locked:        'FALSE',
    biometric_locked_at:     ''
  });

  return ok({ reset: true, employee_id: employeeId });
}

// ---------------------------------------------------------------------------
// getConfig  (public — no session required)
// ---------------------------------------------------------------------------
function getConfig(payload) {
  return ok({ config: getAllConfig() });
}

// ---------------------------------------------------------------------------
// getProfile  (requires valid session)
// ---------------------------------------------------------------------------
function getProfile(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  return ok({ employee: safeEmployee(auth.employee) });
}

// ---------------------------------------------------------------------------
// safeEmployee  (private helper)
// ---------------------------------------------------------------------------
function safeEmployee(employee) {
  const safe = Object.assign({}, employee);
  delete safe.password_hash;
  delete safe.webauthn_public_key;
  delete safe.__rowIndex;
  return safe;
}

// ---------------------------------------------------------------------------
// webauthnRegisterChallenge
// ---------------------------------------------------------------------------
// Payload: { session_token, device_id }
function webauthnRegisterChallenge(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const challenge = _generateChallenge();
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000);

  appendRow(getSheet('Sessions'), {
    token:       challenge,
    employee_id: auth.employee.id,
    role:        auth.employee.role,
    expires_at:  expiresAt.toISOString(),
    device_id:   String(payload.device_id || ''),
    token_type:  'webauthn_reg',
    challenge:   challenge,
    used:        ''
  });

  return ok({ challenge });
}

// ---------------------------------------------------------------------------
// webauthnRegisterComplete
// ---------------------------------------------------------------------------
// Payload: { session_token, credentialId, publicKey, signedChallenge }
function webauthnRegisterComplete(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  // Registration is one-time per employee. A credential already on file means
  // someone else's device tripped the "new phone" prompt with this account's
  // password — block it here instead of silently handing them check-in access.
  // HR must clear it first (hrResetBiometric) after confirming with the real employee.
  if (String(auth.employee.webauthn_credential_id || '').trim()) {
    return error(
      'Biometric already registered for this account. Ask HR to reset it before registering on a new device.',
      'البصمة مسجّلة بالفعل لهذا الحساب. اطلب من إدارة الموارد البشرية إعادة تعيينها قبل التسجيل على جهاز جديد.',
      'biometric_already_registered'
    );
  }

  const credentialId  = String(payload.credentialId   || '').trim();
  const attestObj     = String(payload.publicKey       || '').trim();
  const clientDataB64 = String(payload.signedChallenge || '').trim();

  if (!credentialId || !attestObj || !clientDataB64) {
    return error('Missing credential data', 'بيانات الاعتماد مفقودة');
  }

  let clientData;
  try {
    clientData = JSON.parse(_b64urlToString(clientDataB64));
  } catch (e) {
    return error('Invalid credential data', 'بيانات الاعتماد غير صالحة');
  }

  if (clientData.type !== 'webauthn.create') {
    return error('Invalid operation type', 'نوع العملية غير صالح');
  }
  if (!clientData.origin || !clientData.origin.startsWith('https://')) {
    return error('Insecure origin rejected', 'المصدر غير آمن');
  }

  const challenge = (clientData.challenge || '').replace(/=/g, '');
  const sessSheet = getSheet('Sessions');
  const row = _findChallengeRow(sessSheet, challenge, auth.employee.id, 'webauthn_reg');
  if (!row) {
    return error('Challenge not found or expired', 'انتهت صلاحية التحقق أو غير موجود');
  }

  updateRow(sessSheet, row.__rowIndex, { used: 'TRUE' });

  const empSheet = getSheet('Employees');
  updateRow(empSheet, auth.employee.__rowIndex, {
    webauthn_credential_id:  credentialId,
    webauthn_public_key:     attestObj,
    webauthn_registered_at:  new Date().toISOString()
  });

  return ok({ registered: true });
}

// ---------------------------------------------------------------------------
// webauthnAuthChallenge
// ---------------------------------------------------------------------------
// Payload: { session_token, device_id }
// Blocked while the employee's biometric check-in is locked.
function webauthnAuthChallenge(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  // Refuse to issue a challenge while biometric check-in is locked
  const bioLock = _checkBiometricLock(String(auth.employee.id));
  if (bioLock.locked) {
    return {
      status:            'biometric_locked',
      minutes_remaining: bioLock.minutes_remaining,
      message_en: 'Biometric check-in locked due to too many failed attempts. ' +
                  'Try again in ' + bioLock.minutes_remaining + ' minute(s).',
      message_ar: 'تم قفل تسجيل الحضور بالبصمة بسبب كثرة المحاولات الفاشلة. ' +
                  'حاول مرة أخرى خلال ' + bioLock.minutes_remaining + ' دقيقة.'
    };
  }

  const challenge = _generateChallenge();
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000);

  appendRow(getSheet('Sessions'), {
    token:       challenge,
    employee_id: auth.employee.id,
    role:        auth.employee.role,
    expires_at:  expiresAt.toISOString(),
    device_id:   String(payload.device_id || ''),
    token_type:  'webauthn_auth',
    challenge:   challenge,
    used:        ''
  });

  return ok({ challenge });
}

// ---------------------------------------------------------------------------
// webauthnAuthVerify
// ---------------------------------------------------------------------------
// Payload: { session_token, signedResponse: {
//   credentialId, clientDataJSON, authenticatorData, signature  (all b64url)
// }}
//
// Failed verifications are counted per employee. After 3 failures in 10 min
// the employee is locked for 30 min — biometric_locked=TRUE is written to
// the Employees tab so HR can see the flag in the dashboard.
//
// NOTE: Apps Script cannot verify the ECDSA P-256 assertion signature.
// Security relies on server-generated single-use challenges, HTTPS, and
// session validation as layered controls.
function webauthnAuthVerify(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  // Check biometric lock before proceeding
  const bioLock = _checkBiometricLock(String(auth.employee.id));
  if (bioLock.locked) {
    return {
      status:            'biometric_locked',
      minutes_remaining: bioLock.minutes_remaining,
      message_en: 'Biometric check-in locked due to too many failed attempts. ' +
                  'Try again in ' + bioLock.minutes_remaining + ' minute(s).',
      message_ar: 'تم قفل تسجيل الحضور بالبصمة بسبب كثرة المحاولات الفاشلة. ' +
                  'حاول مرة أخرى خلال ' + bioLock.minutes_remaining + ' دقيقة.'
    };
  }

  const sr = payload.signedResponse;
  if (!sr || !sr.credentialId || !sr.clientDataJSON || !sr.authenticatorData || !sr.signature) {
    return error('Missing signed response fields', 'بيانات الاستجابة الموقّعة مفقودة');
  }

  let clientData;
  try {
    clientData = JSON.parse(_b64urlToString(sr.clientDataJSON));
  } catch (e) {
    return error('Invalid signed response', 'بيانات الاستجابة غير صالحة');
  }

  if (clientData.type !== 'webauthn.get') {
    return error('Invalid operation type', 'نوع العملية غير صالح');
  }
  if (!clientData.origin || !clientData.origin.startsWith('https://')) {
    return error('Insecure origin rejected', 'المصدر غير آمن');
  }

  // Validate challenge — counts as a failed attempt if not found (replay/tamper)
  const challenge = (clientData.challenge || '').replace(/=/g, '');
  const sessSheet = getSheet('Sessions');
  const row = _findChallengeRow(sessSheet, challenge, auth.employee.id, 'webauthn_auth');
  if (!row) {
    _recordWebAuthnFailure(auth.employee.id);
    return error('Challenge not found or expired', 'انتهت صلاحية التحقق أو غير موجود');
  }

  // Verify credential ID matches the registered credential
  const storedCredId = String(auth.employee.webauthn_credential_id || '').trim();
  if (!storedCredId) {
    // HR cleared the credential (reset / new phone) while this device still
    // holds a stale local one — the code tells the PWA to re-register.
    return error(
      'Biometric not registered for this account',
      'البصمة غير مسجّلة لهذا الحساب',
      'biometric_not_registered'
    );
  }
  if (storedCredId !== sr.credentialId) {
    _recordWebAuthnFailure(auth.employee.id);
    return error(
      'Credential mismatch',
      'بيانات الاعتماد غير متطابقة',
      'biometric_credential_mismatch'
    );
  }

  // Mark challenge as used — single-use enforcement
  updateRow(sessSheet, row.__rowIndex, { used: 'TRUE' });

  // Issue one-time checkin_token (2-min expiry)
  const checkinToken = Utilities.getUuid();
  const tokenExpiry  = new Date(Date.now() + 2 * 60 * 1000);

  appendRow(sessSheet, {
    token:       checkinToken,
    employee_id: auth.employee.id,
    role:        auth.employee.role,
    expires_at:  tokenExpiry.toISOString(),
    device_id:   String(payload.device_id || ''),
    token_type:  'checkin_token',
    challenge:   '',
    used:        ''
  });

  return ok({ verified: true, checkin_token: checkinToken });
}

// =============================================================================
// Private helpers — WebAuthn (challenge generation + lookup)
// =============================================================================

function _generateChallenge() {
  const seed  = Utilities.getUuid() + Date.now().toString() + Math.random().toString(36).slice(2);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function _b64urlToString(b64url) {
  const padding = (4 - (b64url.length % 4)) % 4;
  const padded  = b64url + '='.repeat(padding);
  const bytes   = Utilities.base64DecodeWebSafe(padded);
  return Utilities.newBlob(bytes).getDataAsString();
}

// Returns the matching Sessions row or null if not found / expired / used.
function _findChallengeRow(sessSheet, challenge, employeeId, tokenType) {
  if (!challenge) return null;

  const row = findRow(sessSheet, 'token', challenge);
  if (!row)                                              return null;
  if (String(row.token_type)  !== tokenType)             return null;
  if (String(row.employee_id) !== String(employeeId))    return null;
  if (String(row.used).toUpperCase() === 'TRUE')         return null;

  const now       = new Date();
  const expiresAt = new Date(row.expires_at);
  if (isNaN(expiresAt.getTime()) || now > expiresAt) {
    deleteSheetRow(sessSheet, row.__rowIndex);
    return null;
  }

  return row;
}

// =============================================================================
// Private helpers — Rate limiting
// =============================================================================
//
// The Sessions tab stores rate-limit counters as lightweight rows (no extra sheet).
// Column mapping for these special rows:
//   token       → 'failed_<username>'  or  'webauthn_fail_<employee_id>'
//   token_type  → 'failed_attempt'     or  'webauthn_fail'
//   challenge   → attempt count (string integer)
//   device_id   → last_attempt ISO timestamp
//   expires_at  → lock_until ISO timestamp  ('' = not yet locked)
//   role, used  → '' (unused)

const _LOGIN_MAX_ATTEMPTS  = 5;
const _LOGIN_WINDOW_MS     = 10 * 60 * 1000; // 10 min rolling window
const _LOGIN_LOCKOUT_MS    = 30 * 60 * 1000; // 30 min lockout

const _WEBAUTHN_MAX_FAILURES = 3;
const _WEBAUTHN_WINDOW_MS    = 10 * 60 * 1000;
const _WEBAUTHN_LOCKOUT_MS   = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Login rate limiting
// ---------------------------------------------------------------------------

function _checkLoginLock(username) {
  const row = findRow(getSheet('Sessions'), 'token', 'failed_' + username);
  if (!row) return { locked: false };

  const lockUntil = new Date(row.expires_at);
  if (isNaN(lockUntil.getTime())) return { locked: false };

  const now = new Date();
  if (now >= lockUntil) return { locked: false }; // expired naturally

  return {
    locked:            true,
    minutes_remaining: Math.ceil((lockUntil.getTime() - now.getTime()) / 60000)
  };
}

function _recordFailedLogin(username) {
  const sessSheet = getSheet('Sessions');
  const now       = new Date();
  const tokenKey  = 'failed_' + username;
  const row       = findRow(sessSheet, 'token', tokenKey);

  if (!row) {
    appendRow(sessSheet, {
      token:       tokenKey,
      employee_id: username,
      role:        '',
      expires_at:  '',
      device_id:   now.toISOString(),
      token_type:  'failed_attempt',
      challenge:   '1',
      used:        ''
    });
    return;
  }

  // Reset counter if last attempt was outside the rolling window
  const lastAttempt = new Date(row.device_id);
  let count = parseInt(String(row.challenge), 10) || 0;
  if (!isNaN(lastAttempt.getTime()) &&
      (now.getTime() - lastAttempt.getTime()) > _LOGIN_WINDOW_MS) {
    count = 0;
  }
  count++;

  const updates = { challenge: String(count), device_id: now.toISOString() };
  if (count >= _LOGIN_MAX_ATTEMPTS) {
    updates.expires_at = new Date(now.getTime() + _LOGIN_LOCKOUT_MS).toISOString();
  }

  updateRow(sessSheet, row.__rowIndex, updates);
}

function _clearFailedLogin(username) {
  const sessSheet = getSheet('Sessions');
  const row = findRow(sessSheet, 'token', 'failed_' + username);
  if (row) deleteSheetRow(sessSheet, row.__rowIndex);
}

// ---------------------------------------------------------------------------
// Biometric (WebAuthn) rate limiting
// ---------------------------------------------------------------------------

// Returns { locked: false } or { locked: true, minutes_remaining }.
// Auto-clears the lock from the Employees tab when the 30-min window has passed.
function _checkBiometricLock(employeeId) {
  const empSheet = getSheet('Employees');
  const emp      = findRow(empSheet, 'id', String(employeeId));
  if (!emp || String(emp.biometric_locked).toUpperCase() !== 'TRUE') {
    return { locked: false };
  }

  const lockedAt = new Date(emp.biometric_locked_at || '');
  if (isNaN(lockedAt.getTime())) return { locked: false };

  const now       = new Date();
  const lockUntil = new Date(lockedAt.getTime() + _WEBAUTHN_LOCKOUT_MS);

  if (now < lockUntil) {
    return {
      locked:            true,
      minutes_remaining: Math.ceil((lockUntil.getTime() - now.getTime()) / 60000)
    };
  }

  // Lock has expired — clear it
  updateRow(empSheet, emp.__rowIndex, {
    biometric_locked:    'FALSE',
    biometric_locked_at: ''
  });
  return { locked: false };
}

// Record a failed WebAuthn verification attempt.
// After _WEBAUTHN_MAX_FAILURES in the window: set biometric_locked=TRUE on the
// Employees row (HR flag) and delete the counter row.
function _recordWebAuthnFailure(employeeId) {
  const sessSheet = getSheet('Sessions');
  const now       = new Date();
  const tokenKey  = 'webauthn_fail_' + employeeId;
  const row       = findRow(sessSheet, 'token', tokenKey);

  if (!row) {
    appendRow(sessSheet, {
      token:       tokenKey,
      employee_id: String(employeeId),
      role:        '',
      expires_at:  '',
      device_id:   now.toISOString(),
      token_type:  'webauthn_fail',
      challenge:   '1',
      used:        ''
    });
    return;
  }

  const lastAttempt = new Date(row.device_id);
  let count = parseInt(String(row.challenge), 10) || 0;
  if (!isNaN(lastAttempt.getTime()) &&
      (now.getTime() - lastAttempt.getTime()) > _WEBAUTHN_WINDOW_MS) {
    count = 0;
  }
  count++;

  if (count >= _WEBAUTHN_MAX_FAILURES) {
    // Write the HR-visible lock flag onto the employee record
    const empSheet = getSheet('Employees');
    const emp      = findRow(empSheet, 'id', String(employeeId));
    if (emp) {
      updateRow(empSheet, emp.__rowIndex, {
        biometric_locked:    'TRUE',
        biometric_locked_at: now.toISOString()
      });
    }
    // Counter row is no longer needed — lock is now in the Employees tab
    deleteSheetRow(sessSheet, row.__rowIndex);
  } else {
    updateRow(sessSheet, row.__rowIndex, {
      challenge: String(count),
      device_id: now.toISOString()
    });
  }
}
