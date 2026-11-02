/** Kiểm thử toàn bộ luồng nghiệp vụ với Google API giả lập: node test/run.js */
process.env.TZ = 'Asia/Ho_Chi_Minh';
Object.assign(process.env, { SPREADSHEET_ID: 'SHEET', SESSION_SECRET: 'x'.repeat(40), UPLOAD_FOLDER_ID: 'ROOT', ADMIN_EMAIL: 'hr@kdi.edu.vn', GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"sa@test.iam.gserviceaccount.com","private_key":"x"}' });
const { createMock } = require('./mockgoogle');
const M = createMock();
require('../src/google')._setClients(M.S, M.D);
const mails = [];
require('../src/mail')._setTransport({ sendMail: async o => { mails.push(o); }, verify: async () => true });
const { execute } = require('../server');
const store = require('../src/store');

const NV_H = 'MaNhanVien	HoVaTen	Ten	TrangThaiLamViec	NgayVaoLamDauTien	NgayBatDauFulltime	SoNgayLamViec	NgayDungLamViec	HinhThuc/LoaiNhanVien	DonVi/ChiNhanh	DiaDiemLamViec	Khoi	PhongBan	Nhom	ChucDanhHienTai	BacPC	BacPhuCap	Ngach	SoDienThoai	EmailCaNhan	B1	EmailNhanVien	TrangThaiTaiKhoan	ITTaoTaiKhoan	ITCapNhatTaiKhoan	GhiChuNhanSu	B2	AnhDaiDien	NgayDauTienCuaNam	TongSoLanDaKiHd	FileProfileNV	GhiChu	ProFile	FileGioiThieu	HoSoUngVien	CaLamViec	DemEmail	SchoolID	TenTruong	BU1	BU2	BU3	BU4	NgayTao	NguoiTao	NgayCapNhat	NguoiCapNhat'.split('\t');
const CN_H = 'HinhCCCD	TrangThaiLV	MaNhanVien	HoVaTen	Ten	GioiTinh	NgaySinh	Tuoi	NoiSinh	HinhAnhCaNhan	SoCMND	SoCCCD	NgayCap	NoiCap	QuocTich	NguyenQuan	DanToc	DiaChiThuongTru	DiaChiTamTru	SoDienThoai	EmailCaNhan	B1	MaSoThue	SoSoBHXH	NoiDangKyKhamBHYT	TinhTrangHonNhan	ThongTinGiaDinh	TonGiao	TrinhDoHocVanCaoNhat	TenNganHang	ChiNhanhNganHang	SoTaiKhoanNganHang	B2	TenNguoiLienHeKhanCap	SdtLienHeKhanCap	MoiQuanHeVoiBanThan	SoNguoiPhuThuocDangKy	ThongTinNguoiPhuThuoc	BanMemHoSoCanNop	B3	CV	NhanCV	SoYeuLyLich	NhanSoYeuLyLich	CMNDCCCD	NhanCMNDCCCD	HoKhau	NhanHoKhau	GiayKhamSucKhoe	NhanGiayKhamSucKhoe	BangCapCaoNhat	NhanBangCapCaoNhat	HopDongLaoDong	NhanHopDongLaoDong	ThongTinBaoMat	NhanThongTinBaoMat	HopDongLiemChinh	NhanHopDongLiemChinh	CK02TNCN	NhanCK02TNCN	GhiChu	TrangThai	BU1	BU2	NgayTao	NguoiTao	NgayCapNhat	NguoiCapNhat'.split('\t');
const row = (H, o) => H.map(h => o[h] !== undefined ? o[h] : '');
M.sheets.ThongTinNhanVien = new M.MockSheet('ThongTinNhanVien', [NV_H,
  row(NV_H, { MaNhanVien: 'TG001', HoVaTen: 'Nguyễn Văn An', Ten: 'An', TrangThaiLamViec: 'Đang làm việc', 'DonVi/ChiNhanh': 'CN Quận 1', EmailCaNhan: 'An@Gmail.com', SoDienThoai: 901234567, ChucDanhHienTai: 'Trợ giảng', BU1: 'BU-A', BU2: 'BU-B' }),
  row(NV_H, { MaNhanVien: 'TG002', HoVaTen: 'Trần Thị Bình', TrangThaiLamViec: 'Nghỉ việc', 'DonVi/ChiNhanh': 'CN Quận 1', EmailCaNhan: 'binh@gmail.com' }),
  row(NV_H, { MaNhanVien: 'TG003', HoVaTen: 'Lê Văn Cường', TrangThaiLamViec: 'Đang làm việc', 'DonVi/ChiNhanh': 'CN Thủ Đức', EmailCaNhan: 'cuong@yahoo.com', NgayVaoLamDauTien: new Date(2024, 0, 15) }),
], 4);
M.sheets.ThongTinCaNhan = new M.MockSheet('ThongTinCaNhan', [CN_H,
  row(CN_H, { MaNhanVien: 'TG003', HoVaTen: 'Lê Văn Cường', SoCCCD: '079200001111', NgaySinh: new Date(2000, 4, 6), GioiTinh: 'Nam', CV: 'ThongTinCaNhan_Files_/cv_cuong.pdf', NhanCV: true, TenNganHang: 'ACB' }),
], 2);
M.sheets.ThongTinCaNhan.formulas['1,7'] = '=DATEDIF(G2,TODAY(),"Y")';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const call = async (a, t, p) => { try { return { ok: true, data: await execute(a, t, p) }; } catch (e) { return { ok: false, error: e.message, code: e.code }; } };
const must = async (a, t, p) => { const r = await call(a, t, p); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; };
const lastCode = () => (mails[mails.length - 1].subject.match(/(\d{6})/) || [])[1];
const { cache } = require('../src/util');
async function login(email) { cache.remove('OTPW_' + email.toLowerCase()); await must('requestOtp', null, { email }); return (await must('verifyOtp', null, { email, code: lastCode() })).token; }
const b64 = Buffer.from('fake-image-bytes').toString('base64');
const isDate = v => v instanceof Date;

(async () => {
  // setup
  const { execSync } = require('child_process');
  await new Promise((res, rej) => {
    const origLog = console.log; const out = [];
    console.log = (...a) => out.push(a.join(' '));
    require('../scripts/setup.js');
    setTimeout(() => { console.log = origLog; console.log(out.join('\n')); res(); }, 300);
  });
  ok(M.sheets.WA_HoSo && M.sheets.WA_PhanQuyen.objects()[0].Email === 'hr@kdi.edu.vn', 'setup tạo sheet & admin');
  process.exitCode = 0;

  let r = await call('requestOtp', null, { email: 'unknown@gmail.com' });
  ok(!r.ok && /chưa được/.test(r.error), 'email lạ bị từ chối');
  r = await call('requestOtp', null, { email: 'binh@gmail.com' });
  ok(!r.ok && /ngừng hoạt động/.test(r.error), 'NV nghỉ việc bị chặn');
  await must('requestOtp', null, { email: 'an@gmail.com' });
  r = await call('requestOtp', null, { email: 'an@gmail.com' }); ok(!r.ok && /chờ/.test(r.error), 'chống gửi lại liên tục');
  r = await call('verifyOtp', null, { email: 'an@gmail.com', code: '000000' }); ok(!r.ok && /không đúng/.test(r.error), 'OTP sai');
  const tAn = (await must('verifyOtp', null, { email: 'an@gmail.com', code: lastCode() })).token;
  ok(tAn && tAn.split('.').length === 3, 'nhận JWT');
  r = await call('getMyProfile', 'abc.def.ghi', {}); ok(!r.ok && r.code === 'AUTH', 'token giả bị từ chối');
  r = await call('hrList', tAn, {}); ok(!r.ok && /quyền/.test(r.error), 'NV không gọi được API nhân sự');

  let P = await must('getMyProfile', tAn);
  ok(P.status === 'CHUA_BAT_DAU' && P.data.EmailCaNhan === 'An@Gmail.com' && P.data.QuocTich === 'Việt Nam', 'hồ sơ mới');
  const up = k => must('uploadFile', tAn, { field: k, name: k + '.jpg', mime: 'image/jpeg', base64: b64 });
  r = await call('uploadFile', tAn, { field: 'CV', name: 'x.exe', mime: 'application/x-msdownload', base64: b64 }); ok(!r.ok, 'chặn loại file lạ');
  const fCCCD = await up('HinhCCCD'), fAnh = await up('HinhAnhCaNhan'), fCV = await up('CV'), fCM = await up('CMNDCCCD');
  ok(M.files[fCV.id].appProperties.maNV === 'TG001' && M.files[fCV.id].parents[0] !== 'ROOT', 'file lưu đúng thư mục NV, gắn mã NV');
  ok(Object.values(M.files).filter(f => f.mimeType === 'application/vnd.google-apps.folder').length === 1, 'chỉ tạo 1 thư mục cho NV');
  const data = Object.assign({}, P.data, { SoCCCD: '001099012345', NgayCap: '2021-08-15', NoiCap: 'Cục Cảnh sát quản lý hành chính về trật tự xã hội', HinhCCCD: fCCCD,
    GioiTinh: 'Nam', NgaySinh: '1999-01-01', TrinhDoHocVanCaoNhat: 'Đại học', HinhAnhCaNhan: fAnh, DiaChiThuongTru: 'Số 1/2 Lê Lợi, Q1', DiaChiTamTru: '=HYPERLINK("http://evil")',
    TenNganHang: 'Vietcombank', SoTaiKhoanNganHang: '0071000123456', TenNguoiLienHeKhanCap: 'Nguyễn Văn Bố', SdtLienHeKhanCap: '0912 345 678', MoiQuanHeVoiBanThan: 'Bố', CV: fCV, EmailCaNhan: 'hacker@x.com' });
  const d1 = await must('saveDraft', tAn, { data: Object.assign({}, data, { CMNDCCCD: { v: 'https://evil', id: 'notmine12345' } }) });
  ok(d1.status === 'NHAP' && d1.data.EmailCaNhan === 'An@Gmail.com' && d1.data.CMNDCCCD === '', 'chống sửa email & file giả');
  r = await call('submit', tAn, { data }); ok(!r.ok && /CCCD 2 mặt/.test(r.error), 'thiếu file bắt buộc');
  data.CMNDCCCD = fCM;
  r = await call('submit', tAn, { data: Object.assign({}, data, { SoCCCD: '079200001111' }) }); ok(!r.ok && /nhân viên khác/.test(r.error), 'trùng CCCD');
  await must('submit', tAn, { data, note: 'Em nộp ạ' });
  ok((await must('getMyProfile', tAn)).status === 'CHO_DUYET', 'đã nộp');
  ok(mails[mails.length - 1].to.includes('hr@kdi.edu.vn'), 'email báo nhân sự');
  const hs = M.sheets.WA_HoSo.objects()[0];
  ok(typeof hs.DuLieu === 'string' && JSON.parse(hs.DuLieu).SoCCCD === '001099012345' && hs.NgayNop instanceof Date, 'WA_HoSo lưu JSON & ngày');

  const tHr = await login('hr@kdi.edu.vn');
  ok((await must('me', tHr)).user.role === 'ADMIN', 'HR role');
  ok((await must('hrMeta', tHr)).counts.pending === 1, 'đếm chờ duyệt');
  ok((await must('hrList', tHr, { q: 'cuong' })).items[0].maNV === 'TG003', 'tìm không dấu');
  let H = await must('hrGetProfile', tHr, { maNV: 'TG001' });
  ok(H.status === 'CHO_DUYET' && H.logs.some(l => l.a === 'NOP_HO_SO'), 'HR xem hồ sơ + nhật ký');
  await must('hrSave', tHr, { maNV: 'TG001', data: H.data, received: Object.assign({}, H.received, { NhanCV: true, NhanCMNDCCCD: true }), note: 'OK' });
  let cn = M.sheets.ThongTinCaNhan.objects().find(x => x.MaNhanVien === 'TG001');
  ok(cn && cn.SoCCCD === '001099012345' && cn.SoTaiKhoanNganHang === '0071000123456' && cn.SdtLienHeKhanCap === '0912345678', 'giữ số 0 đầu: ' + (cn && cn.SoCCCD));
  ok(isDate(cn.NgaySinh) && cn.NgaySinh.getFullYear() === 1999 && cn.NgaySinh.getDate() === 1, 'ngày sinh dạng ngày');
  ok(cn.DiaChiTamTru === '=HYPERLINK("http://evil")' && cn.DiaChiThuongTru === 'Số 1/2 Lê Lợi, Q1', 'chống chèn công thức');
  ok(cn.NhanCV === true && cn.NhanCMNDCCCD === true && cn.NhanHoKhau === false, 'cột Đã nhận');
  ok(cn.CV === fCV.url && cn.TrangThaiLV === 'Đang làm việc' && cn.BU1 === 'BU-A' && typeof cn.Tuoi === 'number', 'cột hệ thống');
  ok(cn.TrangThai === 'Đã duyệt' && cn.NguoiCapNhat === 'hr@kdi.edu.vn' && isDate(cn.NgayTao), 'metadata');
  ok(M.sheets.ThongTinCaNhan.rowCount > 2, 'tự mở rộng số dòng sheet');
  ok(M.sheets.ThongTinNhanVien.objects()[0].SoDienThoai === 901234567, 'không ghi SĐT khi không đổi');

  P = await must('getMyProfile', tAn); ok(P.status === 'DA_DUYET', 'NV thấy đã duyệt');
  await must('requestEdit', tAn, { reason: 'Đổi STK' });
  r = await call('requestEdit', tAn, { reason: 'lần 2' }); ok(!r.ok, 'không gửi trùng yêu cầu');
  const R = await must('hrEditRequests', tHr, {}); ok(R.length === 1, 'HR thấy yêu cầu');
  await must('hrResolveRequest', tHr, { id: R[0].id, accept: true });
  P = await must('getMyProfile', tAn); ok(P.status === 'MO_CHINH_SUA' && P.data.CV.url === fCV.url, 'mở chỉnh sửa giữ dữ liệu');
  P.data.TenNganHang = 'ACB'; P.data.SoTaiKhoanNganHang = '123456789';
  await must('submit', tAn, { data: P.data });
  H = await must('hrGetProfile', tHr, { maNV: 'TG001' });
  ok(H.current.TenNganHang === 'Vietcombank' && H.data.TenNganHang === 'ACB', 'so sánh cũ/mới');
  await must('hrSave', tHr, { maNV: 'TG001', data: H.data, received: H.received });
  const rows1 = M.sheets.ThongTinCaNhan.objects().filter(x => x.MaNhanVien === 'TG001');
  ok(rows1.length === 1 && rows1[0].TenNganHang === 'ACB' && rows1[0].SoTaiKhoanNganHang === '123456789' && rows1[0].NhanCV === true, 'cập nhật đúng dòng');

  await must('hrUnlock', tHr, { maNV: 'TG001', note: 'Bổ sung' });
  await must('submit', tAn, { data: (await must('getMyProfile', tAn)).data });
  await must('hrReject', tHr, { maNV: 'TG001', note: 'Thiếu giấy khám' });
  P = await must('getMyProfile', tAn); ok(P.status === 'TU_CHOI' && P.ghiChuNS === 'Thiếu giấy khám', 'trả lại');

  const tC = await login('cuong@yahoo.com');
  P = await must('getMyProfile', tC);
  ok(P.status === 'DA_DUYET' && P.data.NgaySinh === '2000-05-06' && P.data.CV.v === 'ThongTinCaNhan_Files_/cv_cuong.pdf' && P.nv.NgayVaoLam === '2024-01-15', 'đọc hồ sơ cũ AppSheet + ngày serial');
  await must('hrUnlock', tHr, { maNV: 'TG003' });
  P = await must('getMyProfile', tC); P.data.NoiCap = 'Bộ Công an'; P.data.NgayCap = '2024-08-01';
  await must('saveDraft', tC, { data: P.data });
  H = await must('hrGetProfile', tHr, { maNV: 'TG003' });
  await must('hrSave', tHr, { maNV: 'TG003', data: H.data, received: H.received });
  cn = M.sheets.ThongTinCaNhan.objects().find(x => x.MaNhanVien === 'TG003');
  ok(M.sheets.ThongTinCaNhan.formulas['1,7'] && cn.Tuoi === '', 'không ghi đè ô công thức');
  ok(cn.CV === 'ThongTinCaNhan_Files_/cv_cuong.pdf' && cn.NhanCV === true && cn.NoiCap === 'Bộ Công an' && isDate(cn.NgayCap), 'giữ file cũ');

  // Xem file
  const F = require('../src/files');
  const S2 = require('../src/store');
  const viewAs = (t, id) => S2.runRequest(async () => { await S2.preload(['ThongTinNhanVien', 'WA_PhanQuyen']); return F.openFile(id, require('../src/logic').requireSession_(t, 'ANY')); });
  ok(!!(await viewAs(tAn, fCV.id)).stream, 'NV xem file của mình');
  ok(!!(await viewAs(tHr, fCV.id)).stream, 'HR xem file');
  let denied = false; try { await viewAs(tC, fCV.id); } catch (e) { denied = true; } ok(denied, 'NV khác không xem được file');

  r = await call('hrAddEmployee', tHr, { data: { MaNhanVien: 'TG001', HoVaTen: 'X', EmailCaNhan: 'x@gmail.com' } }); ok(!r.ok && /tồn tại/.test(r.error), 'trùng mã');
  r = await call('hrAddEmployee', tHr, { data: { MaNhanVien: 'TG009', HoVaTen: 'X', EmailCaNhan: 'an@gmail.com' } }); ok(!r.ok && /đang được dùng/.test(r.error), 'trùng email');
  await must('hrAddEmployee', tHr, { data: { MaNhanVien: '00123', HoVaTen: 'Phạm Thị Dung', EmailCaNhan: 'Dung@Gmail.com', 'DonVi/ChiNhanh': 'CN Thủ Đức', NgayVaoLamDauTien: '2026-11-01', SoDienThoai: '0987 654 321' }, sendInvite: true });
  const nv = M.sheets.ThongTinNhanVien.objects().find(x => x.HoVaTen === 'Phạm Thị Dung');
  ok(nv && nv.MaNhanVien === '00123' && nv.Ten === 'Dung' && nv.EmailCaNhan === 'dung@gmail.com' && nv.SoDienThoai === '0987654321' && isDate(nv.NgayVaoLamDauTien), 'thêm NV');
  ok(M.sheets.ThongTinNhanVien.rowCount > 4, 'mở rộng sheet NV');
  ok((await must('getMyProfile', await login('dung@gmail.com'))).status === 'CHUA_BAT_DAU', 'NV mới đăng nhập được');

  M.sheets.WA_PhanQuyen.data.push(['hr2@kdi.edu.vn', 'HR Thủ Đức', 'HR', 'CN Thủ Đức', false, true]);
  store.invalidate_('WA_PhanQuyen');
  const tHr2 = await login('hr2@kdi.edu.vn');
  const L2 = await must('hrList', tHr2, {}); ok(L2.items.length === 2 && L2.items.every(i => i.donVi === 'CN Thủ Đức'), 'phạm vi chi nhánh');
  r = await call('hrGetProfile', tHr2, { maNV: 'TG001' }); ok(!r.ok && /phạm vi/.test(r.error), 'chặn ngoài phạm vi');
  denied = false; try { await viewAs(tHr2, fCV.id); } catch (e) { denied = true; } ok(denied, 'HR ngoài phạm vi không xem được file');
  // thu hồi quyền có hiệu lực ngay
  M.sheets.WA_PhanQuyen.data[2][5] = false; store.invalidate_('WA_PhanQuyen');
  r = await call('hrList', tHr2, {}); ok(!r.ok, 'thu hồi quyền HR có hiệu lực ngay');
  await must('logout', tAn); ok((await call('getMyProfile', tAn, {})).code === 'AUTH', 'đăng xuất');

  // ghi đồng thời
  const tD = await login('dung@gmail.com');
  await Promise.all([1, 2, 3, 4, 5].map(i => must('saveDraft', tD, { data: { NoiSinh: 'Lần ' + i } })));
  ok(M.sheets.WA_HoSo.objects().filter(x => x.HoVaTen === 'Phạm Thị Dung').length === 1, 'ghi đồng thời không tạo dòng trùng');
  console.log(`\nĐọc ${M.calls.read} lần, ghi ${M.calls.write} lần`);
  console.log(`${pass} đạt, ${fail} lỗi`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
