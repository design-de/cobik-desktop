// อัปเดตตัวเอง — โหลดรุ่นใหม่จาก GitHub Releases แล้วสลับตัวแอป
//
// ทำไมไม่ใช้ electron-updater: มันบังคับให้แอปถูกเซ็นด้วย Developer ID
// (Squirrel.Mac ตรวจลายเซ็นก่อนติดตั้ง) = ต้องมี Apple Developer Program $99/ปี
//
// ทำไมทำเองแล้วยังไม่เจอคำเตือน Gatekeeper: ธง com.apple.quarantine ถูกติดโดย
// เบราว์เซอร์/Slack/AirDrop/Mail เท่านั้น — ไฟล์ที่ "แอปโหลดมาเอง" ไม่ติดธง
// (นี่คือเหตุผลเดียวกับที่ทาง B ในแผนใช้ curl)
const { app, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = 'design-de/cobik-desktop';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const BUNDLE_ID = 'com.bluebik.cobik.desktop';

// '0.10.0' > '0.9.0' — เทียบเป็นตัวเลขทีละท่อน ไม่ใช่เทียบข้อความ
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

let state = { checking: false, current: null, latest: null, url: null, notes: '', busy: false, percent: 0, error: null };
let notify = () => {};
const setNotifier = (fn) => { notify = fn; };
const push = (patch) => { state = { ...state, ...patch }; notify(state); };

function current() { return app.getVersion(); }

/** ถาม GitHub ว่ารุ่นล่าสุดคืออะไร — repo เป็น public จึงไม่ต้องใช้ token */
async function check({ quiet = true } = {}) {
  if (state.checking) return state;
  push({ checking: true, error: null, current: current() });
  try {
    const r = await fetch(API, { headers: { accept: 'application/vnd.github+json' } });
    if (r.status === 404) return push({ checking: false, latest: null }), state;  // ยังไม่เคยออกรุ่นไหนเลย
    if (!r.ok) throw new Error(`GitHub ตอบ ${r.status}`);
    const j = await r.json();
    const asset = (j.assets || []).find((a) => /\.zip$/i.test(a.name) && /arm64/i.test(a.name))
      || (j.assets || []).find((a) => /\.zip$/i.test(a.name));
    const version = String(j.tag_name || '').replace(/^v/, '');
    push({
      checking: false,
      latest: version || null,
      url: asset?.browser_download_url || null,
      notes: (j.body || '').slice(0, 600),
    });
  } catch (e) {
    push({ checking: false, error: quiet ? null : (e?.message || String(e)) });
  }
  return state;
}

/** มีรุ่นใหม่ที่อัปเดตได้จริงไหม (ตอนพัฒนาไม่นับ — ไม่มีตัวแอปให้สลับ) */
function available() {
  return !!(app.isPackaged && state.latest && state.url && newer(state.latest, current()));
}

function appBundlePath() {
  // /Applications/Cobik.app/Contents/MacOS/Cobik → /Applications/Cobik.app
  return path.resolve(path.dirname(process.execPath), '..', '..');
}

async function download(url, dest, onPercent) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`โหลดไฟล์ไม่สำเร็จ (${r.status})`);
  const total = Number(r.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = fs.createWriteStream(dest);
  let got = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
    if (total) onPercent(Math.min(99, Math.round((got / total) * 100)));
  }
  await new Promise((res, rej) => { out.end(); out.on('finish', res); out.on('error', rej); });
  if (total && got !== total) throw new Error('ไฟล์ที่โหลดมาไม่ครบ');
  return dest;
}

const run = (cmd, args) => new Promise((res, rej) =>
  execFile(cmd, args, (e, so) => (e ? rej(e) : res(String(so)))));

/** อ่านค่าจาก Info.plist ของ .app ที่แตกออกมา — กันไฟล์เสียหรือไม่ใช่แอปเรา */
async function plist(appPath, key) {
  try {
    return (await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(appPath, 'Contents', 'Info.plist')])).trim();
  } catch { return null; }
}

/**
 * โหลด → แตก → ตรวจ → เขียนสคริปต์สลับ → ปิดตัวเอง
 * การสลับต้องทำ "หลังแอปปิด" จึงฝากไว้กับสคริปต์ที่แยกตัวออกไปรอ
 */
async function install() {
  if (state.busy) return { ok: false, error: 'กำลังอัปเดตอยู่' };
  if (!available()) return { ok: false, error: 'ไม่มีรุ่นใหม่ให้อัปเดต' };

  const dest = appBundlePath();
  const work = path.join(app.getPath('userData'), 'update');
  push({ busy: true, percent: 0, error: null });

  try {
    fs.rmSync(work, { recursive: true, force: true });
    const zip = path.join(work, 'cobik.zip');
    await download(state.url, zip, (p) => push({ percent: p }));

    const staged = path.join(work, 'unpacked');
    fs.mkdirSync(staged, { recursive: true });
    await run('/usr/bin/ditto', ['-x', '-k', zip, staged]);

    const found = fs.readdirSync(staged).find((n) => n.endsWith('.app'));
    if (!found) throw new Error('ในไฟล์ที่โหลดมาไม่มีตัวแอป');
    const fresh = path.join(staged, found);

    const id = await plist(fresh, 'CFBundleIdentifier');
    if (id !== BUNDLE_ID) throw new Error('ไฟล์ที่โหลดมาไม่ใช่แอป Cobik');
    const got = await plist(fresh, 'CFBundleShortVersionString');
    if (got && newer(current(), got)) throw new Error(`รุ่นที่โหลดมาเก่ากว่าที่ใช้อยู่ (${got})`);

    // สลับตัวแอปต้องเกิดหลังโปรเซสนี้ตายแล้ว — ไม่งั้นเขียนทับตัวเองที่กำลังรันอยู่
    const sh = path.join(work, 'swap.sh');
    fs.writeFileSync(sh, `#!/bin/sh
PID="$1"; NEW="$2"; DEST="$3"
i=0
while kill -0 "$PID" 2>/dev/null && [ $i -lt 60 ]; do sleep 0.5; i=$((i+1)); done
rm -rf "$DEST.new" "$DEST.old"
/usr/bin/ditto "$NEW" "$DEST.new" || exit 1
mv "$DEST" "$DEST.old" || exit 1
mv "$DEST.new" "$DEST" || { mv "$DEST.old" "$DEST"; exit 1; }
rm -rf "$DEST.old"
/usr/bin/xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
/usr/bin/open "$DEST"
`, { mode: 0o755 });

    const child = spawn('/bin/sh', [sh, String(process.pid), fresh, dest], {
      detached: true, stdio: 'ignore',
    });
    child.unref();

    push({ percent: 100 });
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  } catch (e) {
    push({ busy: false, percent: 0, error: e?.message || String(e) });
    return { ok: false, error: state.error };
  }
}

/** เปิดหน้า release ในเบราว์เซอร์ — ทางออกสำรองถ้าอัปเดตในแอปพัง */
function openReleases() { shell.openExternal(`https://github.com/${REPO}/releases/latest`); }

function snapshot() {
  return { ...state, current: current(), available: available(), packaged: app.isPackaged };
}

module.exports = { check, install, snapshot, setNotifier, openReleases, newer };
