// ตัวเชื่อม Claude — ฝัง Claude Agent SDK ไว้ใน main process
// ไม่มี agent loop ของเราเอง: SDK คือ loop · เราแค่ป้อน prompt + ต่อ MCP ของ Cowork + ส่งเหตุการณ์ออกไปให้แผง
//
// auth: ไม่ส่ง credential ใด ๆ → SDK หยิบ login Claude Code ของผู้ใช้ในเครื่องเอง (พิสูจน์แล้วในเฟส 0)
// ประหยัด: ใช้ session เดิมซ้ำ (resume) เพราะทุก session ใหม่ = เขียนแคช system prompt ใหม่ทั้งก้อน
// ⚠️ ELECTRON_RUN_AS_NODE ต้องตั้งเฉพาะ "ลูกที่ SDK spawn" เท่านั้น (ผ่าน options.env)
//    ห้ามตั้งที่ process.env ของ main — มันจะไหลไปทุก helper ของ Electron เอง (GPU/network/renderer)
//    แล้วพังทั้งแอปด้วย "bad option: --type=utility"
const CHILD_ENV = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

let query = null;
function getQuery() {
  if (!query) ({ query } = require('@anthropic-ai/claude-agent-sdk'));
  return query;
}

// จำ session ต่อ "ห้อง" (ตอนนี้ห้องเดียว ภายหลังจะเป็นห้องต่อโปรเจกต์)
const sessions = new Map();
let running = null;

function mcpConfig(base, token) {
  return {
    // ชื่อ 'cobik' ไม่ใช่ 'cowork' — กันชนกับ connector "claude.ai Cowork" ที่ผู้ใช้อาจเชื่อมไว้เอง
    cobik: { type: 'http', url: `${base}/api/mcp`, headers: { Authorization: `Bearer ${token}` } },
  };
}

/**
 * ส่งข้อความหา Claude แล้วสตรีมเหตุการณ์กลับทาง onEvent
 * onEvent({ type, ... }) — 'text' | 'tool' | 'tool_result' | 'done' | 'error'
 */
async function ask({ base, token, prompt, room = 'main', context, onEvent }) {
  if (running) throw new Error('กำลังทำงานอยู่ รอให้จบก่อน');

  const q = getQuery();
  const resume = sessions.get(room);

  // บริบทของหน้าที่ผู้ใช้เปิดอยู่ — แนบนำหน้าแบบเห็นได้ ไม่ซ่อนใน system prompt
  const full = context ? `[ผู้ใช้กำลังดู: ${context}]\n\n${prompt}` : prompt;

  running = room;
  let sawError = null;
  try {
    for await (const m of q({
      prompt: full,
      options: {
        maxTurns: 12,
        mcpServers: mcpConfig(base, token),
        permissionMode: 'bypassPermissions', // v1: เครื่องมือ Cowork เท่านั้น ยังไม่เปิด Write/Bash ในเครื่อง
        env: CHILD_ENV,       // ← ลูกรันเป็น Node (ดูหมายเหตุหัวไฟล์)
        executable: 'node',
        ...(resume ? { resume } : {}),
      },
    })) {
      if (m.type === 'system' && m.subtype === 'init') {
        sessions.set(room, m.session_id);
        onEvent({
          type: 'init',
          sessionId: m.session_id,
          model: m.model,
          servers: (m.mcp_servers || []).map((s) => ({ name: s.name, status: s.status })),
          toolCount: (m.tools || []).length,
        });
      }

      if (m.type === 'assistant') {
        for (const b of m.message?.content ?? []) {
          if (b.type === 'text' && b.text.trim()) onEvent({ type: 'text', text: b.text });
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
        if (m.subtype !== 'success') sawError = m.subtype;
        sessions.set(room, m.session_id || sessions.get(room));
        onEvent({
          type: 'done',
          subtype: m.subtype,
          cost: m.total_cost_usd,
          turns: m.num_turns,
          sessionId: m.session_id,
        });
      }
    }
  } catch (e) {
    sawError = e?.message || String(e);
    onEvent({ type: 'error', message: sawError });
  } finally {
    running = null;
  }
  return { error: sawError };
}

function reset(room = 'main') { sessions.delete(room); }
function isRunning() { return !!running; }

module.exports = { ask, reset, isRunning };
