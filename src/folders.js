// โฟลเดอร์ในเครื่องที่ยอมให้ Claude อ่าน — จำ "แยกตามโปรเจกต์"
//
// เหตุผล: โฟลเดอร์ที่เกี่ยวข้องเป็นคนละชุดกันในแต่ละงาน
//   อยู่โปรเจกต์ A ก็ควรได้ repo ของ A ไม่ใช่กองรวมทุกอันที่เคยเพิ่มมาทั้งปี
//   และไม่ควรต้องเพิ่มใหม่ทุกครั้งที่เปิดแอป (เดิมจำแค่ในรอบที่เปิดอยู่)
//
// ขอบเขตดูจากหน้าที่เปิดอยู่ฝั่งซ้าย — /projects/<id> = ของโปรเจกต์นั้น · หน้าอื่น = 'ทั่วไป'
// เก็บเป็นไฟล์เดียว folders.json ใน userData: { "global": [...], "project:<id>": [...] }
const fs = require('node:fs');
const path = require('node:path');

let fileFor = null;   // ตั้งจาก main หลัง app พร้อม (userData ยังไม่มีค่าก่อนหน้านั้น)
let cache = null;

function init(userDataDir) {
  fileFor = path.join(userDataDir, 'folders.json');
  cache = null;
}

function all() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(fileFor, 'utf8')); }
  catch { cache = {}; }
  if (!cache || typeof cache !== 'object') cache = {};
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(fileFor), { recursive: true });
    fs.writeFileSync(fileFor, JSON.stringify(all(), null, 2));
  } catch {}
}

const GLOBAL = 'global';

/** ขอบเขตจาก URL ฝั่งซ้าย — คืน { key, label } */
function scopeOf(url) {
  try {
    const m = /\/projects\/([0-9a-f-]{8,})/i.exec(new URL(url).pathname);
    if (m) return { key: `project:${m[1]}`, label: null };   // ชื่อโปรเจกต์เติมทีหลังโดยแผง
  } catch {}
  return { key: GLOBAL, label: 'ทั่วไป' };
}

function list(key) {
  const v = all()[key];
  return Array.isArray(v) ? v : [];
}

function add(key, paths) {
  const next = [...new Set([...list(key), ...paths])];
  all()[key] = next;
  persist();
  return next;
}

function remove(key, p) {
  const next = list(key).filter((x) => x !== p);
  if (next.length) all()[key] = next; else delete all()[key];
  persist();
  return next;
}

/** ชุดเดียวกันไหม (ใช้ตัดสินว่าต้องเริ่มบทสนทนาใหม่หรือเปล่า) */
function same(a = [], b = []) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

module.exports = { init, scopeOf, list, add, remove, same, GLOBAL };
