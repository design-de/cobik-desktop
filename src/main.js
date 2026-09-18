// Cobik Desktop — main process
// หน้าต่างเดียว แบ่งสองฝั่ง: ซ้าย = เว็บ cobik ของจริง · ขวา = แผง Claude
// ทั้งสองฝั่งเป็น WebContentsView คนละตัว → เว็บแอปไม่ต้องรู้จักแผง และแผงไม่ต้องเบียดเว็บ
const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog } = require('electron');
const path = require('node:path');
const oauth = require('./oauth');
const agent = require('./agent');
const store = require('./folders');

// skill 6 ตัวของ cobik ที่ติดมากับแอป (ดู scripts/sync-skills.mjs)
// แอปไม่ได้ pack เป็น asar (ตั้งไว้ใน package.json) → ที่อยู่เดียวกันทั้งตอนพัฒนาและตอนเป็นแอปจริง
// ต้องเป็นโฟลเดอร์ที่ "อ่านได้จากโปรเซสลูก" ด้วย เพราะ Claude Code เป็นคนอ่าน ไม่ใช่เรา
const PLUGIN_DIR = path.join(__dirname, '..', 'skills-plugin');
const plugins = require('node:fs').existsSync(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'))
  ? [{ type: 'local', path: PLUGIN_DIR, skipMcpDiscovery: true }]   // MCP เราต่อเองแล้ว plugin ไม่ต้องต่อซ้ำ
  : [];

// ที่อยู่ของเว็บ — ลำดับ: ตัวแปรตอนรัน → ค่าที่จำไว้ (ui.json) → ค่าตั้งต้น
//
// ทำไมไม่ฝังตายตัว: ถ้าเปลี่ยนชื่อโปรเจกต์บน Vercel หรือย้ายไปโดเมนของตัวเอง
// URL prod จะเปลี่ยน แล้วแอปที่แจกไปแล้วทุกเครื่องจะชี้ผิดทันที ต้องออกเวอร์ชันใหม่
// ให้ทุกคนอัปเดต · เก็บไว้ในไฟล์ตั้งค่าแทน = แก้ได้โดยไม่ต้อง build ใหม่
// (ทางที่ดีที่สุดคือผูกโดเมนของตัวเองให้เสร็จก่อน แล้ว URL จะไม่เปลี่ยนอีกเลย)
const DEFAULT_URL = 'https://cowork-app-tau.vercel.app';
let TARGET = DEFAULT_URL;
function resolveTarget(prefs) {
  if (process.env.COBIK_TARGET === 'local') return 'http://localhost:3000';
  if (process.env.COBIK_URL) return process.env.COBIK_URL;
  return prefs?.appUrl || DEFAULT_URL;
}

const PANEL_WIDTH = 420;
const PANEL_MIN = 320;
const PANEL_MAX = 900;
const MIN_WEB_WIDTH = 480;

let win = null;
let webView = null;   // ซ้าย: cobik
let panelView = null; // ขวา: แผง Claude

// แผงผู้ช่วยไม่ใช่พระเอกของแอป — งานคือพระเอก
// จึง "เริ่มแบบหุบเสมอในครั้งแรก" แล้วค่อยขึ้นมาเมื่อผู้ใช้กดเอง (ไอคอน ✨ บน Topbar / ⌘/)
// หลังจากนั้นจำสถานะล่าสุดไว้ — เปิดค้างไว้ก็ยังเปิดอยู่ครั้งหน้า
const prefsFile = () => require('node:path').join(app.getPath('userData'), 'ui.json');
function loadPrefs() {
  try { return JSON.parse(require('node:fs').readFileSync(prefsFile(), 'utf8')); }
  catch { return { collapsed: true, panelWidth: PANEL_WIDTH }; }
}
function savePrefs() {
  try {
    require('node:fs').mkdirSync(app.getPath('userData'), { recursive: true });
    const keep = loadPrefs();
    require('node:fs').writeFileSync(prefsFile(), JSON.stringify({ ...keep, collapsed, panelWidth }));
  } catch {}
}

let panelWidth = PANEL_WIDTH;
let collapsed = true;

// cookie ของ Supabase ต้องอยู่ข้ามการปิด-เปิดแอป → partition ถาวรชื่อเดียวตลอด
const PARTITION = 'persist:cobik';

function layout() {
  if (!win || !webView || !panelView) return;
  const { width, height } = win.getContentBounds();
  // หุบ = หายไปเลย ไม่เหลือแถบกินที่ — ทางกลับคือไอคอนบน Topbar ของ cobik หรือ ⌘/
  const pw = collapsed ? 0 : Math.min(panelWidth, Math.max(PANEL_MIN, width - MIN_WEB_WIDTH));
  webView.setBounds({ x: 0, y: 0, width: width - pw, height });
  panelView.setBounds({ x: width - pw, y: 0, width: pw, height });
}

function setCollapsed(v) {
  collapsed = typeof v === 'boolean' ? v : !collapsed;
  layout();
  // บอกทั้งสองฝั่ง — แผงใช้ตัดสินว่าจะจุด Claude ไหม · เว็บใช้ทำสถานะปุ่ม ✨
  panelView?.webContents.send('cobik:collapsed', collapsed);
  webView?.webContents.send('cobik:collapsed', collapsed);
  savePrefs();
  return collapsed;
}

// ลากขอบซ้ายของแผงเพื่อปรับความกว้าง
// แผงกับเว็บเป็นคนละ view — ลากออกนอกแผงแล้ว mousemove หายไป
// จึงให้ main อ่านตำแหน่งเคอร์เซอร์จากระบบแทน ระหว่างที่ผู้ใช้ยังกดอยู่
let dragTimer = null;
function startDrag() {
  if (dragTimer) return;
  const { screen } = require('electron');
  dragTimer = setInterval(() => {
    if (!win) return stopDrag();
    const pt = screen.getCursorScreenPoint();
    const b = win.getContentBounds();
    const w = Math.round(b.x + b.width - pt.x);
    panelWidth = Math.max(PANEL_MIN, Math.min(PANEL_MAX, w));
    if (collapsed) collapsed = false;
    layout();
  }, 16);
}
function stopDrag() { clearInterval(dragTimer); dragTimer = null; }

function loadPanel() {
  panelView?.webContents.loadURL(`${TARGET}/desktop/panel`);
}

function createWindow() {
  const prefs = loadPrefs();
  TARGET = resolveTarget(prefs);
  collapsed = prefs.collapsed !== false;              // ไม่เคยเปิดมาก่อน = หุบไว้
  panelWidth = Number(prefs.panelWidth) || PANEL_WIDTH;

  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: MIN_WEB_WIDTH + 320,
    minHeight: 600,
    title: 'Cobik',
    // ปุ่มปิด/ย่อ/ขยายลอยบนเนื้อหา ไม่กินแถบเต็มความสูง
    // Topbar ของ cobik เว้นที่ให้ทางซ้ายเมื่อรู้ว่าอยู่ในเปลือก (ดู components/Topbar.jsx)
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#1a1a1a',
  });

  // ── ซ้าย: เว็บ cobik ของจริง ──
  // ต่อสะพานตัวเล็กให้ด้วย เพื่อให้ Topbar รู้ว่าอยู่ในแอป (ซ่อน AiChat เดิม)
  // และให้ไอคอน ✨ สั่งหุบ/กางแผงข้างขวาได้
  webView = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-web.js'),
    },
  });
  win.contentView.addChildView(webView);
  webView.webContents.loadURL(TARGET);

  // ── ขวา: แผง Claude ──
  panelView = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.contentView.addChildView(panelView);
  // แผงเป็นหน้าของเว็บ (ได้ระบบดีไซน์ + tr() + cookie session)
  // src/panel/index.html เป็นหน้าสำรองตอนโหลดจากเว็บไม่ได้ — มีแค่ข้อความกับปุ่มลองใหม่
  loadPanel();
  panelView.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (url.includes('/desktop/panel')) {
      console.warn('โหลดแผงจากเว็บไม่สำเร็จ → ใช้หน้าสำรอง:', code, desc);
      panelView.webContents.loadFile(path.join(__dirname, 'panel', 'index.html'));
    }
  });

  layout();
  win.on('resize', layout);

  // เปลือกรู้ว่าฝั่งซ้ายเปิดหน้าไหนอยู่ → ส่งให้แผงเป็น "บริบท" (เฟส 2 จะใช้จริง)
  const pushUrl = () => {
    const url = webView.webContents.getURL();
    panelView.webContents.send('cobik:web-url', url);
    syncScope(url);
  };
  webView.webContents.on('did-navigate', pushUrl);
  webView.webContents.on('did-navigate-in-page', pushUrl);

  win.on('closed', () => { win = null; webView = null; panelView = null; });
}

// ── ช่องทางที่แผงเรียกกลับมาหา main ──
ipcMain.handle('cobik:get-state', () => ({
  bridgeVersion: 1,
  target: TARGET,
  webUrl: webView ? webView.webContents.getURL() : null,
  collapsed,
  panelWidth,
}));

ipcMain.handle('cobik:reload-web', () => {
  if (webView) webView.webContents.reload();
});

ipcMain.handle('cobik:navigate', (_e, pathname) => {
  if (!webView || typeof pathname !== 'string') return false;
  const next = new URL(pathname, TARGET);
  // กันหลุดออกนอกโดเมนของเราเอง
  if (next.origin !== new URL(TARGET).origin) return false;
  webView.webContents.loadURL(next.toString());
  return true;
});

ipcMain.handle('cobik:set-panel-width', (_e, w) => {
  panelWidth = Math.max(PANEL_MIN, Math.min(PANEL_MAX, Number(w) || PANEL_WIDTH));
  collapsed = false;
  layout(); savePrefs();
  return panelWidth;
});

ipcMain.handle('cobik:toggle-panel', (_e, v) => setCollapsed(v));
ipcMain.handle('cobik:panel-open', () => !collapsed);

// ปุ่ม "ลองใหม่" บนหน้าสำรอง — โหลดแผงจากเว็บอีกครั้ง
// (reload หน้าสำรองเฉย ๆ จะได้หน้าสำรองซ้ำ ไม่ได้กลับไปลองของจริง)
ipcMain.handle('cobik:retry-panel', async () => {
  if (!panelView) return false;
  try { await panelView.webContents.loadURL(`${TARGET}/desktop/panel`); return true; }
  catch { return false; }   // did-fail-load จะพากลับไปหน้าสำรองเอง
});
ipcMain.handle('cobik:drag-start', () => { startDrag(); });
ipcMain.handle('cobik:drag-end', () => { stopDrag(); savePrefs(); return panelWidth; });

// ── เชื่อม cobik (OAuth) ──
ipcMain.handle('cobik:auth-status', () => oauth.status());

ipcMain.handle('cobik:auth-connect', async () => {
  try {
    const rec = await oauth.connect(TARGET, { interactive: true });
    return { ok: true, scope: rec.scope };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('cobik:auth-clear', () => { oauth.clear(); agent.reset(); return true; });

// ── โฟลเดอร์ในเครื่อง + ไฟล์แนบ ──
// จำแยกตามโปรเจกต์ที่เปิดอยู่ฝั่งซ้าย และจำข้ามการปิด-เปิดแอป (ดู src/folders.js)
let scope = { key: store.GLOBAL };
const folders = () => store.list(scope.key);

/** บอกแผงว่าตอนนี้ขอบเขตไหน มีโฟลเดอร์อะไร และชุดนี้ตรงกับบทสนทนาที่คุยอยู่ไหม */
function pushFolders() {
  const st = agent.state('main');
  panelView?.webContents.send('cobik:folders', {
    scope: scope.key,
    folders: folders(),
    // บทสนทนาที่เปิดค้างอยู่ใช้โฟลเดอร์ชุดเก่า → แผงขึ้นบรรทัดบอกว่าจะมีผลรอบหน้า
    stale: st.alive && st.turns > 0 && !store.same(st.folders, folders()),
  });
}

/**
 * ฝั่งซ้ายเปลี่ยนโปรเจกต์ → สลับชุดโฟลเดอร์ตาม
 * ถ้ายังไม่ได้คุยอะไรในห้องนี้เลย ปิดห้องเงียบ ๆ ให้ห้องใหม่ได้โฟลเดอร์ที่ถูก
 * (ถ้าคุยไปแล้วไม่แตะ — ตัดบทสนทนาของคนอื่นทิ้งกลางคันเป็นเรื่องที่ยอมไม่ได้)
 */
function syncScope(url) {
  const next = store.scopeOf(url);
  if (next.key === scope.key) return;
  scope = next;
  const st = agent.state('main');
  if (st.alive && !st.busy && st.turns === 0 && !store.same(st.folders, folders())) agent.reset('main');
  pushFolders();
}

ipcMain.handle('cobik:folders-list', () => ({ scope: scope.key, folders: folders() }));

ipcMain.handle('cobik:folders-add', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'เลือกโฟลเดอร์ให้ Claude อ่านได้',
    properties: ['openDirectory', 'multiSelections', 'createDirectory'],
  });
  if (r.canceled) return { scope: scope.key, folders: folders() };
  store.add(scope.key, r.filePaths);
  agent.reset(); // โฟลเดอร์เป็นค่าตอนเปิด session → ต้องเปิดห้องใหม่ให้มีผล
  return { scope: scope.key, folders: folders() };
});

ipcMain.handle('cobik:folders-remove', (_e, p) => {
  store.remove(scope.key, p);
  agent.reset();
  return { scope: scope.key, folders: folders() };
});

ipcMain.handle('cobik:pick-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'แนบไฟล์',
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths;
});

// ── ขออนุญาตก่อนแตะเครื่องของผู้ใช้ ──
// เครื่องยนต์ของ Claude Code จะเรียก canUseTool เมื่อจะทำสิ่งที่ย้อนกลับยาก
// (เขียนไฟล์ · แก้ไฟล์ · รันคำสั่ง) เราส่งต่อให้แผงถามเป็นภาษาคน แล้วรอคำตอบ
//
// tool ของ cobik เองไม่ถาม — ผู้ใช้กด "อนุญาตให้ Cobi" ตอนเชื่อมบัญชีไปแล้วครั้งหนึ่ง
// และทุกการแก้ถูกบันทึกในประวัติของแอปอยู่แล้ว · การถามซ้ำทุกครั้งจะทำให้ใช้งานไม่ได้จริง
const AUTO_ALLOW = /^mcp__cobik__/;

const asks = new Map();
let askSeq = 0;

/** สรุปสิ่งที่กำลังจะทำให้อ่านได้ในบรรทัดเดียว */
function describeAsk(tool, input = {}) {
  const t = String(tool);
  if (t === 'Bash') return String(input.command || '');
  if (/^(Write|Edit|NotebookEdit|Read)$/.test(t)) return String(input.file_path || input.notebook_path || '');
  if (t === 'WebFetch') return String(input.url || '');
  const first = Object.values(input).find((v) => typeof v === 'string');
  return first ? String(first).slice(0, 300) : '';
}

async function canUseTool(toolName, input, opts = {}) {
  if (AUTO_ALLOW.test(toolName)) return { behavior: 'allow' };
  if (!panelView || panelView.webContents.isDestroyed()) {
    return { behavior: 'deny', message: 'ยังไม่ได้รับอนุญาตจากผู้ใช้' };
  }
  // คำถามที่ไม่มีใครเห็นคือคำถามที่ไม่มีวันได้คำตอบ — กางแผงขึ้นมาก่อน
  if (collapsed) setCollapsed(false);

  const id = `ask${++askSeq}`;
  return new Promise((resolve) => {
    const finish = (result) => {
      if (!asks.has(id)) return;
      asks.delete(id);
      try { opts.signal?.removeEventListener('abort', onAbort); } catch {}
      // บอกแผงเสมอ ไม่ว่าคำตอบมาจากผู้ใช้หรือจากการยกเลิก — การ์ดจะได้ไม่ค้างเป็นปุ่มกดไม่ได้
      toPanel({ type: 'ask-done', id, answer: result.behavior });
      resolve(result);
    };
    const onAbort = () => finish({ behavior: 'deny', message: 'ยกเลิกแล้ว' });
    asks.set(id, { finish, suggestions: opts.suggestions || [] });
    try { opts.signal?.addEventListener('abort', onAbort, { once: true }); } catch {}

    toPanel({
      type: 'ask',
      id,
      tool: toolName,
      title: opts.title || null,
      // ปุ่ม "อนุญาตตลอด" มีได้เฉพาะเมื่อเครื่องยนต์บอกว่ากฎที่จะเขียนไม่กว้างเกินคำขอนี้
      canAlways: !opts.suppressAlwaysAllowRule && (opts.suggestions || []).length > 0,
      defaultToNo: !!opts.defaultToNo,
      detail: describeAsk(toolName, input),
    });
  });
}

ipcMain.handle('cobik:answer-ask', (_e, { id, answer }) => {
  const a = asks.get(id);
  if (!a) return false;
  if (answer === 'allow') a.finish({ behavior: 'allow' });
  else if (answer === 'always') a.finish({ behavior: 'allow', updatedPermissions: a.suggestions });
  else a.finish({ behavior: 'deny', message: 'ผู้ใช้ไม่อนุญาตให้ทำสิ่งนี้' });
  return true;
});

/** ปิดคำถามที่ค้างทั้งหมด — ใช้ตอนกดหยุด เริ่มบทสนทนาใหม่ หรือสลับบทสนทนา */
function clearAsks() {
  for (const a of [...asks.values()]) a.finish({ behavior: 'deny', message: 'ยกเลิกแล้ว' });
}

// ── ถาม Claude ──
function toPanel(ev) {
  if (panelView && !panelView.webContents.isDestroyed()) panelView.webContents.send('cobik:agent', ev);
}

ipcMain.handle('cobik:ask', async (_e, { prompt, context, model, effort }) => {
  let rec;
  try {
    rec = await oauth.connect(TARGET, { interactive: false });
    if (!rec) return { ok: false, error: 'not_connected' };
  } catch (e) {
    return { ok: false, error: e?.message || 'ต่ออายุสิทธิ์ไม่สำเร็จ' };
  }

  try {
    const r = agent.send('main', prompt, {
      base: TARGET, token: rec.access_token, context, model, effort,
      folders: folders(), plugins, canUseTool, onEvent: toPanel,
    });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// เปิด session ค้างไว้เพื่อถามรายชื่อโมเดลของบัญชีนี้ (ไม่เสียเงิน — จ่ายตอนส่งข้อความ)
ipcMain.handle('cobik:warmup', async () => {
  try {
    const rec = await oauth.connect(TARGET, { interactive: false });
    if (!rec) return { ok: false, error: 'not_connected' };
    const r = await agent.warmup('main', {
      base: TARGET, token: rec.access_token, folders: folders(), plugins, canUseTool, onEvent: toPanel,
    });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// ── บทสนทนาที่เก็บไว้ ──
async function authed() {
  const rec = await oauth.connect(TARGET, { interactive: false });
  return rec ? { base: TARGET, token: rec.access_token, folders: folders(), plugins, canUseTool, onEvent: toPanel } : null;
}

ipcMain.handle('cobik:chats', (_e, archived) => agent.listChats({ archived }));
ipcMain.handle('cobik:chat-action', (_e, { action, id, value }) => agent.chatAction(action, id, value));
ipcMain.handle('cobik:chat-open', async (_e, id) => {
  clearAsks();
  const o = await authed();
  if (!o) return { ok: false, error: 'not_connected' };
  const history = await agent.openChat('main', id, o);
  return { ok: true, history };
});

ipcMain.handle('cobik:stop', () => { clearAsks(); return agent.stop('main'); });
ipcMain.handle('cobik:new-chat', () => { clearAsks(); agent.reset('main'); return true; });
ipcMain.handle('cobik:agent-state', () => agent.state('main'));
ipcMain.handle('cobik:set-model', (_e, m) => agent.setModel('main', m));
ipcMain.handle('cobik:models', () => agent.models('main'));
ipcMain.handle('cobik:commands', () => agent.commands('main'));

function buildMenu() {
  const { Menu } = require('electron');
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'มุมมอง',
      submenu: [
        { label: 'ซ่อน/แสดงแผง Claude', accelerator: 'CmdOrCtrl+/', click: () => setCollapsed() },
        { type: 'separator' },
        { label: 'แผงแคบ',  accelerator: 'CmdOrCtrl+1', click: () => { panelWidth = 340; collapsed = false; layout(); savePrefs(); } },
        { label: 'แผงกลาง', accelerator: 'CmdOrCtrl+2', click: () => { panelWidth = 460; collapsed = false; layout(); savePrefs(); } },
        { label: 'แผงกว้าง', accelerator: 'CmdOrCtrl+3', click: () => { panelWidth = 640; collapsed = false; layout(); savePrefs(); } },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(() => {
  buildMenu();
  store.init(app.getPath('userData'));
  // ให้ session ของ partition นี้ใช้ user-agent ปกติ (บางเว็บกันบล็อก webview)
  session.fromPartition(PARTITION);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
