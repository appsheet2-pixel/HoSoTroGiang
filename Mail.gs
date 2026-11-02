/**
 * Email: OTP, thông báo cho nhân viên và nhân sự.
 * Lưu ý hạn mức: tài khoản Google Workspace ~1.500 người nhận/ngày, Gmail cá nhân ~100/ngày.
 */
function escHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function mailTpl_(title, bodyHtml, withButton) {
  const url = appUrl_();
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;border:1px solid #e3e8ef;border-radius:10px;overflow:hidden">' +
    '<div style="background:#0f4c81;color:#fff;padding:16px 20px;font-size:16px;font-weight:bold">' + escHtml_(CONFIG.APP_NAME) + '</div>' +
    '<div style="padding:20px;color:#1f2937;font-size:14px;line-height:1.6"><h3 style="margin-top:0">' + escHtml_(title) + '</h3>' + bodyHtml +
    (withButton && url ? '<p style="margin-top:20px"><a href="' + url + '" style="background:#0f4c81;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Mở ứng dụng</a></p>' : '') +
    '</div><div style="background:#f6f8fb;color:#6b7280;font-size:12px;padding:12px 20px">' + escHtml_(CONFIG.ORG_NAME) + ' – Email tự động, vui lòng không trả lời.</div></div>';
}

function send_(to, subject, html) {
  MailApp.sendEmail({ to: to, subject: '[' + CONFIG.APP_NAME + '] ' + subject, htmlBody: html, name: CONFIG.APP_NAME });
}

function sendOtpMail_(email, name, code) {
  send_(email, 'Mã đăng nhập: ' + code, mailTpl_('Mã đăng nhập của bạn',
    '<p>Xin chào ' + escHtml_(name || '') + ',</p><p>Mã đăng nhập của bạn là:</p>' +
    '<p style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#0f4c81;margin:8px 0">' + code + '</p>' +
    '<p>Mã có hiệu lực trong ' + CONFIG.OTP_TTL_MIN + ' phút. Không chia sẻ mã này cho bất kỳ ai.</p>', false));
}

function sendEmployeeMail_(nv, subject, html) {
  try {
    if (!isEmail_(nv.EmailCaNhan)) return;
    send_(String(nv.EmailCaNhan).trim(), subject, mailTpl_(subject, '<p>Xin chào ' + escHtml_(nv.HoVaTen) + ',</p><p>' + html + '</p>', true));
  } catch (e) { console.error('sendEmployeeMail_', e); }
}

function sendInviteMail_(nv) {
  send_(String(nv.EmailCaNhan).trim(), 'Mời cập nhật hồ sơ nhân sự', mailTpl_('Mời bạn cập nhật hồ sơ',
    '<p>Xin chào ' + escHtml_(nv.HoVaTen) + ',</p>' +
    '<p>Phòng Nhân sự đã tạo hồ sơ cho bạn (mã nhân viên <b>' + escHtml_(nv.MaNhanVien) + '</b>). ' +
    'Vui lòng mở ứng dụng, đăng nhập bằng email <b>' + escHtml_(nv.EmailCaNhan) + '</b> (mã xác thực sẽ được gửi qua email), ' +
    'quét mã QR trên CCCD và hoàn thiện thông tin, tải lên các giấy tờ cần thiết rồi bấm <b>Nộp hồ sơ</b>.</p>', true));
}

function notifyHr_(nv, subject, html) {
  try {
    const t = table_(CONFIG.SHEET_QUYEN);
    const to = [];
    t.rows.forEach(function (r) {
      const o = rec_(t, r);
      const active = o.KichHoat === '' || truthy_(o.KichHoat);
      if (!active || !truthy_(o.NhanThongBao) || !isEmail_(o.Email)) return;
      const scope = String(o.PhamVi || '').split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(String);
      if (!hrCanSee_({ scope: scope }, nv)) return;
      to.push(String(o.Email).trim());
    });
    if (to.length) send_(to.join(','), subject, mailTpl_(subject, '<p>' + html + '</p>', true));
  } catch (e) { console.error('notifyHr_', e); }
}
