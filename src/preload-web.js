// สะพานฝั่ง "เว็บ cobik" (หน้าต่างซ้าย) — เล็กกว่าฝั่งแผงมาก
//
// เว็บต้องรู้แค่สามอย่าง:
//   1) ตอนนี้เปิดอยู่ในแอป Cobik นะ (→ ซ่อน AiChat เดิม ไม่ให้มีผู้ช่วยสองตัว)
//   2) สั่งหุบ/กางแผงข้างขวาได้ (ไอคอน ✨ บน Topbar)
//   3) รับคำสั่งเรื่อง canvas จาก Cobi — เพราะ canvas เก็บใน localStorage ของหน้าเว็บ
//      ฝั่งแผงกับ main process เอื้อมไม่ถึง ต้องให้หน้าเว็บเป็นคนลงมือ
//      (ทางเดิน: เครื่องมือของ Cobi → main → ตรงนี้ → components/DesktopCanvasBridge.jsx)
//
// ไม่เปิดของอื่นให้เลย (ask / chats / folders / auth) — นั่นเป็นเรื่องของแผง
// หน้าเว็บมีโค้ดเยอะและมีของที่คนอื่นเขียน ยิ่งให้น้อยยิ่งปลอดภัย
const { contextBridge, ipcRenderer } = require('electron');

// ผู้รับคำสั่ง canvas ฝั่งหน้าเว็บ — มีตัวเดียว ลงทะเบียนตอนหน้าเว็บ mount
let canvasHandler = null;

ipcRenderer.on('cobik:canvas-op', async (_e, req) => {
  const reply = (r) => ipcRenderer.send('cobik:canvas-op-reply', { rid: req.rid, ...r });
  if (!canvasHandler) {
    reply({ ok: false, error: 'หน้าเว็บ cobik ยังไม่พร้อม — ให้ผู้ใช้เปิดแอปค้างไว้แล้วลองใหม่' });
    return;
  }
  try {
    reply({ ok: true, data: await canvasHandler(req.op, req.args || {}) });
  } catch (e) {
    reply({ ok: false, error: e?.message || String(e) });
  }
});

contextBridge.exposeInMainWorld('cobik', {
  version: 4,
  // เวอร์ชันของตัวแอป (อ่านอย่างเดียว) — เรื่องอัปเดตยังเป็นของแถบเมนู macOS เหมือนเดิม
  appVersion: () => ipcRenderer.invoke('cobik:app-version'),
  surface: 'web',
  canvas: {
    onOp: (cb) => {
      canvasHandler = cb;
      return () => { if (canvasHandler === cb) canvasHandler = null; };
    },
  },
  togglePanel: (v) => ipcRenderer.invoke('cobik:toggle-panel', v),
  isPanelOpen: () => ipcRenderer.invoke('cobik:panel-open'),
  isFullscreen: () => ipcRenderer.invoke('cobik:is-fullscreen'),
  onFullscreen: (cb) => {
    const h = (_e, v) => cb(v);
    ipcRenderer.on('cobik:fullscreen', h);
    return () => ipcRenderer.removeListener('cobik:fullscreen', h);
  },
  onCollapsed: (cb) => {
    const h = (_e, v) => cb(v);
    ipcRenderer.on('cobik:collapsed', h);
    return () => ipcRenderer.removeListener('cobik:collapsed', h);
  },
});
