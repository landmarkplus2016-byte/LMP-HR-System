# Build Guide — LMP Attendance PWA
> Your step-by-step manual for building the app from zero to live.
> Work through this top to bottom. Check off every item as you go.
> Never skip a test. Never move to the next step if a test fails.

---

## Before You Write a Single Line of Code

### One-time setup checklist
- [ ] Create a new Google Spreadsheet under your developer Gmail — name it `LMP Attendance`
- [ ] Create these tabs in order: `Config`, `Employees`, `Departments`, `Shifts`, `Locations`, `Attendance`, `AttendanceLog`, `Leaves`, `Holidays`, `Sessions`
- [ ] In `Config` tab, add these rows (Key column / Value column):
  - `app_name` / `LMP Attendance`
  - `company_name` / `Landmark Plus`
  - `geofence_radius_m` / `150`
  - `late_threshold_min` / `15`
  - `gps_accuracy_max_m` / `200`
  - `session_expiry_hours` / `8`
  - `auto_checkout_enabled` / `TRUE`
  - `offline_sync_enabled` / `TRUE`
  - `primary_language` / `ar`
  - `working_days` / `Sun,Mon,Tue,Wed,Thu`
  - `biometric_required` / `TRUE`
- [ ] In `Employees` tab, add column headers: `id | name | username | password_hash | force_password_change | role | department | shift_id | manager_id | active | biometric_exempt | webauthn_credential_id | webauthn_public_key | webauthn_registered_at | device_id`
- [ ] Add yourself as the first HR user: id=`HR001`, name=`Khaled`, username=`khaled.admin`, password_hash=(leave blank for now — Apps Script will hash it), force_password_change=`TRUE`, role=`hr`, active=`TRUE`, biometric_exempt=`TRUE`
- [ ] Add one test employee and one test manager row (same structure, role=`employee` and role=`manager`)
- [ ] In `Locations` tab, add headers: `id | name | lat | lng | radius_m | active`
- [ ] Add one test location with real coordinates near you for testing
- [ ] **Protect every Sheet tab**: right-click each tab → Protect sheet → Only you can edit
- [ ] Create your project folder: `lmp-attendance`
- [ ] Drop `CLAUDE.md` into the root of that folder
- [ ] Create a `design/` folder inside `lmp-attendance/` and drop `LMP_Attendance_Screens_v3.html` into it
- [ ] Create the full folder structure as defined in the File Map section of `CLAUDE.md` — empty files only
- [ ] Open the folder in VS Code
- [ ] Create a GitHub repository (public) and connect your local folder to it
- [ ] Enable GitHub Pages on the repo (Settings → Pages → Deploy from main branch)

### First message to Claude Code — copy and paste this exactly:
```
Read CLAUDE.md first and confirm you understand the project before writing any code.
Then open and read design/LMP_Attendance_Screens_v3.html — describe what you observe
about the visual design system: colors, typography, RTL layout, component patterns,
status badge styles, and the check-in button design.
Then create the full folder and file structure as defined in the File Map section —
empty files only, no code yet. Do not write any logic until I confirm the structure
looks correct.
```

### After structure is created — verify before moving on:
- [ ] All folders exist: `js/`, `css/`, `locales/`, `appscript/`, `assets/`, `design/`
- [ ] All files listed in the File Map exist and are empty
- [ ] `design/LMP_Attendance_Screens_v3.html` is present
- [ ] `CLAUDE.md` is in the root
- [ ] No code has been written yet

---

## Stage 1 — Foundation

**Goal:** Log in with username and password, force password change on first login, session token stored, correct role detected, app shell rendered, language toggle works.

---

### Step 1.1 — Google Sheet + Apps Script foundation (`appscript/Code.gs`, `Auth.gs`, `Utils.gs`)

**Prompt:**
```
Read CLAUDE.md. We are on Stage 1, Step 1.
Build the Apps Script foundation — three files: Code.gs, Auth.gs, Utils.gs.

Code.gs must:
- Be the single entry point (doPost router)
- Read the action field from the POST payload
- Call the correct handler function based on action
- Return all responses as JSON with { status: 'ok'|'error', data: {} }
- Handle any uncaught error gracefully — never crash silently

Auth.gs must handle:
- login(): look up username in Employees tab → verify password hash → check active=TRUE →
  if force_password_change=TRUE return { status: 'change_password' } →
  otherwise create session token → write to Sessions tab → return token + employee profile + full Config tab as JSON
- change_password(): verify old hash → store new hash → set force_password_change=FALSE
- validateSession(): called at top of every handler — verify token exists in Sessions tab,
  not expired, return employee record or reject
- logout(): delete session row from Sessions tab
- createSession(): generate UUID token, write { token, employee_id, role, expires_at, device_id }
  to Sessions tab

Utils.gs must contain:
- hashPassword(plain): returns hex SHA-256 string
- generateId(prefix): returns prefix + timestamp + random suffix
- haversine(lat1, lng1, lat2, lng2): returns distance in metres
- formatDate(date): returns YYYY-MM-DD string
- formatTime(date): returns HH:MM string

No other functionality yet.
```

**After writing — deploy the Apps Script:**
- [ ] In Google Apps Script editor: Deploy → New deployment → Web App
- [ ] Set "Execute as" = Me (your developer Gmail)
- [ ] Set "Who has access" = Anyone
- [ ] Copy the Web App URL — you will paste this into the app on first launch
- [ ] Save the URL somewhere safe — never put it in the code

**Tests for Step 1.1:**
- [ ] Open the Apps Script URL in browser → returns JSON (not an error page)
- [ ] In Apps Script editor: run `doPost` manually with `{ action: 'get_config' }` → returns Config tab as JSON
- [ ] Run login with correct username and a test password → returns `{ status: 'change_password' }`
- [ ] After hashing a password and storing it in Employees tab: login → returns session token + profile
- [ ] Run login with wrong password → returns `{ status: 'error', message: 'Invalid credentials' }`
- [ ] Run any action with a fake session token → returns `{ status: 'error', message: 'Invalid session' }`
- [ ] Check Sessions tab — one row written after successful login

---

### Step 1.2 — App Shell (`index.html`, `js/app.js`)

**Prompt:**
```
Read CLAUDE.md. Stage 1, Step 2.
Open and study design/LMP_Attendance_Screens_v3.html before writing anything —
extract the color variables, font choices, and overall layout structure from it.
Build index.html and js/app.js — the app shell and router only.

index.html must:
- Load all CSS files in the correct order (styles.css, rtl.css, mobile.css, desktop.css)
- Load all JS files in the correct order
- Load SheetJS via CDN: https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
- Load Leaflet.js via CDN: https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js
- Show a loading screen on launch
- Contain a single <div id="app"> where all views are rendered
- Have a <div id="nav"> for bottom tabs or sidebar

js/app.js must:
- On load: call config.js to fetch app config → then check auth state in localStorage
- If no session token → render login screen
- If session token exists → validate it (call api.js) → if valid render correct role home screen
- renderNav(): check window.innerWidth >= 900 → sidebar (HR/Manager desktop) or bottom tabs (mobile)
- Simple hash-based router: window.location.hash drives which view is rendered
- Role guard: HR-only routes redirect non-HR users to their home screen
No content yet — just the shell and correct routing logic.
Apply the frontend-design skill for the overall layout structure.
Reference design/LMP_Attendance_Screens_v3.html for exact visual implementation.
```

**Tests for Step 1.2:**
- [ ] Open `index.html` in Chrome — no console errors about missing files
- [ ] Loading screen appears briefly then redirects to login (no session exists)
- [ ] All JS and CSS files load without 404 errors (check Network tab)
- [ ] SheetJS and Leaflet CDN scripts load successfully
- [ ] Manually set `lmp_session` in localStorage to a fake value → app tries to validate it → fails → shows login

---

### Step 1.3 — API Layer (`js/api.js`)

**Prompt:**
```
Read CLAUDE.md. Stage 1, Step 3.
Build js/api.js — the only file that communicates with Apps Script.

It must:
- Read the Apps Script URL from localStorage key lmp_script_url on every call
- If no URL stored → show first-launch setup screen asking HR to paste the URL
- post(action, payload): sends { action, session_token, device_id, ...payload } as POST to the URL
- Handle network errors gracefully — return { status: 'error', message: 'Network error' }
- Handle Apps Script cold start: first call may take 5-8 seconds — show 'Connecting...' indicator
  immediately on app launch, hide it after first successful response
- Never log or expose the Apps Script URL in console
- Export named functions: apiLogin(), apiLogout(), apiCheckIn(), apiCheckOut(),
  apiGetConfig(), apiGetMyAttendance(), apiSubmitLeave() — each calls post() with the right action
  (stub functions are fine now — they will be filled in later stages)
```

**Tests for Step 1.3:**
- [ ] No URL in localStorage → setup screen appears asking to paste the Apps Script URL
- [ ] Paste valid URL → stored in localStorage, setup screen disappears
- [ ] post() with action 'get_config' → returns Config JSON from Apps Script
- [ ] post() with no network → returns error object, does not crash or throw
- [ ] 'Connecting...' indicator shows on first call → disappears after response

---

### Step 1.4 — Auth (`js/auth.js`)

**Prompt:**
```
Read CLAUDE.md. Stage 1, Step 4.
Open and study design/LMP_Attendance_Screens_v3.html — note the login screen layout,
color scheme, and Arabic typography before building anything.
Build js/auth.js — login screen, password change screen, session management.

Login screen must:
- Show username field + password field + 'Sign In' button
- Language toggle button (AR/EN) top-right — calls i18n.js
- On submit: hash the password client-side using utils.js hashPassword() →
  call api.js apiLogin() → handle three responses:
  a) { status: 'change_password' } → render password change screen
  b) { status: 'ok', token, employee } → store token in localStorage lmp_session,
     store employee profile in localStorage lmp_user → call app.js to render home screen
  c) { status: 'error' } → show error message, clear password field

Password change screen must:
- Show new password field + confirm password field
- Validate: min 8 characters, both fields match
- On submit: call api.js change_password() → on success redirect to home screen
- Cannot be skipped — back button returns to login, not home

Session management:
- logout(): clear lmp_session + lmp_user from localStorage → render login screen
- getCurrentUser(): parse lmp_user from localStorage → return employee object
- getSessionToken(): return lmp_session from localStorage

Apply the frontend-design skill for login screen styling.
Reference design/LMP_Attendance_Screens_v3.html for exact visual implementation.
```

**Tests for Step 1.4:**
- [ ] Login screen renders with username, password fields and Sign In button
- [ ] Language toggle switches between AR and EN (even if strings are placeholders)
- [ ] Submit with wrong password → error message shown, password field cleared
- [ ] Submit with correct password (first login) → password change screen appears
- [ ] Submit with correct password (returning user) → home screen rendered
- [ ] Password change: mismatched passwords → validation error shown
- [ ] Password change: under 8 characters → validation error shown
- [ ] Password change success → home screen rendered, session stored in localStorage
- [ ] logout() → localStorage cleared → login screen shown

---

### Step 1.5 — i18n + Config (`js/i18n.js`, `js/config.js`, `locales/en.json`, `locales/ar.json`)

**Prompt:**
```
Read CLAUDE.md. Stage 1, Step 5.
Build js/i18n.js, js/config.js, and both locale files.

js/i18n.js must:
- Load the correct locale JSON file based on lmp_lang in localStorage (default: ar)
- t(key): returns the translated string for that key
- setLanguage(lang): store in localStorage, apply dir='rtl' or dir='ltr' to <html>,
  toggle rtl.css, re-render current view
- All UI strings must use t() — never hardcode text in other JS files

locales/ar.json and locales/en.json must contain ALL strings for:
- Login screen (labels, button, errors)
- Password change screen
- Navigation items (Dashboard, Check In, History, Leaves, Team, Reports, Employees,
  Locations, Shifts, Departments, Holidays, Config, Sign Out)
- Common actions (Save, Cancel, Edit, Deactivate, Approve, Reject, Add, Search)
- Status labels (Present, Absent, Late, On Leave, Holiday, Pending, Approved, Rejected)
- Error messages (Invalid credentials, Network error, GPS denied, Not at company location,
  Fingerprint required, Session expired)
- Check-in flow messages (Verifying location, Check-in successful, Already checked in today)

js/config.js must:
- On app startup: call api.js apiGetConfig() → cache result in memory as window.appConfig
- getConfig(key): return appConfig[key]
- If config call fails: use hardcoded fallback values so app doesn't break
```

**Tests for Step 1.5:**
- [ ] App loads in Arabic by default — `<html dir="rtl">`
- [ ] Language toggle switches to English — `<html dir="ltr">`, rtl.css removed
- [ ] Toggle back to Arabic — RTL restored
- [ ] t('login.submit') returns correct string in both languages
- [ ] Config loaded from Apps Script on startup — `window.appConfig.geofence_radius_m` = 150
- [ ] Config failure: app still loads with fallback values, no crash

### ✅ Stage 1 Complete — Full check before moving on:
- [ ] Login works with correct credentials
- [ ] Wrong password shows error
- [ ] First-login password change is enforced — cannot skip
- [ ] Session persists on page refresh (localStorage)
- [ ] Logout clears session and returns to login
- [ ] Language toggle works in both directions
- [ ] RTL layout applies correctly for Arabic
- [ ] App config loads from Sheet on startup
- [ ] Push to GitHub → app loads from GitHub Pages URL, login works

---

## Stage 2 — GPS + Biometric + Check-in

**Goal:** Employee registers fingerprint once, taps check-in, biometric verified, GPS validated both client and server, attendance row written to Sheet.

---

### Step 2.1 — GPS Module (`js/gps.js`)

**Prompt:**
```
Read CLAUDE.md. Stage 2, Step 1.
Build js/gps.js — geolocation, geofence check, and mock location detection.

It must:
- getPosition(): call navigator.geolocation.getCurrentPosition() with:
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  Return { lat, lng, accuracy } or { error: 'denied'|'timeout'|'unavailable' }
- checkAccuracy(accuracy): reject if accuracy < 5 (DevTools fake) or accuracy > appConfig.gps_accuracy_max_m
  Return { valid: true|false, reason: string }
- checkGeofence(lat, lng, locations): call utils.js haversine() against each active location
  Return { inRange: true|false, locationId, locationName, distance }
- detectMockLocation(): check navigator.userAgentData patterns — return { suspicious: true|false }
- checkGPS(): orchestrate the full GPS check:
  1. getPosition()
  2. checkAccuracy()
  3. detectMockLocation()
  4. checkGeofence() against locations from window.appConfig
  Return full result object with all fields

Client-side GPS check is for instant user feedback only.
Server-side re-validates independently — never skip the server check.
```

**Tests for Step 2.1:**
- [ ] GPS permission denied → returns `{ error: 'denied' }` with correct i18n message shown
- [ ] GPS timeout → returns `{ error: 'timeout' }` with message
- [ ] Accuracy below 5m → rejected with 'GPS too accurate — possible fake location'
- [ ] Accuracy above 200m → rejected with 'GPS signal too weak'
- [ ] In Chrome DevTools: set location to office coordinates → mock location flag triggers (accuracy will be exactly 1m or suspicious)
- [ ] Real GPS inside geofence radius → `{ inRange: true, locationName: 'Main Office' }`
- [ ] Real GPS outside geofence radius → `{ inRange: false, distance: Xm }`

---

### Step 2.2 — Biometric Module (`js/biometric.js`, `Auth.gs` WebAuthn endpoints)

**Prompt:**
```
Read CLAUDE.md. Stage 2, Step 2.
Build js/biometric.js and add WebAuthn endpoints to Auth.gs.

js/biometric.js must:
- checkSupport(): return { supported: boolean } using window.PublicKeyCredential
- checkPlatformAuth(): async, return true if device has fingerprint/face/PIN sensor
  using PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
- isRegistered(): check localStorage lmp_credential_id — return true if exists
- registerFingerprint():
  1. Call api.js webauthn_register_challenge → get challenge bytes
  2. Call navigator.credentials.create() with the challenge
  3. Call api.js webauthn_register_complete with credential ID + public key + signed challenge
  4. On success: store credential ID in localStorage lmp_credential_id
- verifyFingerprint():
  1. Call api.js webauthn_auth_challenge → get fresh challenge
  2. Call navigator.credentials.get() with stored credential ID + challenge
  3. Call api.js webauthn_auth_verify with signed response
  4. On success: return { verified: true, checkin_token }
  5. On failure: return { verified: false, reason }
- clearRegistration(): remove lmp_credential_id from localStorage

Auth.gs must add:
- webauthnRegisterChallenge(): generate 32 random bytes, store in Sessions tab
  with { token_type: 'webauthn_reg', employee_id, challenge, expires_at: now+2min }
  Return base64url-encoded challenge
- webauthnRegisterComplete(): verify challenge matches + not expired → mark used →
  store credential_id + public_key in Employees tab
- webauthnAuthChallenge(): same as register challenge but type='webauthn_auth'
- webauthnAuthVerify(): look up employee's public_key from Employees tab →
  verify the signature cryptographically → mark challenge as used →
  generate one-time checkin_token (UUID, 2-min expiry) → store in Sessions tab →
  return { verified: true, checkin_token }
```

**Tests for Step 2.2:**
- [ ] `checkSupport()` returns true in Chrome on Android (test on real device)
- [ ] `isRegistered()` returns false before registration
- [ ] `registerFingerprint()` triggers native fingerprint prompt on Android
- [ ] After registration: `lmp_credential_id` in localStorage, credential in Employees Sheet tab
- [ ] `isRegistered()` returns true after registration
- [ ] `verifyFingerprint()` triggers fingerprint prompt → on success returns `{ verified: true, checkin_token }`
- [ ] Wrong finger: prompt retries automatically
- [ ] 3 failed attempts: returns `{ verified: false, reason: 'too_many_attempts' }`
- [ ] Replay checkin_token: Apps Script rejects it (already used)
- [ ] Expired checkin_token (wait 2 min): Apps Script rejects it

---

### Step 2.3 — Security Module + Check-in Flow (`js/security.js`, `js/attendance.js`, `appscript/Attendance.gs`)

**Prompt:**
```
Read CLAUDE.md. Stage 2, Step 3.
Open design/LMP_Attendance_Screens_v3.html and study the employee check-in screen —
the check-in button design, GPS status indicator, and success/error states —
before building the UI components.
Build js/security.js, js/attendance.js, and appscript/Attendance.gs.

js/security.js must:
- getDeviceId(): if lmp_device_id exists in localStorage return it, otherwise:
  generate hash of navigator.userAgent + screen.width + screen.height + Intl.DateTimeFormat().resolvedOptions().timeZone
  Store as lmp_device_id in localStorage and return it

js/attendance.js must orchestrate the full check-in flow:
1. Check if biometric registered → if not, show registration screen first
2. verifyFingerprint() → get checkin_token → if fails, show error and stop
3. checkGPS() → if fails (accuracy/geofence/permission), show specific error and stop
4. Build payload: { session_token, checkin_token, lat, lng, accuracy, device_id, location_id }
5. Call api.js apiCheckIn() with payload
6. On success: show check-in confirmation (time + location name + success animation)
7. On network failure: queue in IndexedDB via offline.js, show 'Pending sync' indicator
8. Prevent double check-in: if employee already checked in today and not checked out →
   show checkout button instead of check-in

Also build checkout flow:
- Employee taps 'Check Out'
- verifyFingerprint() → get checkin_token
- Call api.js apiCheckOut()
- Show checkout confirmation with hours worked

appscript/Attendance.gs must:
- checkIn(): validateSession() → verify checkin_token (exists, not expired, matches employee, unused) →
  mark token used → server-side haversine check against Locations tab →
  check employee has no open check-in today already →
  write Attendance row: { id, employee_id, date, check_in, location_id, lat, lng, accuracy,
  biometric_verified: TRUE, device_id, device_match (compare with session device_id), status }
  → return { status: 'ok', check_in_time, location_name }
- checkOut(): validateSession() → find today's open Attendance row for this employee →
  write check_out time → calculate hours_worked → update status (present/late based on shift) →
  return { status: 'ok', check_out_time, hours_worked }
- getMyAttendance(): validateSession() → return last 30 days of rows for calling employee only
```

**Tests for Step 2.3:**
- [ ] Full check-in flow on Android: fingerprint → GPS → success → row in Attendance tab
- [ ] Attendance row has: correct employee_id, date, check_in time, location_id, biometric_verified=TRUE
- [ ] `device_match`: TRUE if same device as session, FALSE if different — visible in Sheet
- [ ] Double check-in attempt: second tap shows checkout button, not check-in
- [ ] Checkout: hours_worked calculated correctly in Sheet
- [ ] Status: check-in after late_threshold_min past shift start → `status: 'late'` in Sheet
- [ ] Replay checkin_token in check-in payload: Apps Script rejects it
- [ ] GPS outside geofence: check-in blocked, error shown to employee
- [ ] No network: check-in queued in IndexedDB, 'Pending sync' shown

### ✅ Stage 2 Complete — Full check before moving on:
- [ ] Full check-in end-to-end works on a real Android phone
- [ ] Attendance row in Sheet has all correct fields
- [ ] Checkout works and calculates hours correctly
- [ ] Late status assigned correctly
- [ ] GPS rejection works for wrong location and poor accuracy
- [ ] Fingerprint failure stops the flow before GPS runs
- [ ] Replay attack rejected by Apps Script
- [ ] Device mismatch recorded (not blocked — just flagged)

---

## Stage 3 — Employee App + Offline

**Goal:** Employee sees attendance history and leave form, app works offline and syncs on reconnect, PWA installs on Android.

---

### Step 3.1 — Employee Views (`js/employee.js`)

**Prompt:**
```
Read CLAUDE.md. Stage 3, Step 1.
Open design/LMP_Attendance_Screens_v3.html and study the employee-facing screens —
home screen layout, attendance history list rows, status badge colors, and bottom
tab bar design — before writing any code.
Build js/employee.js — all employee-facing views.

Home screen must show:
- Today's date and greeting with employee name
- Large check-in button (if not yet checked in today) OR check-out button (if checked in)
- Current time
- Last check-in time if already done today

Attendance history screen must show:
- Last 30 days as a scrollable list: date, check-in time, check-out time, hours, status badge
- Status badges: Present (green), Late (amber), Absent (red), On Leave (blue)
- Fetched via api.js apiGetMyAttendance()

Leave request screen must show:
- Leave type dropdown: Annual, Sick, Emergency
- Start date + End date pickers
- Reason text field
- Submit button → calls api.js apiSubmitLeave()
- Confirmation on success

Leave balance screen must show:
- Remaining annual leave days
- Taken this year
- Pending requests

Apply the frontend-design skill for mobile employee screens.
Reference design/LMP_Attendance_Screens_v3.html for exact visual implementation.
```

**Tests for Step 3.1:**
- [ ] Home screen shows correct greeting and employee name
- [ ] Check-in button shown when not yet checked in today
- [ ] Check-out button shown when checked in but not checked out
- [ ] Both buttons hidden after checkout — shows 'Attendance recorded for today'
- [ ] Attendance history loads and shows last 30 days
- [ ] Status badges display correctly with correct colors
- [ ] Leave request submits and appears in Leaves Sheet tab
- [ ] Leave balance loads and shows correct numbers

---

### Step 3.2 — Offline Queue (`js/offline.js`, `sw.js`)

**Prompt:**
```
Read CLAUDE.md. Stage 3, Step 2.
Build js/offline.js and sw.js — offline queue and service worker.

js/offline.js must:
- Use IndexedDB store named 'lmp_queue' with fields:
  { id, action, payload, timestamp, attempts, status }
- enqueue(action, payload): add a pending item to the queue
- processQueue(): called on reconnect — iterate pending items, call api.js for each,
  mark as synced or increment attempts (max 3)
- getQueueCount(): return count of pending items
- Show 'Pending sync: X' indicator when queue is not empty
- Show '✓ All synced' briefly when queue clears

sw.js must:
- Cache-first strategy for all static assets (HTML, CSS, JS, locales, assets)
- Register Background Sync with tag 'attendance-sync'
- On sync event: call offline.js processQueue()
- Check for app updates silently on every launch
- When new version available: show banner 'A new update is available — tap to refresh' [Update]

manifest.json must:
- name: LMP Attendance
- short_name: LMP Attend
- start_url: /
- display: standalone
- theme_color: (match your chosen brand color)
- icons: 192px and 512px
```

**Tests for Step 3.2:**
- [ ] Go offline in Chrome DevTools → check-in → queued in IndexedDB, 'Pending sync: 1' shown
- [ ] Go back online → queue processes → row appears in Attendance Sheet → '✓ All synced' shown
- [ ] Offline items survive page refresh (still in IndexedDB)
- [ ] 3 failed attempts on a queue item → marked as failed, HR notified flag set
- [ ] On Android: 'Add to Home Screen' prompt appears
- [ ] Installed PWA opens in standalone mode (no browser chrome)
- [ ] Offline with PWA installed → app loads from cache, all static assets available

---

### Step 3.3 — Leaves + Shifts Backend (`appscript/Leaves.gs`, `appscript/Admin.gs` shifts)

**Prompt:**
```
Read CLAUDE.md. Stage 3, Step 3.
Build appscript/Leaves.gs and the shifts portion of appscript/Admin.gs.

Leaves.gs must handle:
- submitLeave(): validateSession() → write leave request to Leaves tab with status='pending'
- getMyLeaves(): validateSession() → return calling employee's leave rows + calculate balance
  (annual leave: 21 days/year default, subtract approved leaves in current year)
- approveLeave(): validateSession() → role check (manager or hr) → update status='approved', approvedBy
- rejectLeave(): validateSession() → role check → update status='rejected', reason field

Admin.gs shifts section must handle:
- getShifts(): return all rows from Shifts tab
- addShift(): HR only → append row to Shifts tab
- updateShift(): HR only → find by id → update fields
- deleteShift(): HR only → remove row (shifts can be hard-deleted if no employees assigned)
```

**Tests for Step 3.3:**
- [ ] Submit leave request → appears in Leaves Sheet tab with status='pending'
- [ ] My leaves screen shows submitted request with 'Pending' badge
- [ ] Leave balance calculates correctly
- [ ] Manager approves leave → status updates in Sheet → employee sees 'Approved' badge
- [ ] Manager rejects with reason → employee sees 'Rejected' with reason shown
- [ ] Shifts CRUD: add a shift → appears in Shifts tab → update it → delete it

### ✅ Stage 3 Complete — Full check before moving on:
- [ ] Employee home screen shows correct check-in/out state
- [ ] Attendance history loads correctly
- [ ] Leave request submits and updates correctly
- [ ] Offline check-in queues and syncs on reconnect
- [ ] PWA installs on Android and opens standalone
- [ ] Static assets load from cache when offline
- [ ] Shifts add/update/delete working

---

## Stage 4 — Manager View

**Goal:** Manager sees team live status, approves/rejects leaves, views team attendance records.

---

### Step 4.1 — Manager Views + Employees Backend (`js/manager.js`, `appscript/Employees.gs`)

**Prompt:**
```
Read CLAUDE.md. Stage 4, Step 1.
Open design/LMP_Attendance_Screens_v3.html and study the manager home screen —
the summary stat cards, team member list rows, status badges, and the مباشر (Live)
indicator — before writing any code.
Build js/manager.js and appscript/Employees.gs.

js/manager.js must render these views:

Team status screen (manager home):
- Today's summary: X Present / X Absent / X Late / X On Leave counts
- Scrollable list of all team members with today's status and check-in time
- Status shown as colored badge
- Auto-refreshes every 60 seconds via api.js

Team attendance screen:
- Date picker (default: today)
- Scrollable list of team attendance records for that date
- Each row: name, check-in, check-out, hours, status, location

Leave approvals screen:
- List of all pending leave requests from team members
- Each item: employee name, leave type, dates, reason, [Approve] [Reject] buttons
- Approve/reject calls api.js → updates immediately in UI

appscript/Employees.gs must handle:
- getTeamStatus(): validateSession() → role check (manager or hr) →
  get all employees where manager_id = calling manager's id →
  for each, check today's Attendance row → return status array
- getTeamAttendance(date): same but for a specific date
- getAllEmployees(): HR only → return full Employees tab (all rows including inactive)
- addEmployee(): HR only → validate unique username → hash temp password →
  set force_password_change=TRUE → append to Employees tab
- updateEmployee(): HR only → find by id → update allowed fields
- deactivateEmployee(): HR only → set active=FALSE → reject if employee_id = calling HR id
- reactivateEmployee(): HR only → set active=TRUE

Apply the frontend-design skill for manager screens.
Reference design/LMP_Attendance_Screens_v3.html for exact visual implementation.
```

**Tests for Step 4.1:**
- [ ] Manager home shows today's team summary counts
- [ ] Each team member shows correct status badge
- [ ] Status auto-refreshes (check that a check-in on another device appears within 60s)
- [ ] Date picker changes the attendance list correctly
- [ ] Pending leave requests show for manager's team
- [ ] Approve button → leave status updates → disappears from pending list
- [ ] Reject button → shows reason field → updates status
- [ ] HR: getAllEmployees() returns all employees including inactive
- [ ] HR: addEmployee() with duplicate username → error returned
- [ ] HR: deactivateEmployee on self → error returned

### ✅ Stage 4 Complete — Full check before moving on:
- [ ] Manager sees correct team status in real-time
- [ ] Attendance records filterable by date
- [ ] Leave approval flow works end-to-end
- [ ] Employee management CRUD all working
- [ ] Manager cannot see or do HR-only actions

---

## Stage 5 — HR Desktop App

**Goal:** HR Manager has all 11 desktop screens working — full management capability without ever opening the Google Sheet.

---

### Step 5.1 — HR Desktop Layout + Dashboard (`js/hr.js`, `css/desktop.css`)

**Prompt:**
```
Read CLAUDE.md. Stage 5, Step 1.
Open design/LMP_Attendance_Screens_v3.html and study the HR desktop screens in detail —
the sidebar navigation with Arabic labels, the stat card grid, the recent activity table,
and the overall color and spacing system — before writing any code.
Build the HR desktop layout, sidebar navigation, and dashboard screen.

css/desktop.css must:
- Sidebar: 200px wide, fixed left, full height, shows on screens >= 900px
- Main content: fills remaining width, scrollable
- Stat cards: 4-column grid at top of dashboard
- Data tables: full width, sortable headers, row hover state

js/hr.js dashboard screen must show:
- 4 stat cards: Today's Present / Absent / Late / On Leave counts (fetched via api.js)
- Pending leave requests badge count
- Recent activity: last 10 check-ins company-wide as a live feed
- Auto-refreshes every 60 seconds

Sidebar navigation items (in order):
Dashboard | Live Status | Attendance | Leave Requests | Reports |
Employees | Departments | Shifts | Locations | Holidays | Config | Sign Out

Apply the frontend-design skill for the HR desktop layout — professional, data-dense,
clean sidebar — not a generic template.
Reference design/LMP_Attendance_Screens_v3.html for exact visual implementation.
```

**Tests for Step 5.1:**
- [ ] On screen >= 900px: sidebar visible, bottom nav hidden
- [ ] On screen < 900px: sidebar hidden, bottom nav visible (if role is manager)
- [ ] Dashboard loads with correct today's stats
- [ ] Recent activity shows last 10 check-ins
- [ ] All sidebar items render and route correctly (views can be placeholder for now)
- [ ] Sidebar active state highlights current route

---

### Step 5.2 — HR Attendance Management (`js/hr.js` attendance screens, `appscript/Attendance.gs` corrections)

**Prompt:**
```
Read CLAUDE.md. Stage 5, Step 2.
Build the attendance, live status, and correction screens in js/hr.js.
Also add correction endpoints to appscript/Attendance.gs.

Live Status screen:
- Full company list: all active employees with today's check-in status
- Columns: Name, Department, Check-in time, Location, Status badge
- Auto-refreshes every 60 seconds
- Search/filter by employee name or department

Attendance Records screen:
- Filters: employee dropdown + date range picker
- Paginated table: id, employee name, date, check-in, check-out, hours, status, verified badge
- Click any row → slide-out panel showing full record details
- Edit button in panel: opens correction form
- Correction form fields: check-in time, check-out time, status, HR note (required)
- 'Add Manual Record' button: opens form with all fields + required HR note

appscript/Attendance.gs must add:
- correctAttendance(recordId, corrections, hrNote):
  HR only → validateSession() →
  read original record → write original + hrNote + correcting HR employee_id + timestamp to AttendanceLog →
  update Attendance row with corrected values → return updated record
- addManualAttendance(employeeId, date, checkIn, checkOut, locationId, hrNote):
  HR only → validateSession() → write full Attendance row with hrNote field
- getFlaggedRecords(): HR only → return rows where device_match = FALSE
```

**Tests for Step 5.2:**
- [ ] Live Status shows all active employees with today's status
- [ ] Search filters the list in real-time
- [ ] Attendance filter: pick an employee + date range → correct records shown
- [ ] Click a record → detail panel slides out with full data
- [ ] Edit check-in time → correction saved → AttendanceLog tab has original values + HR note
- [ ] Add manual record → appears in Attendance tab with manual flag
- [ ] HR note is required — form cannot submit without it
- [ ] Flagged records (device mismatch) visible in HR app

---

### Step 5.3 — HR Reports (`js/hr.js` reports screen, `js/report.js`, `appscript/Report.gs`)

**Prompt:**
```
Read CLAUDE.md. Stage 5, Step 3.
Build the reports screen in js/hr.js, js/report.js, and appscript/Report.gs.
Apply the xlsx skill for Excel generation.

Reports screen must:
- Month picker (default: current month)
- Department filter dropdown (optional — default: all departments)
- 'Generate Report' button

appscript/Report.gs must:
- getReportData(year, month, departmentId?):
  HR only → validateSession() →
  fetch all employees (filtered by department if provided) →
  fetch all attendance rows for that month →
  fetch all approved leaves for that month →
  fetch all holidays for that month →
  return structured JSON: { employees: [], attendance: {}, leaves: {}, holidays: [] }

js/report.js must:
- receive report data from api.js
- Use SheetJS to generate a .xlsx file with:
  - One row per active employee
  - Columns: Name, Department, Day 1 through Day 31 (P/A/L/Leave/Holiday/—),
    Total Present, Total Absent, Total Late, Total Hours Worked, Leave Days Used
  - Header row styled bold with background color
  - Status codes: P=Present, A=Absent, L=Late, Lv=On Leave, H=Holiday, —=Weekend/non-working
  - Trigger browser download: LMP_Attendance_YYYY_MM.xlsx
```

**Tests for Step 5.3:**
- [ ] Select January 2026 → Generate Report → .xlsx file downloaded
- [ ] Open in Excel: correct employee rows, correct column headers
- [ ] Each day column shows correct status code
- [ ] Weekend/non-working days show '—'
- [ ] Holidays show 'H'
- [ ] Approved leave days show 'Lv'
- [ ] Totals calculated correctly in summary columns
- [ ] Department filter: select one department → only those employees in report

---

### Step 5.4 — HR Admin Screens (`js/hr.js` admin screens, `appscript/Admin.gs`)

**Prompt:**
```
Read CLAUDE.md. Stage 5, Step 4.
Build all HR admin screens and appscript/Admin.gs.

Employees screen:
- Searchable sortable table: Name, Username, Role, Department, Shift, Status (Active/Inactive), Biometric
- [Add Employee] button → slide-out form: Name, Username, Temp Password, Role dropdown,
  Department dropdown, Shift dropdown, Manager dropdown (filtered by managers)
- Click a row → slide-out panel with [Edit] [Deactivate/Reactivate] buttons
- Edit form: all fields except username (username cannot change after creation)
- Deactivate shows confirmation: 'This employee will lose access immediately'
- Inactive employees shown in list with dimmed style and [Reactivate] button

Locations screen:
- Leaflet.js map showing all active locations as markers
- Table below map: Name, Lat, Lng, Radius, Status
- [Add Location] → click map to set coordinates OR type manually → set name and radius
- Click marker or table row → edit panel

Holidays screen:
- Current year calendar view
- Click a date → add holiday name → saves to Holidays tab
- Holiday dates shown highlighted in calendar
- [Delete] on any holiday

Config screen:
- Form-based view of all Config tab keys:
  Geofence Radius (m), Late Threshold (min), GPS Accuracy Max (m),
  Session Expiry (hours), Auto Checkout toggle, Offline Sync toggle,
  Default Language dropdown, Working Days checkboxes, Biometric Required toggle
- [Save Config] → calls api.js updateConfig() → confirms save

Departments screen: name + default shift, add/edit
Shifts screen: name, start time, end time, working days checkboxes, add/edit

appscript/Admin.gs must handle all CRUD for:
Locations, Holidays, Config, Departments, Shifts
```

**Tests for Step 5.4:**
- [ ] Employees table loads with search working
- [ ] Add employee: duplicate username → error shown
- [ ] Add employee: success → immediately visible in table
- [ ] Deactivate: employee can no longer log in (test with that account)
- [ ] Reactivate: employee can log in again
- [ ] Locations map loads with markers for all active locations
- [ ] Add location by clicking map → coordinates auto-filled
- [ ] Holiday: click date → enter name → appears highlighted on calendar
- [ ] Delete holiday → removed from calendar and Sheet
- [ ] Config: change geofence radius → save → app uses new value on next config load
- [ ] Biometric Required toggle: set to FALSE → employee can check in without fingerprint
- [ ] Departments and Shifts CRUD all working

### ✅ Stage 5 Complete — Full check before moving on:
- [ ] All 11 HR desktop screens render correctly
- [ ] Every screen performs its actions and reflects changes in the Sheet
- [ ] Attendance corrections write audit trail to AttendanceLog
- [ ] Report downloads as correctly formatted Excel file
- [ ] Employee management full lifecycle working (add, edit, deactivate, reactivate)
- [ ] Location map loads and new locations can be added
- [ ] Config changes take effect in the app
- [ ] HR can do everything without opening the Google Sheet

---

## Stage 6 — Security Layer

**Goal:** Device mismatch flagged, mock location detection active, brute force lockout, session cleanup and archive triggers running.

---

### Step 6.1 — Security Hardening + Maintenance Triggers (`appscript/Auth.gs` + `appscript/Maintenance.gs`)

**Prompt:**
```
Read CLAUDE.md. Stage 6, Step 1.
Harden the security layer and build appscript/Maintenance.gs.

Auth.gs additions:
- Rate limiting: track failed login attempts per username in Sessions tab
  (type='failed_attempt' row with count + last_attempt timestamp)
  After 5 failed attempts in 10 minutes → lock account for 30 minutes →
  return { status: 'locked', minutes_remaining }
  Reset counter on successful login
- Failed WebAuthn verification: after 3 failures in 10 minutes → lock check-in for 30 min →
  HR notified by flag in Employees tab (biometric_locked=TRUE + timestamp)

Maintenance.gs must:
- cleanExpiredSessions(): delete all Sessions rows where expires_at < now()
  Also delete used webauthn challenge rows
  Set up as a time-based trigger: runs daily at 02:00
- archiveAttendance(): copy all Attendance rows from previous year to a new spreadsheet
  named 'LMP_Attendance_Archive_YYYY' in the same Google Drive folder
  Then clear those rows from the main Attendance tab
  Set up as a time-based trigger: runs January 1st at 03:00
- Instructions comment at top of Maintenance.gs explaining how to set up both triggers
  in the Apps Script dashboard (Triggers → Add Trigger → time-based)
```

**Tests for Step 6.1:**
- [ ] 5 failed logins in quick succession → 6th attempt returns 'locked' with minutes remaining
- [ ] Wait 30 minutes (or manually clear the lock in Sessions tab) → login works again
- [ ] 3 failed fingerprint verifications → subsequent check-in attempts blocked for 30 min
- [ ] biometric_locked=TRUE visible in Employees Sheet tab after lockout
- [ ] `cleanExpiredSessions()` run manually → old session rows deleted, active sessions untouched
- [ ] `archiveAttendance()` run manually with test data → archive spreadsheet created → main tab cleared
- [ ] After archive: login and check-in still work normally

### ✅ Stage 6 Complete — Full check before moving on:
- [ ] Brute force login protection working
- [ ] Fingerprint lockout working and visible to HR
- [ ] Session cleanup runs without error (test manually then verify trigger is set up)
- [ ] Archive creates a new spreadsheet with correct data then clears main tab
- [ ] Both triggers documented in Maintenance.gs comments

---

## Stage 7 — Polish + PWA

**Goal:** Fully bilingual app, RTL correct, all screens polished, PWA update banner working, ready for go-live.

---

### Step 7.1 — Full Bilingual Pass (`locales/ar.json`, `locales/en.json`, `css/rtl.css`)

**Prompt:**
```
Read CLAUDE.md. Stage 7, Step 1.
Complete the bilingual system across the entire app.

Audit every screen in the app — find any hardcoded English strings and move them
to both locale files. Every visible string must use t() from i18n.js.

css/rtl.css must:
- Flip all layout: sidebar moves to right side, text-align switches, padding/margin swap
- Use logical CSS properties throughout styles.css (margin-inline-start instead of margin-left, etc.)
- Icons that imply direction (arrows, chevrons) must mirror in RTL
- Tables: column order stays the same, text alignment flips

Test with Arabic (RTL) and English (LTR) — switch between them and verify every screen.
```

**Tests for Step 7.1:**
- [ ] App opens in Arabic by default for ALL users — employee, manager, HR
- [ ] Switch to English → every visible string switches to English on every screen
- [ ] Switch back to Arabic → every visible string switches back to Arabic
- [ ] HR desktop: sidebar labels in Arabic (RTL) and English (LTR) — both correct
- [ ] HR desktop: all 11 screens fully bilingual — tables, forms, buttons, labels, map UI
- [ ] Date format: Arabic mode → `28/04/2026` and `08:52 ص` — English mode → `28/04/2026` and `08:52 AM`
- [ ] Calendar/holiday screen: month names in Arabic when AR, English when EN
- [ ] Error messages: wrong password → correct language shown for current setting
- [ ] GPS denied error → correct language
- [ ] Fingerprint failed error → correct language
- [ ] Apps Script errors (invalid session, not at location, account locked) → correct language
- [ ] Sync indicator `● Pending sync` / `✓ Synced` → correct language
- [ ] Offline banner → correct language
- [ ] PWA update banner → correct language
- [ ] Check-in success notification → correct language with time in correct format
- [ ] RTL (Arabic): HR desktop sidebar on the RIGHT side
- [ ] RTL (Arabic): all table columns text right-aligned
- [ ] RTL (Arabic): form labels on correct side, input fields direction correct
- [ ] Switch language on any screen → stays on current screen, no redirect
- [ ] No hardcoded English text anywhere — search codebase for any string not wrapped in t()

---

### Step 7.2 — Full UI Polish (all CSS files)

**Prompt:**
```
Read CLAUDE.md. Stage 7, Step 2.
Open design/LMP_Attendance_Screens_v3.html — this is the primary visual reference.
Extract every design decision from it: exact colors and their CSS variable names,
font family and weights, spacing values, border-radius, shadow definitions,
badge colors for each status, check-in button animation, sidebar active states,
table row styles, and stat card appearance.
Polish all CSS files: styles.css, mobile.css, desktop.css, rtl.css to match the
prototype exactly. Apply the frontend-design skill to fill in anything the prototype
does not cover.

Mobile employee screens:
- Check-in button: match the prototype exactly — size, color, fingerprint icon, pulse ring
- Status badges: match the prototype badge colors exactly for all four states
- Bottom tab bar: match icon + label style, active state from prototype

HR desktop:
- Sidebar: match the prototype's sidebar structure, item spacing, and active state exactly
- Data tables: readable, hover states, sorted column indicator
- Stat cards: match the prototype's card layout and color system
- Forms and slide-out panels: clean spacing, clear hierarchy
- Map screen: map takes appropriate space, table below is readable

Shared:
- Loading states: skeleton screens not spinners where possible
- Error states: clear and actionable messages
- Empty states: helpful message when no data (e.g. 'No attendance records this month')
- Consistent modal design across all confirmation dialogs
- Sync indicator: subtle but always visible when pending

Never use: Inter, Roboto, Arial, system fonts, purple gradients, generic AI aesthetics.
```

**Visual check after Step 7.2:**
- [ ] Employee check-in screen matches the prototype — not just similar, pixel-close
- [ ] Manager team status screen matches the prototype list and badge design
- [ ] HR dashboard matches the prototype stat cards and activity table
- [ ] All badges, status indicators, and icons are consistent with the prototype
- [ ] Loading and empty states exist for every data-fetching screen
- [ ] App looks the same quality in Arabic RTL and English LTR
- [ ] No visible layout breaks on screen sizes 375px (small phone) to 1440px (laptop)

---

### Step 7.3 — PWA Update Banner + Final Service Worker (`sw.js`)

**Prompt:**
```
Read CLAUDE.md. Stage 7, Step 3.
Finalize sw.js with the update banner flow.

sw.js must:
- Cache all static assets on install (HTML, CSS, JS, locales, icons)
- Serve from cache first — network fallback
- On every app open: check for a new service worker silently
- When a new SW is waiting: show a non-intrusive banner at the bottom of the screen:
  'A new version is available' [Update Now] button
- User taps Update Now → skipWaiting() → clients.claim() → page reloads with new version
- The banner must be dismissed without updating if user taps outside it
```

**Tests for Step 7.3:**
- [ ] App works fully offline after first load (all screens, no network errors)
- [ ] Deploy a small visible change to GitHub Pages
- [ ] Open the installed PWA → update banner appears
- [ ] Tap Update Now → app reloads with the new change visible
- [ ] Tap outside banner → banner dismisses, update does not apply until next open

### ✅ Stage 7 Complete — Full check before moving on:
- [ ] Entire app is bilingual — no hardcoded strings
- [ ] RTL layout correct on all screens
- [ ] App looks professional on both mobile and desktop — matches the design prototype
- [ ] PWA update flow works end-to-end
- [ ] No console errors on any screen in any language

---

## Go Live

### Switch from test data to real data:
1. [ ] HR logs in to the desktop app
2. [ ] Go to Config screen → verify all settings are correct for production
3. [ ] Go to Locations screen → remove test location → add real company location(s) with correct coordinates
4. [ ] Go to Shifts screen → set up real working shifts with correct times
5. [ ] Go to Departments screen → add real departments
6. [ ] Go to Employees screen → deactivate any test employees → add real employees with real usernames and temp passwords
7. [ ] Notify employees of their username and temp password — they will be forced to change on first login
8. [ ] Each employee installs the PWA on their phone: visit the GitHub Pages URL in Chrome → Add to Home Screen
9. [ ] Each employee logs in, changes password, registers fingerprint — all self-service
10. [ ] Verify one real check-in end-to-end → row in Attendance tab confirmed
11. [ ] You are live ✅

### Post go-live monitoring (first week):
- [ ] Check Apps Script execution logs daily for any errors
- [ ] Check Attendance tab — verify records are writing correctly
- [ ] Check Sessions tab — verify nightly cleanup is running
- [ ] Ask HR to confirm all 11 desktop screens are working
- [ ] Confirm PWA is installed on all employee phones

---

## Future Additions (when ready)

When adding any new feature, start a new Claude Code session with this message:
```
Read CLAUDE.md. I want to add [feature name].
Confirm you understand the existing architecture before writing any code.
Tell me which files will change and which new files are needed.
```

Possible Phase 2 features:
- GPS variance test (3 readings / 20-second wait) — add to gps.js + Attendance.gs
- Flagged records HR dashboard — new HR screen + getFlaggedRecords() endpoint
- Overtime tracking — flag check-outs past shift end in Attendance.gs
- Auto-checkout trigger — Maintenance.gs: run at shift end, mark as auto_checkout
- Push notifications — Firebase Cloud Messaging for check-out reminders
- Local server migration — swap api.js SCRIPT_URL for local Node.js server URL

---

*Keep this file open while building. Check off every item as you go.*
*If something fails a test, fix it before moving to the next step.*
*Never skip the end-of-stage full checks — they catch cross-file issues early.*
*If Claude Code goes off-plan, paste the relevant CLAUDE.md section and say: follow this exactly.*
