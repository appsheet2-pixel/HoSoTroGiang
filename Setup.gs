/**
 * CHẠY HÀM NÀY MỘT LẦN trong trình soạn thảo Apps Script (chọn setup > Chạy).
 * - Tạo các sheet WA_* nếu chưa có
 * - Thêm bạn làm ADMIN trong WA_PhanQuyen
 * - Tạo thư mục Drive lưu file (nếu chưa cấu hình)
 * - Kiểm tra các cột cần thiết trong 2 sheet dữ liệu
 */
function setup() {
  const ss = ss_();
  const report = [];
  const defs = [
    [CONFIG.SHEET_HOSO, WA_HEADERS.HOSO],
    [CONFIG.SHEET_YC, WA_HEADERS.YC],
    [CONFIG.SHEET_QUYEN, WA_HEADERS.QUYEN],
    [CONFIG.SHEET_LOG, WA_HEADERS.LOG],
  ];
  defs.forEach(function (d) {
    let sh = ss.getSheetByName(d[0]);
    if (!sh) {
      sh = ss.insertSheet(d[0]);
      sh.getRange(1, 1, 1, d[1].length).setValues([d[1]]).setFontWeight('bold').setBackground('#e8eef6');
      sh.setFrozenRows(1);
      report.push('Đã tạo sheet ' + d[0]);
    } else {
      const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
      const miss = d[1].filter(function (h) { return have.indexOf(h) < 0; });
      if (miss.length) {
        sh.getRange(1, sh.getLastColumn() + 1, 1, miss.length).setValues([miss]).setFontWeight('bold');
        report.push('Bổ sung cột cho ' + d[0] + ': ' + miss.join(', '));
      }
    }
  });
  // Cột DuLieu chứa JSON – để dạng văn bản
  ss.getSheetByName(CONFIG.SHEET_HOSO).getRange('E:E').setNumberFormat('@');

  // Thêm người chạy setup làm ADMIN
  const me = Session.getEffectiveUser().getEmail();
  const q = ss.getSheetByName(CONFIG.SHEET_QUYEN);
  if (q.getLastRow() < 2 && me) {
    q.appendRow([me.toLowerCase(), 'Quản trị viên', 'ADMIN', '', true, true]);
    report.push('Đã thêm ' + me + ' làm ADMIN trong ' + CONFIG.SHEET_QUYEN);
  }

  // Thư mục lưu file
  const props = PropertiesService.getScriptProperties();
  if (!CONFIG.UPLOAD_FOLDER_ID && !props.getProperty('UPLOAD_FOLDER_ID')) {
    const folder = DriveApp.createFolder('HoSoNhanVien_WebApp');
    props.setProperty('UPLOAD_FOLDER_ID', folder.getId());
    report.push('Đã tạo thư mục Drive: ' + folder.getUrl() + ' (hãy chia sẻ thư mục này cho nhóm Nhân sự)');
  }

  // Kiểm tra cột
  const needNV = ['MaNhanVien', 'HoVaTen', 'Ten', 'TrangThaiLamViec', 'EmailCaNhan', 'SoDienThoai', CONFIG.SCOPE_COLUMN, 'NgayTao', 'NguoiTao', 'NgayCapNhat', 'NguoiCapNhat'];
  const needCN = ['MaNhanVien', 'HoVaTen', 'Ten', 'TrangThaiLV', 'BU1', 'BU2', 'TrangThai', 'NgayTao', 'NguoiTao', 'NgayCapNhat', 'NguoiCapNhat']
    .concat(FIELDS.map(function (f) { return f.key; }))
    .concat(FIELDS.filter(function (f) { return f.recv; }).map(function (f) { return f.recv; }));
  [[CONFIG.SHEET_NV, needNV], [CONFIG.SHEET_CN, needCN]].forEach(function (x) {
    const t = table_(x[0], true);
    const miss = x[1].filter(function (h) { return t.idx[h] === undefined; });
    report.push(x[0] + ': ' + (miss.length ? 'THIẾU cột ' + miss.join(', ') : 'đủ cột ✓') + ' (' + t.rows.length + ' dòng)');
  });

  report.push('Hạn mức email còn lại hôm nay: ' + MailApp.getRemainingDailyQuota());
  report.push('Tiếp theo: Triển khai > Tùy chọn triển khai mới > Ứng dụng web, Thực thi với tư cách: Tôi, Người có quyền truy cập: Bất kỳ ai.');
  console.log(report.join('\n'));
  return report.join('\n');
}

/** Tiện ích: xóa phiên đăng nhập/mã OTP đang lưu trong cache của một email (khi cần hỗ trợ) */
function resetOtp(email) {
  email = norm_(email || '');
  cache_().removeAll(['OTP_' + email, 'OTPW_' + email, 'OTPD_' + email]);
}
