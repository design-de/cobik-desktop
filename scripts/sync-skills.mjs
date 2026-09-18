// คัดลอก skill 6 ตัวของ cobik จาก repo ต้นทาง มาไว้ในแอป
//
// ทำไมต้องคัดลอก ไม่ใช่ symlink หรืออ่านข้ามโฟลเดอร์:
//   ตอน build เป็น Cobik.app ไฟล์ต้องอยู่ "ข้างใน" แอป ไม่งั้นเครื่องคนอื่นไม่มีให้อ่าน
//   จึง commit สำเนาไว้ใน repo นี้ด้วย แล้วรันสคริปต์นี้ซ้ำเมื่อต้นทางเปลี่ยน
//
// ต้นทาง: repo cobik-skill (ชื่อเดิม cowork-skill) ที่วางไว้ข้าง ๆ กัน
// ปลายทาง: skills-plugin/ — โครงแบบ "plugin ของ Claude Code" (มี .claude-plugin/plugin.json)
//           Agent SDK โหลดทั้งโฟลเดอร์เป็น plugin เดียว แล้ว skill ข้างในโผล่ในเมนู /
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dest = join(root, 'skills-plugin');

const candidates = [
  process.env.COBIK_SKILL_DIR,
  resolve(root, '..', 'cobik-skill'),
  resolve(root, '..', 'cowork-skill'),
].filter(Boolean);

const src = candidates.find((p) => existsSync(join(p, 'cobik-use', 'SKILL.md')));
if (!src) {
  console.error('หา repo skill ต้นทางไม่เจอ — มองหาที่:\n' + candidates.map((p) => '  ' + p).join('\n'));
  console.error('ตั้ง COBIK_SKILL_DIR=/path/to/cobik-skill แล้วรันใหม่');
  process.exit(1);
}

const skills = readdirSync(src, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('cobik-'))
  .map((d) => d.name)
  .sort();

if (!skills.length) { console.error('ไม่พบโฟลเดอร์ cobik-* ใน ' + src); process.exit(1); }

rmSync(join(dest, 'skills'), { recursive: true, force: true });
mkdirSync(join(dest, 'skills'), { recursive: true });
mkdirSync(join(dest, '.claude-plugin'), { recursive: true });

for (const name of skills) cpSync(join(src, name), join(dest, 'skills', name), { recursive: true });

writeFileSync(join(dest, '.claude-plugin', 'plugin.json'), JSON.stringify({
  name: 'cobik',
  description: 'Skill ของ cobik ที่ติดมากับแอป Cobik Desktop — ทุกคนได้เหมือนกันโดยไม่ต้องติดตั้งเอง',
  version: '1.0.0',
}, null, 2) + '\n');

console.log(`คัดลอก ${skills.length} skill จาก ${src}`);
for (const s of skills) console.log('  · ' + s);
