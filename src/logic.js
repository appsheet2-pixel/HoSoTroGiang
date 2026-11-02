/**
 * Nghiệp vụ: đăng nhập, hồ sơ nhân viên, duyệt của nhân sự (chuyển từ bản Apps Script)
 */
const jwt = require('jsonwebtoken');
const { CONFIG, ST, EDITABLE_ST, SECTIONS, FIELDS, NV_FIELDS } = require('./config');
const { formatDate, norm, fold, isEmail, uuid, fmtDate, dtStr, dateStr, toDate, age, lastName, escHtml, cache } = require('./util');
const { table_, rec_, find_, findAll_, writeRow_, appendRow_, upsertWa_, log_, queueMail } = require('./store');
const { sendMail, mailTpl, sendOtpMail_, sendEmployeeMail_, sendInviteMail_ } = require('./mail');

/** Xác định người dùng theo email: nhân sự (WA_PhanQuyen) và/hoặc nhân viên (ThongTinNhanVien) */
function resolveUser_(email) {
  email = norm(email);
  const user = { email: email, role: null, scope: [], name: '', maNV: null, blocked: false };

  const q = table_(CONFIG.SHEET_QUYEN);
  const fq = find_(q, 'Email', email);
  if (fq) {
    const active = fq.rec.KichHoat === '' || fq.rec.KichHoat === true || norm(fq.rec.KichHoat) === 'true';
    if (active && String(fq.rec.VaiTro || '').trim()) {
      user.role = String(fq.rec.VaiTro).trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'HR';
      user.scope = String(fq.rec.PhamVi || '').split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(String);
      user.name = String(fq.rec.HoTen || '');
    }
  }

  const nv = table_(CONFIG.SHEET_NV);
  const all = findAll_(nv, 'EmailCaNhan', email);
  const blocked = CONFIG.BLOCKED_WORK_STATUS.map(norm);
  const activeRows = all.filter(function (r) { return blocked.indexOf(norm(r.rec.TrangThaiLamViec)) < 0; });
  const pick = activeRows.length ? activeRows[activeRows.length - 1] : null;
  if (pick) {
    user.maNV = String(pick.rec.MaNhanVien).trim();
    user.name = user.name || String(pick.rec.HoVaTen || '');
  } else if (all.length) {
    user.blocked = true;
  }
  return user;
}


/**
 * Nghiệp vụ hồ sơ: nhân viên khai – nộp – nhân sự duyệt – lưu vào ThongTinCaNhan.
 */

/* ===================== Helpers chung ===================== */
function isFileField_(f) { return f.type === 'file' || f.type === 'image'; }

function getNV_(maNV) {
  const f = find_(table_(CONFIG.SHEET_NV), 'MaNhanVien', maNV);
  if (!f) throw new Error('Không tìm thấy nhân viên mã ' + maNV);
  return f.rec;
}
function getCN_(maNV) {
  const f = find_(table_(CONFIG.SHEET_CN), 'MaNhanVien', maNV);
  return f ? f.rec : null;
}
function getHoSo_(maNV) {
  const f = find_(table_(CONFIG.SHEET_HOSO), 'MaNhanVien', maNV);
  if (!f) return null;
  let data = {};
  try { data = JSON.parse(String(f.rec.DuLieu || '{}')); } catch (e) { data = {}; }
  return { rec: f.rec, data: data };
}

function fileVal_(v) {
  if (!v) return '';
  if (typeof v === 'object') return v.v ? v : '';
  const s = String(v).trim();
  if (!s) return '';
  return { v: s, url: /^https?:\/\//i.test(s) ? s : '', name: s.split('/').pop().split('?')[0] || 'Tệp' };
}

function cellToData_(f, v) {
  if (isFileField_(f)) return fileVal_(v);
  if (f.type === 'date') return dateStr(v);
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return fmtDate(v);
  return String(v);
}

function cnToData_(cn) {
  const d = {};
  FIELDS.forEach(function (f) { d[f.key] = cellToData_(f, cn[f.key]); });
  return d;
}

function mergeCn_(data, cn) {
  const out = Object.assign({}, data);
  const cd = cnToData_(cn);
  FIELDS.forEach(function (f) {
    if (isFileField_(f)) {
      const cur = fileVal_(data[f.key]);
      const nv = cd[f.key];
      out[f.key] = (cur && nv && cur.v === nv.v) ? cur : nv;
    } else {
      out[f.key] = cd[f.key];
    }
  });
  return out;
}

function truthy_(v) {
  return v === true || ['true', 'yes', 'y', '1', 'có', 'x'].indexOf(norm(v)) >= 0;
}

function recvFromCn_(cn) {
  const r = {};
  FIELDS.forEach(function (f) { if (f.recv) r[f.recv] = cn ? truthy_(cn[f.recv]) : false; });
  return r;
}

function state_(maNV) {
  const hoso = getHoSo_(maNV);
  const cn = getCN_(maNV);
  let status, data;
  if (hoso) {
    status = String(hoso.rec.TrangThai || ST.NHAP);
    data = hoso.data;
    if (status === ST.DA_DUYET && cn) data = mergeCn_(data, cn);
  } else if (cn) {
    status = ST.DA_DUYET;
    data = cnToData_(cn);
  } else {
    status = ST.CHUA;
    data = {};
  }
  return { status: status, data: data, hoso: hoso, cn: cn };
}

/** SĐT lưu dạng số trong sheet bị mất số 0 đầu -> thêm lại */
function phone_(v) {
  const s = String(v == null ? '' : v).replace(/[\s.]/g, '');
  return /^[1-9]\d{8}$/.test(s) ? '0' + s : s;
}

function withDefaults_(data, nv) {
  const out = Object.assign({}, data);
  FIELDS.forEach(function (f) {
    if (out[f.key] === undefined || out[f.key] === null) out[f.key] = '';
    if (f.def !== undefined && out[f.key] === '') out[f.key] = f.def;
  });
  out.EmailCaNhan = String(nv.EmailCaNhan || '').trim();
  if (!out.SoDienThoai && nv.SoDienThoai) out.SoDienThoai = phone_(nv.SoDienThoai);
  return out;
}


function nvPublic_(nv) {
  return {
    MaNhanVien: String(nv.MaNhanVien || ''),
    HoVaTen: String(nv.HoVaTen || ''),
    EmailCaNhan: String(nv.EmailCaNhan || ''),
    SoDienThoai: phone_(nv.SoDienThoai),
    TrangThaiLamViec: String(nv.TrangThaiLamViec || ''),
    DonVi: String(nv['DonVi/ChiNhanh'] || ''),
    ChucDanh: String(nv.ChucDanhHienTai || ''),
    LoaiNV: String(nv['HinhThuc/LoaiNhanVien'] || ''),
    TenTruong: String(nv.TenTruong || ''),
    NgayVaoLam: dateStr(nv.NgayVaoLamDauTien),
  };
}

/** Làm sạch dữ liệu client gửi lên. File chỉ được chấp nhận nếu là file cũ hoặc file vừa tải lên cho đúng nhân viên. */
function sanitize_(input, prev, maNV) {
  input = input || {};
  prev = prev || {};
  const out = {};
  FIELDS.forEach(function (f) {
    if (f.readonly) { out[f.key] = prev[f.key] || ''; return; }
    let v = input[f.key];
    if (isFileField_(f)) {
      const pv = fileVal_(prev[f.key]);
      const nv = fileVal_(v);
      if (!nv) { out[f.key] = ''; return; }
      if (pv && nv.v === pv.v) { out[f.key] = pv; return; }
      if (nv.id && cache.get('UPL_' + nv.id) === String(maNV)) {
        out[f.key] = { v: String(nv.v), url: String(nv.url || ''), name: String(nv.name || '').slice(0, 200), id: String(nv.id) };
        return;
      }
      out[f.key] = pv || '';
      return;
    }
    if (v === null || v === undefined) v = '';
    v = String(v).trim().slice(0, f.type === 'textarea' ? 3000 : 300);
    if (f.type === 'date') v = dateStr(v);
    if (f.type === 'digits' || f.type === 'tel') v = v.replace(/[\s.]/g, '');
    if (f.type === 'select' && f.options && v && f.options.indexOf(v) < 0 && prev[f.key] !== v) v = '';
    out[f.key] = v;
  });
  return out;
}

function isEmpty_(f, v) {
  if (isFileField_(f)) return !fileVal_(v);
  return v === null || v === undefined || String(v).trim() === '';
}

function validate_(data, requireAll) {
  const errs = [];
  FIELDS.forEach(function (f) {
    if (f.readonly) return;
    const v = data[f.key];
    if (isEmpty_(f, v)) { if (requireAll && f.required) errs.push(f.label + ': chưa nhập'); return; }
    if (f.pattern && !isFileField_(f) && !new RegExp(f.pattern).test(String(v))) errs.push(f.label + ': không đúng định dạng' + (f.hint ? ' (' + f.hint + ')' : ''));
    if (f.type === 'date') {
      const d = toDate(v);
      if (!d || d > new Date()) errs.push(f.label + ': ngày không hợp lệ');
    }
  });
  if (data.NgaySinh && data.NgayCap && data.NgayCap <= data.NgaySinh) errs.push('Ngày cấp CCCD phải sau ngày sinh');
  return errs;
}

function checkDuplicateCccd_(maNV, cccd) {
  if (!cccd) return;
  const t = table_(CONFIG.SHEET_CN);
  if (t.idx.SoCCCD === undefined) return;
  findAll_(t, 'SoCCCD', cccd).forEach(function (r) {
    if (norm(r.rec.MaNhanVien) !== norm(maNV)) {
      throw new Error('Số CCCD này đã có trong hồ sơ của nhân viên khác (' + r.rec.MaNhanVien + '). Vui lòng liên hệ Nhân sự.');
    }
  });
}

function saveHoSo_(nv, patch) {
  const maNV = String(nv.MaNhanVien);
  const exists = find_(table_(CONFIG.SHEET_HOSO), 'MaNhanVien', maNV);
  const vals = Object.assign({
    MaNhanVien: maNV,
    EmailCaNhan: String(nv.EmailCaNhan || ''),
    HoVaTen: String(nv.HoVaTen || ''),
    NgayCapNhat: new Date(),
  }, patch);
  if (vals.DuLieu && typeof vals.DuLieu !== 'string') vals.DuLieu = JSON.stringify(vals.DuLieu);
  if (!exists) vals.NgayTao = new Date();
  upsertWa_(CONFIG.SHEET_HOSO, 'MaNhanVien', maNV, vals);
}

function pendingRequest_(maNV) {
  const list = findAll_(table_(CONFIG.SHEET_YC), 'MaNhanVien', maNV).filter(function (r) { return r.rec.TrangThai === 'CHO_XU_LY'; });
  return list.length ? list[list.length - 1].rec : null;
}

/** Ghi hồ sơ đã duyệt vào sheet ThongTinCaNhan */
function writeCN_(nv, data, received, actor) {
  const maNV = String(nv.MaNhanVien);
  const t = table_(CONFIG.SHEET_CN);
  const f = find_(t, 'MaNhanVien', maNV);
  const vals = {};
  FIELDS.forEach(function (fd) {
    let v = data[fd.key];
    if (isFileField_(fd)) { const fv = fileVal_(v); v = fv ? fv.v : ''; }
    else if (fd.type === 'date') v = toDate(v) || '';
    else if (fd.type === 'number') v = (v === '' || isNaN(Number(v))) ? v : Number(v);
    vals[fd.key] = v;
  });
  vals.MaNhanVien = maNV;
  vals.HoVaTen = nv.HoVaTen;
  vals.Ten = nv.Ten || lastName(nv.HoVaTen);
  vals.TrangThaiLV = nv.TrangThaiLamViec;
  vals.BU1 = nv.BU1;
  vals.BU2 = nv.BU2;
  if (CONFIG.WRITE_TUOI && vals.NgaySinh instanceof Date) vals.Tuoi = age(vals.NgaySinh);
  if (received) FIELDS.forEach(function (fd) {
    if (fd.recv && Object.prototype.hasOwnProperty.call(received, fd.recv)) vals[fd.recv] = !!received[fd.recv];
  });
  if (CONFIG.CN_STATUS_ON_APPROVE) vals.TrangThai = CONFIG.CN_STATUS_ON_APPROVE;
  vals.NgayCapNhat = new Date();
  vals.NguoiCapNhat = actor;
  if (f) {
    writeRow_(t, f.rowNum, vals);
  } else {
    vals.NgayTao = new Date();
    vals.NguoiTao = actor;
    appendRow_(t, 'MaNhanVien', vals);
  }

  if (CONFIG.SYNC_PHONE_TO_NV && data.SoDienThoai) {
    const tn = table_(CONFIG.SHEET_NV);
    const fn = find_(tn, 'MaNhanVien', maNV);
    if (fn && phone_(fn.rec.SoDienThoai) !== data.SoDienThoai) {
      writeRow_(tn, fn.rowNum, { SoDienThoai: data.SoDienThoai, NgayCapNhat: new Date(), NguoiCapNhat: actor });
    }
  }
}

/* ===================== API nhân viên ===================== */
function api_getMyProfile(p, ctx) {
  const nv = getNV_(ctx.maNV);
  const s = state_(ctx.maNV);
  const yc = pendingRequest_(ctx.maNV);
  const lastYc = findAll_(table_(CONFIG.SHEET_YC), 'MaNhanVien', ctx.maNV).pop();
  return {
    nv: nvPublic_(nv),
    status: s.status,
    data: withDefaults_(s.data, nv),
    ghiChuNS: s.hoso ? String(s.hoso.rec.GhiChuNS || '') : '',
    ghiChuNV: s.hoso ? String(s.hoso.rec.GhiChuNV || '') : '',
    ngayNop: s.hoso ? dtStr(s.hoso.rec.NgayNop) : '',
    ngayDuyet: s.hoso ? dtStr(s.hoso.rec.NgayDuyet) : '',
    editRequest: yc ? { lyDo: String(yc.LyDo || ''), ngayTao: dtStr(yc.NgayTao) } : null,
    lastRequest: lastYc && lastYc.rec.TrangThai === 'TU_CHOI' ? { phanHoi: String(lastYc.rec.PhanHoi || ''), ngayXuLy: dtStr(lastYc.rec.NgayXuLy) } : null,
  };
}

function editableState_(maNV) {
  const s = state_(maNV);
  if (EDITABLE_ST.indexOf(s.status) < 0) {
    throw new Error(s.status === ST.CHO_DUYET ? 'Hồ sơ đang chờ duyệt. Hãy "Rút lại" nếu cần sửa.' : 'Hồ sơ đã được duyệt. Hãy gửi yêu cầu chỉnh sửa tới Nhân sự.');
  }
  return s;
}

function api_saveDraft(p, ctx) {
  const nv = getNV_(ctx.maNV);
  const s = editableState_(ctx.maNV);
  const clean = withDefaults_(sanitize_(p.data, s.data, ctx.maNV), nv);
  const status = s.status === ST.CHUA ? ST.NHAP : s.status;
  saveHoSo_(nv, { TrangThai: status, DuLieu: clean, GhiChuNV: String(p.note || '').slice(0, 1000) });
  return { status: status, data: clean, savedAt: dtStr(new Date()) };
}

function api_submit(p, ctx) {
  const nv = getNV_(ctx.maNV);
  const s = editableState_(ctx.maNV);
  const clean = withDefaults_(sanitize_(p.data, s.data, ctx.maNV), nv);
  const errs = validate_(clean, true);
  if (errs.length) {
    saveHoSo_(nv, { TrangThai: s.status === ST.CHUA ? ST.NHAP : s.status, DuLieu: clean });
    throw new Error('Hồ sơ chưa đầy đủ:\n• ' + errs.join('\n• '));
  }
  checkDuplicateCccd_(ctx.maNV, clean.SoCCCD);
  saveHoSo_(nv, { TrangThai: ST.CHO_DUYET, DuLieu: clean, GhiChuNV: String(p.note || '').slice(0, 1000), NgayNop: new Date() });
  log_(ctx.maNV, 'NOP_HO_SO', ctx.email, s.status === ST.MO_SUA ? 'Nộp lại sau chỉnh sửa' : '');
  if (CONFIG.NOTIFY_HR_ON_SUBMIT) notifyHr_(nv, 'Hồ sơ mới chờ duyệt', nv.HoVaTen + ' (' + nv.MaNhanVien + ') vừa nộp hồ sơ.' + (p.note ? '<br>Ghi chú: ' + escHtml(p.note) : ''));
  return { status: ST.CHO_DUYET };
}

function api_withdraw(p, ctx) {
  const nv = getNV_(ctx.maNV);
  const s = state_(ctx.maNV);
  if (s.status !== ST.CHO_DUYET) throw new Error('Chỉ rút lại được hồ sơ đang chờ duyệt.');
  saveHoSo_(nv, { TrangThai: ST.NHAP });
  log_(ctx.maNV, 'RUT_HO_SO', ctx.email, '');
  return { status: ST.NHAP };
}

function api_requestEdit(p, ctx) {
  const nv = getNV_(ctx.maNV);
  const s = state_(ctx.maNV);
  const reason = String(p.reason || '').trim();
  if (s.status !== ST.DA_DUYET) throw new Error('Chỉ gửi yêu cầu chỉnh sửa khi hồ sơ đã được duyệt.');
  if (!reason) throw new Error('Vui lòng nhập nội dung cần chỉnh sửa.');
  if (pendingRequest_(ctx.maNV)) throw new Error('Bạn đã có một yêu cầu đang chờ Nhân sự xử lý.');
  const id = 'YC' + formatDate(new Date(), 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
  upsertWa_(CONFIG.SHEET_YC, 'MaYeuCau', id, {
    MaYeuCau: id, MaNhanVien: ctx.maNV, HoVaTen: nv.HoVaTen, EmailCaNhan: nv.EmailCaNhan,
    LyDo: reason.slice(0, 2000), TrangThai: 'CHO_XU_LY', NgayTao: new Date(),
  });
  log_(ctx.maNV, 'YEU_CAU_SUA', ctx.email, reason);
  notifyHr_(nv, 'Yêu cầu chỉnh sửa hồ sơ', nv.HoVaTen + ' (' + nv.MaNhanVien + ') yêu cầu chỉnh sửa hồ sơ:<br><i>' + escHtml(reason) + '</i>');
  return { ok: true };
}

/* ===================== API nhân sự ===================== */

function hrCanSee_(ctx, nvRec) {
  if (!ctx.scope || !ctx.scope.length) return true;
  const v = norm(nvRec[CONFIG.SCOPE_COLUMN]);
  return ctx.scope.some(function (s) { return norm(s) === v; });
}

function requireHrAccess_(ctx, maNV) {
  const nv = getNV_(maNV);
  if (!hrCanSee_(ctx, nv)) throw new Error('Nhân viên này không thuộc phạm vi bạn quản lý.');
  return nv;
}

function api_hrMeta(p, ctx) {
  const t = table_(CONFIG.SHEET_NV);
  const lists = {};
  NV_FIELDS.forEach(function (f) {
    if (!f.list || t.idx[f.key] === undefined) return;
    const set = {};
    const c = t.idx[f.key];
    t.rows.forEach(function (r) {
      if (f.key === CONFIG.SCOPE_COLUMN && !hrCanSee_(ctx, rec_(t, r))) return;
      const v = r[c] instanceof Date ? '' : String(r[c]).trim();
      if (v) set[v] = 1;
    });
    if (f.key === CONFIG.SCOPE_COLUMN && ctx.scope && ctx.scope.length) ctx.scope.forEach(function (s) { set[s] = 1; });
    lists[f.key] = Object.keys(set).sort().slice(0, 300);
  });
  const h = table_(CONFIG.SHEET_HOSO);
  const y = table_(CONFIG.SHEET_YC);
  const nvIdx = {};
  t.rows.forEach(function (r) { nvIdx[norm(r[t.idx.MaNhanVien])] = rec_(t, r); });
  let pending = 0, requests = 0;
  h.rows.forEach(function (r) {
    const o = rec_(h, r);
    const nv = nvIdx[norm(o.MaNhanVien)];
    if (o.TrangThai === ST.CHO_DUYET && nv && hrCanSee_(ctx, nv)) pending++;
  });
  y.rows.forEach(function (r) {
    const o = rec_(y, r);
    const nv = nvIdx[norm(o.MaNhanVien)];
    if (o.TrangThai === 'CHO_XU_LY' && nv && hrCanSee_(ctx, nv)) requests++;
  });
  return { lists: lists, counts: { pending: pending, requests: requests } };
}

function api_hrList(p, ctx) {
  const nvT = table_(CONFIG.SHEET_NV), hT = table_(CONFIG.SHEET_HOSO), cT = table_(CONFIG.SHEET_CN), yT = table_(CONFIG.SHEET_YC);
  const hMap = {};
  hT.rows.forEach(function (r) { const o = rec_(hT, r); hMap[norm(o.MaNhanVien)] = o; });
  const cSet = {};
  if (cT.idx.MaNhanVien !== undefined) cT.rows.forEach(function (r) { cSet[norm(r[cT.idx.MaNhanVien])] = true; });
  const ySet = {};
  yT.rows.forEach(function (r) { const o = rec_(yT, r); if (o.TrangThai === 'CHO_XU_LY') ySet[norm(o.MaNhanVien)] = true; });
  const q = fold(p.q || '');
  const seen = {};
  const out = [];
  for (let i = nvT.rows.length - 1; i >= 0; i--) {
    const o = rec_(nvT, nvT.rows[i]);
    const ma = String(o.MaNhanVien || '').trim();
    const k = norm(ma);
    if (!ma || seen[k]) continue;
    seen[k] = 1;
    if (!hrCanSee_(ctx, o)) continue;
    const h = hMap[k];
    const st = h ? String(h.TrangThai) : (cSet[k] ? ST.DA_DUYET : ST.CHUA);
    if (p.status && p.status !== 'ALL' && st !== p.status) continue;
    if (p.onlyRequests && !ySet[k]) continue;
    if (q) {
      const hay = fold([ma, o.HoVaTen, o.EmailCaNhan, o.SoDienThoai, o['DonVi/ChiNhanh'], o.TenTruong].join(' '));
      if (hay.indexOf(q) < 0) continue;
    }
    out.push({
      maNV: ma, hoTen: String(o.HoVaTen || ''), email: String(o.EmailCaNhan || ''), sdt: phone_(o.SoDienThoai),
      donVi: String(o['DonVi/ChiNhanh'] || ''), truong: String(o.TenTruong || ''), trangThaiLV: String(o.TrangThaiLamViec || ''),
      status: st, ngayNop: h ? dtStr(h.NgayNop) : '', ts: h && h.NgayNop instanceof Date ? h.NgayNop.getTime() : 0,
      hasRequest: !!ySet[k],
    });
  }
  const rank = {}; rank[ST.CHO_DUYET] = 0; rank[ST.MO_SUA] = 1; rank[ST.TU_CHOI] = 2; rank[ST.NHAP] = 3; rank[ST.CHUA] = 4; rank[ST.DA_DUYET] = 5;
  out.sort(function (a, b) {
    const r = (rank[a.status] || 9) - (rank[b.status] || 9);
    if (r) return r;
    if (a.status === ST.CHO_DUYET) return a.ts - b.ts;
    return a.hoTen.localeCompare(b.hoTen, 'vi');
  });
  const limit = Math.min(Number(p.limit) || 300, 1000);
  return { total: out.length, items: out.slice(0, limit) };
}

function api_hrGetProfile(p, ctx) {
  const nv = requireHrAccess_(ctx, p.maNV);
  const s = state_(p.maNV);
  const logT = table_(CONFIG.SHEET_LOG);
  const logs = findAll_(logT, 'MaNhanVien', p.maNV).slice(-30).reverse().map(function (r) {
    return { t: dtStr(r.rec.ThoiGian), a: String(r.rec.HanhDong || ''), u: String(r.rec.NguoiThucHien || ''), d: String(r.rec.ChiTiet || '') };
  });
  const reqs = findAll_(table_(CONFIG.SHEET_YC), 'MaNhanVien', p.maNV).reverse().map(function (r) {
    return { id: r.rec.MaYeuCau, lyDo: String(r.rec.LyDo || ''), trangThai: r.rec.TrangThai, phanHoi: String(r.rec.PhanHoi || ''), ngayTao: dtStr(r.rec.NgayTao), nguoiXuLy: String(r.rec.NguoiXuLy || '') };
  });
  return {
    nv: nvPublic_(nv),
    status: s.status,
    data: withDefaults_(s.data, nv),
    current: s.cn ? cnToData_(s.cn) : null,
    received: recvFromCn_(s.cn),
    ghiChuNS: s.hoso ? String(s.hoso.rec.GhiChuNS || '') : '',
    ghiChuNV: s.hoso ? String(s.hoso.rec.GhiChuNV || '') : '',
    ngayNop: s.hoso ? dtStr(s.hoso.rec.NgayNop) : '',
    nguoiDuyet: s.hoso ? String(s.hoso.rec.NguoiDuyet || '') : '',
    ngayDuyet: s.hoso ? dtStr(s.hoso.rec.NgayDuyet) : '',
    requests: reqs,
    logs: logs,
  };
}

/** Nhân sự duyệt hồ sơ (hoặc sửa trực tiếp) và lưu vào ThongTinCaNhan */
function api_hrSave(p, ctx) {
  const nv = requireHrAccess_(ctx, p.maNV);
  const s = state_(p.maNV);
  const clean = withDefaults_(sanitize_(p.data, s.data, p.maNV), nv);
  const errs = validate_(clean, false);
  if (errs.length) throw new Error('Dữ liệu chưa hợp lệ:\n• ' + errs.join('\n• '));
  checkDuplicateCccd_(p.maNV, clean.SoCCCD);
  writeCN_(nv, clean, p.received || null, ctx.email);
  const wasPending = s.status === ST.CHO_DUYET;
  saveHoSo_(nv, {
    TrangThai: ST.DA_DUYET, DuLieu: clean, GhiChuNS: String(p.note || '').slice(0, 1000),
    NguoiDuyet: ctx.email, NgayDuyet: new Date(),
  });
  log_(p.maNV, wasPending ? 'DUYET' : 'NS_CAP_NHAT', ctx.email, p.note || '');
  if (wasPending) sendEmployeeMail_(nv, 'Hồ sơ của bạn đã được duyệt',
    'Phòng Nhân sự đã duyệt và lưu hồ sơ của bạn.' + (p.note ? '<br>Ghi chú: ' + escHtml(p.note) : ''));
  return { status: ST.DA_DUYET };
}

function api_hrReject(p, ctx) {
  const nv = requireHrAccess_(ctx, p.maNV);
  const s = state_(p.maNV);
  const note = String(p.note || '').trim();
  if (s.status !== ST.CHO_DUYET) throw new Error('Hồ sơ không ở trạng thái chờ duyệt.');
  if (!note) throw new Error('Vui lòng ghi rõ nội dung nhân viên cần bổ sung/chỉnh sửa.');
  saveHoSo_(nv, { TrangThai: ST.TU_CHOI, GhiChuNS: note.slice(0, 1000), NguoiDuyet: ctx.email, NgayDuyet: new Date() });
  log_(p.maNV, 'TRA_LAI', ctx.email, note);
  sendEmployeeMail_(nv, 'Hồ sơ cần bổ sung', 'Phòng Nhân sự đề nghị bạn bổ sung/chỉnh sửa hồ sơ:<br><b>' + escHtml(note) + '</b>');
  return { status: ST.TU_CHOI };
}

/** Nhân sự chủ động mở hồ sơ để nhân viên tự chỉnh sửa */
function api_hrUnlock(p, ctx) {
  const nv = requireHrAccess_(ctx, p.maNV);
  const s = state_(p.maNV);
  if (EDITABLE_ST.indexOf(s.status) >= 0) throw new Error('Hồ sơ đang ở trạng thái nhân viên có thể sửa.');
  const note = String(p.note || '').trim() || 'Nhân sự đã mở hồ sơ để bạn cập nhật.';
  saveHoSo_(nv, { TrangThai: ST.MO_SUA, DuLieu: withDefaults_(s.data, nv), GhiChuNS: note.slice(0, 1000) });
  log_(p.maNV, 'MO_CHINH_SUA', ctx.email, note);
  sendEmployeeMail_(nv, 'Hồ sơ đã được mở để cập nhật', escHtml(note));
  return { status: ST.MO_SUA };
}

function api_hrEditRequests(p, ctx) {
  const yT = table_(CONFIG.SHEET_YC);
  const nvT = table_(CONFIG.SHEET_NV);
  const nvIdx = {};
  nvT.rows.forEach(function (r) { nvIdx[norm(r[nvT.idx.MaNhanVien])] = rec_(nvT, r); });
  const want = p.status || 'CHO_XU_LY';
  const out = [];
  yT.rows.forEach(function (r) {
    const o = rec_(yT, r);
    if (want !== 'ALL' && o.TrangThai !== want) return;
    const nv = nvIdx[norm(o.MaNhanVien)];
    if (!nv || !hrCanSee_(ctx, nv)) return;
    out.push({
      id: String(o.MaYeuCau), maNV: String(o.MaNhanVien), hoTen: String(o.HoVaTen || nv.HoVaTen || ''),
      donVi: String(nv['DonVi/ChiNhanh'] || ''), lyDo: String(o.LyDo || ''), trangThai: o.TrangThai,
      phanHoi: String(o.PhanHoi || ''), ngayTao: dtStr(o.NgayTao), nguoiXuLy: String(o.NguoiXuLy || ''),
      ts: o.NgayTao instanceof Date ? o.NgayTao.getTime() : 0,
    });
  });
  out.sort(function (a, b) { return b.ts - a.ts; });
  return out.slice(0, 300);
}

function api_hrResolveRequest(p, ctx) {
  const yT = table_(CONFIG.SHEET_YC);
  const f = find_(yT, 'MaYeuCau', p.id);
  if (!f) throw new Error('Không tìm thấy yêu cầu.');
  if (f.rec.TrangThai !== 'CHO_XU_LY') throw new Error('Yêu cầu này đã được xử lý.');
  const nv = requireHrAccess_(ctx, f.rec.MaNhanVien);
  const note = String(p.note || '').trim();
  if (!p.accept && !note) throw new Error('Vui lòng nhập lý do từ chối.');
  writeRow_(yT, f.rowNum, { TrangThai: p.accept ? 'CHAP_NHAN' : 'TU_CHOI', PhanHoi: note, NguoiXuLy: ctx.email, NgayXuLy: new Date() });
  if (p.accept) {
    const s = state_(f.rec.MaNhanVien);
    saveHoSo_(nv, { TrangThai: ST.MO_SUA, DuLieu: withDefaults_(s.data, nv), GhiChuNS: note || ('Đã mở chỉnh sửa theo yêu cầu: ' + f.rec.LyDo) });
    sendEmployeeMail_(nv, 'Yêu cầu chỉnh sửa đã được chấp nhận',
      'Bạn có thể vào ứng dụng để chỉnh sửa hồ sơ, sau đó bấm <b>Nộp hồ sơ</b> để Nhân sự duyệt lại.' + (note ? '<br>Ghi chú: ' + escHtml(note) : ''));
  } else {
    sendEmployeeMail_(nv, 'Yêu cầu chỉnh sửa chưa được chấp nhận', 'Phản hồi từ Nhân sự: ' + escHtml(note));
  }
  log_(f.rec.MaNhanVien, p.accept ? 'CHAP_NHAN_YC' : 'TU_CHOI_YC', ctx.email, note);
  return { ok: true };
}

function api_hrAddEmployee(p, ctx) {
  const d = p.data || {};
  const vals = {};
  NV_FIELDS.forEach(function (f) {
    let v = String(d[f.key] == null ? '' : d[f.key]).trim().slice(0, 500);
    if (f.required && !v) throw new Error(f.label + ' là bắt buộc.');
    if (f.type === 'date') v = v ? toDate(v) : '';
    if (f.type === 'tel') v = v.replace(/[\s.]/g, '');
    vals[f.key] = v;
  });
  vals.EmailCaNhan = norm(vals.EmailCaNhan);
  if (!isEmail(vals.EmailCaNhan)) throw new Error('Email cá nhân không hợp lệ.');
  if (ctx.scope && ctx.scope.length && !hrCanSee_(ctx, vals)) throw new Error('Đơn vị/Chi nhánh không thuộc phạm vi bạn quản lý.');

  const t = table_(CONFIG.SHEET_NV);
  if (find_(t, 'MaNhanVien', vals.MaNhanVien)) throw new Error('Mã nhân viên ' + vals.MaNhanVien + ' đã tồn tại.');
  const blocked = CONFIG.BLOCKED_WORK_STATUS.map(norm);
  const dup = findAll_(t, 'EmailCaNhan', vals.EmailCaNhan).filter(function (r) { return blocked.indexOf(norm(r.rec.TrangThaiLamViec)) < 0; });
  if (dup.length) throw new Error('Email này đang được dùng cho nhân viên ' + dup[0].rec.MaNhanVien + ' – ' + dup[0].rec.HoVaTen + '.');

  vals.Ten = lastName(vals.HoVaTen);
  vals.NgayTao = new Date();
  vals.NguoiTao = ctx.email;
  vals.NgayCapNhat = new Date();
  vals.NguoiCapNhat = ctx.email;
  appendRow_(t, 'MaNhanVien', vals);
  log_(vals.MaNhanVien, 'THEM_NHAN_VIEN', ctx.email, vals.HoVaTen + ' – ' + vals.EmailCaNhan);
  let invited = false;
  if (p.sendInvite) { sendInviteMail_(vals); invited = true; }
  return { maNV: vals.MaNhanVien, invited: invited };
}

function api_hrSendInvite(p, ctx) {
  const nv = requireHrAccess_(ctx, p.maNV);
  if (!isEmail(nv.EmailCaNhan)) throw new Error('Nhân viên chưa có email cá nhân hợp lệ.');
  sendInviteMail_(nv);
  log_(p.maNV, 'GUI_LOI_MOI', ctx.email, nv.EmailCaNhan);
  return { ok: true };
}

function notifyHr_(nv, subject, html) {
  try {
    const t = table_(CONFIG.SHEET_QUYEN);
    const to = [];
    t.rows.forEach(function (r) {
      const o = rec_(t, r);
      const active = o.KichHoat === '' || truthy_(o.KichHoat);
      if (!active || !truthy_(o.NhanThongBao) || !isEmail(o.Email)) return;
      const scope = String(o.PhamVi || '').split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(String);
      if (!hrCanSee_({ scope: scope }, nv)) return;
      to.push(String(o.Email).trim());
    });
    if (to.length) queueMail(() => sendMail(to.join(','), subject, mailTpl(subject, '<p>' + html + '</p>', true)));
  } catch (e) { console.error('notifyHr_', e); }
}


/* ===================== Đăng nhập (OTP qua email, phiên bằng JWT) ===================== */
function authError_(msg) {
  const e = new Error(msg || 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  e.code = 'AUTH';
  return e;
}

function api_requestOtp(p) {
  const email = norm(p.email);
  if (!isEmail(email)) throw new Error('Email không hợp lệ.');
  if (cache.get('OTPW_' + email)) throw new Error('Vui lòng chờ ' + CONFIG.OTP_RESEND_SECONDS + ' giây trước khi gửi lại mã.');
  const dayKey = 'OTPD_' + email;
  const sentToday = Number(cache.get(dayKey) || 0);
  if (sentToday >= 10) throw new Error('Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau.');
  const user = resolveUser_(email);
  if (!user.role && !user.maNV) {
    if (user.blocked) throw new Error('Tài khoản của bạn đã ngừng hoạt động. Vui lòng liên hệ phòng Nhân sự.');
    throw new Error('Email này chưa được Nhân sự đăng ký trong hệ thống. Vui lòng liên hệ phòng Nhân sự.');
  }
  const code = String(require('crypto').randomInt(100000, 1000000));
  cache.put('OTP_' + email, JSON.stringify({ code, tries: 0 }), CONFIG.OTP_TTL_MIN * 60);
  cache.put('OTPW_' + email, '1', CONFIG.OTP_RESEND_SECONDS);
  cache.put(dayKey, String(sentToday + 1), 6 * 3600);
  sendOtpMail_(email, user.name, code);
  return { sent: true, ttlMin: CONFIG.OTP_TTL_MIN };
}

function api_verifyOtp(p) {
  const email = norm(p.email);
  const code = String(p.code || '').replace(/\D/g, '');
  const raw = cache.get('OTP_' + email);
  if (!raw) throw new Error('Mã đã hết hạn. Vui lòng gửi lại mã mới.');
  const o = JSON.parse(raw);
  if (o.code !== code) {
    o.tries++;
    if (o.tries >= CONFIG.OTP_MAX_TRIES) { cache.remove('OTP_' + email); throw new Error('Nhập sai quá số lần cho phép. Vui lòng gửi lại mã mới.'); }
    cache.put('OTP_' + email, JSON.stringify(o), CONFIG.OTP_TTL_MIN * 60);
    throw new Error('Mã không đúng. Còn ' + (CONFIG.OTP_MAX_TRIES - o.tries) + ' lần thử.');
  }
  cache.remove('OTP_' + email);
  const user = resolveUser_(email);
  if (!user.role && !user.maNV) throw new Error('Tài khoản không còn hiệu lực.');
  const token = jwt.sign({ e: email, j: uuid() }, CONFIG.SESSION_SECRET, { expiresIn: CONFIG.SESSION_HOURS * 3600 });
  log_(user.maNV, 'DANG_NHAP', email, user.role || 'NV');
  return { token };
}

/** Kiểm tra token. Quyền được đọc lại từ sheet ở mỗi request nên thu hồi quyền có hiệu lực ngay. */
function requireSession_(token, need) {
  let payload;
  try { payload = jwt.verify(String(token || ''), CONFIG.SESSION_SECRET); } catch (e) { throw authError_(); }
  if (cache.get('REVOKED_' + payload.j)) throw authError_();
  const s = resolveUser_(payload.e);
  if (!s.role && !s.maNV) throw authError_('Tài khoản không còn hiệu lực.');
  s.jti = payload.j;
  if (need === 'HR' && !s.role) throw new Error('Bạn không có quyền nhân sự.');
  if (need === 'NV' && !s.maNV) throw new Error('Tài khoản của bạn không gắn với hồ sơ nhân viên nào.');
  return s;
}

function api_logout(p, ctx) {
  cache.put('REVOKED_' + ctx.jti, '1', CONFIG.SESSION_HOURS * 3600);
  return true;
}

function api_me(p, ctx) {
  return {
    user: { email: ctx.email, name: ctx.name, role: ctx.role, maNV: ctx.maNV, scope: ctx.scope },
    sections: SECTIONS,
    fields: FIELDS,
    nvFields: ctx.role ? NV_FIELDS : [],
    config: { appName: CONFIG.APP_NAME, orgName: CONFIG.ORG_NAME, maxFileMb: CONFIG.MAX_FILE_MB },
  };
}

module.exports = {
  isFileField_, getNV_, editableState_, requireHrAccess_, requireSession_, fileVal_,
  api_requestOtp, api_verifyOtp, api_logout, api_me,
  api_getMyProfile, api_saveDraft, api_submit, api_withdraw, api_requestEdit,
  api_hrMeta, api_hrList, api_hrGetProfile, api_hrSave, api_hrReject, api_hrUnlock,
  api_hrEditRequests, api_hrResolveRequest, api_hrAddEmployee, api_hrSendInvite,
};
