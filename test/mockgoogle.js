/** Giả lập Google Sheets API v4 + Drive API v3 (đủ cho kiểm thử) */
const crypto = require('crypto');
const { Readable } = require('stream');

function colNum(a) { let n = 0; for (const ch of a) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function toSerial(d) { return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - Date.UTC(1899, 11, 30)) / 86400000; }

class MockSheet {
  constructor(title, rows, rowCount) { this.title = title; this.data = rows.map(r => r.slice()); this.formulas = {}; this.rowCount = rowCount || Math.max(rows.length + 20, 1000); this.id = Math.floor(Math.random() * 1e9); }
  set(r, c, v) { // r,c 0-based
    if (r >= this.rowCount) throw new Error(`Range exceeds grid limits: ${this.title} row ${r + 1} > ${this.rowCount}`);
    while (this.data.length <= r) this.data.push([]);
    this.data[r][c] = v;
  }
  userEntered(r, c, v) {
    if (typeof v === 'string') {
      if (v.startsWith("'")) v = v.slice(1);
      else if (v.startsWith('=')) { this.formulas[r + ',' + c] = v; v = 0; }
      else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
      else if (/^(TRUE|FALSE)$/i.test(v)) v = /TRUE/i.test(v);
      else { const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/); if (m) v = new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)); }
    }
    this.set(r, c, v);
  }
  render(opt) {
    const rows = this.data.map((row, r) => {
      const out = [];
      for (let c = 0; c < row.length; c++) {
        let v = row[c];
        if (opt.valueRenderOption === 'FORMULA' && this.formulas[r + ',' + c]) v = this.formulas[r + ',' + c];
        if (v instanceof Date) v = toSerial(v);
        out.push(v === undefined || v === null ? '' : v);
      }
      while (out.length && out[out.length - 1] === '') out.pop();
      return out;
    });
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    return rows;
  }
  objects() { const h = this.data[0]; return this.data.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? '' : r[i]]))); }
}

function createMock() {
  const sheets = {};
  const calls = { read: 0, write: 0 };
  const name = r => { const m = String(r).match(/^'((?:[^']|'')*)'/); return m[1].replace(/''/g, "'"); };
  const S = {
    spreadsheets: {
      get: async () => ({ data: { sheets: Object.values(sheets).map(s => ({ properties: { sheetId: s.id, title: s.title, gridProperties: { rowCount: s.rowCount } } })) } }),
      batchUpdate: async ({ requestBody }) => {
        calls.write++;
        requestBody.requests.forEach(q => {
          if (q.addSheet) sheets[q.addSheet.properties.title] = new MockSheet(q.addSheet.properties.title, [], 1000);
          if (q.appendDimension) { const s = Object.values(sheets).find(x => x.id === q.appendDimension.sheetId); s.rowCount += q.appendDimension.length; }
        });
        return { data: {} };
      },
      values: {
        batchGet: async ({ ranges, valueRenderOption }) => { calls.read++; return { data: { valueRanges: ranges.map(r => ({ range: r, values: sheets[name(r)].render({ valueRenderOption }) })) } }; },
        batchUpdate: async ({ requestBody }) => {
          calls.write++;
          requestBody.data.forEach(d => {
            const s = sheets[name(d.range)];
            const m = d.range.match(/!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
            const r0 = +m[2] - 1, c0 = colNum(m[1]);
            d.values.forEach((row, i) => row.forEach((v, j) => requestBody.valueInputOption === 'RAW' ? s.set(r0 + i, c0 + j, v) : s.userEntered(r0 + i, c0 + j, v)));
          });
          return { data: {} };
        },
        append: async ({ range, requestBody }) => {
          calls.write++;
          const s = sheets[name(range)];
          requestBody.values.forEach(row => { const r = s.render({}).length; if (r >= s.rowCount) s.rowCount++; row.forEach((v, j) => s.userEntered(r, j, v)); });
          return { data: {} };
        },
      },
    },
  };
  const files = {};
  const D = {
    files: {
      list: async ({ q }) => {
        const parent = q.match(/'([^']+)' in parents/)[1]; const nm = q.match(/name = '([^']+)'/)[1];
        return { data: { files: Object.values(files).filter(f => f.parents[0] === parent && f.name === nm && f.mimeType === 'application/vnd.google-apps.folder') } };
      },
      create: async ({ requestBody, media }) => {
        const id = 'id' + crypto.randomBytes(8).toString('hex');
        const chunks = [];
        if (media) for await (const c of media.body) chunks.push(c);
        files[id] = Object.assign({ id, mimeType: media ? media.mimeType : requestBody.mimeType, content: Buffer.concat(chunks) }, requestBody);
        return { data: { id, name: requestBody.name, webViewLink: 'https://drive.google.com/file/d/' + id + '/view' } };
      },
      get: async ({ fileId, alt }) => {
        const f = files[fileId];
        if (!f && fileId !== 'ROOT') throw new Error('File not found');
        if (fileId === 'ROOT') return { data: { id: 'ROOT', name: 'Root', driveId: 'D1', capabilities: { canAddChildren: true } } };
        if (alt === 'media') return { data: Readable.from(f.content) };
        return { data: { id: f.id, name: f.name, mimeType: f.mimeType, appProperties: f.appProperties } };
      },
    },
  };
  return { S, D, sheets, files, calls, MockSheet };
}

module.exports = { createMock };
