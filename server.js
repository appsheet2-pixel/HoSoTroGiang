/**
 * Cổng hồ sơ nhân sự – máy chủ web
 *   npm start           chạy máy chủ (cổng PORT, mặc định 8080)
 *   npm run setup       tạo các sheet WA_* và kiểm tra cấu hình
 */
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { CONFIG } = require('./src/config');
const { Mutex } = require('./src/util');
const S = require('./src/store');
const L = require('./src/logic');
const F = require('./src/files');

const ROUTES = {
  requestOtp: { role: null, fn: L.api_requestOtp },
  verifyOtp: { role: null, fn: L.api_verifyOtp },
  me: { role: 'ANY', fn: L.api_me },
  logout: { role: 'ANY', fn: L.api_logout },

  getMyProfile: { role: 'NV', fn: L.api_getMyProfile },
  saveDraft: { role: 'NV', fn: L.api_saveDraft, write: true },
  submit: { role: 'NV', fn: L.api_submit, write: true },
  withdraw: { role: 'NV', fn: L.api_withdraw, write: true },
  requestEdit: { role: 'NV', fn: L.api_requestEdit, write: true },
  uploadFile: { role: 'NV', fn: F.api_uploadFile },

  hrMeta: { role: 'HR', fn: L.api_hrMeta },
  hrList: { role: 'HR', fn: L.api_hrList },
  hrGetProfile: { role: 'HR', fn: L.api_hrGetProfile, extra: [CONFIG.SHEET_LOG] },
  hrSave: { role: 'HR', fn: L.api_hrSave, write: true },
  hrReject: { role: 'HR', fn: L.api_hrReject, write: true },
  hrUnlock: { role: 'HR', fn: L.api_hrUnlock, write: true },
  hrEditRequests: { role: 'HR', fn: L.api_hrEditRequests },
  hrResolveRequest: { role: 'HR', fn: L.api_hrResolveRequest, write: true },
  hrAddEmployee: { role: 'HR', fn: L.api_hrAddEmployee, write: true },
  hrSendInvite: { role: 'HR', fn: L.api_hrSendInvite },
  hrUploadFile: { role: 'HR', fn: F.api_hrUploadFile },
};
const BASE_SHEETS = [CONFIG.SHEET_NV, CONFIG.SHEET_CN, CONFIG.SHEET_HOSO, CONFIG.SHEET_YC, CONFIG.SHEET_QUYEN];
const writeLock = new Mutex();

/** Chạy một thao tác API: nạp sheet -> kiểm tra phiên -> xử lý -> ghi dữ liệu -> gửi email */
async function execute(action, token, payload) {
  const r = ROUTES[action];
  if (!r) throw new Error('Thao tác không hợp lệ: ' + action);
  const job = () => S.runRequest(async () => {
    await S.preload(BASE_SHEETS.concat(r.extra || []), r.write ? { fresh: true, formulas: [CONFIG.SHEET_NV, CONFIG.SHEET_CN] } : {});
    const ctx = r.role ? L.requireSession_(token, r.role) : null;
    const data = await r.fn(payload || {}, ctx);
    await S.flush();
    return data;
  });
  return r.write ? writeLock.run(job) : job();
}

function bearer(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.query.t || ''); }

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' });
    next();
  });
  app.use('/api', express.json({ limit: Math.ceil(CONFIG.MAX_FILE_MB * 1.4 + 2) + 'mb' }));
  const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.' } });
  app.use(['/api/requestOtp', '/api/verifyOtp'], otpLimiter);

  app.get('/healthz', (req, res) => res.send('ok'));

  app.post('/api/:action', async (req, res) => {
    try {
      const data = await execute(req.params.action, bearer(req), req.body);
      res.json({ ok: true, data: data === undefined ? null : data });
    } catch (e) {
      if (!e.code) console.error(req.params.action, e && e.stack || e);
      res.json({ ok: false, error: String(e && e.message || e), code: e && e.code || '' });
    }
  });

  // Xem file đã tải lên (ảnh/PDF) – kiểm tra quyền trên máy chủ
  app.get('/api/file/:id', async (req, res) => {
    try {
      const f = await S.runRequest(async () => {
        await S.preload([CONFIG.SHEET_NV, CONFIG.SHEET_QUYEN]);
        const ctx = L.requireSession_(bearer(req), 'ANY');
        return F.openFile(req.params.id, ctx);
      });
      res.set('Content-Type', f.mimeType || 'application/octet-stream');
      res.set('Content-Disposition', 'inline; filename*=UTF-8\'\'' + encodeURIComponent(f.name || 'file'));
      res.set('Cache-Control', 'private, max-age=300');
      f.stream.on('error', () => res.end()).pipe(res);
    } catch (e) {
      res.status(e.code === 'AUTH' ? 401 : 403).send(String(e.message || e));
    }
  });

  app.get('/vendor/html5-qrcode.min.js', (req, res) => res.sendFile(require.resolve('html5-qrcode/html5-qrcode.min.js')));
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));
  return app;
}

if (require.main === module) {
  const miss = ['SPREADSHEET_ID', 'SESSION_SECRET', 'GOOGLE_SERVICE_ACCOUNT_JSON'].filter(k => !process.env[k]);
  if (miss.length) { console.error('Thiếu biến môi trường: ' + miss.join(', ') + '. Xem file .env.example'); process.exit(1); }
  if (String(process.env.SESSION_SECRET).length < 32) { console.error('SESSION_SECRET phải dài ít nhất 32 ký tự.'); process.exit(1); }
  const port = Number(process.env.PORT || 8080);
  createApp().listen(port, () => console.log(`${CONFIG.APP_NAME} đang chạy tại http://localhost:${port}`));
}

module.exports = { createApp, execute, ROUTES };
