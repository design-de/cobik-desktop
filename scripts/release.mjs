// ออกเวอร์ชันใหม่ขึ้น GitHub Releases — แอปของทุกคนจะเห็นเองภายใน 6 ชม. หรือตอนเปิดครั้งหน้า
//
// ⚠️ เลข tag ต้องตรงกับ version ใน package.json เป๊ะ ๆ
//    เพราะตัวอัปเดตในแอปเทียบสองค่านี้ตรง ๆ (src/update.js) — สคริปต์นี้จึงบังคับให้ตรงเสมอ
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tag = `v${version}`;
const files = [`Cobik-${version}-arm64.zip`, `Cobik-${version}-arm64.dmg`].map((f) => join(root, 'dist', f));

const missing = files.filter((f) => !existsSync(f));
if (missing.length) {
  console.error(`ยังไม่มีไฟล์ของรุ่น ${version}:\n` + missing.map((f) => '  ' + f).join('\n'));
  console.error('รัน `npm run dist` ก่อน');
  process.exit(1);
}

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();

// ปล่อยของขึ้นไปโดยที่โค้ดยังไม่ push = คนโหลดได้ของที่ไม่มีใครตามรอยได้
try {
  if (sh('git', ['status', '--porcelain'])) throw new Error('ยังมีไฟล์ที่ไม่ได้ commit');
  sh('git', ['fetch', '-q', 'origin']);
  if (sh('git', ['rev-list', 'origin/main..HEAD'])) throw new Error('ยังมี commit ที่ไม่ได้ push');
} catch (e) { console.error('หยุดก่อน:', e.message); process.exit(1); }

let notes = '';
try {
  const prev = sh('git', ['describe', '--tags', '--abbrev=0']);
  notes = sh('git', ['log', '--pretty=- %s', `${prev}..HEAD`]);
} catch { notes = sh('git', ['log', '--pretty=- %s', '-10']); }

console.log(`ออกรุ่น ${tag}`);
execFileSync('gh', ['release', 'create', tag, ...files,
  '--title', `Cobik ${version}`,
  '--notes', notes || 'ปรับปรุงทั่วไป',
], { cwd: root, stdio: 'inherit' });

console.log('\nขึ้นแล้ว — แอปของทุกคนจะเห็นแถบ "มีเวอร์ชันใหม่" เองภายใน 6 ชม. หรือตอนเปิดครั้งหน้า');
