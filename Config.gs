/**
 * ============================================================
 *  CẤU HÌNH ỨNG DỤNG – chỉnh sửa tại đây cho phù hợp hệ thống
 * ============================================================
 */
const CONFIG = {
  APP_NAME: 'Cổng hồ sơ nhân sự',
  ORG_NAME: 'KDI Education',

  // Để trống nếu script được tạo từ chính file Google Sheet (Tiện ích mở rộng > Apps Script).
  // Nếu dùng script độc lập thì dán ID file Google Sheet vào đây.
  SPREADSHEET_ID: '',

  // Tên các sheet dữ liệu có sẵn
  SHEET_NV: 'ThongTinNhanVien',
  SHEET_CN: 'ThongTinCaNhan',

  // Các sheet do web app tự tạo khi chạy setup()
  SHEET_HOSO: 'WA_HoSo',          // bản nháp / hồ sơ chờ duyệt
  SHEET_YC: 'WA_YeuCauSua',       // yêu cầu chỉnh sửa của nhân viên
  SHEET_QUYEN: 'WA_PhanQuyen',    // danh sách tài khoản nhân sự
  SHEET_LOG: 'WA_NhatKy',         // nhật ký thao tác

  // Thư mục Google Drive lưu file nhân viên tải lên.
  // Để trống: setup() sẽ tự tạo thư mục "HoSoNhanVien_WebApp".
  UPLOAD_FOLDER_ID: '',

  // Cách ghi giá trị cột file/ảnh vào ThongTinCaNhan:
  //  - ''  : ghi đường link Google Drive (đơn giản nhất)
  //  - 'ThongTinCaNhan_Files_/' : ghi đường dẫn tương đối kiểu AppSheet.
  //    Khi dùng chế độ này, UPLOAD_FOLDER_ID phải là thư mục tương ứng trong thư mục app AppSheet.
  APPSHEET_PATH_PREFIX: '',

  // Đăng nhập
  OTP_TTL_MIN: 10,
  OTP_MAX_TRIES: 5,
  OTP_RESEND_SECONDS: 60,
  SESSION_HOURS: 6,               // tối đa 6 giờ (giới hạn CacheService)
  // Nhân viên có TrangThaiLamViec thuộc danh sách này sẽ không đăng nhập được
  BLOCKED_WORK_STATUS: ['Nghỉ việc', 'Đã nghỉ việc', 'Đã nghỉ', 'Ngừng làm việc'],

  // Khi nhân sự duyệt: giá trị ghi vào cột TrangThai của ThongTinCaNhan (null = không ghi)
  CN_STATUS_ON_APPROVE: 'Đã duyệt',
  WRITE_TUOI: true,               // tự tính và ghi cột Tuoi (bỏ qua nếu ô đang là công thức)
  SYNC_PHONE_TO_NV: true,         // cập nhật SoDienThoai sang ThongTinNhanVien khi duyệt

  // Phân quyền nhân sự theo cột này (cột PhamVi trong WA_PhanQuyen)
  SCOPE_COLUMN: 'DonVi/ChiNhanh',

  MAX_FILE_MB: 10,
  NOTIFY_HR_ON_SUBMIT: true,
  TIMEZONE: 'Asia/Ho_Chi_Minh',
};

/** Trạng thái hồ sơ */
const ST = {
  CHUA: 'CHUA_BAT_DAU',
  NHAP: 'NHAP',
  CHO_DUYET: 'CHO_DUYET',
  TU_CHOI: 'TU_CHOI',
  DA_DUYET: 'DA_DUYET',
  MO_SUA: 'MO_CHINH_SUA',
};
const EDITABLE_ST = [ST.CHUA, ST.NHAP, ST.TU_CHOI, ST.MO_SUA];

/** Các nhóm thông tin hiển thị trên form */
const SECTIONS = [
  { id: 'cccd', title: 'Căn cước công dân' },
  { id: 'canhan', title: 'Thông tin cá nhân' },
  { id: 'lienhe', title: 'Liên hệ & địa chỉ' },
  { id: 'taichinh', title: 'Thuế, BHXH & ngân hàng' },
  { id: 'giadinh', title: 'Gia đình & liên hệ khẩn cấp' },
  { id: 'hoso', title: 'Hồ sơ cần nộp' },
];

/**
 * Các trường nhân viên tự khai – key PHẢI trùng tên cột trong ThongTinCaNhan.
 * type: text | digits | tel | email | date | select | textarea | number | image | file
 * options: giá trị cho select (nên trùng giá trị Enum trong AppSheet)
 * recv: cột "Đã nhận" tương ứng (nhân sự tick khi duyệt)
 */
const FIELDS = [
  // --- CCCD ---
  { key: 'SoCCCD', label: 'Số CCCD / Căn cước', section: 'cccd', type: 'digits', required: true, pattern: '^\\d{12}$', hint: '12 chữ số' },
  { key: 'SoCMND', label: 'Số CMND cũ (nếu có)', section: 'cccd', type: 'digits', pattern: '^(\\d{9}|\\d{12})$' },
  { key: 'NgayCap', label: 'Ngày cấp', section: 'cccd', type: 'date', required: true },
  { key: 'NoiCap', label: 'Nơi cấp', section: 'cccd', type: 'text', required: true,
    suggest: ['Cục Cảnh sát quản lý hành chính về trật tự xã hội', 'Bộ Công an', 'Cục Cảnh sát ĐKQL cư trú và DLQG về dân cư'] },
  { key: 'HinhCCCD', label: 'Ảnh CCCD mặt trước', section: 'cccd', type: 'image', required: true },

  // --- Cá nhân ---
  { key: 'GioiTinh', label: 'Giới tính', section: 'canhan', type: 'select', required: true, options: ['Nam', 'Nữ'] },
  { key: 'NgaySinh', label: 'Ngày sinh', section: 'canhan', type: 'date', required: true },
  { key: 'NoiSinh', label: 'Nơi sinh', section: 'canhan', type: 'text' },
  { key: 'NguyenQuan', label: 'Nguyên quán / Quê quán', section: 'canhan', type: 'text' },
  { key: 'QuocTich', label: 'Quốc tịch', section: 'canhan', type: 'text', def: 'Việt Nam' },
  { key: 'DanToc', label: 'Dân tộc', section: 'canhan', type: 'text', def: 'Kinh' },
  { key: 'TonGiao', label: 'Tôn giáo', section: 'canhan', type: 'text', def: 'Không' },
  { key: 'TinhTrangHonNhan', label: 'Tình trạng hôn nhân', section: 'canhan', type: 'select', options: ['Độc thân', 'Đã kết hôn', 'Ly hôn', 'Góa'] },
  { key: 'TrinhDoHocVanCaoNhat', label: 'Trình độ học vấn cao nhất', section: 'canhan', type: 'select', required: true,
    options: ['THPT', 'Trung cấp', 'Cao đẳng', 'Sinh viên đại học', 'Đại học', 'Thạc sĩ', 'Tiến sĩ', 'Khác'] },
  { key: 'HinhAnhCaNhan', label: 'Ảnh chân dung (ảnh thẻ)', section: 'canhan', type: 'image', required: true },

  // --- Liên hệ ---
  { key: 'SoDienThoai', label: 'Số điện thoại', section: 'lienhe', type: 'tel', required: true, pattern: '^(\\+?84|0)\\d{9,10}$' },
  { key: 'EmailCaNhan', label: 'Email cá nhân (email đăng nhập)', section: 'lienhe', type: 'email', readonly: true },
  { key: 'DiaChiThuongTru', label: 'Địa chỉ thường trú', section: 'lienhe', type: 'textarea', required: true },
  { key: 'DiaChiTamTru', label: 'Địa chỉ tạm trú / nơi ở hiện tại', section: 'lienhe', type: 'textarea', required: true },

  // --- Thuế, BHXH, ngân hàng ---
  { key: 'MaSoThue', label: 'Mã số thuế cá nhân', section: 'taichinh', type: 'digits', pattern: '^\\d{10}(-?\\d{3})?$|^\\d{12}$', hint: 'Từ 07/2025 có thể dùng số CCCD' },
  { key: 'SoSoBHXH', label: 'Số sổ BHXH', section: 'taichinh', type: 'digits', pattern: '^\\d{10}$' },
  { key: 'NoiDangKyKhamBHYT', label: 'Nơi đăng ký khám BHYT', section: 'taichinh', type: 'text' },
  { key: 'TenNganHang', label: 'Tên ngân hàng', section: 'taichinh', type: 'text', required: true,
    suggest: ['Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'ACB', 'VPBank', 'TPBank', 'Sacombank', 'HDBank', 'VIB', 'SHB', 'OCB', 'MSB', 'SeABank', 'Eximbank', 'Nam A Bank', 'LPBank'] },
  { key: 'ChiNhanhNganHang', label: 'Chi nhánh ngân hàng', section: 'taichinh', type: 'text' },
  { key: 'SoTaiKhoanNganHang', label: 'Số tài khoản ngân hàng', section: 'taichinh', type: 'digits', required: true, pattern: '^\\d{6,20}$' },

  // --- Gia đình ---
  { key: 'ThongTinGiaDinh', label: 'Thông tin gia đình', section: 'giadinh', type: 'textarea', hint: 'Họ tên, năm sinh, nghề nghiệp của bố, mẹ, vợ/chồng, con…' },
  { key: 'TenNguoiLienHeKhanCap', label: 'Người liên hệ khẩn cấp', section: 'giadinh', type: 'text', required: true },
  { key: 'SdtLienHeKhanCap', label: 'SĐT liên hệ khẩn cấp', section: 'giadinh', type: 'tel', required: true, pattern: '^(\\+?84|0)\\d{9,10}$' },
  { key: 'MoiQuanHeVoiBanThan', label: 'Mối quan hệ với bản thân', section: 'giadinh', type: 'select', required: true,
    options: ['Bố', 'Mẹ', 'Vợ', 'Chồng', 'Anh/Chị/Em', 'Con', 'Người thân khác', 'Bạn bè'] },
  { key: 'SoNguoiPhuThuocDangKy', label: 'Số người phụ thuộc đăng ký giảm trừ', section: 'giadinh', type: 'number', def: '0' },
  { key: 'ThongTinNguoiPhuThuoc', label: 'Thông tin người phụ thuộc', section: 'giadinh', type: 'textarea', hint: 'Họ tên, ngày sinh, số CCCD/MST, quan hệ' },

  // --- Hồ sơ đính kèm ---
  { key: 'CV', label: 'CV', section: 'hoso', type: 'file', required: true, recv: 'NhanCV' },
  { key: 'SoYeuLyLich', label: 'Sơ yếu lý lịch', section: 'hoso', type: 'file', recv: 'NhanSoYeuLyLich' },
  { key: 'CMNDCCCD', label: 'Bản chụp CCCD 2 mặt', section: 'hoso', type: 'file', required: true, recv: 'NhanCMNDCCCD' },
  { key: 'HoKhau', label: 'Xác nhận cư trú / Hộ khẩu', section: 'hoso', type: 'file', recv: 'NhanHoKhau' },
  { key: 'GiayKhamSucKhoe', label: 'Giấy khám sức khỏe', section: 'hoso', type: 'file', recv: 'NhanGiayKhamSucKhoe' },
  { key: 'BangCapCaoNhat', label: 'Bằng cấp cao nhất / Thẻ sinh viên', section: 'hoso', type: 'file', recv: 'NhanBangCapCaoNhat' },
  { key: 'HopDongLaoDong', label: 'Hợp đồng (bản đã ký)', section: 'hoso', type: 'file', recv: 'NhanHopDongLaoDong' },
  { key: 'ThongTinBaoMat', label: 'Cam kết bảo mật thông tin', section: 'hoso', type: 'file', recv: 'NhanThongTinBaoMat' },
  { key: 'HopDongLiemChinh', label: 'Cam kết liêm chính', section: 'hoso', type: 'file', recv: 'NhanHopDongLiemChinh' },
  { key: 'CK02TNCN', label: 'Mẫu cam kết 08/CK-TNCN (nếu có)', section: 'hoso', type: 'file', recv: 'NhanCK02TNCN' },
];

/** Trường nhân sự nhập khi thêm nhân viên mới – key trùng tên cột ThongTinNhanVien */
const NV_FIELDS = [
  { key: 'MaNhanVien', label: 'Mã nhân viên', required: true },
  { key: 'HoVaTen', label: 'Họ và tên', required: true },
  { key: 'EmailCaNhan', label: 'Email cá nhân (dùng để đăng nhập)', type: 'email', required: true },
  { key: 'SoDienThoai', label: 'Số điện thoại', type: 'tel' },
  { key: 'TrangThaiLamViec', label: 'Trạng thái làm việc', list: true, def: 'Đang làm việc' },
  { key: 'HinhThuc/LoaiNhanVien', label: 'Hình thức / Loại nhân viên', list: true, def: 'Part-time' },
  { key: 'ChucDanhHienTai', label: 'Chức danh', list: true, def: 'Trợ giảng' },
  { key: 'NgayVaoLamDauTien', label: 'Ngày vào làm đầu tiên', type: 'date' },
  { key: 'DonVi/ChiNhanh', label: 'Đơn vị / Chi nhánh', list: true },
  { key: 'DiaDiemLamViec', label: 'Địa điểm làm việc', list: true },
  { key: 'Khoi', label: 'Khối', list: true },
  { key: 'PhongBan', label: 'Phòng ban', list: true },
  { key: 'Nhom', label: 'Nhóm', list: true },
  { key: 'SchoolID', label: 'School ID', list: true },
  { key: 'TenTruong', label: 'Tên trường', list: true },
  { key: 'CaLamViec', label: 'Ca làm việc', list: true },
  { key: 'BU1', label: 'BU1', list: true },
  { key: 'BU2', label: 'BU2', list: true },
  { key: 'BU3', label: 'BU3', list: true },
  { key: 'BU4', label: 'BU4', list: true },
  { key: 'GhiChuNhanSu', label: 'Ghi chú nhân sự', type: 'textarea' },
];

/** Cấu trúc các sheet do web app quản lý */
const WA_HEADERS = {
  HOSO: ['MaNhanVien', 'EmailCaNhan', 'HoVaTen', 'TrangThai', 'DuLieu', 'GhiChuNV', 'GhiChuNS', 'NgayNop', 'NguoiDuyet', 'NgayDuyet', 'NgayTao', 'NgayCapNhat'],
  YC: ['MaYeuCau', 'MaNhanVien', 'HoVaTen', 'EmailCaNhan', 'LyDo', 'TrangThai', 'PhanHoi', 'NguoiXuLy', 'NgayXuLy', 'NgayTao'],
  QUYEN: ['Email', 'HoTen', 'VaiTro', 'PhamVi', 'NhanThongBao', 'KichHoat'],
  LOG: ['ThoiGian', 'MaNhanVien', 'HanhDong', 'NguoiThucHien', 'ChiTiet'],
};
