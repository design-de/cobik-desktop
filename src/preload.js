// สะพานระหว่างแผง (หน้าเว็บ) กับ main process
// หน้าแผงเห็นได้แค่ window.cobik — ไม่มี node, ไม่มี ipcRenderer ดิบ
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cobik', {
  // v2 = โฟลเดอร์แยกตามโปรเจกต์ (folders.list คืนเป็น object) + คำถามขออนุญาต
  // v3 = อัปเดตแอปจากในแอป
  // แผงอยู่บนเว็บ จึงเจอเปลือกรุ่นเก่าได้ → แผงต้องเช็คก่อนเรียกของใหม่เสมอ
  version: 3,

  // สถานะเปลือก (ไว้ให้หน้าแผงเช็คว่าเวอร์ชันสะพานตรงกันไหม)
  getState: () => ipcRenderer.invoke('cobik:get-state'),
  setAskMode: (v) => ipcRenderer.invoke('cobik:set-ask-mode', v),

  // สั่งฝั่งซ้าย
  reloadWeb: () => ipcRenderer.invoke('cobik:reload-web'),
  navigate: (pathname) => ipcRenderer.invoke('cobik:navigate', pathname),
  setPanelWidth: (w) => ipcRenderer.invoke('cobik:set-panel-width', w),

  // หุบ/กางแผง + ลากขอบปรับความกว้าง
  togglePanel: (v) => ipcRenderer.invoke('cobik:toggle-panel', v),
  isPanelOpen: () => ipcRenderer.invoke('cobik:panel-open'),
  retryPanel: () => ipcRenderer.invoke('cobik:retry-panel'),
  dragStart: () => ipcRenderer.invoke('cobik:drag-start'),
  dragEnd: () => ipcRenderer.invoke('cobik:drag-end'),
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

  // ฝั่งซ้ายเปลี่ยนหน้า → แผงรู้ (เฟส 2)
  onWebUrl: (cb) => {
    const h = (_e, url) => cb(url);
    ipcRenderer.on('cobik:web-url', h);
    return () => ipcRenderer.removeListener('cobik:web-url', h);
  },

  // ── อัปเดตแอป ──
  update: {
    state: () => ipcRenderer.invoke('cobik:update-state'),
    check: () => ipcRenderer.invoke('cobik:update-check'),
    install: () => ipcRenderer.invoke('cobik:update-install'),
    open: () => ipcRenderer.invoke('cobik:update-open'),
    onState: (cb) => {
      const h = (_e, v) => cb(v);
      ipcRenderer.on('cobik:update', h);
      return () => ipcRenderer.removeListener('cobik:update', h);
    },
  },

  // ── สิทธิ์เข้า cobik ──
  auth: {
    status: () => ipcRenderer.invoke('cobik:auth-status'),
    connect: () => ipcRenderer.invoke('cobik:auth-connect'),
    clear: () => ipcRenderer.invoke('cobik:auth-clear'),
  },

  // ── โฟลเดอร์ + ไฟล์ ──
  // ทั้งสามตัวคืน { scope, folders } — ขอบเขตเปลี่ยนตามโปรเจกต์ที่เปิดอยู่ฝั่งซ้าย
  folders: {
    list: () => ipcRenderer.invoke('cobik:folders-list'),
    add: () => ipcRenderer.invoke('cobik:folders-add'),
    remove: (p) => ipcRenderer.invoke('cobik:folders-remove', p),
    // ฝั่งซ้ายย้ายโปรเจกต์ → ชุดโฟลเดอร์เปลี่ยนเอง แผงไม่ต้องถามซ้ำ
    onChange: (cb) => {
      const h = (_e, v) => cb(v);
      ipcRenderer.on('cobik:folders', h);
      return () => ipcRenderer.removeListener('cobik:folders', h);
    },
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
  // ตอบคำถามขออนุญาต — answer: 'allow' | 'always' | 'deny'
  answerAsk: (id, answer) => ipcRenderer.invoke('cobik:answer-ask', { id, answer }),
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
