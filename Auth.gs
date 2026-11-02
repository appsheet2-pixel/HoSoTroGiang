/**
 * Đăng nhập bằng email cá nhân + mã OTP gửi qua email.
 * Không cần tài khoản Google / email domain công ty.
 */

function cache_() { return CacheService.getScriptCache(); }

function authError_(msg) {
  const e = new Error(msg || 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  e.code = 'AUTH';
  return e;
}

function isEmail_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '')); }

/** Xác định người dùng theo email: nhân sự (WA_PhanQuyen) và/hoặc nhân viên (ThongTinNhanVien) */
function resolveUser_(email) {
  email = norm_(email);
  const user = { email: email, role: null, scope: [], name: '', maNV: null, blocked: false };

  const q = table_(CONFIG.SHEET_QUYEN);
  const fq = find_(q, 'Email', email);
  if (fq) {
    const active = fq.rec.KichHoat === '' || fq.rec.KichHoat === true || norm_(fq.rec.KichHoat) === 'true';
    if (active && String(fq.rec.VaiTro || '').trim()) {
      user.role = String(fq.rec.VaiTro).trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'HR';
      user.scope = String(fq.rec.PhamVi || '').split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(String);
      user.name = String(fq.rec.HoTen || '');
    }
  }

  const nv = table_(CONFIG.SHEET_NV);
  const all = findAll_(nv, 'EmailCaNhan', email);
  const blocked = CONFIG.BLOCKED_WORK_STATUS.map(norm_);
  const activeRows = all.filter(function (r) { return blocked.indexOf(norm_(r.rec.TrangThaiLamViec)) < 0; });
  const pick = activeRows.length ? activeRows[activeRows.length - 1] : null;
  if (pick) {
    user.maNV = String(pick.rec.MaNhanVien).trim();
    user.name = user.name || String(pick.rec.HoVaTen || '');
  } else if (all.length) {
    user.blocked = true;
  }
  return user;
}

function api_requestOtp(p) {
  const email = norm_(p.email);
  if (!isEmail_(email)) throw new Error('Email không hợp lệ.');
  const c = cache_();
  if (c.get('OTPW_' + email)) throw new Error('Vui lòng chờ ' + CONFIG.OTP_RESEND_SECONDS + ' giây trước khi gửi lại mã.');
  const dayKey = 'OTPD_' + email;
  const sentToday = Number(c.get(dayKey) || 0);
  if (sentToday >= 10) throw new Error('Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau.');

  const user = resolveUser_(email);
  if (!user.role && !user.maNV) {
    if (user.blocked) throw new Error('Tài khoản của bạn đã ngừng hoạt động. Vui lòng liên hệ phòng Nhân sự.');
    throw new Error('Email này chưa được Nhân sự đăng ký trong hệ thống. Vui lòng liên hệ phòng Nhân sự.');
  }

  const code = String(100000 + (parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 10), 16) % 900000));
  c.put('OTP_' + email, JSON.stringify({ code: code, tries: 0 }), CONFIG.OTP_TTL_MIN * 60);
  c.put('OTPW_' + email, '1', CONFIG.OTP_RESEND_SECONDS);
  c.put(dayKey, String(sentToday + 1), 6 * 3600);
  sendOtpMail_(email, user.name, code);
  return { sent: true, ttlMin: CONFIG.OTP_TTL_MIN };
}

function api_verifyOtp(p) {
  const email = norm_(p.email);
  const code = String(p.code || '').replace(/\D/g, '');
  const c = cache_();
  const raw = c.get('OTP_' + email);
  if (!raw) throw new Error('Mã đã hết hạn. Vui lòng gửi lại mã mới.');
  const o = JSON.parse(raw);
  if (o.code !== code) {
    o.tries++;
    if (o.tries >= CONFIG.OTP_MAX_TRIES) { c.remove('OTP_' + email); throw new Error('Nhập sai quá số lần cho phép. Vui lòng gửi lại mã mới.'); }
    c.put('OTP_' + email, JSON.stringify(o), CONFIG.OTP_TTL_MIN * 60);
    throw new Error('Mã không đúng. Còn ' + (CONFIG.OTP_MAX_TRIES - o.tries) + ' lần thử.');
  }
  c.remove('OTP_' + email);
  const user = resolveUser_(email);
  if (!user.role && !user.maNV) throw new Error('Tài khoản không còn hiệu lực.');
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  c.put('S_' + token, JSON.stringify(user), Math.min(CONFIG.SESSION_HOURS, 6) * 3600);
  log_(user.maNV, 'DANG_NHAP', email, user.role || 'NV');
  return { token: token };
}

function requireSession_(token, need) {
  if (!token || !/^[a-f0-9]{64}$/.test(String(token))) throw authError_();
  const c = cache_();
  const raw = c.get('S_' + token);
  if (!raw) throw authError_();
  const s = JSON.parse(raw);
  c.put('S_' + token, raw, Math.min(CONFIG.SESSION_HOURS, 6) * 3600); // gia hạn phiên khi còn dùng
  s.token = token;
  if (need === 'HR' && !s.role) throw new Error('Bạn không có quyền nhân sự.');
  if (need === 'NV' && !s.maNV) throw new Error('Tài khoản của bạn không gắn với hồ sơ nhân viên nào.');
  return s;
}

function api_logout(p, ctx) {
  cache_().remove('S_' + ctx.token);
  return true;
}
