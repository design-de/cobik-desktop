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

  // หุบ/กางแผง + ลากขอบปรับความกว้าง
  togglePanel: (v) => ipcRenderer.invoke('cobik:toggle-panel', v),
  isPanelOpen: () => ipcRenderer.invoke('cobik:panel-open'),
  dragStart: () => ipcRenderer.invoke('cobik:drag-start'),
  dragEnd: () => ipcRenderer.invoke('cobik:drag-end'),
  onCollapsed: (cb) => {
    const h = (_e, v) => cb(v);
    ipcRenderer.on('cobik:collapsed', h);
    return () => ipcRenderer.removeListener('cobik:collapsed', h);
  },

  // ฝั่งซ้ายเปลี่ยนหน้า → แผงรู้ (เฟส 2)
  onWebUrl: (cb) => {
    const h = (_e, url) => cb(url);
    ipcRenderer.on('cobik:web-url', h);
    return () => ipcRenderer.removeListener('cobik:web-url', h);
  },

  // ── สิทธิ์เข้า Cowork ──
  auth: {
    status: () => ipcRenderer.invoke('cobik:auth-status'),
    connect: () => ipcRenderer.invoke('cobik:auth-connect'),
    clear: () => ipcRenderer.invoke('cobik:auth-clear'),
  },

  // ── โฟลเดอร์ + ไฟล์ ──
  folders: {
    list: () => ipcRenderer.invoke('cobik:folders-list'),
    add: () => ipcRenderer.invoke('cobik:folders-add'),
    remove: (p) => ipcRenderer.invoke('cobik:folders-remove', p),
  },
  pickFiles: () => ipcRenderer.invoke('cobik:pick-files'),

  // ── คุยกับ Claude ──
  warmup: () => ipcRenderer.invoke('cobik:warmup'),

  // ── บทสนทนาที่เก็บไว้ ──
  chats: {
    list: (archived) => ipcRenderer.invoke('cobik:chats', archived),
    open: (id) => ipcRenderer.invoke('cobik:chat-open', id),
    rename: (id, value) => ipcRenderer.invoke('cobik:chat-action', { action: 'rename', id, value }),
    archive: (id) => ipcRenderer.invoke('cobik:chat-action', { action: 'archive', id }),
    restore: (id) => ipcRenderer.invoke('cobik:chat-action', { action: 'restore', id }),
    remove: (id) => ipcRenderer.invoke('cobik:chat-action', { action: 'delete', id }),
  },

  ask: (prompt, context, model, effort) => ipcRenderer.invoke('cobik:ask', { prompt, context, model, effort }),
  stop: () => ipcRenderer.invoke('cobik:stop'),
  newChat: () => ipcRenderer.invoke('cobik:new-chat'),
  agentState: () => ipcRenderer.invoke('cobik:agent-state'),
  setModel: (m) => ipcRenderer.invoke('cobik:set-model', m),
  models: () => ipcRenderer.invoke('cobik:models'),
  commands: () => ipcRenderer.invoke('cobik:commands'),
  onAgent: (cb) => {
    const h = (_e, ev) => cb(ev);
    ipcRenderer.on('cobik:agent', h);
    return () => ipcRenderer.removeListener('cobik:agent', h);
  },
});
