/** Kiểm thử giao diện trên Chromium với máy chủ thật + Google API giả lập: node test/ui.js */
process.env.TZ = 'Asia/Ho_Chi_Minh';
Object.assign(process.env, { SPREADSHEET_ID: 'SHEET', SESSION_SECRET: 'x'.repeat(40), UPLOAD_FOLDER_ID: 'ROOT', GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"sa@x","private_key":"x"}' });
const { chromium } = require('playwright');
const { createMock } = require('./mockgoogle');
const M = createMock();
require('../src/google')._setClients(M.S, M.D);
const mails = [];
require('../src/mail')._setTransport({ sendMail: async o => { mails.push(o); } });
const { createApp } = require('../server');

const NV_H = ['MaNhanVien', 'HoVaTen', 'Ten', 'TrangThaiLamViec', 'DonVi/ChiNhanh', 'ChucDanhHienTai', 'SoDienThoai', 'EmailCaNhan', 'BU1', 'BU2', 'NgayTao', 'NguoiTao', 'NgayCapNhat', 'NguoiCapNhat'];
const { FIELDS, WA_HEADERS } = require('../src/config');
const CN_H = ['MaNhanVien', 'HoVaTen', 'Ten', 'TrangThaiLV', 'Tuoi', 'BU1', 'BU2', 'TrangThai', 'NgayTao', 'NguoiTao', 'NgayCapNhat', 'NguoiCapNhat'].concat(FIELDS.map(f => f.key)).concat(FIELDS.filter(f => f.recv).map(f => f.recv));
M.sheets.ThongTinNhanVien = new M.MockSheet('ThongTinNhanVien', [NV_H, ['TG001', 'Nguyễn Văn An', 'An', 'Đang làm việc', 'CN Quận 1', 'Trợ giảng', '0901234567', 'an@gmail.com']]);
M.sheets.ThongTinCaNhan = new M.MockSheet('ThongTinCaNhan', [CN_H]);
M.sheets.WA_HoSo = new M.MockSheet('WA_HoSo', [WA_HEADERS.HOSO]);
M.sheets.WA_YeuCauSua = new M.MockSheet('WA_YeuCauSua', [WA_HEADERS.YC]);
M.sheets.WA_PhanQuyen = new M.MockSheet('WA_PhanQuyen', [WA_HEADERS.QUYEN, ['hr@kdi.edu.vn', 'HR', 'ADMIN', '', true, true]]);
M.sheets.WA_NhatKy = new M.MockSheet('WA_NhatKy', [WA_HEADERS.LOG]);

const code = () => (mails[mails.length - 1].subject.match(/(\d{6})/) || [])[1];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const srv = createApp().listen(8099);
  const b = await chromium.launch();
  const errors = [];
  const page = async (w, h) => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', e => errors.push(e.message));
    await p.route('https://**', r => r.abort());
    await p.goto('http://localhost:8099/');
    return p;
  };
  const login = async (p, email) => {
    await p.fill('#lgEmail', email); await p.click('#btnOtp');
    await p.waitForSelector('#step2:not(.hidden)');
    await p.fill('#lgCode', code());
    await p.waitForSelector('#userBox:not(.hidden)');
  };
  let fail = 0;
  const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

  const p = await page(390, 844);
  await login(p, 'an@gmail.com');
  await p.waitForSelector('#empForm');
  // Quét QR từ ảnh (thư viện tự host)
  await p.setInputFiles('[data-act="scan-file"]', '/tmp/cccd_qr.png');
  await p.waitForSelector('#qrApply', { timeout: 20000 });
  await p.screenshot({ path: 'test/shot_qr.png' });
  await p.click('#qrApply');
  ok(await p.inputValue('#f_SoCCCD') === '001099012345' && await p.inputValue('#f_NgaySinh') === '1999-01-01' && await p.inputValue('#f_NgayCap') === '2021-08-15', 'quét QR CCCD điền đúng dữ liệu');
  ok((await p.inputValue('#f_NoiCap')).startsWith('Cục Cảnh sát'), 'gợi ý nơi cấp');
  // điền phần còn lại
  const fill = { f_TrinhDoHocVanCaoNhat: 'Đại học', f_MoiQuanHeVoiBanThan: 'Mẹ' };
  for (const [id, v] of Object.entries(fill)) await p.selectOption('#' + id, v);
  await p.fill('#f_DiaChiTamTru', 'KTX khu B');
  await p.fill('#f_TenNganHang', 'ACB'); await p.fill('#f_SoTaiKhoanNganHang', '123456789');
  await p.fill('#f_TenNguoiLienHeKhanCap', 'Trần Thị Mẹ'); await p.fill('#f_SdtLienHeKhanCap', '0911222333');
  for (const k of ['HinhCCCD', 'HinhAnhCaNhan']) {
    await p.setInputFiles(`[data-upload="${k}"] >> nth=0`, { name: k + '.png', mimeType: 'image/png', buffer: png });
    await p.waitForSelector(`[data-field="${k}"] .fi:has-text("✓")`);
  }
  for (const k of ['CV', 'CMNDCCCD']) {
    await p.setInputFiles(`[data-upload="${k}"]`, { name: k + '.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await p.waitForSelector(`[data-field="${k}"] .fi:has-text("✓")`);
  }
  ok(await p.textContent('#progTxt') === 'Đã hoàn thành 18/18 mục bắt buộc', 'thanh tiến độ: ' + await p.textContent('#progTxt'));
  const thumb = await p.getAttribute('[data-field="HinhCCCD"] .thumb img', 'src');
  ok(thumb && thumb.startsWith('data:image'), 'xem trước ảnh');
  await p.click('#bSubmit');
  await p.click('#askOk');
  await p.waitForSelector('.badge.b-CHO_DUYET');
  await p.screenshot({ path: 'test/shot_submitted.png' });
  ok(true, 'nộp hồ sơ qua giao diện');
  // NV mở link file của mình qua máy chủ
  const href = await p.getAttribute('[data-field="CV"] a', 'href');
  const resp = await p.request.get('http://localhost:8099/' + href);
  ok(resp.status() === 200 && (await resp.text()).startsWith('%PDF'), 'xem file qua máy chủ');
  const resp2 = await p.request.get('http://localhost:8099/' + href.replace(/t=[^&]+/, 't=bad'));
  ok(resp2.status() === 401, 'chặn xem file khi không có token hợp lệ');

  const h = await page(1280, 900);
  await login(h, 'hr@kdi.edu.vn');
  await h.waitForSelector('.item[data-ma="TG001"]');
  await h.click('.item[data-ma="TG001"]');
  await h.waitForSelector('#hrForm');
  await h.check('[data-recv="NhanCV"]');
  await h.screenshot({ path: 'test/shot_hr_review.png' });
  await h.click('#bApprove'); await h.click('#askOk');
  await h.waitForSelector('.empty');
  const cn = M.sheets.ThongTinCaNhan.objects()[0];
  ok(cn && cn.SoCCCD === '001099012345' && cn.NhanCV === true && cn.HoVaTen === 'Nguyễn Văn An', 'HR duyệt qua giao diện → ghi ThongTinCaNhan');
  await h.click('[data-tab="add"]');
  await h.fill('#nv_MaNhanVien', 'TG050'); await h.fill('#nv_HoVaTen', 'Đỗ Minh Khoa'); await h.fill('#nv_EmailCaNhan', 'khoa@gmail.com');
  await h.click('#nvSave'); await h.waitForSelector('#askOk');
  ok(M.sheets.ThongTinNhanVien.objects().some(x => x.MaNhanVien === 'TG050'), 'thêm nhân viên qua giao diện');
  ok(errors.length === 0, 'không có lỗi JavaScript ' + errors.join('; '));
  await b.close(); srv.close();
  console.log(fail ? fail + ' lỗi' : 'Tất cả đạt');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
