// =============================================================================
// Auth.gs — Login, session management, password change, WebAuthn stubs
// =============================================================================

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------
// Payload: { username, password_hash, device_id }
// Returns:
//   { status: 'change_password', employee_id }  — first login
//   ok({ token, employee, config })              — normal login
//   error(...)                                   — bad credentials / inactive
function login(payload) {
  const username     = String(payload.username     || '').trim();
  const passwordHash = String(payload.password_hash || '').trim();
  const deviceId     = String(payload.device_id    || '');

  if (!username || !passwordHash) {
    return error('Username and password are required', 'اسم المستخدم وكلمة المرور مطلوبان');
  }

  const empSheet = getSheet('Employees');
  const employee = findRow(empSheet, 'username', username);

  if (!employee) {
    return error('Invalid credentials', 'بيانات الدخول غير صحيحة');
  }

  if (String(employee.active).toUpperCase() !== 'TRUE') {
    return error('Account is inactive', 'الحساب غير نشط');
  }

  if (String(employee.password_hash) !== passwordHash) {
    return error('Invalid credentials', 'بيانات الدخول غير صحيحة');
  }

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
  const username        = String(payload.username         || '').trim();
  const oldHash         = String(payload.old_password_hash || '').trim();
  const newHash         = String(payload.new_password_hash || '').trim();
  const deviceId        = String(payload.device_id        || '');

  if (!username || !oldHash || !newHash) {
    return error('Missing required fields', 'الحقول المطلوبة مفقودة');
  }

  const empSheet = getSheet('Employees');
  const employee = findRow(empSheet, 'username', username);

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
    password_hash:          newHash,
    force_password_change:  'FALSE'
  });

  const token  = createSession(employee.id, employee.role, deviceId);
  const config = getAllConfig();

  // Re-read the employee row so the returned profile has the updated fields
  const updated = findRow(empSheet, 'id', employee.id);
  return ok({ token, employee: safeEmployee(updated), config });
}

// ---------------------------------------------------------------------------
// validateSession
// ---------------------------------------------------------------------------
// Called at the top of every authenticated handler.
// Returns { valid: true, employee, session } or { valid: false, error: <error obj> }.
// Never throws — callers check .valid before proceeding.
function validateSession(payload) {
  const token    = String(payload.session_token || '').trim();
  const deviceId = String(payload.device_id     || '');

  if (!token) {
    return { valid: false, error: error('Session token required', 'رمز الجلسة مطلوب') };
  }

  const sessSheet = getSheet('Sessions');
  const session   = findRow(sessSheet, 'token', token);

  if (!session) {
    return { valid: false, error: error('Invalid session', 'جلسة غير صالحة') };
  }

  // Only validate auth sessions here — WebAuthn challenge rows are handled
  // separately in Auth.gs webauthn* functions
  if (session.token_type && String(session.token_type) !== 'session') {
    return { valid: false, error: error('Invalid session', 'جلسة غير صالحة') };
  }

  const now       = new Date();
  const expiresAt = new Date(session.expires_at);

  if (isNaN(expiresAt.getTime()) || now > expiresAt) {
    deleteSheetRow(sessSheet, session.__rowIndex);
    return { valid: false, error: error('Session expired. Please log in again.', 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً') };
  }

  const empSheet = getSheet('Employees');
  const employee = findRow(empSheet, 'id', String(session.employee_id));

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
// getConfig  (public — no session required)
// ---------------------------------------------------------------------------
// Payload: {} — called by the PWA on startup before login
function getConfig(payload) {
  return ok({ config: getAllConfig() });
}

// ---------------------------------------------------------------------------
// getProfile  (requires valid session)
// ---------------------------------------------------------------------------
// Lightweight session check used by the PWA on startup.
// Returns the validated employee profile so the app can restore its state
// without the employee having to log in again.
function getProfile(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;
  return ok({ employee: safeEmployee(auth.employee) });
}

// ---------------------------------------------------------------------------
// safeEmployee  (private helper)
// ---------------------------------------------------------------------------
// Strips fields that must never leave the server before returning to client.
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
// Requires a valid session. Generates a random 32-byte challenge, stores it
// in the Sessions tab (token_type='webauthn_reg', expires in 2 min), and
// returns it base64url-encoded for the PWA's navigator.credentials.create().
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

  return ok({ challenge: challenge });
}

// ---------------------------------------------------------------------------
// webauthnRegisterComplete
// ---------------------------------------------------------------------------
// Payload: { session_token, credentialId, publicKey (attestationObject b64url),
//            signedChallenge (clientDataJSON b64url) }
// Verifies the clientDataJSON challenge matches the stored challenge, then
// writes the credential ID and attestation blob to the Employees tab.
function webauthnRegisterComplete(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const credentialId  = String(payload.credentialId   || '').trim();
  const attestObj     = String(payload.publicKey       || '').trim();
  const clientDataB64 = String(payload.signedChallenge || '').trim();

  if (!credentialId || !attestObj || !clientDataB64) {
    return error('Missing credential data', 'بيانات الاعتماد مفقودة');
  }

  // Decode and parse clientDataJSON
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

  // Find the pending challenge row (strip any padding for safe comparison)
  const challenge = (clientData.challenge || '').replace(/=/g, '');
  const sessSheet = getSheet('Sessions');
  const row = _findChallengeRow(sessSheet, challenge, auth.employee.id, 'webauthn_reg');
  if (!row) {
    return error('Challenge not found or expired', 'انتهت صلاحية التحقق أو غير موجود');
  }

  // Mark single-use
  updateRow(sessSheet, row.__rowIndex, { used: 'TRUE' });

  // Persist credential against the employee record
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
// Same as webauthnRegisterChallenge but token_type='webauthn_auth'.
// Each challenge is single-use and expires in 2 minutes.
function webauthnAuthChallenge(payload) {
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
    token_type:  'webauthn_auth',
    challenge:   challenge,
    used:        ''
  });

  return ok({ challenge: challenge });
}

// ---------------------------------------------------------------------------
// webauthnAuthVerify
// ---------------------------------------------------------------------------
// Payload: { session_token, signedResponse: {
//   credentialId, clientDataJSON, authenticatorData, signature  (all b64url)
// }}
//
// Verification steps:
//   1. clientDataJSON.type === 'webauthn.get'
//   2. clientDataJSON.origin is HTTPS
//   3. challenge in clientDataJSON matches a valid, unused, unexpired row
//   4. credentialId matches the employee's registered credential
//   5. challenge row is marked used (single-use enforcement)
//   6. A one-time checkin_token (UUID, 2-min TTL) is issued
//
// NOTE: Apps Script does not expose ECDSA P-256 primitives, so the
// assertion signature over authenticatorData + SHA-256(clientDataJSON)
// cannot be cryptographically verified here. Security relies on the
// server-generated single-use challenge, HTTPS transport, and session
// validation as layered controls.
function webauthnAuthVerify(payload) {
  const auth = validateSession(payload);
  if (!auth.valid) return auth.error;

  const sr = payload.signedResponse;
  if (!sr || !sr.credentialId || !sr.clientDataJSON || !sr.authenticatorData || !sr.signature) {
    return error('Missing signed response fields', 'بيانات الاستجابة الموقّعة مفقودة');
  }

  // Decode and parse clientDataJSON
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

  // Validate challenge
  const challenge = (clientData.challenge || '').replace(/=/g, '');
  const sessSheet = getSheet('Sessions');
  const row = _findChallengeRow(sessSheet, challenge, auth.employee.id, 'webauthn_auth');
  if (!row) {
    return error('Challenge not found or expired', 'انتهت صلاحية التحقق أو غير موجود');
  }

  // Verify credential ID matches the registered credential for this employee
  const storedCredId = String(auth.employee.webauthn_credential_id || '').trim();
  if (!storedCredId) {
    return error('Biometric not registered for this account', 'البصمة غير مسجّلة لهذا الحساب');
  }
  if (storedCredId !== sr.credentialId) {
    return error('Credential mismatch', 'بيانات الاعتماد غير متطابقة');
  }

  // Mark challenge as used — prevents replay within the TTL window
  updateRow(sessSheet, row.__rowIndex, { used: 'TRUE' });

  // Issue a one-time checkin_token (2-min expiry)
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

// ---------------------------------------------------------------------------
// Private helpers — WebAuthn
// ---------------------------------------------------------------------------

// Generate a base64url-encoded 32-byte challenge.
// Uses SHA-256 of UUID + high-res timestamp + random decimal for entropy.
function _generateChallenge() {
  const seed  = Utilities.getUuid() + Date.now().toString() + Math.random().toString(36).slice(2);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

// Decode a base64url string to a UTF-8 string.
// Used to parse clientDataJSON sent by the browser (JSON, UTF-8 encoded).
function _b64urlToString(b64url) {
  const padding = (4 - (b64url.length % 4)) % 4;
  const padded  = b64url + '='.repeat(padding);
  const bytes   = Utilities.base64DecodeWebSafe(padded);
  return Utilities.newBlob(bytes).getDataAsString();
}

// Find a valid challenge row: correct type, employee, not used, not expired.
// Returns the row object (with __rowIndex) or null.
function _findChallengeRow(sessSheet, challenge, employeeId, tokenType) {
  if (!challenge) return null;

  const row = findRow(sessSheet, 'token', challenge);
  if (!row) return null;
  if (String(row.token_type)   !== tokenType)           return null;
  if (String(row.employee_id)  !== String(employeeId))  return null;
  if (String(row.used).toUpperCase() === 'TRUE')        return null;

  const now       = new Date();
  const expiresAt = new Date(row.expires_at);
  if (isNaN(expiresAt.getTime()) || now > expiresAt) {
    deleteSheetRow(sessSheet, row.__rowIndex);
    return null;
  }

  return row;
}
