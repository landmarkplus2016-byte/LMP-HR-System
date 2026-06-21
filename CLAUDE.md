# CLAUDE.md — LMP Attendance PWA
> This file is Claude Code's persistent memory for this project.
> Read this at the start of every session before writing any code.

---

## What We Are Building

A GPS-verified, biometric employee attendance PWA for Landmark Plus.
- **Employee app:** Mobile PWA installed on employee phones — check in/out with fingerprint + GPS
- **HR desktop app:** Full management dashboard installed as desktop PWA on HR Manager's laptop
- **Manager app:** Same PWA, manager role view — team status and leave approvals
- Hosted on **GitHub Pages** (public repo — NO sensitive data ever in code)
- **Google Sheets** as the sole database, accessed ONLY through Google Apps Script Web App
- **No Firebase. No npm. No build tools.** Pure HTML, CSS, vanilla JS — all dependencies via CDN

---

## Non-Negotiable Rules

1. **No sensitive data in code** — Apps Script URL lives in `localStorage` only, Sheet ID never leaves the script
2. **Never call Google Sheets directly** — ALL reads/writes go through `js/api.js` → Apps Script only
3. **One file, one job** — never add logic to a file that belongs in another file
4. **Passwords are always hashed** — never store or log plain-text passwords anywhere, ever
5. **Double GPS validation** — geofence check runs client-side (feedback) AND server-side (authority)
6. **Fingerprint is required for check-in** — biometric must pass before GPS runs, no exceptions unless `biometric_exempt = TRUE` in Employees tab
7. **Never hard-delete any record** — deactivate employees, correct attendance — never delete rows
8. **Role enforcement is server-side** — Apps Script enforces role permissions on every request, not just the frontend
9. **Session token on every call** — every API call carries the session token, Apps Script validates it every time
10. **HTTPS only** — the PWA will not function on HTTP (GPS API requires secure context)

---

## Four User Roles — Quick Reference

| Role | Device | Navigation | Key permissions |
|---|---|---|---|
| Employee | Mobile | Bottom tab bar | Check in/out, own attendance history, leave requests |
| Manager | Mobile or desktop | Bottom tabs / sidebar | Team live status, leave approvals, team attendance records |
| HR Manager | Desktop (laptop) | Left sidebar — 11 screens | Full company dashboard, employee management, all admin screens, reports |
| Developer (you) | — | Google Sheet + Apps Script | Only person with Sheet access — everyone else uses the PWA |

> ⚠️ Nobody except the developer ever opens the Google Sheet. HR manages everything through the PWA desktop app. The Sheet is a locked silent database.

---

## File Map — One Job Per File

```
lmp-attendance/
├── CLAUDE.md                   ← you are here
├── index.html                  # App shell only — loads all CSS and JS, contains router
├── manifest.json               # PWA manifest — name, icons, display standalone
├── sw.js                       # Service worker — cache-first for static assets, background sync for offline queue
│
├── design/
│   └── LMP_Attendance_Screens_v3.html  # Interactive design prototype — visual reference for all UI work
│
├── js/
│   ├── app.js                  # App init, router, auth state listener, role-based nav renderer
│   ├── api.js                  # ALL fetch() calls to Apps Script URL — nothing else calls Apps Script
│   ├── auth.js                 # Login form, session token management, logout
│   ├── gps.js                  # Geolocation, client-side geofence, accuracy check, mock location detection
│   ├── biometric.js            # WebAuthn registration and fingerprint verification
│   ├── security.js             # Device ID generation and tracking
│   ├── attendance.js           # Check-in / check-out UI logic and flow orchestration
│   ├── offline.js              # IndexedDB offline queue, background sync retry
│   ├── employee.js             # Employee-only views: history, leave request form, leave balance
│   ├── manager.js              # Manager views: team live status, leave approvals, team records
│   ├── hr.js                   # HR desktop views: dashboard, all admin screens, report generation
│   ├── report.js               # SheetJS client-side Excel report generation
│   ├── config.js               # Loads app config from Apps Script on startup, caches it
│   ├── i18n.js                 # Arabic/English translation engine
│   └── utils.js                # Haversine formula, date helpers, ID generators, hash utilities
│
├── css/
│   ├── styles.css              # Base styles, CSS variables, shared components
│   ├── rtl.css                 # Arabic RTL layout overrides — applied when lang = ar
│   ├── mobile.css              # Employee and manager mobile-specific styles
│   └── desktop.css             # HR desktop sidebar layout, data tables, dashboard grid
│
├── locales/
│   ├── en.json                 # All English UI strings
│   └── ar.json                 # All Arabic UI strings
│
├── appscript/
│   ├── Code.gs                 # doPost() router — entry point for all API calls
│   ├── Auth.gs                 # login(), createSession(), validateSession(), logout()
│   ├── Attendance.gs           # checkIn(), checkOut(), getAttendance(), correctAttendance(), addManual()
│   ├── Employees.gs            # getEmployees(), addEmployee(), updateEmployee(), deactivate(), reactivate()
│   ├── Leaves.gs               # submitLeave(), approveLeave(), rejectLeave(), getLeaves()
│   ├── Locations.gs            # getLocations(), addLocation(), updateLocation(), toggleLocation()
│   ├── Admin.gs                # Shifts, Departments, Holidays, Config CRUD
│   ├── Report.gs               # getReportData() — structured data for SheetJS export
│   ├── Maintenance.gs          # cleanExpiredSessions(), archiveAttendance() — scheduled triggers
│   └── Utils.gs                # haversine(), generateId(), hashPassword(), verifyPassword(), formatDate()
│
└── assets/
    ├── icon-192.png            # PWA icon
    ├── icon-512.png            # PWA icon large
    └── logo.svg                # App logo
```

---

## Design Reference

A working interactive prototype lives at `design/LMP_Attendance_Screens_v3.html`.

**Read this file before building any UI screen. It is the single source of truth for all visual decisions.**

It defines:
- The exact color system and CSS variable values to use throughout the app
- Typography — font family, weights, and sizes for headings, body text, labels, and badges
- The check-in button — size, color, fingerprint icon, pulse animation, and tap states
- Status badge system — exact colors for حاضر (Present), متأخر (Late), غائب (Absent), إجازة (On Leave)
- Team member list row layout — avatar circle with initials, name, department, check-in time, badge
- Manager home screen — summary stat cards (Present / Absent / Late / On Leave counts) and live team list
- Employee home screen — greeting, date, shift info, GPS status indicator, dominant check-in button
- HR desktop dashboard — sidebar navigation with Arabic labels, stat cards, recent activity table
- Arabic RTL layout — sidebar on the right, text alignment, form field directions, icon mirroring
- All spacing, border-radius, shadow values, and transition timings

**Rules for using the prototype:**
- Do not invent a visual style — extract everything from the prototype and match it exactly
- When the prompt says "apply frontend-design skill", the prototype takes priority over generic skill output
- Extract CSS variable values (colors, radii, shadows) from the prototype's compiled styles and define them in `styles.css`
- Any component visible in the prototype (badge, card, list row, sidebar item, button) must be implemented to match — not approximated

---

## Key Business Logic — Know Before You Code

### Authentication Flow (`js/auth.js` + `Auth.gs`)
- Employee opens PWA → username + password form
- `api.js` sends `{ action: 'login', username, passwordHash }` to Apps Script
- `Auth.gs` looks up username in Employees tab → compares `hashPassword(password)` against stored `password_hash`
- If `force_password_change = TRUE` → Apps Script returns `{ status: 'change_password' }` → PWA shows change password screen
- On success: Apps Script generates UUID session token → writes to Sessions tab with `employee_id`, `expires_at` (8 hours), `device_id` → returns token + employee profile + app config
- PWA stores token in `localStorage` as `lmp_session`
- Every subsequent `api.js` call includes `{ session_token, device_id }` in the payload
- `Auth.gs` `validateSession()` runs at the top of every Apps Script action handler

### Password Rules
- Stored as SHA-256 hash in `password_hash` column of Employees tab
- HR sets temporary password when adding employee — `force_password_change` = TRUE
- On first login, employee must set their own password before proceeding
- `utils.js` `hashPassword(plain)` → returns hex SHA-256 string (pure JS, no library)
- Plain text password never sent or stored — the hash is sent in the login payload

### GPS Geofence Check (`js/gps.js` + `Attendance.gs`)
```javascript
// Haversine formula — lives in js/utils.js AND Utils.gs (both sides)
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth radius in metres
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) ** 2 +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLng/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```
- Client-side check: instant feedback to employee — "You are not at a company location"
- Server-side check in `Attendance.gs`: re-validates submitted coordinates independently — this is the authority
- Accuracy rejection: reject if `coords.accuracy < 5` (DevTools fake) or `coords.accuracy > 200` (too inaccurate)
- Mock location detection: check `navigator.userAgentData` patterns and accuracy anomalies in `gps.js`
- Geofence radius: read from Config tab (`geofence_radius_m`) — default 150m, HR can change

### Fingerprint / WebAuthn Flow (`js/biometric.js` + `Auth.gs`)

**Registration (one-time, after first login):**
1. PWA calls `webauthn_register_challenge` → Apps Script generates random 32-byte challenge, stores in Sessions tab with 2-min expiry
2. `navigator.credentials.create()` — triggers Android fingerprint prompt
3. PWA sends credential ID + public key + signed challenge to `webauthn_register_complete`
4. Apps Script verifies challenge → stores `webauthn_credential_id` + `webauthn_public_key` + `webauthn_registered_at` in Employees tab

**Check-in fingerprint verification:**
1. PWA calls `webauthn_auth_challenge` → fresh random challenge, 2-min expiry, single-use
2. `navigator.credentials.get()` — fingerprint prompt
3. PWA sends signed response to `webauthn_auth_verify`
4. Apps Script verifies signature using stored public key — if valid, returns one-time `checkin_token`
5. `checkin_token` is included in the check-in payload — `Attendance.gs` only accepts check-ins with a valid `checkin_token`

**Biometric exempt employees:**
- `biometric_exempt = TRUE` in Employees tab → skip biometric step entirely
- HR sets this individually per employee (phones with no sensor)
- Record shows `biometric_verified: FALSE`, `reason: exempt`

**New phone detection:**
- `biometric.js` checks `localStorage` for stored `credential_id`
- If missing (new phone) → show re-registration prompt after login
- **Registration is one-time per employee, not self-service replacement.** `webauthnRegisterComplete` (`Auth.gs`) rejects the attempt if `webauthn_credential_id` is already set on the employee record — this is what stops a coworker who knows someone's password from "registering" their own fingerprint on their own phone and checking in on that person's behalf
- A genuine phone change requires HR to clear the old credential first via `hr_reset_biometric` (Employees screen → employee detail → "Reset Biometric") — only then does the next login's registration prompt succeed

### Check-in Full Flow (`js/attendance.js`)
```
Employee taps "Check In"
  → biometric.js: is fingerprint registered? No → registration flow first
  → biometric.js: request challenge from api.js
  → native fingerprint prompt
  → biometric.js: verify with api.js → receive checkin_token
  → gps.js: get position (accuracy check + mock location check)
  → client-side geofence check → show error if outside
  → api.js: POST checkin { session_token, checkin_token, lat, lng, accuracy, device_id }
  → Apps Script: validateSession() → verifyCheckinToken() → haversine() → write Attendance row
  → success: show check-in time + location name
  → offline: queue in IndexedDB if network fails
```

### Offline Queue (`js/offline.js` + `sw.js`)
- Check-in/out requests that fail due to no network → saved to IndexedDB `pending_queue` store
- Service worker Background Sync registered with tag `attendance-sync`
- When connectivity returns, service worker fires → `offline.js` processes queue in order
- Each item retried up to 3 times before marking as failed and notifying HR
- Offline records show `synced: FALSE` until confirmed — employee sees "Pending sync" indicator

### Session Cleanup (`Maintenance.gs`)
- `cleanExpiredSessions()` → nightly trigger at 02:00 → deletes rows where `expires_at < now()`
- `archiveAttendance()` → January 1st trigger → copies previous year's Attendance rows to archive spreadsheet → clears main Attendance tab
- Both are time-based triggers set up once in Apps Script dashboard — zero PWA changes

### Responsive Layout — One Codebase, Two Layouts
```css
/* styles.css — one breakpoint controls everything */
.sidebar       { display: none; }
.bottom-nav    { display: flex; }

@media (min-width: 900px) {
    .sidebar    { display: flex; width: 200px; }
    .bottom-nav { display: none; }
    .data-table { display: table; }
    .card-list  { display: none; }
}
```
- `app.js` `renderNav()` checks `window.innerWidth >= 900` to decide sidebar vs bottom tabs
- HR-only sidebar items filtered by `currentUser.role === 'hr'`
- Manager sees team sections on both mobile (tabs) and desktop (sidebar subset)

### i18n Bilingual System (`js/i18n.js`)

**Scope — applies to EVERY part of the app without exception:**
- Employee mobile app — all screens
- HR desktop app — all 11 screens including admin panels, forms, tables, and map labels
- Manager views — both mobile and desktop
- Error messages — every error returned by api.js or Apps Script
- System notifications — sync indicators, GPS status, fingerprint prompts, offline banners, update banner
- Date and time formats — switch with language
- All status badges, labels, confirmations, and warnings

**Rules:**
- Language preference stored in `localStorage` as `lmp_lang` — default: `ar` for ALL users and ALL roles
- All UI strings referenced via `t('key')` — never hardcode any visible text in HTML or JS
- RTL: `<html dir="rtl">` + `rtl.css` applied when `lang = ar` — this includes the HR desktop sidebar layout
- Language toggle in nav bar (mobile: in top bar / desktop: in sidebar footer) — switches instantly without page reload
- Translation keys live in `locales/en.json` and `locales/ar.json`

**Date format rules:**
- Arabic (`lmp_lang = ar`): `DD/MM/YYYY` — e.g. `28/04/2026`
- English (`lmp_lang = en`): `DD/MM/YYYY` — same format, different language context
- Time: 12-hour with AM/PM in English (`08:52 AM`), 12-hour with ص/م in Arabic (`08:52 ص`)
- Month names in full when displayed in calendar/holiday views: Arabic month names in AR, English in EN
- `utils.js` must export `formatDate(date)` and `formatTime(date)` that read `lmp_lang` and return correctly formatted strings
- All dates in Sheet are stored as `YYYY-MM-DD` (ISO) — formatting is display-only, never affects stored data

**Error messages — bilingual rules:**
- Every error returned by Apps Script includes both `message_ar` and `message_en` fields in the JSON
- `api.js` reads `lmp_lang` and picks the correct field before passing to the UI
- Example Apps Script error response: `{ status: 'error', message_ar: 'بيانات الدخول غير صحيحة', message_en: 'Invalid credentials' }`
- Client-side errors (GPS denied, no network, fingerprint failed) also use `t('error.key')` from locale files
- Never show raw technical error strings to users — always a human-readable bilingual message

**System notifications — bilingual rules:**
- Sync status indicator: `t('sync.pending')` / `t('sync.complete')`
- GPS messages: `t('gps.denied')` / `t('gps.weak')` / `t('gps.fake_detected')` / `t('gps.outside_range')`
- Fingerprint messages: `t('biometric.prompt')` / `t('biometric.failed')` / `t('biometric.locked')`
- Offline banner: `t('offline.banner')`
- PWA update banner: `t('update.available')`
- Check-in confirmation: `t('checkin.success')` with time and location name interpolated
- All toast/snackbar messages: bilingual via locale files

**Locale file structure — both files must contain keys for all of the above categories:**
```
login.*, password.*, nav.*, checkin.*, checkout.*, attendance.*,
leave.*, team.*, hr.*, employees.*, locations.*, shifts.*,
departments.*, holidays.*, config.*, reports.*, error.*,
gps.*, biometric.*, sync.*, offline.*, update.*, date.*, time.*
```

### Device ID (`js/security.js`)
- Generated once on first install: hash of `navigator.userAgent + screen.width + screen.height + timezone`
- Stored in `localStorage` as `lmp_device_id`
- Sent with every API call
- Apps Script stores `device_id` on session creation
- Check-in from a different `device_id` than the session's registered device → `device_match: FALSE` in Attendance record — HR can see this

### HR Monthly Report (`js/report.js` + `Report.gs`)
- HR selects month + optional department filter in the Reports screen
- `api.js` calls `get_report_data` → Apps Script fetches and structures the data
- `report.js` uses SheetJS (CDN) to generate `.xlsx` file client-side
- Columns: Employee Name, Department, Day 1…Day 31 (P/A/L/Leave/Holiday/—), Total Present, Total Absent, Total Late, Total Hours Worked, Leave Days Used
- One row per employee — downloaded instantly to HR's laptop

---

## Google Sheets Tab Reference

| Tab | Purpose | Who writes |
|---|---|---|
| `Config` | App settings key-value pairs | Apps Script (HR via PWA) |
| `Employees` | All employee records, credentials, WebAuthn keys | Apps Script (HR via PWA + Auth.gs) |
| `Departments` | Department names | Apps Script (HR via PWA) |
| `Shifts` | Shift schedules with times and working days | Apps Script (HR via PWA) |
| `Locations` | Office GPS coordinates and geofence radius | Apps Script (HR via PWA) |
| `Attendance` | All check-in/check-out records | Apps Script (employees + HR corrections) |
| `AttendanceLog` | Audit trail — every HR correction with original values | Apps Script (append-only) |
| `Leaves` | Leave requests and approval status | Apps Script (all roles) |
| `Holidays` | Company holiday dates | Apps Script (HR via PWA) |
| `Sessions` | Active login tokens — auto-cleaned nightly | Apps Script only |

### Employees Tab Columns (full reference)
`id | name | username | password_hash | force_password_change | role | department | shift_id | manager_id | active | biometric_exempt | webauthn_credential_id | webauthn_public_key | webauthn_registered_at | device_id`

### Attendance Tab Columns (full reference)
`id | employee_id | date | check_in | check_out | hours_worked | location_id | lat | lng | accuracy | biometric_verified | biometric_method | device_id | device_match | status | notes | corrected_by | corrected_at`

### Config Tab Keys (full reference)
`app_name | company_name | geofence_radius_m | late_threshold_min | gps_accuracy_max_m | session_expiry_hours | auto_checkout_enabled | offline_sync_enabled | primary_language | working_days | biometric_required`

---

## Apps Script Endpoints — Full Reference

All calls are POST to the Web App URL. Every call (except `login` and `get_config`) requires `session_token` in the payload.

| Action | Role | Description |
|---|---|---|
| `login` | All | Hash check → session token → profile + config |
| `change_password` | All | Verify old hash → store new hash → clear force_change flag |
| `logout` | All | Delete session row |
| `get_config` | All (no auth) | Return Config tab as JSON — called on app startup |
| `webauthn_register_challenge` | Employee | Generate + store registration challenge |
| `webauthn_register_complete` | Employee | Verify + store credential ID and public key |
| `webauthn_auth_challenge` | Employee | Generate + store auth challenge (2-min expiry, single-use) |
| `webauthn_auth_verify` | Employee | Verify signature → return one-time checkin_token |
| `checkin` | Employee | Validate checkin_token + GPS → write Attendance row |
| `checkout` | Employee | Find open check-in → write checkout + calculate hours |
| `get_my_attendance` | Employee | Own last 30 days only |
| `submit_leave` | Employee | Write leave request row |
| `get_my_leaves` | Employee | Own leave requests + balance |
| `get_team_status` | Manager | Today's status for all employees under this manager |
| `get_team_attendance` | Manager | Team attendance, filterable by date |
| `get_team_leaves` | Manager | Pending leave requests for team |
| `approve_leave` | Manager/HR | Update leave status → approved |
| `reject_leave` | Manager/HR | Update leave status → rejected |
| `get_all_attendance` | HR | All attendance, filterable by employee + date range |
| `correct_attendance` | HR | Edit record → write original to AttendanceLog → update Attendance |
| `add_manual_attendance` | HR | Insert manual record with required HR note |
| `get_flagged_records` | HR | Records where device_match = FALSE |
| `get_all_employees` | HR | Full employee list including inactive |
| `get_team_employees` | Manager | Employees under calling manager |
| `add_employee` | HR | Validate unique username → append to Employees tab |
| `update_employee` | HR | Edit employee details |
| `deactivate_employee` | HR | Set active = FALSE (reject if self) |
| `reactivate_employee` | HR | Set active = TRUE |
| `get_report_data` | HR | Structured attendance + leave + holiday data for SheetJS |
| `get_locations / add_location / update_location / toggle_location` | HR | Location CRUD |
| `get_shifts / add_shift / update_shift / delete_shift` | HR | Shift CRUD |
| `get_holidays / add_holiday / delete_holiday` | HR | Holiday calendar CRUD |
| `get_departments / add_department / update_department` | HR | Department CRUD |
| `update_config` | HR | Write config key-value pairs to Config tab |

---

## Build Stages — Follow This Order

### Stage 1 — Foundation
Google Sheet setup → `appscript/Code.gs` + `Auth.gs` + `Utils.gs` → `index.html` → `js/app.js` → `js/api.js` → `js/auth.js` → `js/config.js` → `js/i18n.js` + `locales/`

**Goal:** Employee can log in with username/password, force-change password on first login, session token stored, app shell renders with correct role, language toggle works.

### Stage 2 — GPS + Biometric + Check-in
`js/gps.js` → `js/biometric.js` → `js/security.js` → `js/attendance.js` → `appscript/Attendance.gs`

**Goal:** Employee registers fingerprint once, taps check-in, fingerprint verified, GPS validated both client and server, attendance row written to Sheet.

### Stage 3 — Employee App + Offline
`js/employee.js` → `js/offline.js` → `sw.js` (background sync) → `manifest.json`

**Goal:** Employee sees their attendance history and leave request form, check-in works offline and syncs on reconnect, PWA installs on Android.

### Stage 4 — Manager View
`js/manager.js` → `appscript/Leaves.gs` (approve/reject)

**Goal:** Manager sees team live status today, can approve/reject leave requests, views team attendance records filtered by date.

### Stage 5 — HR Desktop App
`js/hr.js` → `js/report.js` → `appscript/Employees.gs` + `Admin.gs` + `Report.gs` → `css/desktop.css`

**Goal:** HR Manager has all 11 desktop screens working — dashboard, live status, attendance records with correction, leave management, report export, employee management, locations, shifts, departments, holidays, config.

### Stage 6 — Security Layer
`js/security.js` (device ID tracking) → mock location detection in `js/gps.js` → rate limiting in `Auth.gs` → `appscript/Maintenance.gs` (session cleanup + archive triggers)

**Goal:** Device mismatch flagged in records, mock location detection active, brute force lockout after 3 failed fingerprint attempts, nightly session cleanup working, yearly archive trigger set up.

### Stage 7 — Polish
Full bilingual Arabic/English in all views → `css/rtl.css` → UI polish across all screens → PWA update banner in `sw.js` → final end-to-end testing

**Goal:** App fully bilingual, RTL layout correct in Arabic, all screens polished, PWA update flow working, ready for go-live.

---

## UI Design Rules — Apply frontend-design Skill

> ⚠️ The prototype at `design/LMP_Attendance_Screens_v3.html` takes priority over all rules below.
> Read the prototype first. Use these rules to fill in anything the prototype does not cover.

- **Mobile employee screen:** Clean, large check-in button dominant, one action at a time, thumb-friendly
- **HR desktop:** Data-dense sidebar layout, sortable tables, professional internal tool feel
- **Breakpoint:** 900px — below = mobile layout, above = desktop sidebar layout
- **Typography:** Distinctive, readable — never Inter, Roboto, Arial, or system fonts
- **Colors:** CSS variables throughout — one dominant brand color, sharp accent for actions
- **Arabic RTL — applies to desktop AND mobile:** Sidebar moves to right side, all layout flips in `rtl.css` — never use `left/right` in `styles.css`, always use `start/end` logical properties. HR desktop sidebar, tables, forms, map UI all must flip correctly in RTL.
- **Status indicators:** `● Pending sync` (amber), `✓ Synced` (green brief), `⚠ GPS poor` (amber), `✗ Blocked` (red), `🔒 Biometric required` (neutral)
- **Never:** Purple gradients, generic AI aesthetics, cookie-cutter layouts

---

## What NOT to Do

- Never store plain-text passwords anywhere — hash before sending, hash before storing
- Never call Apps Script from any file except `js/api.js`
- Never skip the server-side GPS check — client check is for UX only, server check is the security gate
- Never allow check-in without a valid `checkin_token` from WebAuthn verification (unless `biometric_exempt = TRUE`)
- Never share the Google Sheet with any employee or manager Gmail — the Sheet is developer-only
- Never hardcode the Apps Script URL — it lives in `localStorage` as `lmp_script_url`
- Never add a feature not in this file without confirming with the project owner (Khaled)
- Never hard-delete an employee — `active = FALSE` only, historical attendance must be preserved
- Never hard-delete attendance records — HR corrects, originals go to `AttendanceLog`
- Never hardcode any visible text string in HTML or JS — everything goes through `t()` from `i18n.js`
- Never show raw technical error strings — always route through bilingual error messages
- Never format dates or times without going through `utils.js` `formatDate()` / `formatTime()` — they handle language switching
- Never assume the app is mobile-only when applying bilingual — HR desktop must be fully bilingual in all 11 screens
- Never ignore the `force_password_change` flag — always enforce password change before allowing access
- Never invent a visual style — all UI must be built to match `design/LMP_Attendance_Screens_v3.html`
