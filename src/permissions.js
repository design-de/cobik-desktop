// สิทธิ์ที่ผู้ใช้ให้ไว้ — ถามเป็น "ชุดเดียว" ครั้งเดียว แล้วจำไว้ข้ามการปิด-เปิดแอปและข้ามการอัปเดต
//
// 🔴 ทำไมเก็บเอง ไม่พึ่งของ SDK: ปุ่ม "อนุญาตตลอด" ของเครื่องยนต์เขียนกฎลง .claude/settings.local.json
//    ใต้ "โฟลเดอร์ทำงาน" ของ session ซึ่งตอนเปิดแอปจาก Finder คือ '/' — เขียนไม่ได้
//    กฎจึงหายทุกครั้งที่ปิดแอป ผู้ใช้เลยรู้สึกว่าต้องกดอนุญาตซ้ำไม่จบสิ้น
//    ไฟล์ของเราอยู่ใน userData → รอดทั้งตอนปิดแอปและตอนสลับตัวแอปเวลาอัปเดต
//
// ⚠️ ไฟล์นี้คุมเฉพาะ "กล่องของเรา" — กล่องของ macOS (พวงกุญแจ · โฟลเดอร์ Desktop/Documents)
//    เป็นของระบบปฏิบัติการ สั่งแทนผู้ใช้ไม่ได้ ต้องเซ็นแอปด้วย Developer ID ถึงจะหายถามซ้ำทุกรุ่น
const fs = require('node:fs');
const path = require('node:path');

let file = null;
let data = null;

const CONSENT = ['none', 'granted', 'ask'];

/* เครื่องมือที่ "อ่านอย่างเดียว" — ไม่แก้ไฟล์ ไม่รันคำสั่ง ไม่ยิงเน็ต
   ถามทุกครั้งที่จะอ่านไฟล์หนึ่งบรรทัดทำให้ใช้งานจริงไม่ได้ จึงผ่านให้ตั้งแต่ต้น */
const READ_ONLY = /^(Read|Glob|Grep|NotebookRead|TodoWrite|ListMcpResources|ReadMcpResource)$/;

/* เขียนไฟล์ — ชุดนี้คือหัวใจของ "กล่องเดียว": อนุญาตทีเดียวแต่จำกัดขอบเขต
   ให้เฉพาะในโฟลเดอร์ที่ผู้ใช้เพิ่มไว้เอง · นอกนั้นยังถามรายครั้งเหมือนเดิม */
const WRITE_FILE = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

function init(userDataDir) {
  file = path.join(userDataDir, 'permissions.json');
  data = null;
}

function load() {
  if (data) return data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = null; }
  if (!data || typeof data !== 'object') data = {};
  if (!CONSENT.includes(data.consent)) data.consent = 'none';
  if (!Array.isArray(data.grants)) data.grants = [];
  return data;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(load(), null, 2));
  } catch {}
}

const consent = () => load().consent;
function setConsent(v) {
  if (!CONSENT.includes(v)) return consent();
  load().consent = v;
  persist();
  return v;
}

// ── ทางเข้าออกของ "กฎที่กดอนุญาตตลอด" ──

/** ไฟล์ที่เครื่องมือนี้กำลังจะแตะ (ถ้ามี) */
function targetPath(input = {}) {
  return input.file_path || input.notebook_path || input.path || null;
}

/** อยู่ในโฟลเดอร์ที่ผู้ใช้เพิ่มไว้ไหม — เทียบหลัง resolve กัน ../ หลุดขอบ */
function inside(p, dirs = []) {
  if (!p) return false;
  const abs = path.resolve(String(p));
  return dirs.some((d) => {
    const root = path.resolve(String(d));
    return abs === root || abs.startsWith(root + path.sep);
  });
}

/* หัวคำสั่ง — 'git status -s' → 'git status' · 'ls -la' → 'ls'
   เอาสองท่อนเมื่อท่อนที่สองเป็นคำสั่งย่อยจริง ๆ (ไม่ใช่ธงหรือพาธ)
   เพราะ 'git' ทั้งก้อนกว้างเกินไป แต่ 'git status' เป็นสิ่งที่ผู้ใช้ตั้งใจอนุญาตได้ */
function bashHead(cmd) {
  const parts = String(cmd || '').trim().split(/\s+/);
  const first = parts[0] || '';
  const second = parts[1] || '';
  return second && /^[a-z][\w.-]*$/i.test(second) ? `${first} ${second}` : first;
}

/** แปลงคำขอหนึ่งครั้ง → กฎที่จะจำไว้ (null = จำไม่ได้ ต้องถามทุกครั้ง) */
function ruleFor(tool, input = {}, folders = []) {
  const t = String(tool);
  if (t === 'Bash') {
    const head = bashHead(input.command);
    return head ? { tool: 'Bash', head } : null;
  }
  if (WRITE_FILE.test(t)) {
    const p = targetPath(input);
    if (!p) return null;
    // จำเป็น "โฟลเดอร์" ไม่ใช่ไฟล์ — ไม่งั้นแก้ไฟล์ถัดไปในโฟลเดอร์เดิมก็ถามใหม่อีก
    const dir = folders.find((d) => inside(p, [d])) || path.dirname(path.resolve(String(p)));
    return { tool: t, dir };
  }
  if (t === 'WebFetch') {
    try { return { tool: 'WebFetch', host: new URL(String(input.url)).host }; } catch { return null; }
  }
  return { tool: t };
}

function sameRule(a, b) {
  return a.tool === b.tool && a.head === b.head && a.dir === b.dir && a.host === b.host;
}

function matches(rule, tool, input = {}) {
  if (rule.tool !== tool) return false;
  if (rule.head) return bashHead(input.command) === rule.head;
  if (rule.dir) return inside(targetPath(input), [rule.dir]);
  if (rule.host) { try { return new URL(String(input.url)).host === rule.host; } catch { return false; } }
  return true;
}

/** ผู้ใช้กด "อนุญาตตลอด" — จำกฎนี้ไว้ */
function grant(tool, input, folders) {
  const rule = ruleFor(tool, input, folders);
  if (!rule) return null;
  const g = load().grants;
  if (!g.some((r) => sameRule(r, rule))) { g.push(rule); persist(); }
  return rule;
}

function clearGrants() { load().grants = []; persist(); }

/**
 * ตัดสินคำขอหนึ่งครั้ง — 'allow' = ทำได้เลย · 'ask' = ขึ้นการ์ดถาม
 * (โหมด "ถามทุกครั้ง" ไม่ต้องเรียกฟังก์ชันนี้ — main ตัดจบก่อนแล้ว)
 */
function decide(tool, input = {}, folders = []) {
  const t = String(tool);
  if (READ_ONLY.test(t)) return 'allow';
  if (consent() === 'granted' && WRITE_FILE.test(t) && inside(targetPath(input), folders)) return 'allow';
  if (load().grants.some((r) => matches(r, t, input))) return 'allow';
  return 'ask';
}

/** บรรทัดภาษาคนของกฎที่ให้ไว้ — ใช้ในกล่อง "สิทธิ์ที่ให้ไว้" */
function describe(rule) {
  if (rule.tool === 'Bash') return `รันคำสั่ง ${rule.head}`;
  if (rule.tool === 'mcp__cobik_canvas__canvas_write') return 'สร้างและแก้ canvas ใน My Canvas';
  if (WRITE_FILE.test(rule.tool)) return `แก้ไฟล์ใน ${rule.dir}`;
  if (rule.tool === 'WebFetch') return `เปิดเว็บ ${rule.host}`;
  return `ใช้ ${rule.tool}`;
}

function state() {
  const d = load();
  return { consent: d.consent, grants: d.grants.map((r) => ({ ...r, label: describe(r) })) };
}

module.exports = {
  init, consent, setConsent, decide, grant, clearGrants, state, describe,
  READ_ONLY, WRITE_FILE,
};
