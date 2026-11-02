/**
 * Lưu file lên Google Drive: <thư mục gốc>/<MaNV_HoTen>/<MaNV>_<Truong>_<thoigian>.<ext>
 * và phục vụ xem file qua máy chủ (chỉ nhân sự hoặc chính nhân viên đó mới xem được).
 */
const { Readable } = require('stream');
const { CONFIG, FIELDS } = require('./config');
const { fold, formatDate, cache } = require('./util');
const g = require('./google');
const L = require('./logic');

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const folderIds = new Map();

function safeName(s) {
  return fold(s).replace(/[^a-z0-9_-]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 80) || 'file';
}

async function empFolder(nv) {
  const key = String(nv.MaNhanVien);
  if (folderIds.has(key)) return folderIds.get(key);
  if (!CONFIG.UPLOAD_FOLDER_ID) throw new Error('Chưa cấu hình UPLOAD_FOLDER_ID.');
  const name = safeName(nv.MaNhanVien + '_' + nv.HoVaTen);
  const d = g.drive();
  const r = await d.files.list({
    q: `'${CONFIG.UPLOAD_FOLDER_ID}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)', supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: 'allDrives', pageSize: 1,
  });
  let f = r.data.files && r.data.files[0];
  if (!f) {
    const c = await d.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [CONFIG.UPLOAD_FOLDER_ID] }, fields: 'id,name', supportsAllDrives: true });
    f = c.data;
  }
  folderIds.set(key, f);
  return f;
}

async function doUpload(nv, p) {
  const f = FIELDS.find(x => x.key === p.field && L.isFileField_(x));
  if (!f) throw new Error('Trường tải lên không hợp lệ.');
  const mime = String(p.mime || '').toLowerCase();
  if (!MIME_EXT[mime]) throw new Error('Chỉ chấp nhận ảnh (JPG, PNG), PDF hoặc Word.');
  if (f.type === 'image' && mime.indexOf('image/') !== 0) throw new Error(f.label + ' phải là file ảnh.');
  const buf = Buffer.from(String(p.base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw new Error('File rỗng.');
  if (buf.length > CONFIG.MAX_FILE_MB * 1024 * 1024) throw new Error('File vượt quá ' + CONFIG.MAX_FILE_MB + 'MB.');

  const folder = await empFolder(nv);
  const fileName = safeName(nv.MaNhanVien) + '_' + f.key + '_' + formatDate(new Date(), 'yyyyMMdd_HHmmss') + '.' + MIME_EXT[mime];
  const r = await g.drive().files.create({
    requestBody: { name: fileName, parents: [folder.id], description: 'Tải lên từ web app: ' + String(p.name || '').slice(0, 200), appProperties: { maNV: String(nv.MaNhanVien), field: f.key } },
    media: { mimeType: mime, body: Readable.from(buf) },
    fields: 'id,webViewLink', supportsAllDrives: true,
  });
  const id = r.data.id;
  const url = r.data.webViewLink || ('https://drive.google.com/file/d/' + id + '/view');
  const v = CONFIG.APPSHEET_PATH_PREFIX ? CONFIG.APPSHEET_PATH_PREFIX + folder.name + '/' + fileName : url;
  cache.put('UPL_' + id, String(nv.MaNhanVien), 21600);
  return { v, url, name: String(p.name || fileName).slice(0, 200), id };
}

async function api_uploadFile(p, ctx) {
  L.editableState_(ctx.maNV);
  return doUpload(L.getNV_(ctx.maNV), p);
}
async function api_hrUploadFile(p, ctx) {
  return doUpload(L.requireHrAccess_(ctx, p.maNV), p);
}

/** Kiểm tra quyền và trả về luồng nội dung file */
async function openFile(id, ctx) {
  if (!/^[\w-]{10,}$/.test(String(id))) throw new Error('Mã file không hợp lệ.');
  const d = g.drive();
  const m = await d.files.get({ fileId: id, fields: 'id,name,mimeType,appProperties', supportsAllDrives: true });
  const owner = m.data.appProperties && m.data.appProperties.maNV;
  if (ctx.role) {
    if (owner) L.requireHrAccess_(ctx, owner);
    else if (ctx.role !== 'ADMIN' && ctx.scope && ctx.scope.length) throw new Error('Không có quyền xem file này.');
  } else if (!owner || String(owner) !== String(ctx.maNV)) {
    throw new Error('Không có quyền xem file này.');
  }
  const s = await d.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
  return { name: m.data.name, mimeType: m.data.mimeType, stream: s.data };
}

module.exports = { api_uploadFile, api_hrUploadFile, openFile, safeName };
