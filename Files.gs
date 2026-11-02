/**
 * Lưu file nhân viên tải lên vào Google Drive: <thư mục gốc>/<MaNV_HoTen>/<MaNV>_<Truong>_<thoigian>.<ext>
 */
const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

function safeName_(s) {
  return fold_(s).replace(/[^a-z0-9_\-]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 80) || 'file';
}

function rootFolder_() {
  const id = CONFIG.UPLOAD_FOLDER_ID || PropertiesService.getScriptProperties().getProperty('UPLOAD_FOLDER_ID');
  if (!id) throw new Error('Chưa cấu hình thư mục lưu file. Quản trị viên hãy chạy hàm setup().');
  return DriveApp.getFolderById(id);
}

function empFolder_(nv) {
  const props = PropertiesService.getScriptProperties();
  const key = 'F_' + nv.MaNhanVien;
  const id = props.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* tạo lại */ } }
  const root = rootFolder_();
  const name = safeName_(nv.MaNhanVien + '_' + nv.HoVaTen);
  const it = root.getFoldersByName(name);
  const folder = it.hasNext() ? it.next() : root.createFolder(name);
  props.setProperty(key, folder.getId());
  return folder;
}

function doUpload_(nv, p) {
  const f = FIELDS.filter(function (x) { return x.key === p.field && isFileField_(x); })[0];
  if (!f) throw new Error('Trường tải lên không hợp lệ.');
  const mime = String(p.mime || '').toLowerCase();
  if (!MIME_EXT[mime]) throw new Error('Chỉ chấp nhận ảnh (JPG, PNG), PDF hoặc Word.');
  if (f.type === 'image' && mime.indexOf('image/') !== 0) throw new Error(f.label + ' phải là file ảnh.');
  const bytes = Utilities.base64Decode(String(p.base64 || '').replace(/^data:[^,]*,/, ''));
  if (!bytes.length) throw new Error('File rỗng.');
  if (bytes.length > CONFIG.MAX_FILE_MB * 1024 * 1024) throw new Error('File vượt quá ' + CONFIG.MAX_FILE_MB + 'MB.');

  const folder = empFolder_(nv);
  const fileName = safeName_(nv.MaNhanVien) + '_' + f.key + '_' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss') + '.' + MIME_EXT[mime];
  const file = folder.createFile(Utilities.newBlob(bytes, mime, fileName));
  try { file.setDescription('Tải lên từ web app: ' + String(p.name || '').slice(0, 200)); } catch (e) { /* ignore */ }
  const url = file.getUrl();
  const v = CONFIG.APPSHEET_PATH_PREFIX ? CONFIG.APPSHEET_PATH_PREFIX + folder.getName() + '/' + fileName : url;
  cache_().put('UPL_' + file.getId(), String(nv.MaNhanVien), 21600);
  return { v: v, url: url, name: String(p.name || fileName).slice(0, 200), id: file.getId() };
}

function api_uploadFile(p, ctx) {
  editableState_(ctx.maNV);
  return doUpload_(getNV_(ctx.maNV), p);
}

function api_hrUploadFile(p, ctx) {
  return doUpload_(requireHrAccess_(ctx, p.maNV), p);
}
