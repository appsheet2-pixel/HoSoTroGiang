/** Hàm tiện ích dùng chung */
const crypto = require('crypto');

const pad2 = x => String(x).padStart(2, '0');

function formatDate(d, fmt) {
  return fmt
    .replace('yyyy', d.getFullYear())
    .replace('yy', String(d.getFullYear()).slice(2))
    .replace('MM', pad2(d.getMonth() + 1))
    .replace('dd', pad2(d.getDate()))
    .replace('HH', pad2(d.getHours()))
    .replace('mm', pad2(d.getMinutes()))
    .replace('ss', pad2(d.getSeconds()));
}

const isDate = v => v instanceof Date && !isNaN(v.getTime());
const norm = v => String(v == null ? '' : v).trim().toLowerCase();
const fold = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || ''));
const uuid = () => crypto.randomUUID().replace(/-/g, '');

function fmtDate(d) { return formatDate(d, 'yyyy-MM-dd'); }
function dtStr(v) { return isDate(v) ? formatDate(v, 'dd/MM/yyyy HH:mm') : (v ? String(v) : ''); }

/** Đưa giá trị ngày (Date | 'yyyy-MM-dd' | 'dd/MM/yyyy') về 'yyyy-MM-dd' */
function dateStr(v) {
  if (!v) return '';
  if (v instanceof Date) return isDate(v) ? fmtDate(v) : '';
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]);
  return '';
}
function toDate(s) {
  s = dateStr(s);
  if (!s) return null;
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
/** Số serial Google Sheets -> Date theo giờ địa phương (TZ của server) */
function serialToDate(n) {
  const u = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
}
function age(d) {
  if (!isDate(d)) return '';
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return a;
}
function lastName(full) { const p = String(full || '').trim().split(/\s+/); return p[p.length - 1] || ''; }

/** Giá trị JS -> giá trị ghi bằng USER_ENTERED; giữ số 0 đầu, chống chèn công thức */
function toCell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (!isDate(v)) return '';
    return (v.getHours() || v.getMinutes() || v.getSeconds()) ? formatDate(v, 'yyyy-MM-dd HH:mm:ss') : formatDate(v, 'yyyy-MM-dd');
  }
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  const s = String(v);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  if (/^\d+$/.test(s) && (s.charAt(0) === '0' || s.length >= 8)) return "'" + s;
  if (/^\d{1,4}[/\-.]\d{1,2}([/\-.]\d{1,4})?$/.test(s)) return "'" + s; // tránh Sheets tự đổi thành ngày
  return s;
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Bộ nhớ đệm có thời hạn (thay CacheService) */
class TTLCache {
  constructor() { this.m = new Map(); }
  get(k) { const e = this.m.get(k); if (!e) return null; if (e.exp < Date.now()) { this.m.delete(k); return null; } return e.v; }
  put(k, v, sec) { this.m.set(k, { v: String(v), exp: Date.now() + sec * 1000 }); if (this.m.size > 20000) this.gc(); }
  remove(k) { this.m.delete(k); }
  gc() { const now = Date.now(); for (const [k, e] of this.m) if (e.exp < now) this.m.delete(k); }
}
const cache = new TTLCache();

/** Khóa tuần tự cho các thao tác ghi */
class Mutex {
  constructor() { this.p = Promise.resolve(); }
  run(fn) { const r = this.p.then(fn, fn); this.p = r.catch(() => {}); return r; }
}

module.exports = { pad2, formatDate, isDate, norm, fold, isEmail, uuid, fmtDate, dtStr, dateStr, toDate, serialToDate, age, lastName, toCell, escHtml, cache, Mutex };
