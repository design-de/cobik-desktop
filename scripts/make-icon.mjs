// สร้างไอคอนแอป Cobik.app จากมาร์กแบรนด์ — ไม่พึ่งเครื่องมือนอก
//
// วิธี: วาดไอคอนเป็นหน้าเว็บ 1024×1024 แล้วให้ Electron ถ่ายภาพหน้าจอตัวเอง
//       จากนั้นย่อเป็นชุดขนาดด้วย sips แล้วมัดเป็น .icns ด้วย iconutil (ทั้งคู่ติดมากับ macOS)
//
// รูปทรง: ตามสัดส่วนไอคอน macOS — เนื้อไอคอน 824 จาก 1024 มุมโค้ง 185
//         พื้นเข้มเพื่อให้ไล่สีฟ้า→น้ำเงินของมาร์กเด่นทั้งบน Dock สว่างและมืด
import { app, BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build');
const iconset = join(outDir, 'cobik.iconset');

const MARK = 'M341.421 341.421C313.451 369.392 277.814 388.44 239.018 396.157C200.222 403.874 160.009 399.913 123.463 384.776C86.9181 369.638 55.6824 344.004 33.7061 311.114C11.7298 278.224 2.43622e-06 239.556 0 200C-2.43622e-06 160.444 11.7298 121.776 33.7061 88.886C55.6823 55.9961 86.9181 30.3616 123.463 15.2241C160.009 0.0865715 200.222 -3.8741 239.018 3.84294C277.814 11.56 313.451 30.6081 341.421 58.5786L228.284 171.716C222.69 166.122 215.563 162.312 207.804 160.769C200.044 159.225 192.002 160.017 184.693 163.045C177.384 166.072 171.136 171.199 166.741 177.777C162.346 184.355 160 192.089 160 200C160 207.911 162.346 215.645 166.741 222.223C171.136 228.801 177.384 233.928 184.693 236.955C192.002 239.983 200.044 240.775 207.804 239.231C215.563 237.688 222.69 233.878 228.284 228.284L341.421 341.421Z';

const HTML = `<!doctype html><meta charset="utf-8">
<style>
  html,body { margin:0; width:1024px; height:1024px; background:transparent; }
  .plate {
    position:absolute; left:100px; top:100px; width:824px; height:824px;
    border-radius:185px;
    background:linear-gradient(160deg,#1B2130 0%,#0B0E14 100%);
    box-shadow: inset 0 2px 0 rgba(255,255,255,.07), inset 0 -2px 0 rgba(0,0,0,.4);
    display:flex; align-items:center; justify-content:center;
  }
  svg { width:376px; height:440px; }
</style>
<div class="plate">
  <svg viewBox="0 0 342 400" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${MARK}" fill="url(#g)"/>
    <defs><linearGradient id="g" x1="-17.5" y1="200" x2="416.3" y2="200" gradientUnits="userSpaceOnUse">
      <stop stop-color="#4AE4FF"/><stop offset="1" stop-color="#0156FE"/>
    </linearGradient></defs>
  </svg>
</div>`;

// .icns ต้องมีครบทุกขนาด ไม่งั้น Finder/Dock จะเลือกภาพเบลอมาใช้
const SIZES = [[16,'16x16'],[32,'16x16@2x'],[32,'32x32'],[64,'32x32@2x'],
               [128,'128x128'],[256,'128x128@2x'],[256,'256x256'],[512,'256x256@2x'],
               [512,'512x512'],[1024,'512x512@2x']];

app.disableHardwareAcceleration();

// ⚠️ ห้ามใช้ top-level await รอ app.whenReady() ในไฟล์ .mjs ที่เป็น entry ของ Electron
//    Electron รอให้โมดูลหลัก "ประเมินจบ" ก่อนถึงจะยิง ready → รอกันเองค้างตลอดกาล
//    ต้องห้อยงานทั้งหมดไว้ใน .then() แทน
app.whenReady().then(async () => {
  const bail = setTimeout(() => { console.error('สร้างไอคอนไม่สำเร็จ: หมดเวลา'); app.exit(1); }, 60_000);

  // ⚠️ ต้อง show:true — หน้าต่างที่ซ่อนอยู่จะไม่วาดอะไรเลย แล้ว capturePage() ค้างไม่คืนค่า
  //    จึงเปิดไว้นอกจอแทน (วาบขึ้นมาไม่ถึงวินาทีตอน build เท่านั้น)
  const win = new BrowserWindow({
    width: 1024, height: 1024, x: -3000, y: 0, show: true, frame: false, transparent: true,
    backgroundColor: '#00000000', useContentSize: true, skipTaskbar: true,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await new Promise((r) => setTimeout(r, 600));   // รอ layout + เงานิ่ง

  const png = (await win.webContents.capturePage()).toPNG();

  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset, { recursive: true });
  const master = join(outDir, 'icon.png');
  writeFileSync(master, png);

  for (const [px, name] of SIZES) {
    execFileSync('sips', ['-z', String(px), String(px), master, '--out', join(iconset, `icon_${name}.png`)],
      { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(outDir, 'icon.icns')]);
  rmSync(iconset, { recursive: true, force: true });

  clearTimeout(bail);
  console.log('ได้ไอคอนแล้ว → build/icon.icns (+ build/icon.png)');
  app.exit(0);
});
