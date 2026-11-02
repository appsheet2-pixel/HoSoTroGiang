/**
 * npm run setup
 *  - Tạo các sheet WA_* nếu chưa có, thêm ADMIN_EMAIL vào WA_PhanQuyen
 *  - Kiểm tra quyền truy cập Google Sheet, thư mục Drive, cột dữ liệu, SMTP
 */
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';
require('dotenv').config({ quiet: true });
const { CONFIG, FIELDS, WA_HEADERS } = require('../src/config');
const g = require('../src/google');
const S = require('../src/store');
const { transport } = require('../src/mail');

const ok = m => console.log('  ✓ ' + m);
const bad = m => { console.log('  ✗ ' + m); process.exitCode = 1; };

(async () => {
  console.log('Service account: ' + g.serviceEmail());
  console.log('\n1) Google Sheet');
  let meta;
  try { meta = await S.getMeta(true); ok('Mở được file (' + Object.keys(meta).length + ' sheet)'); }
  catch (e) { bad('Không mở được Google Sheet: ' + e.message + '\n    → Chia sẻ file Sheet cho email service account ở trên với quyền Người chỉnh sửa.'); return; }

  const defs = [[CONFIG.SHEET_HOSO, WA_HEADERS.HOSO], [CONFIG.SHEET_YC, WA_HEADERS.YC], [CONFIG.SHEET_QUYEN, WA_HEADERS.QUYEN], [CONFIG.SHEET_LOG, WA_HEADERS.LOG]];
  const add = defs.filter(d => !meta[d[0]]);
  if (add.length) {
    await g.sheets().spreadsheets.batchUpdate({ spreadsheetId: CONFIG.SPREADSHEET_ID, requestBody: { requests: add.map(d => ({ addSheet: { properties: { title: d[0], gridProperties: { frozenRowCount: 1 } } } })) } });
    await g.sheets().spreadsheets.values.batchUpdate({ spreadsheetId: CONFIG.SPREADSHEET_ID, requestBody: { valueInputOption: 'RAW', data: add.map(d => ({ range: S.q(d[0]) + '!A1', values: [d[1]] })) } });
    add.forEach(d => ok('Đã tạo sheet ' + d[0]));
  } else ok('Các sheet WA_* đã có');
  await S.getMeta(true);

  await S.runRequest(async () => {
    await S.preload([CONFIG.SHEET_NV, CONFIG.SHEET_CN, CONFIG.SHEET_QUYEN], { fresh: true });
    const admin = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const q = S.table_(CONFIG.SHEET_QUYEN);
    if (admin && !S.find_(q, 'Email', admin)) {
      S.upsertWa_(CONFIG.SHEET_QUYEN, 'Email', admin, { Email: admin, HoTen: 'Quản trị viên', VaiTro: 'ADMIN', PhamVi: '', NhanThongBao: true, KichHoat: true });
      await S.flush();
      ok('Đã thêm ' + admin + ' làm ADMIN trong ' + CONFIG.SHEET_QUYEN);
    } else if (!admin) bad('Chưa đặt ADMIN_EMAIL');
    else ok(admin + ' đã có trong ' + CONFIG.SHEET_QUYEN);

    const needNV = ['MaNhanVien', 'HoVaTen', 'Ten', 'TrangThaiLamViec', 'EmailCaNhan', 'SoDienThoai', CONFIG.SCOPE_COLUMN, 'NgayTao', 'NguoiTao', 'NgayCapNhat', 'NguoiCapNhat'];
    const needCN = ['MaNhanVien', 'HoVaTen', 'Ten', 'TrangThaiLV', 'BU1', 'BU2', 'TrangThai', 'NgayTao', 'NguoiTao', 'NgayCapNhat', 'NguoiCapNhat']
      .concat(FIELDS.map(f => f.key)).concat(FIELDS.filter(f => f.recv).map(f => f.recv));
    [[CONFIG.SHEET_NV, needNV], [CONFIG.SHEET_CN, needCN]].forEach(([n, need]) => {
      let t;
      try { t = S.table_(n); } catch (e) { bad(e.message); return; }
      const miss = need.filter(h => t.idx[h] === undefined);
      (miss.length ? bad : ok)(n + ': ' + (miss.length ? 'THIẾU cột ' + miss.join(', ') : 'đủ cột') + ' (' + t.rows.length + ' dòng)');
    });
  });

  console.log('\n2) Thư mục Google Drive');
  if (!CONFIG.UPLOAD_FOLDER_ID) bad('Chưa đặt UPLOAD_FOLDER_ID');
  else {
    try {
      const f = await g.drive().files.get({ fileId: CONFIG.UPLOAD_FOLDER_ID, fields: 'id,name,driveId,capabilities(canAddChildren)', supportsAllDrives: true });
      if (!f.data.capabilities.canAddChildren) bad('Service account không có quyền thêm file vào thư mục "' + f.data.name + '"');
      else ok('Thư mục "' + f.data.name + '"' + (f.data.driveId ? ' (Bộ nhớ dùng chung)' : ''));
      if (!f.data.driveId && !process.env.GOOGLE_IMPERSONATE) bad('Thư mục KHÔNG nằm trong Bộ nhớ dùng chung (Shared drive). Service account không có dung lượng riêng nên sẽ không tải file lên được.\n    → Tạo thư mục trong một Shared drive và thêm service account làm "Người quản lý nội dung".');
    } catch (e) { bad('Không truy cập được thư mục: ' + e.message); }
  }

  console.log('\n3) Email (SMTP)');
  if (process.env.MAIL_MODE === 'console') ok('MAIL_MODE=console – email chỉ in ra log (chế độ thử)');
  else {
    try { await transport().verify(); ok('Kết nối SMTP thành công (' + (process.env.SMTP_HOST || 'smtp.gmail.com') + ')'); }
    catch (e) { bad('Không kết nối được SMTP: ' + e.message); }
  }
  console.log(process.exitCode ? '\nCòn lỗi cần xử lý ở trên.' : '\nHoàn tất! Chạy: npm start');
})().catch(e => { console.error(e); process.exit(1); });
