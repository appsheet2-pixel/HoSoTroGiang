/**
 * Kết nối Google Sheets / Drive bằng service account.
 * GOOGLE_SERVICE_ACCOUNT_JSON: nội dung file JSON (hoặc base64 của nó)
 * GOOGLE_IMPERSONATE (tùy chọn): email Workspace để service account "đóng vai" (cần domain-wide delegation)
 */
const { google } = require('googleapis');

let _auth = null, _sheets = null, _drive = null;

function credentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw) throw new Error('Thiếu biến môi trường GOOGLE_SERVICE_ACCOUNT_JSON');
  const txt = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(txt);
}

function auth() {
  if (_auth) return _auth;
  const c = credentials();
  _auth = new google.auth.JWT({
    email: c.client_email,
    key: c.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
    subject: process.env.GOOGLE_IMPERSONATE || undefined,
  });
  return _auth;
}

function sheets() { return _sheets || (_sheets = google.sheets({ version: 'v4', auth: auth() })); }
function drive() { return _drive || (_drive = google.drive({ version: 'v3', auth: auth() })); }
function serviceEmail() { try { return credentials().client_email; } catch (e) { return ''; } }

/** Cho phép thay thế bằng bản giả lập khi kiểm thử */
function _setClients(s, d) { _sheets = s; _drive = d; }

module.exports = { sheets, drive, serviceEmail, _setClients };
