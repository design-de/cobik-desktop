// สะพานฝั่ง "เว็บ cobik" (หน้าต่างซ้าย) — เล็กกว่าฝั่งแผงมาก
//
// เว็บต้องรู้แค่สองอย่าง:
//   1) ตอนนี้เปิดอยู่ในแอป Cobik นะ (→ ซ่อน AiChat เดิม ไม่ให้มีผู้ช่วยสองตัว)
//   2) สั่งหุบ/กางแผงข้างขวาได้ (ไอคอน ✨ บน Topbar)
//
// ไม่เปิดของอื่นให้เลย (ask / chats / folders / auth) — นั่นเป็นเรื่องของแผง
// หน้าเว็บมีโค้ดเยอะและมีของที่คนอื่นเขียน ยิ่งให้น้อยยิ่งปลอดภัย
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cobik', {
  version: 2,
  surface: 'web',
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
