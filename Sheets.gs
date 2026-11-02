/**
 * Tiện ích đọc/ghi Google Sheet theo TÊN CỘT (không phụ thuộc thứ tự cột),
 * chỉ ghi đúng những ô cần ghi và bỏ qua ô đang chứa công thức,
 * để không làm hỏng cấu trúc mà AppSheet đang dùng.
 */
let _ss = null;
let _tables = {};

function ss_() {
  if (_ss) return _ss;
  _ss = CONFIG.SPREADSHEET_ID ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID) : SpreadsheetApp.getActive();
  if (!_ss) throw new Error('Không mở được Google Sheet. Hãy điền CONFIG.SPREADSHEET_ID.');
  return _ss;
}

function table_(name, fresh) {
  if (!fresh && _tables[name]) return _tables[name];
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Không tìm thấy sheet "' + name + '". Hãy chạy hàm setup().');
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const values = (lastRow && lastCol) ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const idx = {};
  headers.forEach(function (h, i) { if (h && idx[h] === undefined) idx[h] = i; });
  const t = { name: name, sh: sh, headers: headers, idx: idx, rows: values.slice(1) };
  _tables[name] = t;
  return t;
}

function invalidate_(name) { delete _tables[name]; }

function rec_(t, row) {
  const o = {};
  t.headers.forEach(function (h, i) { if (h && !(h in o)) o[h] = row[i]; });
  return o;
}

function norm_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

/** Tìm dòng (ưu tiên dòng cuối cùng nếu trùng). Trả về {i, rowNum, rec} hoặc null */
function find_(t, col, val) {
  const c = t.idx[col];
  if (c === undefined) throw new Error('Sheet ' + t.name + ' thiếu cột ' + col);
  const v = norm_(val);
  if (!v) return null;
  for (let i = t.rows.length - 1; i >= 0; i--) {
    if (norm_(t.rows[i][c]) === v) return { i: i, rowNum: i + 2, rec: rec_(t, t.rows[i]) };
  }
  return null;
}

function findAll_(t, col, val) {
  const c = t.idx[col];
  const v = norm_(val);
  const out = [];
  if (c === undefined || !v) return out;
  t.rows.forEach(function (r, i) { if (norm_(r[c]) === v) out.push({ i: i, rowNum: i + 2, rec: rec_(t, r) }); });
  return out;
}

/** Chuyển giá trị JS sang giá trị ô, chống mất số 0 đầu và chống chèn công thức */
function toCell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date || typeof v === 'boolean' || typeof v === 'number') return v;
  let s = String(v);
  if (/^[=+\-@]/.test(s)) return "'" + s;                    // chống chèn công thức
  if (/^\d+$/.test(s) && (s.charAt(0) === '0' || s.length >= 8)) return "'" + s; // giữ số 0 đầu, số dài
  return s;
}

/** Ghi các cột trong values (object {TenCot: giaTri}) vào dòng rowNum */
function writeRow_(t, rowNum, values) {
  const ncol = t.headers.length;
  const formulas = t.sh.getRange(rowNum, 1, 1, ncol).getFormulas()[0];
  const cells = [];
  Object.keys(values).forEach(function (k) {
    const c = t.idx[k];
    if (c === undefined || formulas[c]) return;
    cells.push({ c: c, v: toCell_(values[k]) });
  });
  cells.sort(function (a, b) { return a.c - b.c; });
  let i = 0;
  while (i < cells.length) {
    let j = i;
    while (j + 1 < cells.length && cells[j + 1].c === cells[j].c + 1) j++;
    const seg = cells.slice(i, j + 1);
    t.sh.getRange(rowNum, seg[0].c + 1, 1, seg.length).setValues([seg.map(function (s) { return s.v; })]);
    i = j + 1;
  }
  // cập nhật bộ nhớ đệm
  const r = t.rows[rowNum - 2];
  if (r) cells.forEach(function (s) {
    r[s.c] = (typeof s.v === 'string' && s.v.charAt(0) === "'") ? s.v.slice(1) : s.v;
  });
}

/** Thêm dòng mới ngay sau dòng cuối có dữ liệu ở cột khóa (an toàn với ARRAYFORMULA / dòng trống AppSheet) */
function appendRow_(t, keyCol, values) {
  const c = t.idx[keyCol];
  let last = -1;
  for (let i = t.rows.length - 1; i >= 0; i--) {
    if (String(t.rows[i][c]).trim() !== '') { last = i; break; }
  }
  const rowNum = last + 3;
  if (rowNum > t.sh.getMaxRows()) t.sh.insertRowsAfter(t.sh.getMaxRows(), 1);
  writeRow_(t, rowNum, values);
  invalidate_(t.name);
  return rowNum;
}

/** Ghi vào sheet WA_* (do app quản lý) */
function upsertWa_(sheetName, keyCol, key, values) {
  const t = table_(sheetName);
  const f = find_(t, keyCol, key);
  if (f) { writeRow_(t, f.rowNum, values); return f.rowNum; }
  const row = t.headers.map(function (h) { return toCell_(values[h] !== undefined ? values[h] : ''); });
  t.sh.appendRow(row);
  invalidate_(sheetName);
  return null;
}

function log_(maNV, action, actor, detail) {
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEET_LOG);
    if (sh) sh.appendRow([new Date(), maNV || '', action, actor || '', toCell_(detail || '')]);
  } catch (e) { console.error('log_', e); }
}

/* ---------------- Ngày tháng ---------------- */
function fmtDate_(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd'); }

/** Đưa giá trị ngày (Date | 'yyyy-MM-dd' | 'dd/MM/yyyy') về chuỗi 'yyyy-MM-dd' */
function dateStr_(v) {
  if (!v) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : fmtDate_(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  return '';
}
function pad2_(x) { x = String(x); return x.length < 2 ? '0' + x : x; }

/** 'yyyy-MM-dd' -> Date (giờ địa phương) */
function toDate_(s) {
  s = dateStr_(s);
  if (!s) return null;
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function age_(d) {
  if (!(d instanceof Date)) return '';
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return a;
}

/** Tên = từ cuối của họ tên */
function lastName_(full) {
  const p = String(full || '').trim().split(/\s+/);
  return p[p.length - 1] || '';
}
