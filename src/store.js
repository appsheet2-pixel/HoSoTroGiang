/**
 * Lớp đọc/ghi Google Sheets theo TÊN CỘT.
 * - Mỗi request: nạp các sheet cần thiết bằng 1 lệnh batchGet (có cache ngắn cho thao tác chỉ đọc)
 * - Mọi lệnh ghi được gom lại và gửi 1 lần bằng batchUpdate khi request kết thúc
 * - Bỏ qua ô đang chứa công thức, giữ số 0 đầu, chống chèn công thức
 */
const { AsyncLocalStorage } = require('async_hooks');
const { CONFIG, DATE_COLS } = require('./config');
const { norm, toCell, serialToDate } = require('./util');
const g = require('./google');

const als = new AsyncLocalStorage();
const raw = {};      // cache giá trị thô: name -> { at, values }
let meta = null;     // name -> { sheetId, rowCount }

const q = n => "'" + String(n).replace(/'/g, "''") + "'";
function colA(c) { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

function runRequest(fn) { return als.run({ tables: {}, writes: [], need: {}, logs: [], mails: [] }, fn); }
function st() { const s = als.getStore(); if (!s) throw new Error('Thiếu ngữ cảnh request'); return s; }

async function getMeta(force) {
  if (meta && !force) return meta;
  const r = await g.sheets().spreadsheets.get({ spreadsheetId: CONFIG.SPREADSHEET_ID, fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))' });
  meta = {};
  r.data.sheets.forEach(s => { meta[s.properties.title] = { sheetId: s.properties.sheetId, rowCount: s.properties.gridProperties.rowCount }; });
  return meta;
}

function build(name, values, formulas) {
  const headers = (values[0] || []).map(h => String(h == null ? '' : h).trim());
  const idx = {};
  headers.forEach((h, i) => { if (h && idx[h] === undefined) idx[h] = i; });
  const rows = values.slice(1).map(r => headers.map((h, i) => {
    let v = r[i];
    if (v === undefined || v === null) v = '';
    if (DATE_COLS.has(h) && typeof v === 'number') v = serialToDate(v);
    return v;
  }));
  return { name, headers, idx, rows, formulas: formulas || null };
}

/** Nạp các sheet vào request hiện tại. opts.fresh: bỏ qua cache; opts.formulas: danh sách sheet cần biết ô công thức */
async function preload(names, opts) {
  opts = opts || {};
  const s = st();
  const now = Date.now();
  const m = await getMeta();
  const need = names.filter(n => !s.tables[n] && m[n]);
  const fetch = need.filter(n => opts.fresh || !raw[n] || now - raw[n].at > CONFIG.CACHE_SECONDS * 1000);
  if (fetch.length) {
    const r = await g.sheets().spreadsheets.values.batchGet({
      spreadsheetId: CONFIG.SPREADSHEET_ID, ranges: fetch.map(q),
      valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER',
    });
    r.data.valueRanges.forEach((vr, i) => { raw[fetch[i]] = { at: now, values: vr.values || [] }; });
  }
  const formulas = {};
  const fl = (opts.formulas || []).filter(n => need.indexOf(n) >= 0);
  if (fl.length) {
    const r = await g.sheets().spreadsheets.values.batchGet({ spreadsheetId: CONFIG.SPREADSHEET_ID, ranges: fl.map(q), valueRenderOption: 'FORMULA' });
    r.data.valueRanges.forEach((vr, i) => { formulas[fl[i]] = vr.values || []; });
  }
  need.forEach(n => { s.tables[n] = build(n, raw[n].values, formulas[n]); });
}

function table_(name) {
  const t = st().tables[name];
  if (!t) throw new Error('Không tìm thấy sheet "' + name + '". Hãy chạy: npm run setup');
  return t;
}
function hasTable_(name) { return !!st().tables[name]; }
function invalidate_(name) { delete raw[name]; }

function rec_(t, row) {
  const o = {};
  t.headers.forEach((h, i) => { if (h && !(h in o)) o[h] = row[i]; });
  return o;
}

function find_(t, col, val) {
  const c = t.idx[col];
  if (c === undefined) throw new Error('Sheet ' + t.name + ' thiếu cột ' + col);
  const v = norm(val);
  if (!v) return null;
  for (let i = t.rows.length - 1; i >= 0; i--) {
    if (norm(t.rows[i][c]) === v) return { i, rowNum: i + 2, rec: rec_(t, t.rows[i]) };
  }
  return null;
}

function findAll_(t, col, val) {
  const c = t.idx[col];
  const v = norm(val);
  const out = [];
  if (c === undefined || !v) return out;
  t.rows.forEach((r, i) => { if (norm(r[c]) === v) out.push({ i, rowNum: i + 2, rec: rec_(t, r) }); });
  return out;
}

function isFormula(t, rowNum, c) {
  if (!t.formulas) return false;
  const r = t.formulas[rowNum - 1];
  const f = r ? r[c] : '';
  return typeof f === 'string' && f.charAt(0) === '=';
}

function writeRow_(t, rowNum, values) {
  const s = st();
  while (t.rows.length < rowNum - 1) t.rows.push(t.headers.map(() => ''));
  const row = t.rows[rowNum - 2];
  Object.keys(values).forEach(k => {
    const c = t.idx[k];
    if (c === undefined || isFormula(t, rowNum, c)) return;
    let v = values[k];
    if (v === undefined || v === null) v = '';
    s.writes.push({ sheet: t.name, row: rowNum, col: c, v: toCell(v) });
    row[c] = v;
  });
}

/** Thêm dòng ngay sau dòng cuối có dữ liệu ở cột khóa */
function appendRow_(t, keyCol, values) {
  const c = t.idx[keyCol];
  if (c === undefined) throw new Error('Sheet ' + t.name + ' thiếu cột ' + keyCol);
  let last = -1;
  for (let i = t.rows.length - 1; i >= 0; i--) {
    if (String(t.rows[i][c]).trim() !== '') { last = i; break; }
  }
  const rowNum = last + 3;
  const s = st();
  s.need[t.name] = Math.max(s.need[t.name] || 0, rowNum);
  writeRow_(t, rowNum, values);
  return rowNum;
}

function upsertWa_(sheetName, keyCol, key, values) {
  const t = table_(sheetName);
  const f = find_(t, keyCol, key);
  if (f) { writeRow_(t, f.rowNum, values); return f.rowNum; }
  const full = {};
  t.headers.forEach(h => { if (h) full[h] = values[h] !== undefined ? values[h] : ''; });
  return appendRow_(t, keyCol, full);
}

function log_(maNV, action, actor, detail) {
  st().logs.push([new Date(), maNV || '', action, actor || '', detail || '']);
}

/** Xếp hàng email, gửi sau khi ghi dữ liệu xong. critical=true: lỗi gửi sẽ báo về client */
function queueMail(fn, critical) { st().mails.push({ fn, critical: !!critical }); }

async function flush() {
  const s = st();
  const touched = new Set();
  if (s.writes.length) {
    const m = await getMeta();
    const reqs = [];
    Object.keys(s.need).forEach(name => {
      const mm = m[name];
      if (mm && s.need[name] > mm.rowCount) reqs.push({ appendDimension: { sheetId: mm.sheetId, dimension: 'ROWS', length: s.need[name] - mm.rowCount + 100 } });
    });
    if (reqs.length) {
      await g.sheets().spreadsheets.batchUpdate({ spreadsheetId: CONFIG.SPREADSHEET_ID, requestBody: { requests: reqs } });
      meta = null;
    }
    const byRow = new Map();
    s.writes.forEach(w => {
      const k = w.sheet + '\u0001' + w.row;
      if (!byRow.has(k)) byRow.set(k, { sheet: w.sheet, row: w.row, cells: new Map() });
      byRow.get(k).cells.set(w.col, w.v);
      touched.add(w.sheet);
    });
    const data = [];
    byRow.forEach(r => {
      const cols = Array.from(r.cells.keys()).sort((a, b) => a - b);
      let i = 0;
      while (i < cols.length) {
        let j = i;
        while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1) j++;
        const seg = cols.slice(i, j + 1);
        data.push({ range: `${q(r.sheet)}!${colA(seg[0])}${r.row}:${colA(seg[seg.length - 1])}${r.row}`, values: [seg.map(c => r.cells.get(c))] });
        i = j + 1;
      }
    });
    await g.sheets().spreadsheets.values.batchUpdate({ spreadsheetId: CONFIG.SPREADSHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data } });
    s.writes = []; s.need = {};
  }
  if (s.logs.length) {
    try {
      await g.sheets().spreadsheets.values.append({
        spreadsheetId: CONFIG.SPREADSHEET_ID, range: q(CONFIG.SHEET_LOG) + '!A1', valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
        requestBody: { values: s.logs.map(r => r.map(toCell)) },
      });
      touched.add(CONFIG.SHEET_LOG);
    } catch (e) { console.error('log', e.message); }
    s.logs = [];
  }
  touched.forEach(invalidate_);
  const mails = s.mails; s.mails = [];
  for (const m of mails) {
    try { await m.fn(); } catch (e) {
      console.error('mail', e.message);
      if (m.critical) throw new Error('Không gửi được email. Vui lòng thử lại sau hoặc liên hệ phòng Nhân sự.');
    }
  }
}

module.exports = { runRequest, preload, table_, hasTable_, invalidate_, rec_, find_, findAll_, writeRow_, appendRow_, upsertWa_, log_, queueMail, flush, getMeta, q, colA };
