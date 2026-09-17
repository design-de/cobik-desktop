// สะพานระหว่างแผง (หน้าเว็บ) กับ main process
// หน้าแผงเห็นได้แค่ window.cobik — ไม่มี node, ไม่มี ipcRenderer ดิบ
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cobik', {
  version: 1,

  // สถานะเปลือก (ไว้ให้หน้าแผงเช็คว่าเวอร์ชันสะพานตรงกันไหม)
  getState: () => ipcRenderer.invoke('cobik:get-state'),

  // สั่งฝั่งซ้าย
  reloadWeb: () => ipcRenderer.invoke('cobik:reload-web'),
  navigate: (pathname) => ipcRenderer.invoke('cobik:navigate', pathname),
  setPanelWidth: (w) => ipcRenderer.invoke('cobik:set-panel-width', w),

  // ฝั่งซ้ายเปลี่ยนหน้า → แผงรู้ (เฟส 2)
  onWebUrl: (cb) => {
    const h = (_e, url) => cb(url);
    ipcRenderer.on('cobik:web-url', h);
    return () => ipcRenderer.removeListener('cobik:web-url', h);
  },
});
