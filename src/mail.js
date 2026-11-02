/**
 * Gửi email qua SMTP (Gmail/Google Workspace, Outlook, SendGrid, Amazon SES…)
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
 */
const nodemailer = require('nodemailer');
const { CONFIG } = require('./config');
const { escHtml, isEmail } = require('./util');
const { queueMail } = require('./store');

let _tx = null;
function transport() {
  if (_tx) return _tx;
  if (process.env.MAIL_MODE === 'console') { // chế độ thử: in email ra log thay vì gửi
    _tx = { sendMail: async o => { console.log('[MAIL]', o.to, '|', o.subject); return {}; } };
    return _tx;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  _tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _tx;
}
function _setTransport(t) { _tx = t; }

async function sendMail(to, subject, html) {
  await transport().sendMail({
    from: process.env.MAIL_FROM || `"${CONFIG.APP_NAME}" <${process.env.SMTP_USER}>`,
    to, subject: '[' + CONFIG.APP_NAME + '] ' + subject, html,
  });
}

function mailTpl(title, bodyHtml, withButton) {
  const url = CONFIG.APP_URL;
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;border:1px solid #e3e8ef;border-radius:10px;overflow:hidden">' +
    '<div style="background:#0f4c81;color:#fff;padding:16px 20px;font-size:16px;font-weight:bold">' + escHtml(CONFIG.APP_NAME) + '</div>' +
    '<div style="padding:20px;color:#1f2937;font-size:14px;line-height:1.6"><h3 style="margin-top:0">' + escHtml(title) + '</h3>' + bodyHtml +
    (withButton && url ? '<p style="margin-top:20px"><a href="' + escHtml(url) + '" style="background:#0f4c81;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Mở ứng dụng</a></p>' : '') +
    '</div><div style="background:#f6f8fb;color:#6b7280;font-size:12px;padding:12px 20px">' + escHtml(CONFIG.ORG_NAME) + ' – Email tự động, vui lòng không trả lời.</div></div>';
}

function sendOtpMail_(email, name, code) {
  queueMail(() => sendMail(email, 'Mã đăng nhập: ' + code, mailTpl('Mã đăng nhập của bạn',
    '<p>Xin chào ' + escHtml(name || '') + ',</p><p>Mã đăng nhập của bạn là:</p>' +
    '<p style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#0f4c81;margin:8px 0">' + code + '</p>' +
    '<p>Mã có hiệu lực trong ' + CONFIG.OTP_TTL_MIN + ' phút. Không chia sẻ mã này cho bất kỳ ai.</p>', false)), true);
}

function sendEmployeeMail_(nv, subject, html) {
  if (!isEmail(nv.EmailCaNhan)) return;
  queueMail(() => sendMail(String(nv.EmailCaNhan).trim(), subject, mailTpl(subject, '<p>Xin chào ' + escHtml(nv.HoVaTen) + ',</p><p>' + html + '</p>', true)));
}

function sendInviteMail_(nv) {
  queueMail(() => sendMail(String(nv.EmailCaNhan).trim(), 'Mời cập nhật hồ sơ nhân sự', mailTpl('Mời bạn cập nhật hồ sơ',
    '<p>Xin chào ' + escHtml(nv.HoVaTen) + ',</p>' +
    '<p>Phòng Nhân sự đã tạo hồ sơ cho bạn (mã nhân viên <b>' + escHtml(nv.MaNhanVien) + '</b>). ' +
    'Vui lòng mở ứng dụng, đăng nhập bằng email <b>' + escHtml(nv.EmailCaNhan) + '</b> (mã xác thực sẽ được gửi qua email), ' +
    'quét mã QR trên CCCD và hoàn thiện thông tin, tải lên các giấy tờ cần thiết rồi bấm <b>Nộp hồ sơ</b>.</p>', true)), true);
}

module.exports = { sendMail, mailTpl, sendOtpMail_, sendEmployeeMail_, sendInviteMail_, transport, _setTransport };
