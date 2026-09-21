// ตัวเชื่อม Claude — ฝัง Claude Agent SDK ไว้ใน main process
// ไม่มี agent loop ของเราเอง: SDK คือ loop · เราแค่ป้อน prompt + ต่อ MCP + ส่งเหตุการณ์ออกไปให้แผง
//
// auth: ไม่ส่ง credential ใด ๆ → SDK หยิบ login Claude Code ของผู้ใช้ในเครื่องเอง
//
// ทำไมเป็น "streaming input mode" (prompt เป็น async generator ไม่ใช่ string):
//   โหมด string = ยิงครั้งเดียวจบ สั่งหยุดกลางคันไม่ได้ สลับโมเดลกลางทางไม่ได้
//   โหมด stream = session เดียวอยู่ยาว ป้อนข้อความเข้าคิวได้เรื่อย ๆ + interrupt() + setModel()
//   และยังได้ผลพลอยได้: ไม่ต้องเขียนแคช system prompt ใหม่ทุกคำถาม (ประหยัดจริง)
//
// ⚠️ ELECTRON_RUN_AS_NODE ตั้งเฉพาะ "ลูกที่ SDK spawn" ผ่าน options.env เท่านั้น
//    ห้ามตั้งที่ process.env ของ main — จะไหลไปทุก helper ของ Electron แล้วพังทั้งแอป
const CHILD_ENV = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

const path = require('node:path');

const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_EFFORT = 'high';

// โฟลเดอร์ทำงานของบทสนทนา — แยกเป็นของ Cobik เอง
// SDK เก็บ transcript เป็นไฟล์ .jsonl ใต้ ~/.claude/projects/<โฟลเดอร์นี้>/ ให้อยู่แล้ว
// เราจึง "ไม่เก็บซ้ำ" — อ่านรายการผ่าน listSessions() ของ SDK ตรง ๆ
let WORKDIR = process.cwd();
function setWorkdir(p) { WORKDIR = p; }

let sdk = null;
const getSdk = () => (sdk ||= require('@anthropic-ai/claude-agent-sdk'));

// ห้องสนทนา: ตอนนี้ห้องเดียว ('main') — ภายหลังจะเป็นห้องต่อโปรเจกต์
const rooms = new Map();

function mcpConfig(base, token, extra) {
  return {
    // ชื่อ 'cobik' ไม่ใช่ 'cowork' — กันชนกับ connector "claude.ai Cowork" ที่ผู้ใช้อาจเชื่อมไว้เอง
    cobik: { type: 'http', url: `${base}/api/mcp`, headers: { Authorization: `Bearer ${token}` } },
    // เครื่องมือที่รันในตัวแอปเอง (เช่น My Canvas ที่เก็บอยู่ในเบราว์เซอร์ ไม่ใช่ที่เซิร์ฟเวอร์)
    ...(extra || {}),
  };
}

// คิวข้อความขาเข้า: แปลง "ผู้ใช้พิมพ์" เป็น async iterable ที่ SDK ดูดไปเรื่อย ๆ
function makeInbox() {
  const queue = [];
  let wake = null;
  let closed = false;
  return {
    push(msg) { queue.push(msg); wake?.(); wake = null; },
    close() { closed = true; wake?.(); wake = null; },
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        if (queue.length) { yield queue.shift(); continue; }
        await new Promise((r) => { wake = r; });
      }
    },
  };
}

function userMessage(text) {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
  };
}

/** เปิดห้อง (ถ้ายังไม่มี) แล้วเริ่มวนอ่านเหตุการณ์จาก SDK ส่งออกทาง onEvent */
function open(roomId, { base, token, model, effort, folders, plugins, canUseTool, onEvent, resumeId, localMcp }) {
  let room = rooms.get(roomId);
  if (room?.alive) return room;

  const { query } = getSdk();
  const inbox = makeInbox();

  const q = query({
    prompt: inbox,
    options: {
      model: model || DEFAULT_MODEL,
      effort: effort || DEFAULT_EFFORT,
      cwd: WORKDIR,
      mcpServers: mcpConfig(base, token, localMcp),
      // 'default' = เครื่องยนต์ถามก่อนทำสิ่งที่ย้อนกลับยาก (เขียนไฟล์ · รันคำสั่ง)
      // แล้วโยนคำถามมาที่ canUseTool → เราส่งต่อให้แผงถามผู้ใช้เป็นภาษาคน
      // (ของเดิมคือ bypassPermissions = ไม่ถามอะไรเลย ปลอดภัยเพราะยังไม่เปิด Write/Bash)
      permissionMode: 'default',
      ...(canUseTool ? { canUseTool } : {}),
      // skill ของ cobik ติดมากับแอป — ทุกคนได้เหมือนกันโดยไม่ต้องติดตั้งเอง
      // skills:'all' = เปิดทั้ง skill ที่ติดมากับแอปและ skill ส่วนตัวของผู้ใช้เอง
      ...(plugins?.length ? { plugins, skills: 'all' } : {}),
      includePartialMessages: true,        // ← สตรีมทีละชิ้น
      env: CHILD_ENV,
      executable: 'node',
      ...(resumeId ? { resume: resumeId } : {}),
      ...(folders?.length ? { additionalDirectories: folders } : {}),
    },
  });

  room = {
    q, inbox, alive: true, busy: false, turns: 0,
    model: model || DEFAULT_MODEL, effort: effort || DEFAULT_EFFORT,
    folders: folders ? [...folders] : [],
  };
  rooms.set(roomId, room);

  (async () => {
    try {
      for await (const m of q) {
        // ── สตรีมทีละชิ้น ──
        if (m.type === 'stream_event') {
          const ev = m.event;
          if (ev?.type === 'content_block_delta') {
            if (ev.delta?.type === 'text_delta' && ev.delta.text) onEvent({ type: 'delta', text: ev.delta.text });
            if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking) onEvent({ type: 'thinking', text: ev.delta.thinking });
          }
          if (ev?.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
            onEvent({ type: 'tool_start', name: ev.content_block.name });
          }
          if (ev?.type === 'message_stop') onEvent({ type: 'block_end' });
          continue;
        }

        if (m.type === 'system' && m.subtype === 'init') {
          room.sessionId = m.session_id;
          onEvent({
            type: 'init',
            sessionId: m.session_id,
            model: m.model,
            toolCount: (m.tools || []).length,
            servers: (m.mcp_servers || []).map((s) => ({ name: s.name, status: s.status })),
          });
        }

        if (m.type === 'assistant') {
          for (const b of m.message?.content ?? []) {
            if (b.type === 'tool_use') onEvent({ type: 'tool', name: b.name, input: b.input });
          }
        }

        if (m.type === 'user') {
          for (const b of m.message?.content ?? []) {
            if (b.type === 'tool_result') {
              const raw = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
              onEvent({ type: 'tool_result', isError: !!b.is_error, preview: raw.slice(0, 400) });
            }
          }
        }

        if (m.type === 'result') {
          room.busy = false;
          onEvent({ type: 'done', subtype: m.subtype, cost: m.total_cost_usd, turns: m.num_turns });
        }
      }
    } catch (e) {
      onEvent({ type: 'error', message: e?.message || String(e) });
    } finally {
      room.alive = false;
      room.busy = false;
      onEvent({ type: 'closed' });
    }
  })();

  return room;
}

/** ส่งข้อความเข้าห้อง (เปิดห้องให้อัตโนมัติถ้ายังไม่มี) */
function send(roomId, text, opts) {
  const room = open(roomId, opts);
  if (room.busy) throw new Error('กำลังทำงานอยู่ รอให้จบก่อน');
  room.busy = true;
  room.turns += 1;
  const ctx = opts.context ? `[ผู้ใช้กำลังดู: ${opts.context}]\n\n` : '';
  room.inbox.push(userMessage(ctx + text));
  return { sessionId: room.sessionId || null };
}

async function stop(roomId = 'main') {
  const room = rooms.get(roomId);
  if (!room?.alive) return false;
  try { await room.q.interrupt(); room.busy = false; return true; }
  catch { return false; }
}

async function setModel(roomId, model) {
  const room = rooms.get(roomId);
  if (!room?.alive) return false;
  try { await room.q.setModel(model); room.model = model; return true; } catch { return false; }
}

async function commands(roomId = 'main') {
  const room = rooms.get(roomId);
  if (!room?.alive) return [];
  try { return await room.q.supportedCommands(); } catch { return []; }
}

async function models(roomId = 'main') {
  const room = rooms.get(roomId);
  if (!room?.alive) return [];
  try { return await room.q.supportedModels(); } catch { return []; }
}

/** ที่ต่ออยู่ (MCP) — ถามได้ตั้งแต่ยังไม่คุย ไม่ต้องรอ init เหมือนกัน · ต่อติดขึ้นก่อน */
async function servers(roomId = 'main') {
  const room = rooms.get(roomId);
  if (!room?.alive) return [];
  try {
    const list = (await room.q.mcpServerStatus()) || [];
    return list
      .map((s) => ({ name: s.name, status: s.status }))
      .sort((a, b) => Number(b.status === 'connected') - Number(a.status === 'connected'));
  } catch { return []; }
}

// กันค้าง: ถ้าถามแล้วไม่มีคำตอบภายในเวลา ให้คืนค่าว่างแทนที่จะแขวนแผงไว้เฉย ๆ
const within = (ms, p, fallback) =>
  Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

/**
 * เปิดห้องค้างไว้เฉย ๆ เพื่อถามว่าบัญชีนี้มีอะไรให้ใช้บ้าง — โมเดล · skill · ที่ต่ออยู่
 * ไม่เสียเงิน — ค่าใช้จ่ายเกิดตอนส่งข้อความ ไม่ใช่ตอนเปิด session
 *
 * 🔴 ห้ามรอ init: ข้อความ init ของ Claude Code มาตอน "เริ่มบทสนทนาคำแรก" ไม่ใช่ตอนเปิดห้อง
 *    ของเดิมยืนรอ 15 วิแล้วยอมแพ้ทุกครั้งที่ผู้ใช้ยังไม่ได้พิมพ์ → แผงได้ลิสต์ว่าง
 *    เมนูโมเดลเหลือตัวสำรองตัวเดียว · Skills เทา · ที่ต่ออยู่ว่าง
 *    สามตัวนี้ถามตรงได้เลย — รอแค่การจับมือของ SDK เอง (ปกติ 2-3 วินาที)
 */
async function warmup(roomId, opts) {
  open(roomId, opts);
  const [m, c, s] = await Promise.all([
    within(45000, models(roomId), []),
    within(45000, commands(roomId), []),
    within(45000, servers(roomId), []),
  ]);
  if (!m.length && !c.length && !s.length) return { timedOut: true, models: [], commands: [], servers: [], state: state(roomId) };
  return { models: m, commands: c, servers: s, state: state(roomId) };
}

/** ปิดห้อง — เริ่มบทสนทนาใหม่ */
function reset(roomId = 'main') {
  const room = rooms.get(roomId);
  if (room?.alive) { try { room.inbox.close(); } catch {} }
  rooms.delete(roomId);
}

function state(roomId = 'main') {
  const room = rooms.get(roomId);
  return {
    alive: !!room?.alive,
    busy: !!room?.busy,
    turns: room?.turns || 0,
    folders: room?.folders || [],
    model: room?.model || DEFAULT_MODEL,
    effort: room?.effort || DEFAULT_EFFORT,
    sessionId: room?.sessionId || null,
  };
}

// ── บทสนทนาที่เก็บไว้ (อ่านจากที่ SDK เก็บอยู่แล้ว ไม่ได้เก็บซ้ำ) ──
// "เก็บเข้ากรุ" = ติดแท็ก 'archived' ผ่าน tagSession — ไม่ได้ย้ายหรือคัดลอกไฟล์
const ARCHIVE_TAG = 'archived';

// ชื่อที่เอาไปโชว์ — ถ้ายังไม่มีชื่อจริง SDK จะคืน "ประโยคแรก" ซึ่งมีของแนบติดมาด้วย
// (คำนำหน้าบอกว่าผู้ใช้กำลังดูหน้าไหน · ท้ายข้อความมีบล็อกอ้างอิงคน/โปรเจกต์)
// ตัดให้เหลือบรรทัดแรกที่ผู้ใช้พิมพ์จริง ๆ ไม่งั้นรายการกับหัวแผงอ่านไม่รู้เรื่อง
function cleanTitle(t) {
  const first = String(t || '').replace(/^\[ผู้ใช้กำลังดู:[^\]]*\]\s*/, '').split('\n')[0].trim();
  return first.slice(0, 120) || 'บทสนทนาไม่มีชื่อ';
}

async function listChats({ archived = false } = {}) {
  const { listSessions } = getSdk();
  try {
    const all = await listSessions({ dir: WORKDIR, limit: 200 });
    return all
      .filter((s) => (s.tag === ARCHIVE_TAG) === !!archived)
      .map((s) => ({
        id: s.sessionId,
        title: cleanTitle(s.customTitle || s.summary || s.firstPrompt),
        at: s.lastModified,
        size: s.fileSize || 0,
        tag: s.tag || null,
      }));
  } catch { return []; }
}

async function chatAction(action, sessionId, value) {
  const sdk = getSdk();
  const opts = { dir: WORKDIR };
  try {
    if (action === 'rename')  await sdk.renameSession(sessionId, value, opts);
    if (action === 'archive') await sdk.tagSession(sessionId, ARCHIVE_TAG, opts);
    if (action === 'restore') await sdk.tagSession(sessionId, null, opts);
    if (action === 'delete')  await sdk.deleteSession(sessionId, opts);
    return true;
  } catch (e) { return { error: e?.message || String(e) }; }
}

/** เปิดบทสนทนาเก่าขึ้นมาคุยต่อ — คืนข้อความเดิมให้แผงวาด */
async function openChat(roomId, sessionId, opts) {
  reset(roomId);
  const { getSessionMessages } = getSdk();
  let history = [];
  try {
    const msgs = await getSessionMessages(sessionId, { dir: WORKDIR });
    history = (msgs || []).map((m) => {
      if (m.type === 'user') {
        const c = m.message?.content;
        const text = typeof c === 'string' ? c : (c || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        return text.trim() ? { role: 'user', text: text.replace(/^\[ผู้ใช้กำลังดู:[^\]]*\]\s*/, '') } : null;
      }
      if (m.type === 'assistant') {
        const text = (m.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        return text.trim() ? { role: 'assistant', text } : null;
      }
      return null;
    }).filter(Boolean);
  } catch { /* อ่านไม่ได้ก็เปิดห้องเปล่า */ }

  open(roomId, { ...opts, resumeId: sessionId });
  return history;
}

module.exports = {
  send, stop, reset, setModel, models, commands, servers, warmup, state, setWorkdir,
  listChats, chatAction, openChat,
  DEFAULT_MODEL, DEFAULT_EFFORT,
};
