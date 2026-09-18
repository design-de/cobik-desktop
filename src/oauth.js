// OAuth กับ Cowork — public client + PKCE + redirect กลับ loopback บนเครื่อง
// ไม่มี client secret · token เก็บเข้ารหัสด้วย safeStorage (Keychain ของ macOS)
//
// ขั้นตอน: discovery → ลงทะเบียนแอป (ครั้งเดียว) → เปิดเบราว์เซอร์ให้ผู้ใช้กดอนุญาต
//          → เว็บ redirect กลับ 127.0.0.1 → แลก code เป็น token → เก็บ Keychain
const { app, safeStorage, shell } = require('electron');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function storePath() { return path.join(app.getPath('userData'), 'cobik-auth.bin'); }

function save(obj) {
  const json = JSON.stringify(obj);
  const blob = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8'); // ถ้า Keychain ใช้ไม่ได้จริง ๆ ยังทำงานต่อได้ แต่ไม่เข้ารหัส
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), blob, { mode: 0o600 });
}

function load() {
  try {
    const blob = fs.readFileSync(storePath());
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(blob) : blob.toString('utf8');
    return JSON.parse(json);
  } catch { return null; }
}

function clear() { try { fs.unlinkSync(storePath()); } catch {} }

async function discover(base) {
  const r = await fetch(`${base}/api/oauth/authorization-server`);
  if (!r.ok) throw new Error(`discovery ล้มเหลว (${r.status})`);
  return r.json();
}

async function registerClient(meta, redirectUri) {
  const r = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Cobik Desktop',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.client_id) throw new Error(j.error_description || j.error || 'ลงทะเบียนแอปไม่สำเร็จ');
  return j.client_id;
}

// ── ทางเข้าหลัก: ทำให้แน่ใจว่ามี access token ใช้งานได้ ──
async function connect(base, { interactive = true } = {}) {
  const saved = load();

  // มี refresh อยู่แล้ว → ต่ออายุเงียบ ๆ
  if (saved?.refresh_token && saved?.client_id) {
    try { return await refresh(base, saved); } catch { /* ตกลงไปขอใหม่ */ }
  }
  if (!interactive) return null;

  const meta = await discover(base);

  // เปิดพอร์ตก่อน เพื่อให้รู้เลขพอร์ตแล้วเอาไปประกอบ redirect_uri (ต้องตรงกันทุกขั้น)
  const server = http.createServer();
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const clientId = saved?.client_id || await registerClient(meta, redirectUri);
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.close(); reject(new Error('หมดเวลารออนุญาต (5 นาที)')); }, 5 * 60_000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const err = u.searchParams.get('error');
      const got = u.searchParams.get('code');
      const ok = !err && got && u.searchParams.get('state') === state;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><body style="font:15px/1.6 -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#17171a;color:#ececef">
        <div style="text-align:center"><div style="font-size:34px">${ok ? '✅' : '⚠️'}</div>
        <p>${ok ? 'เชื่อม Cobik กับ Cowork เรียบร้อย<br>กลับไปที่แอปได้เลย' : 'เชื่อมไม่สำเร็จ — ลองใหม่จากในแอป'}</p></div>`);
      clearTimeout(timer);
      setTimeout(() => server.close(), 300);
      ok ? resolve(got) : reject(new Error(err || 'ไม่ได้รับ code'));
    });

    const authUrl = new URL(meta.authorization_endpoint);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'read tasks.write');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    shell.openExternal(authUrl.toString());
  });

  const r = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier,
    }),
  });
  const tok = await r.json();
  if (!r.ok || !tok.access_token) throw new Error(tok.error_description || tok.error || 'แลก token ไม่สำเร็จ');

  const rec = {
    client_id: clientId,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    scope: tok.scope,
    expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
  };
  save(rec);
  return rec;
}

async function refresh(base, saved) {
  // ยังไม่ใกล้หมดอายุ → ใช้ตัวเดิม
  if (saved.access_token && saved.expires_at && saved.expires_at - Date.now() > 60_000) return saved;

  const meta = await discover(base);
  const r = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: saved.refresh_token,
      client_id: saved.client_id,
    }),
  });
  const tok = await r.json();
  if (!r.ok || !tok.access_token) throw new Error(tok.error_description || tok.error || 'ต่ออายุ token ไม่สำเร็จ');

  const rec = {
    ...saved,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || saved.refresh_token,
    scope: tok.scope || saved.scope,
    expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
  };
  save(rec);
  return rec;
}

function status() {
  const s = load();
  if (!s) return { connected: false };
  return { connected: true, scope: s.scope, expiresAt: s.expires_at, encrypted: safeStorage.isEncryptionAvailable() };
}

module.exports = { connect, refresh, status, clear, load };
