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
// WebAuthn stubs — implemented in Stage 2
// ---------------------------------------------------------------------------
// These exist so the router in Code.gs can reference them without errors.
// They will be replaced with real implementations in Auth.gs during Stage 2.

function webauthnRegisterChallenge(payload) {
  return error('Not yet implemented', 'غير متاح بعد');
}

function webauthnRegisterComplete(payload) {
  return error('Not yet implemented', 'غير متاح بعد');
}

function webauthnAuthChallenge(payload) {
  return error('Not yet implemented', 'غير متاح بعد');
}

function webauthnAuthVerify(payload) {
  return error('Not yet implemented', 'غير متاح بعد');
}
