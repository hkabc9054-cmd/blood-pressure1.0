const TOKEN = '請改成你自己的密碼';
/*
  血壓記錄 — Google Drive 同步（Google Apps Script）
  ------------------------------------------------------------
  部署步驟：
  1. 打開 https://script.google.com → 新增專案，貼上本檔全部內容。
  2. 把第一行的 TOKEN 改成你自己的密碼（App 內要填同一個）。
  3. 右上角「部署」→「新增部署作業」→ 類型選「網頁應用程式」：
       執行身分：我
       誰可以存取：任何人
     按「部署」，第一次會要求授權 Drive 權限，按允許。
  4. 複製「網頁應用程式網址」（結尾是 /exec），貼到 App「設定 → Google Drive 同步」。
  5. 以後改過這份程式碼，要「部署 → 管理部署作業 → 編輯 → 新版本」才會生效。

  資料存放：你的 Drive →「血壓記錄」資料夾 → bp-data.json
  每次覆蓋前，舊版本會存到「血壓記錄/備份」資料夾（保留最近 10 份）。
*/
const FOLDER_NAME = '血壓記錄';
const BACKUP_FOLDER_NAME = '備份';
const DATA_FILE = 'bp-data.json';
const BACKUP_KEEP = 10;
const DEFAULT_TOKEN = '請改成你自己的密碼';

function doGet() {
  return out_({ ok: true, service: '血壓記錄同步服務', message: '運作中。請在 App 的設定頁填入此網址。' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad_request' }); }
  if (TOKEN === DEFAULT_TOKEN || !TOKEN) return out_({ ok: false, error: 'token_not_set' });
  if (!req || req.token !== TOKEN) return out_({ ok: false, error: 'auth' });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    switch (req.action) {
      case 'ping':
      case 'status': {
        const cur = readCurrent_();
        return out_({ ok: true, exists: !!cur, updatedAt: cur ? cur.updatedAt : null, deviceId: cur ? cur.deviceId : null, count: cur ? countOf_(cur) : 0 });
      }
      case 'download': {
        const cur = readCurrent_();
        if (!cur) return out_({ ok: true, exists: false });
        return out_({ ok: true, exists: true, updatedAt: cur.updatedAt, deviceId: cur.deviceId, data: cur.data });
      }
      case 'upload': {
        if (!req.data || !Array.isArray(req.data.records)) return out_({ ok: false, error: 'bad_request', message: '資料格式不正確' });
        const cur = readCurrent_();
        // 雲端的版本與這部裝置上次同步時看到的不同 → 代表另一部裝置改過，先不覆蓋
        if (cur && !req.force && cur.updatedAt !== (req.expectedUpdatedAt || null)) {
          return out_({ ok: false, error: 'conflict', meta: { updatedAt: cur.updatedAt, deviceId: cur.deviceId, count: countOf_(cur) } });
        }
        if (cur) backup_(cur);
        const stamp = new Date().toISOString();
        const doc = { updatedAt: stamp, deviceId: req.deviceId || '', data: req.data };
        writeCurrent_(doc);
        return out_({ ok: true, updatedAt: stamp, count: req.data.records.length });
      }
      default:
        return out_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return out_({ ok: false, error: 'server', message: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ---------- 工具 ---------- */
function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function countOf_(doc) { return doc && doc.data && Array.isArray(doc.data.records) ? doc.data.records.length : 0; }

function folder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}
function subFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function dataFile_() {
  const it = folder_().getFilesByName(DATA_FILE);
  return it.hasNext() ? it.next() : null;
}
function readCurrent_() {
  const f = dataFile_();
  if (!f) return null;
  try { return JSON.parse(f.getBlob().getDataAsString('UTF-8')); }
  catch (e) { return { updatedAt: 'corrupt', deviceId: '', data: { records: [] } }; }
}
function writeCurrent_(doc) {
  const text = JSON.stringify(doc);
  const f = dataFile_();
  if (f) f.setContent(text);
  else folder_().createFile(DATA_FILE, text, 'application/json');
}
function backup_(doc) {
  const bf = subFolder_(folder_(), BACKUP_FOLDER_NAME);
  const name = 'bp-data-' + String(doc.updatedAt).replace(/[:.]/g, '-') + '.json';
  bf.createFile(name, JSON.stringify(doc), 'application/json');
  // 只保留最近 BACKUP_KEEP 份
  const files = [], it = bf.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getName() < a.getName() ? -1 : b.getName() > a.getName() ? 1 : 0; });
  for (let i = BACKUP_KEEP; i < files.length; i++) files[i].setTrashed(true);
}
