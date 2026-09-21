// Cobik Desktop — main process
// หน้าต่างเดียว แบ่งสองฝั่ง: ซ้าย = เว็บ cobik ของจริง · ขวา = แผง Claude
// ทั้งสองฝั่งเป็น WebContentsView คนละตัว → เว็บแอปไม่ต้องรู้จักแผง และแผงไม่ต้องเบียดเว็บ
const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog } = require('electron');
const path = require('node:path');
const oauth = require('./oauth');
const agent = require('./agent');
const store = require('./folders');
const updater = require('./update');
const perms = require('./permissions');

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
// เขียนทับเฉพาะคีย์ที่ส่งมา — ค่าอื่นในไฟล์ (เช่น appUrl, updateSeen) ต้องไม่หาย
function patchPrefs(patch) {
  try {
    require('node:fs').mkdirSync(app.getPath('userData'), { recursive: true });
    require('node:fs').writeFileSync(prefsFile(), JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {}
}

function savePrefs() {
  try {
    require('node:fs').mkdirSync(app.getPath('userData'), { recursive: true });
    const keep = loadPrefs();
    require('node:fs').writeFileSync(prefsFile(), JSON.stringify({ ...keep, collapsed, panelWidth, askMode }));
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
  if (ASK_MODES.includes(prefs.askMode)) askMode = prefs.askMode;

  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: MIN_WEB_WIDTH + 320,
    minHeight: 600,
    title: 'Cobik',
    // ปุ่มปิด/ย่อ/ขยายลอยบนเนื้อหา ไม่กินแถบเต็มความสูง
    // เปลือกเว็บเว้นแถบว่างด้านบนให้ปุ่มพวกนี้เมื่อรู้ว่าอยู่ในแอป (ดู components/AppChrome.jsx + lib/shellTop.js)
    titleBarStyle: 'hiddenInset',
    // y11 ให้ปุ่มอยู่กึ่งกลางแถบว่าง 34px ของหน้าเว็บพอดี (ดู cowork-app/lib/shellTop.js)
    // ขยับค่านี้ = ต้องขยับ SHELL_TOP_PX ให้เท่ากัน ไม่งั้นปุ่มจะลอยสูง/ต่ำกว่ากลางแถบ
    trafficLightPosition: { x: 16, y: 11 },
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

  /* เต็มจอ = macOS ซ่อนปุ่มปิด/ย่อ/ขยาย → หน้าเว็บไม่ต้องเว้นแถบว่างไว้ให้มันอีก
     ต้องเป็นสัญญาณจากเปลือก เพราะฝั่งเว็บเดาเองไม่ได้ (จอมีรอยบากทำให้ขนาดหน้าต่างตอนเต็มจอ
     ไม่เท่ากับขนาดจอ การเทียบความสูงจึงเชื่อไม่ได้) */
  const pushFullscreen = () => {
    const v = win.isFullScreen();
    webView?.webContents.send('cobik:fullscreen', v);
    panelView?.webContents.send('cobik:fullscreen', v);
  };
  win.on('enter-full-screen', pushFullscreen);
  win.on('leave-full-screen', pushFullscreen);
  webView.webContents.on('did-finish-load', pushFullscreen);
  panelView.webContents.on('did-finish-load', pushFullscreen);

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

ipcMain.handle('cobik:is-fullscreen', () => !!win?.isFullScreen());

// ── ช่องทางที่แผงเรียกกลับมาหา main ──
ipcMain.handle('cobik:get-state', () => ({
  bridgeVersion: 1,
  target: TARGET,
  webUrl: webView ? webView.webContents.getURL() : null,
  collapsed,
  panelWidth,
  askMode,
}));

ipcMain.handle('cobik:set-ask-mode', (_e, v) => {
  if (ASK_MODES.includes(v)) { askMode = v; savePrefs(); }
  return askMode;
});

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
// เครื่องยนต์ของ Claude Code เรียก canUseTool เมื่อจะทำสิ่งที่ย้อนกลับยาก
// (เขียนไฟล์ · แก้ไฟล์ · รันคำสั่ง) เราตัดสินจาก "สิทธิ์ที่ผู้ใช้ให้ไว้" ก่อน (src/permissions.js)
// เหลือเท่าที่ยังไม่เคยให้ ค่อยส่งต่อให้แผงถามเป็นภาษาคน
//
// tool ของ cobik เองไม่ถาม — ผู้ใช้กด "อนุญาตให้ Cobi" ตอนเชื่อมบัญชีไปแล้วครั้งหนึ่ง
// และทุกการแก้ถูกบันทึกในประวัติของแอปอยู่แล้ว · การถามซ้ำทุกครั้งจะทำให้ใช้งานไม่ได้จริง
const AUTO_ALLOW = /^mcp__cobik__/;

// 'auto' = ใช้สิทธิ์ที่ให้ไว้ · 'ask' = ถามทุกครั้งแม้แต่การอ่าน (ผู้ใช้สลับเองได้ในแผง)
const ASK_MODES = ['auto', 'ask'];
let askMode = 'auto';

const asks = new Map();
let askSeq = 0;

/** สรุปสิ่งที่กำลังจะทำให้อ่านได้ในบรรทัดเดียว */
function describeAsk(tool, input = {}) {
  const t = String(tool);
  if (t === 'Bash') return String(input.command || '');
  if (/^(Write|Edit|MultiEdit|NotebookEdit|Read)$/.test(t)) return String(input.file_path || input.notebook_path || '');
  if (t === 'WebFetch') return String(input.url || '');
  const first = Object.values(input).find((v) => typeof v === 'string');
  return first ? String(first).slice(0, 300) : '';
}

/* ── กล่องเดียวจบ ──
   ของเดิมถามทีละใบไปเรื่อย ๆ ตลอดชีวิตการใช้งาน — แก้ไฟล์ 10 ไฟล์ = 10 การ์ด
   ตอนนี้ครั้งแรกที่ Cobi จะแตะเครื่องจริง ๆ จะขึ้น "ชุดสิทธิ์" ให้ตัดสินทีเดียว
   แล้วจำไว้ถาวร (userData/permissions.json — รอดทั้งการปิดแอปและการอัปเดต)

   หลาย tool ขอพร้อมกันได้ → ใช้คำสัญญาก้อนเดียวร่วมกัน ไม่งั้นกล่องซ้อนกันสามสี่ใบ */
let consentBox = null;
function ensureConsent() {
  if (consentBox) return consentBox;
  consentBox = msgBox({
    type: 'none',
    message: 'ให้ Cobi ทำงานในโฟลเดอร์ที่คุณเลือกได้ไหม',
    detail: 'ตอบครั้งเดียวจบ — หลังจากนี้จะไม่ถามเรื่องเดิมซ้ำอีก'
      + '\n\nอนุญาตแล้ว Cobi จะทำสิ่งเหล่านี้ได้เอง'
      + '\n   •  อ่านและค้นไฟล์'
      + '\n   •  สร้างและแก้ไฟล์ เฉพาะในโฟลเดอร์ที่คุณเพิ่มไว้เท่านั้น'
      + '\n   •  จดรายการงานระหว่างทำ'
      + '\n\nสิ่งเหล่านี้ยังถามทุกครั้งเหมือนเดิม'
      + '\n   •  รันคำสั่งในเครื่อง'
      + '\n   •  แก้ไฟล์นอกโฟลเดอร์ที่เพิ่มไว้'
      + '\n   •  เปิดเว็บภายนอก'
      + '\n\nเปลี่ยนใจได้ที่เมนู Cobik → สิทธิ์ที่ให้ไว้',
    buttons: ['อนุญาต', 'ถามทีละครั้ง'],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => perms.setConsent(response === 0 ? 'granted' : 'ask'))
    // กล่องเปิดไม่ขึ้นด้วยเหตุใดก็ตาม ต้องไม่ทำให้คำขอค้างเป็นผี — ถือว่ายังไม่ได้ตอบ แล้วไปขึ้นการ์ดแทน
    .catch(() => perms.consent())
    .finally(() => { consentBox = null; });
  return consentBox;
}

async function canUseTool(toolName, input, opts = {}) {
  if (AUTO_ALLOW.test(toolName)) return { behavior: 'allow' };

  if (askMode === 'auto') {
    if (perms.decide(toolName, input, folders()) === 'allow') return { behavior: 'allow' };
    // ครั้งแรกที่มีของจริงให้ตัดสิน — ถามเป็นชุดเดียว แล้วลองตัดสินใหม่ด้วยสิทธิ์ที่เพิ่งได้
    if (perms.consent() === 'none' && owner()) {
      await ensureConsent();
      if (perms.decide(toolName, input, folders()) === 'allow') return { behavior: 'allow' };
    }
  }

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
    asks.set(id, { finish, tool: toolName, input });
    try { opts.signal?.addEventListener('abort', onAbort, { once: true }); } catch {}

    toPanel({
      type: 'ask',
      id,
      tool: toolName,
      title: opts.title || null,
      // "อนุญาตตลอด" เก็บกฎไว้ในไฟล์ของเราเอง จึงเสนอได้เสมอ
      // เว้นแต่เครื่องยนต์บอกเองว่าคำขอนี้ไม่ควรกลายเป็นกฎ (เช่นคำสั่งที่ประกอบสดจากข้อมูลภายนอก)
      canAlways: !opts.suppressAlwaysAllowRule,
      defaultToNo: !!opts.defaultToNo,
      detail: describeAsk(toolName, input),
    });
  });
}

ipcMain.handle('cobik:answer-ask', (_e, { id, answer }) => {
  const a = asks.get(id);
  if (!a) return false;
  if (answer === 'allow') a.finish({ behavior: 'allow' });
  else if (answer === 'always') {
    perms.grant(a.tool, a.input, folders());
    a.finish({ behavior: 'allow' });
  } else a.finish({ behavior: 'deny', message: 'ผู้ใช้ไม่อนุญาตให้ทำสิ่งนี้' });
  return true;
});

// ── สิทธิ์ที่ให้ไว้: ดูได้ ถอนได้ ──
ipcMain.handle('cobik:permissions', () => perms.state());
ipcMain.handle('cobik:permissions-reset', () => { perms.clearGrants(); perms.setConsent('none'); return perms.state(); });

async function showPermissions() {
  const s = perms.state();
  const head = s.consent === 'granted'
    ? 'Cobi อ่าน สร้าง และแก้ไฟล์ในโฟลเดอร์ที่คุณเพิ่มไว้ได้เอง'
    : s.consent === 'ask'
      ? 'Cobi ถามก่อนทุกครั้งที่จะแตะไฟล์ในเครื่อง'
      : 'ยังไม่ได้ตอบ — จะถามครั้งแรกที่ Cobi ต้องแตะเครื่อง';
  const lines = s.grants.length
    ? s.grants.map((g) => `   •  ${g.label}`).join('\n')
    : '   (ยังไม่มี)';
  const { response } = await msgBox({
    type: 'none',
    message: 'สิทธิ์ที่ให้ Cobi ไว้',
    detail: `${head}\n\nที่กด "อนุญาตตลอด" ไว้\n${lines}`
      + '\n\nกล่องขออนุญาตของ macOS (พวงกุญแจ · โฟลเดอร์ Desktop/Documents) เป็นคนละชุดกัน'
      + '\nถอนได้ที่ System Settings → Privacy & Security',
    buttons: ['ปิด', 'ถอนทั้งหมด'],
    defaultId: 0,
    cancelId: 0,
  });
  if (response === 1) { perms.clearGrants(); perms.setConsent('none'); }
}

/** ปิดคำถามที่ค้างทั้งหมด — ใช้ตอนกดหยุด เริ่มบทสนทนาใหม่ หรือสลับบทสนทนา */
function clearAsks() {
  for (const a of [...asks.values()]) a.finish({ behavior: 'deny', message: 'ยกเลิกแล้ว' });
}

// ── ถาม Claude ──
function toPanel(ev) {
  if (panelView && !panelView.webContents.isDestroyed()) panelView.webContents.send('cobik:agent', ev);
  // init มาถึง = session พร้อมจริง → ยิงรายชื่อโมเดล/skill ตามไปเลย
  // ไม่ปล่อยให้แผงนั่งเดาเวลาเอง (ของเดิมรอ 6 วิแล้วยอมแพ้เงียบ ๆ)
  if (ev?.type === 'init') pushCatalog();
}

async function pushCatalog() {
  try {
    const [models, commands, servers] = await Promise.all([
      agent.models('main'), agent.commands('main'), agent.servers('main'),
    ]);
    if (models.length || commands.length || servers.length) {
      panelView?.webContents.send('cobik:agent', { type: 'catalog', models, commands, servers });
    }
  } catch {}
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
    if (r.timedOut) return { ok: false, error: 'เชื่อมต่อนานผิดปกติ — ลองกดเชื่อมใหม่อีกครั้ง' };
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

// ── อัปเดตแอป ──
// เรื่องอัปเดตเป็นเรื่องของ "ตัวแอป" ไม่ใช่เรื่องของงานและไม่ใช่เรื่องของบทสนทนา
// เปลือกจึงพูดเอง 3 ที่: ป้ายถาวรในเมนูช่วยเหลือ · จุดบน Dock · กล่องข้อความตอนเจอรุ่นใหม่ครั้งแรก
// (เคยเป็นแถบคาดหัวแผง Cobi — ผิดที่ แถมแผงเริ่มแบบหุบ คนที่ไม่เคยกางแผงจึงไม่มีวันเห็น)

let menuLabel = '';        // ป้ายอัปเดตล่าสุดในเมนู — กันไม่ให้สร้างเมนูใหม่ทุกเปอร์เซ็นต์
let lastUpdError = null;   // กันกล่อง error ซ้ำจากสถานะเดิม

const owner = () => (win && !win.isDestroyed() ? win : null);
const msgBox = (opt) => (owner() ? dialog.showMessageBox(owner(), opt) : dialog.showMessageBox(opt));

/** ป้ายในเมนู — เปลี่ยนตามสถานะ แต่ "มีอยู่เสมอ" ไม่ว่าจะมีรุ่นใหม่หรือไม่ */
function updateMenuItem() {
  const s = updater.snapshot();
  if (s.busy) return { label: `กำลังอัปเดต ${Math.round((s.percent || 0) / 5) * 5}%`, enabled: false };
  if (s.available) return { label: `อัปเดตเป็น ${s.latest}…`, click: () => askInstall() };
  return { label: 'ตรวจหาเวอร์ชันใหม่…', click: () => checkNow() };
}

/** จุดบน Dock — ที่เดียวที่เห็นได้โดยไม่ต้องเปิดเมนู และไม่ไปยืนขวางงาน */
function setDockBadge(s) {
  if (process.platform !== 'darwin' || !app.dock) return;
  try { app.dock.setBadge(s.available && !s.busy ? '●' : ''); } catch {}
}

/** กล่องถาม — ขึ้นครั้งเดียวต่อหนึ่งเวอร์ชัน กด "ภายหลัง" แล้วไม่ตามตื๊อทุก 6 ชั่วโมง */
async function askInstall({ auto = false } = {}) {
  const s = updater.snapshot();
  if (!s.available || s.busy) return;
  if (auto) patchPrefs({ updateSeen: s.latest });   // ถือว่าบอกแล้ว ไม่ว่าผู้ใช้จะกดอะไร
  const notes = String(s.notes || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).join('\n');
  const { response } = await msgBox({
    type: 'none',
    message: `Cobik ${s.latest} พร้อมให้อัปเดต`,
    detail: `ตอนนี้ใช้ ${s.current} อยู่\n\nแอปจะปิดแล้วเปิดใหม่ให้เอง ใช้เวลาไม่กี่วินาที`
      + '\nบทสนทนาที่ค้างอยู่กับ Cobi จะเริ่มใหม่'
      // แอปยังเซ็นแบบ ad-hoc → macOS มองว่ารุ่นใหม่เป็นคนละแอป แล้วขอสิทธิ์ที่เคยให้ไว้ใหม่
      // (สิทธิ์ที่ให้ Cobi ไว้ไม่หาย — อันนั้นเก็บในไฟล์ของเราเอง)
      + '\nหลังเปิดใหม่ macOS อาจขอสิทธิ์พวงกุญแจหรือโฟลเดอร์อีกครั้ง กดอนุญาตได้เลย'
      + `${notes ? `\n\nสิ่งที่เปลี่ยน\n${notes}` : ''}`,
    buttons: ['อัปเดตแล้วเปิดใหม่', 'ภายหลัง'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) updater.install();
}

/** ผู้ใช้กดตรวจเอง — ต้องมีคำตอบเสมอ แม้คำตอบคือ "ไม่มีอะไรใหม่" */
async function checkNow() {
  await updater.check({ quiet: false });
  const s = updater.snapshot();
  if (s.available) return askInstall({ auto: true });
  if (s.error) return;                     // ตัวแจ้งสถานะขึ้นกล่อง error ให้แล้ว
  return msgBox({
    type: 'none',
    message: s.packaged ? 'ใช้เวอร์ชันล่าสุดอยู่แล้ว' : 'ตอนพัฒนายังอัปเดตในแอปไม่ได้',
    detail: `Cobik ${s.current}`,
    buttons: ['ตกลง'],
  });
}

function updateFailed(msg) {
  msgBox({
    type: 'warning',
    message: 'อัปเดตไม่สำเร็จ',
    detail: `${msg}\n\nโหลดตัวเต็มจากหน้าดาวน์โหลดแทนได้`,
    buttons: ['เปิดหน้าดาวน์โหลด', 'ปิด'],
    defaultId: 1,
    cancelId: 1,
  }).then(({ response }) => { if (response === 0) updater.openReleases(); });
}

updater.setNotifier(() => {
  const s = updater.snapshot();
  const item = updateMenuItem();
  if (item.label !== menuLabel) { menuLabel = item.label; buildMenu(); }
  setDockBadge(s);
  if (s.error && s.error !== lastUpdError) { lastUpdError = s.error; updateFailed(s.error); }
  if (!s.error) lastUpdError = null;
  // เจอรุ่นใหม่ที่ยังไม่เคยบอก → ถามหนึ่งครั้ง แล้วปล่อยให้เมนูกับจุดบน Dock ทำหน้าที่ต่อ
  if (s.available && !s.busy && loadPrefs().updateSeen !== s.latest) askInstall({ auto: true });
});

ipcMain.handle('cobik:update-state', () => updater.snapshot());
ipcMain.handle('cobik:update-check', async () => { await updater.check({ quiet: false }); return updater.snapshot(); });
ipcMain.handle('cobik:update-install', () => updater.install());
ipcMain.handle('cobik:update-open', () => { updater.openReleases(); return true; });

function buildMenu() {
  const { Menu } = require('electron');
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    // เมนูชื่อแอปเขียนเอง (ไม่ใช้ role:'appMenu' สำเร็จรูป) เพื่อแทรก "สิทธิ์ที่ให้ไว้"
    // ตรงที่ macOS คาดหวังให้เรื่องระดับแอปอยู่ — ไม่ใช่ใต้เมนูช่วยเหลือ
    ...(mac ? [{
      label: 'Cobik',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'สิทธิ์ที่ให้ไว้…', click: () => showPermissions() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
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
    {
      label: 'ช่วยเหลือ',
      submenu: [
        { label: `Cobik ${app.getVersion()}`, enabled: false },
        updateMenuItem(),
        { label: 'เปิดหน้าดาวน์โหลด', click: () => updater.openReleases() },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(() => {
  buildMenu();
  store.init(app.getPath('userData'));
  perms.init(app.getPath('userData'));
  // เช็คเงียบ ๆ — ไม่มีรุ่นใหม่ก็ไม่ต้องบอกอะไร · ล้มเหลวก็ไม่ต้องบอก (เน็ตหลุดไม่ใช่เรื่องของผู้ใช้)
  setTimeout(() => updater.check(), 8000);
  setInterval(() => updater.check(), 6 * 60 * 60 * 1000);
  // ให้ session ของ partition นี้ใช้ user-agent ปกติ (บางเว็บกันบล็อก webview)
  session.fromPartition(PARTITION);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
