// =============================================================================
// Utils.gs — Shared helpers: sheet I/O, crypto, GPS, date/time, responses
// =============================================================================

// ---------------------------------------------------------------------------
// SPREADSHEET — replace with your actual Spreadsheet ID before deploying
// ---------------------------------------------------------------------------
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';

// Expected Sessions tab column headers (set these up in your Sheet):
// token | employee_id | role | expires_at | device_id | token_type | challenge | used

// ---------------------------------------------------------------------------
// Spreadsheet access
// ---------------------------------------------------------------------------

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet(name) {
  const sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

// Convert sheet data to array of plain objects using row 1 as headers.
// Each object gets a hidden __rowIndex (1-based) for targeted updates.
function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map((row, i) => {
    const obj = {};
    headers.forEach((h, j) => { obj[h] = row[j]; });
    obj.__rowIndex = i + 2; // +1 for header row, +1 for 0-based slice
    return obj;
  });
}

// Find the first row where colName === value. Returns the object with
// __rowIndex, or null if not found.
function findRow(sheet, colName, value) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0];
  const colIdx = headers.indexOf(colName);
  if (colIdx === -1) return null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIdx]) === String(value)) {
      const obj = {};
      headers.forEach((h, j) => { obj[h] = data[i][j]; });
      obj.__rowIndex = i + 1; // 1-based
      return obj;
    }
  }
  return null;
}

// Append a new row to the sheet. obj keys must match header names exactly;
// any missing key writes an empty string.
function appendRow(sheet, obj) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(h => (obj[h] !== undefined ? obj[h] : ''));
  sheet.appendRow(row);
}

// Overwrite specific columns in an existing row. Only keys present in
// updates are changed; all other columns keep their current values.
function updateRow(sheet, rowIndex, updates) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const current = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  const rowObj = {};
  headers.forEach((h, i) => { rowObj[h] = current[i]; });
  Object.assign(rowObj, updates);
  const newRow = headers.map(h => (rowObj[h] !== undefined ? rowObj[h] : ''));
  sheet.getRange(rowIndex, 1, 1, lastCol).setValues([newRow]);
}

// Delete an entire row by its 1-based row index.
function deleteSheetRow(sheet, rowIndex) {
  sheet.deleteRow(rowIndex);
}

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

// Returns lowercase hex SHA-256 of plain text.
// Must produce identical output to the browser's utils.js hashPassword().
function hashPassword(plain) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    plain,
    Utilities.Charset.UTF_8
  );
  // computeDigest returns signed bytes (-128..127); mask to unsigned (0..255)
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ---------------------------------------------------------------------------
// GPS
// ---------------------------------------------------------------------------

// Haversine formula — returns distance in metres between two GPS coordinates.
// Mirrors the implementation in js/utils.js exactly.
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Date / time
// ---------------------------------------------------------------------------

// Returns YYYY-MM-DD string (ISO date, stored format for all dates in Sheet).
function formatDate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// Returns HH:MM string in 24-hour format.
function formatTime(date) {
  const d = new Date(date);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Config tab helpers
// ---------------------------------------------------------------------------

// Read a single key from the Config tab. Returns fallback if key is missing.
function getConfigValue(key, fallback) {
  try {
    const data = getSheet('Config').getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === key) return data[i][1];
    }
  } catch (e) {
    // Sheet access failure — use fallback silently
  }
  return fallback;
}

// Read the entire Config tab as a plain object { key: value, ... }.
function getAllConfig() {
  try {
    const data = getSheet('Config').getDataRange().getValues();
    const config = {};
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) config[String(data[i][0])] = data[i][1];
    }
    return config;
  } catch (e) {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

// Successful response — wraps data in the standard envelope.
function ok(data) {
  return { status: 'ok', data: data || {} };
}

// Error response — always includes both language strings so api.js can pick
// the correct one based on the client's lmp_lang setting.
function error(messageEn, messageAr) {
  return {
    status: 'error',
    message_en: messageEn,
    message_ar: messageAr || messageEn
  };
}
