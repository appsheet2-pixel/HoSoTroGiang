/**
 * Điểm vào web app + bộ điều phối API.
 * Client gọi: google.script.run.api(action, token, payload) -> chuỗi JSON {ok, data | error}
 */
function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  t.appName = CONFIG.APP_NAME;
  return t.evaluate()
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// role: null = công khai, 'ANY' = đã đăng nhập, 'NV' = nhân viên, 'HR' = nhân sự
const ROUTES = {
  requestOtp: { role: null, fn: api_requestOtp },
  verifyOtp: { role: null, fn: api_verifyOtp },
  me: { role: 'ANY', fn: api_me },
  logout: { role: 'ANY', fn: api_logout },

  getMyProfile: { role: 'NV', fn: api_getMyProfile },
  saveDraft: { role: 'NV', fn: api_saveDraft },
  submit: { role: 'NV', fn: api_submit },
  withdraw: { role: 'NV', fn: api_withdraw },
  requestEdit: { role: 'NV', fn: api_requestEdit },
  uploadFile: { role: 'NV', fn: api_uploadFile },

  hrMeta: { role: 'HR', fn: api_hrMeta },
  hrList: { role: 'HR', fn: api_hrList },
  hrGetProfile: { role: 'HR', fn: api_hrGetProfile },
  hrSave: { role: 'HR', fn: api_hrSave },
  hrReject: { role: 'HR', fn: api_hrReject },
  hrUnlock: { role: 'HR', fn: api_hrUnlock },
  hrEditRequests: { role: 'HR', fn: api_hrEditRequests },
  hrResolveRequest: { role: 'HR', fn: api_hrResolveRequest },
  hrAddEmployee: { role: 'HR', fn: api_hrAddEmployee },
  hrSendInvite: { role: 'HR', fn: api_hrSendInvite },
  hrUploadFile: { role: 'HR', fn: api_hrUploadFile },
};

const WRITE_ACTIONS = ['saveDraft', 'submit', 'withdraw', 'requestEdit', 'hrSave', 'hrReject', 'hrUnlock', 'hrResolveRequest', 'hrAddEmployee'];

function api(action, token, payload) {
  let lock = null;
  _tables = {};
  try {
    const r = ROUTES[action];
    if (!r) throw new Error('Thao tác không hợp lệ: ' + action);
    const ctx = r.role ? requireSession_(token, r.role) : null;
    if (WRITE_ACTIONS.indexOf(action) >= 0) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) throw new Error('Hệ thống đang bận, vui lòng thử lại sau ít giây.');
    }
    const data = r.fn(payload || {}, ctx);
    if (lock) SpreadsheetApp.flush();
    return JSON.stringify({ ok: true, data: data === undefined ? null : data });
  } catch (e) {
    console.error(action, e && e.stack || e);
    return JSON.stringify({ ok: false, error: String(e && e.message || e), code: e && e.code || '' });
  } finally {
    if (lock) try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
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

function appUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}
