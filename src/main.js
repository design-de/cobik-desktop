// Cobik Desktop — main process
// หน้าต่างเดียว แบ่งสองฝั่ง: ซ้าย = เว็บ Cowork ของจริง · ขวา = แผง Claude
// ทั้งสองฝั่งเป็น WebContentsView คนละตัว → เว็บแอปไม่ต้องรู้จักแผง และแผงไม่ต้องเบียดเว็บ
const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog } = require('electron');
const path = require('node:path');
const oauth = require('./oauth');
const agent = require('./agent');

const TARGET = process.env.COBIK_TARGET === 'local'
  ? 'http://localhost:3000'
  : 'https://cowork-app-tau.vercel.app';

const PANEL_WIDTH = 420;
const MIN_WEB_WIDTH = 560;

let win = null;
let webView = null;   // ซ้าย: Cowork
let panelView = null; // ขวา: แผง Claude
let panelWidth = PANEL_WIDTH;

// cookie ของ Supabase ต้องอยู่ข้ามการปิด-เปิดแอป → partition ถาวรชื่อเดียวตลอด
const PARTITION = 'persist:cobik';

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  const pw = Math.min(panelWidth, Math.max(0, width - MIN_WEB_WIDTH));
  webView.setBounds({ x: 0, y: 0, width: width - pw, height });
  panelView.setBounds({ x: width - pw, y: 0, width: pw, height });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: MIN_WEB_WIDTH + 320,
    minHeight: 600,
    title: 'Cobik',
    titleBarStyle: 'hiddenInset', // ปุ่มจราจร macOS ลอยบนเนื้อหา ไม่กินแถบเต็ม
    backgroundColor: '#1a1a1a',
  });

  // ── ซ้าย: เว็บ Cowork ของจริง ──
  webView = new WebContentsView({
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false },
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
  panelView.webContents.loadFile(path.join(__dirname, 'panel', 'index.html'));

  layout();
  win.on('resize', layout);

  // เปลือกรู้ว่าฝั่งซ้ายเปิดหน้าไหนอยู่ → ส่งให้แผงเป็น "บริบท" (เฟส 2 จะใช้จริง)
  const pushUrl = () => {
    const url = webView.webContents.getURL();
    panelView.webContents.send('cobik:web-url', url);
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
  panelWidth = Math.max(320, Math.min(900, Number(w) || PANEL_WIDTH));
  layout();
  return panelWidth;
});

// ── เชื่อม Cowork (OAuth) ──
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
// เก็บไว้ในหน่วยความจำของรอบนี้ก่อน (เฟสถัดไปจะจำต่อโปรเจกต์)
let folders = [];

ipcMain.handle('cobik:folders-list', () => folders);

ipcMain.handle('cobik:folders-add', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'เลือกโฟลเดอร์ให้ Claude อ่านได้',
    properties: ['openDirectory', 'multiSelections', 'createDirectory'],
  });
  if (r.canceled) return folders;
  for (const p of r.filePaths) if (!folders.includes(p)) folders.push(p);
  agent.reset(); // โฟลเดอร์เป็นค่าตอนเปิด session → ต้องเปิดห้องใหม่ให้มีผล
  return folders;
});

ipcMain.handle('cobik:folders-remove', (_e, p) => {
  folders = folders.filter((f) => f !== p);
  agent.reset();
  return folders;
});

ipcMain.handle('cobik:pick-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'แนบไฟล์',
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths;
});

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
      base: TARGET, token: rec.access_token, context, model, effort, folders, onEvent: toPanel,
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
      base: TARGET, token: rec.access_token, folders, onEvent: toPanel,
    });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('cobik:stop', () => agent.stop('main'));
ipcMain.handle('cobik:new-chat', () => { agent.reset('main'); return true; });
ipcMain.handle('cobik:agent-state', () => agent.state('main'));
ipcMain.handle('cobik:set-model', (_e, m) => agent.setModel('main', m));
ipcMain.handle('cobik:models', () => agent.models('main'));

app.whenReady().then(() => {
  // ให้ session ของ partition นี้ใช้ user-agent ปกติ (บางเว็บกันบล็อก webview)
  session.fromPartition(PARTITION);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
