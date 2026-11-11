/* =====================================================================
   RESONANCE STORE · data server (Node.js 18+, PostgreSQL 13+, package "pg")
   - Serves the web app (RESONANCE_STORE.html + files next to it), only to logged-in users
   - Log-in: user name = GID, password = the same GID (lab rule); roles admin / user / viewer; admins manage users in users.html
   - Keeps ONE shared copy of the data for every PC in PostgreSQL:  GET/PUT /api/data
   - Automatic backups (table rs_backups): every hour with changes + every shift change (06:00 / 18:00),
     kept KEEP_DAYS days, and copied as files to backupDir (OneDrive / SharePoint) when set
   First time:  npm install   ·   run db/schema.sql in pgAdmin (or let the server create the tables)
   Start:       node server.js        then open  http://<this-pc>:8080
   Settings:    server-config.json next to this file (see db/วิธีตั้งค่าฐานข้อมูล.md)
   ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Pool } = require('pg');

const ROOT = __dirname;
const cfg = Object.assign({ port: 8080, dataDir: 'data', backupDir: '', keepDays: 30, sessionHours: 12, secureCookie: 'auto', trustProxy: true, database: null },
  readJsonFile(path.join(ROOT, 'server-config.json')) || {});
const PORT = Number(process.env.PORT || cfg.port);
const DATA_DIR = path.resolve(ROOT, process.env.RS_DATA_DIR || cfg.dataDir);
const OLD_DATA_FILE = path.join(DATA_DIR, 'resonance-data.json');      /* JSON store used before PostgreSQL: imported once */
const BACKUP_DIR = cfg.backupDir ? path.resolve(ROOT, cfg.backupDir) : '';
const KEEP_DAYS = Number(cfg.keepDays) || 30;
const SESSION_MS = (Number(cfg.sessionHours) || 12) * 36e5;
const MAX_BODY = 60 * 1024 * 1024;
const HOUR = 36e5;
const ROLES = ['admin', 'user', 'viewer'];
const COOKIE = 'rs_sid';

function readJsonFile(f){ try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function log(...a){ console.log(new Date().toLocaleString('en-GB'), '·', ...a); }

/* ---------- database ---------- */
const dbConf = process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : cfg.database;
if (!dbConf){
  console.error('\n  ✖ No database settings.\n    Add "database": { "host", "port", "database", "user", "password" } to server-config.json\n    (see db/วิธีตั้งค่าฐานข้อมูล.md), then start again.\n');
  process.exit(1);
}
const pool = new Pool(Object.assign({ max: 10, idleTimeoutMillis: 30000 }, dbConf));
pool.on('error', e => log('DB pool error', e.message));
const q = (text, params) => pool.query(text, params);
async function tx(fn){
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e){ await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}
let changedSinceBackup = false, lastBackupAt = 0;

async function keysSince(c, since){
  const r = await c.query('SELECT key, value FROM rs_kv WHERE ver > $1', [since]);
  return Object.fromEntries(r.rows.map(x => [x.key, x.value]));
}
async function currentVersion(){ return Number((await q('SELECT version FROM rs_meta WHERE id = 1')).rows[0].version); }

/* tables are created if missing (same file the admin can run in pgAdmin), then the old JSON data is moved in once */
async function prepareDb(){
  await q(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));
  const v = await currentVersion(), n = Number((await q('SELECT count(*) FROM rs_kv')).rows[0].count);
  const old = !v && !n && readJsonFile(OLD_DATA_FILE);
  if (old && old.keys && Object.keys(old.keys).length){
    await tx(async c => {
      const ver = Math.max(1, Number(old.version) || 1);
      for (const [k, x] of Object.entries(old.keys)){
        await c.query('INSERT INTO rs_kv (key, value, ver, updated_by) VALUES ($1, $2, $3, $4)', [k, typeof x === 'string' ? x : x && x.v, ver, 'import']);
        await c.query('SELECT rs_refresh($1)', [k]);
      }
      await c.query('UPDATE rs_meta SET version = $1, updated_at = now() WHERE id = 1', [ver]);
    });
    log(`moved ${Object.keys(old.keys).length} data sets from ${OLD_DATA_FILE} into PostgreSQL (version ${old.version})`);
    await backup('first', 'import');
  }
}

/* ---------- backups (table rs_backups + optional file copy for OneDrive / SharePoint) ---------- */
const p2 = n => String(n).padStart(2, '0');
const stampOf = d => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
async function snapshot(){
  const [m, r] = await Promise.all([q('SELECT version, updated_at FROM rs_meta WHERE id = 1'), q('SELECT key, value, ver FROM rs_kv')]);
  return { version: Number(m.rows[0].version), updatedAt: m.rows[0].updated_at, keys: Object.fromEntries(r.rows.map(x => [x.key, { v: x.value, ver: Number(x.ver) }])) };
}
async function backup(reason, by, payload){
  const name = `resonance-${stampOf(new Date())}-${reason}.json`;
  const data = payload || await snapshot();
  const text = JSON.stringify(data);
  await q('INSERT INTO rs_backups (name, reason, created_by, size_bytes, data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING',
    [name, reason, by || null, Buffer.byteLength(text), text]);
  if (BACKUP_DIR){
    try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); fs.writeFileSync(path.join(BACKUP_DIR, name), text); }
    catch (e){ log('BACKUP FILE COPY FAILED', BACKUP_DIR, e.message); }
  }
  if (!payload){ lastBackupAt = Date.now(); changedSinceBackup = false; }
  log('backup', name, BACKUP_DIR ? `→ table + ${BACKUP_DIR}` : '→ table');
  await prune();
  return name;
}
async function prune(){
  /* older than KEEP_DAYS goes, but the newest 10 always stay */
  await q(`DELETE FROM rs_backups WHERE created_at < now() - make_interval(days => $1)
           AND id NOT IN (SELECT id FROM rs_backups ORDER BY created_at DESC LIMIT 10)`, [KEEP_DAYS]);
  if (!BACKUP_DIR) return;
  let files = [];
  try { files = fs.readdirSync(BACKUP_DIR).filter(f => /^resonance-.*\.json$/.test(f)).sort(); } catch { return; }
  const cutoff = Date.now() - KEEP_DAYS * 24 * HOUR;
  files.slice(0, -10).forEach(f => { const p = path.join(BACKUP_DIR, f); try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {} });
}
let lastShiftMark = shiftMark(new Date());
function shiftMark(d){ const h = d.getHours(); return `${d.toDateString()}-${h >= 6 && h < 18 ? 'D' : 'N'}`; }
setInterval(async () => {
  try {
    const mark = shiftMark(new Date());
    if (mark !== lastShiftMark){ lastShiftMark = mark; await backup('shift'); }
    else if (changedSinceBackup && Date.now() - lastBackupAt >= HOUR) await backup('auto');
    await q('DELETE FROM user_sessions WHERE expires_at < now()');
  } catch (e){ log('timer error', e.message); }
}, 60 * 1000);

/* ---------- passwords + sessions ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashPw(pw){
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}
function checkPw(pw, stored){
  const [kind, N, r, p, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !hash){ crypto.scryptSync(String(pw), 'x', 64, SCRYPT); return false; }   /* same work either way */
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(want, got);
}
/* lab rule (user's choice, 2026-11-11): each person logs in with their own GID as user name AND password,
   so nobody has to hand out or remember passwords; it is still stored only as a hash */
const gidPw = gid => hashPw(gid);
const normGid = v => String(v ?? '').trim().toUpperCase();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const clientIp = req => String((cfg.trustProxy && req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '').slice(0, 64);
const isHttps = req => cfg.secureCookie === true || (cfg.secureCookie === 'auto' && (req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https'));
function cookieOf(req, name){
  for (const part of String(req.headers.cookie || '').split(';')){ const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
  return '';
}
function setSessionCookie(req, res, token, maxAgeMs){
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${isHttps(req) ? '; Secure' : ''}`);
}
async function startSession(req, res, gid){
  const token = crypto.randomBytes(32).toString('base64url');
  await q('INSERT INTO user_sessions (token_hash, gid, expires_at, ip, user_agent) VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5)',
    [sha(token), gid, SESSION_MS / 1000, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300)]);
  setSessionCookie(req, res, token, SESSION_MS);
}
/* the logged-in user of this request, or null */
async function sessionUser(req){
  const token = cookieOf(req, COOKIE);
  if (!token || token.length > 100) return null;
  const r = await q(`SELECT u.gid, u.full_name, u.role, u.crew, u.must_change_password, s.token_hash, s.last_seen_at
    FROM user_sessions s JOIN app_users u ON u.gid = s.gid WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [sha(token)]);
  const u = r.rows[0];
  if (!u) return null;
  if (Date.now() - new Date(u.last_seen_at).getTime() > 60000) q('UPDATE user_sessions SET last_seen_at = now() WHERE token_hash = $1', [u.token_hash]).catch(() => {});
  return { gid: u.gid, name: u.full_name, role: u.role, crew: u.crew, mustChange: u.must_change_password, tokenHash: u.token_hash };
}
const pubUser = u => u && { gid: u.gid, name: u.name, role: u.role, crew: u.crew, mustChange: u.mustChange };
const loginLog = (req, gid, ok, reason) => q('INSERT INTO login_log (gid, ok, reason, ip, user_agent) VALUES ($1, $2, $3, $4, $5)',
  [gid ? String(gid).slice(0, 20) : null, ok, reason, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300)]).catch(() => {});
const adminLog = (admin, target, action, detail) => q('INSERT INTO user_admin_log (admin_gid, target_gid, action, detail) VALUES ($1, $2, $3, $4)',
  [admin, target, action, detail ? JSON.stringify(detail) : null]).catch(() => {});

/* first admin: only while there is no active admin, and only with the one-time token printed in the server log */
let setupToken = '';
async function checkSetup(){
  const n = Number((await q(`SELECT count(*) FROM app_users WHERE role = 'admin' AND active`)).rows[0].count);
  if (n){ setupToken = ''; try { fs.unlinkSync(path.join(DATA_DIR, 'setup-token.txt')); } catch {} return false; }
  if (!setupToken){
    setupToken = process.env.RS_SETUP_TOKEN || crypto.randomBytes(9).toString('base64url');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'setup-token.txt'), setupToken + '\n');
    log(`NO ADMIN YET · open /login.html and create the first admin with setup code: ${setupToken}  (also in ${path.join(DATA_DIR, 'setup-token.txt')})`);
  }
  return true;
}
/* simple brake on password guessing from one address: 20 failures in 15 minutes */
const ipFails = new Map();
function ipBlocked(ip){ const x = ipFails.get(ip); return x && x.n >= 20 && Date.now() - x.at < 15 * 60000; }
function ipFail(ip){ const x = ipFails.get(ip); if (!x || Date.now() - x.at > 15 * 60000) ipFails.set(ip, { n: 1, at: Date.now() }); else x.n++; }

/* ---------- http helpers ---------- */
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.csv':'text/csv; charset=utf-8', '.woff2':'font/woff2', '.pdf':'application/pdf' };
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };
function send(res, code, body, type){
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SEC_HEADERS));
  res.end(data);
}
function redirect(res, to){ res.writeHead(302, Object.assign({ Location: to, 'Cache-Control': 'no-store' }, SEC_HEADERS)); res.end(); }
function readBody(req){
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY){ reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
}

/* app version each PC runs (sync.js sends X-RS-Ver; files from before 2026-11-10 send none = "old") */
const clients = new Map();
function seenClient(req){
  clients.set(`${clientIp(req)}|${req.headers['user-agent'] || ''}`, { ver: String(req.headers['x-rs-ver'] || 'old').slice(0, 20), at: Date.now() });
  const vers = {};
  for (const [k, c] of clients){ if (Date.now() - c.at > 120000) clients.delete(k); else vers[c.ver] = (vers[c.ver] || 0) + 1; }
  return vers;
}
const KEY_RE = /^[A-Za-z0-9_]{1,40}$/;

/* ---------- API ---------- */
async function api(req, res, url){
  const route = `${req.method} ${url.pathname}`;
  /* writes need a custom header: a page on another site cannot send one, so no cross-site form can act for a user */
  if (req.method !== 'GET' && !req.headers['x-rs-ver'] && !req.headers['x-requested-with']) return send(res, 403, { error: 'missing header' });

  /* ----- log-in (no session needed) ----- */
  if (route === 'GET /api/auth/status'){
    const user = await sessionUser(req);
    return send(res, 200, { setupNeeded: await checkSetup(), user: pubUser(user) });
  }
  if (route === 'POST /api/auth/login'){
    const ip = clientIp(req);
    if (ipBlocked(ip)) return send(res, 429, { error: 'เข้าระบบไม่ได้ชั่วคราว ลองใหม่ภายหลัง' });
    const b = await readBody(req), gid = normGid(b.gid);
    const u = (await q('SELECT * FROM app_users WHERE gid = $1', [gid])).rows[0];
    const fail = async (reason, msg, code) => { ipFail(ip); await loginLog(req, gid, false, reason); return send(res, code || 401, { error: msg || 'User หรือ Password ไม่ถูกต้อง' }); };
    if (!u){ checkPw(b.password, ''); return fail('unknown gid'); }
    /* the log-in page says as little as possible: no hint whether a GID exists or why it is locked */
    if (u.locked_until && new Date(u.locked_until) > new Date()) return fail('locked', 'เข้าระบบไม่ได้ชั่วคราว ลองใหม่ภายหลัง', 423);
    if (!checkPw(String(b.password ?? '').trim().toUpperCase(), u.password_hash)){   /* password = GID, so case and spaces don't matter */
      const n = u.failed_logins + 1;
      await q(`UPDATE app_users SET failed_logins = CASE WHEN $2 >= 5 THEN 0 ELSE $2 END,
               locked_until = CASE WHEN $2 >= 5 THEN now() + interval '15 minutes' END WHERE gid = $1`, [gid, n]);
      return fail('wrong password', n >= 5 ? 'เข้าระบบไม่ได้ชั่วคราว ลองใหม่ภายหลัง' : undefined);
    }
    if (!u.active) return fail('inactive', undefined, 403);
    await q('UPDATE app_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE gid = $1', [gid]);
    await startSession(req, res, gid);
    await loginLog(req, gid, true, 'ok');
    return send(res, 200, { user: { gid, name: u.full_name, role: u.role, crew: u.crew, mustChange: u.must_change_password } });
  }
  if (route === 'POST /api/auth/setup'){
    if (!await checkSetup()) return send(res, 409, { error: 'มีแอดมินแล้ว ให้ล็อกอินตามปกติ' });
    const b = await readBody(req), gid = normGid(b.gid), name = String(b.name || '').trim();
    if (!b.token || String(b.token).trim() !== setupToken) return send(res, 403, { error: 'รหัสตั้งค่า (setup code) ไม่ถูกต้อง · ดูใน log ของ server หรือไฟล์ data/setup-token.txt' });
    if (!/^[A-Z0-9._-]{2,20}$/.test(gid) || !name) return send(res, 400, { error: 'ใส่ GID (2–20 ตัว A-Z 0-9 . _ -) และชื่อ' });
    await q(`INSERT INTO app_users (gid, full_name, role, password_hash, must_change_password, created_by, updated_by) VALUES ($1, $2, 'admin', $3, false, 'setup', 'setup')
             ON CONFLICT (gid) DO UPDATE SET full_name = $2, role = 'admin', active = true, password_hash = $3, must_change_password = false, updated_at = now(), updated_by = 'setup'`,
      [gid, name, gidPw(gid)]);
    await adminLog(gid, gid, 'setup', { name });
    await checkSetup();
    await startSession(req, res, gid);
    await loginLog(req, gid, true, 'setup');
    log('first admin created:', gid);
    return send(res, 200, { user: { gid, name, role: 'admin', mustChange: false } });
  }

  /* ----- everything below needs a session ----- */
  const me = await sessionUser(req);
  if (!me) return send(res, 401, { error: 'login required' });
  if (route === 'GET /api/auth/me') return send(res, 200, { user: pubUser(me) });
  if (route === 'POST /api/auth/logout'){
    await q('DELETE FROM user_sessions WHERE token_hash = $1', [me.tokenHash]);
    await loginLog(req, me.gid, true, 'logout');
    setSessionCookie(req, res, '', 0);
    return send(res, 200, { ok: true });
  }

  const can = { write: me.role !== 'viewer', admin: me.role === 'admin' };
  const deny = () => send(res, 403, { error: me.role === 'viewer' ? 'สิทธิ์ Viewer ดูได้อย่างเดียว' : 'เฉพาะแอดมิน' });

  /* ----- user admin ----- */
  if (url.pathname === '/api/users' || url.pathname.startsWith('/api/users/') || url.pathname === '/api/login-log'){
    if (!can.admin) return deny();
    return usersApi(req, res, url, me);
  }

  /* ----- shared data ----- */
  const apps = url.pathname === '/api/data' ? seenClient(req) : undefined;
  if (route === 'GET /api/health'){
    const [v, b] = await Promise.all([q('SELECT version, updated_at FROM rs_meta WHERE id = 1'), q('SELECT count(*) AS n, max(created_at) AS last FROM rs_backups')]);
    return send(res, 200, { ok: true, version: Number(v.rows[0].version), updatedAt: v.rows[0].updated_at, lastBackupAt: b.rows[0].last,
      backupDirs: ['PostgreSQL', BACKUP_DIR].filter(Boolean), keepDays: KEEP_DAYS, backups: Number(b.rows[0].n), user: pubUser(me) });
  }
  if (route === 'GET /api/data'){
    const since = Number(url.searchParams.get('since')) || 0;
    const version = await currentVersion();
    return send(res, 200, { version, keys: await keysSince(pool, since), apps, user: pubUser(me) });
  }
  /* { base, set: { key: string } }  ·  409 if another PC changed one of these keys after `base` */
  if (route === 'PUT /api/data'){
    if (!can.write) return deny();
    const body = await readBody(req);
    const base = Number(body.base) || 0, set = body.set && typeof body.set === 'object' ? body.set : {};
    const keys = Object.keys(set);
    if (keys.some(k => !KEY_RE.test(k))) return send(res, 400, { error: 'bad key' });
    const out = await tx(async c => {
      const version = Number((await c.query('SELECT version FROM rs_meta WHERE id = 1 FOR UPDATE')).rows[0].version);
      const conflicts = (await c.query('SELECT key FROM rs_kv WHERE key = ANY($1) AND ver > $2', [keys, base])).rows.map(r => r.key);
      if (conflicts.length) return { status: 409, body: { version, conflicts, keys: await keysSince(c, base) } };
      const missed = await keysSince(c, base);
      const next = version + 1;
      for (const k of keys){
        await c.query(`INSERT INTO rs_kv (key, value, ver, updated_at, updated_by) VALUES ($1, $2, $3, now(), $4)
          ON CONFLICT (key) DO UPDATE SET value = $2, ver = $3, updated_at = now(), updated_by = $4`, [k, typeof set[k] === 'string' ? set[k] : null, next, me.gid]);
        await c.query('SELECT rs_refresh($1)', [k]);
        delete missed[k];
      }
      await c.query('UPDATE rs_meta SET version = $1, updated_at = now() WHERE id = 1', [next]);
      return { status: 200, body: { version: next, keys: missed } };
    });
    if (out.status === 200){
      changedSinceBackup = true;
      if (!lastBackupAt && !Number((await q('SELECT count(*) FROM rs_backups')).rows[0].count)) await backup('first', me.gid);
    }
    return send(res, out.status, out.body);
  }

  if (route === 'POST /api/backup'){ if (!can.write) return deny(); return send(res, 200, { name: await backup('manual', me.gid) }); }
  if (route === 'GET /api/backups'){
    const r = await q('SELECT name, size_bytes, created_at FROM rs_backups ORDER BY created_at DESC LIMIT 500');
    return send(res, 200, r.rows.map(x => ({ name: x.name, size: x.size_bytes, at: x.created_at })));
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/backups/')){
    const name = path.basename(decodeURIComponent(url.pathname.slice('/api/backups/'.length)));
    const r = await q('SELECT data::text AS data FROM rs_backups WHERE name = $1', [name]);
    if (!r.rows[0]) return send(res, 404, { error: 'not found' });
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' }, SEC_HEADERS));
    return res.end(r.rows[0].data);
  }

  /* { name } = restore a server backup  ·  { keys } = restore from a file the user uploaded · admins only */
  if (route === 'POST /api/restore'){
    if (!can.admin) return deny();
    const body = await readBody(req);
    let keys = body.keys;
    if (body.name){
      const r = await q('SELECT data FROM rs_backups WHERE name = $1', [path.basename(String(body.name))]);
      const snap = r.rows[0] && r.rows[0].data;
      if (!snap || !snap.keys) return send(res, 404, { error: 'backup not found' });
      keys = Object.fromEntries(Object.entries(snap.keys).map(([k, x]) => [k, typeof x === 'string' ? x : x && x.v]));
    }
    if (!keys || typeof keys !== 'object' || Object.keys(keys).some(k => !KEY_RE.test(k))) return send(res, 400, { error: 'no keys' });
    await backup('before-restore', me.gid);
    const version = await tx(async c => {
      const next = Number((await c.query('SELECT version FROM rs_meta WHERE id = 1 FOR UPDATE')).rows[0].version) + 1;
      /* keys missing from the restored set become null, so other PCs drop them too */
      await c.query('UPDATE rs_kv SET value = NULL, ver = $1, updated_at = now(), updated_by = $2', [next, me.gid]);
      for (const [k, v] of Object.entries(keys)) if (typeof v === 'string')
        await c.query(`INSERT INTO rs_kv (key, value, ver, updated_by) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET value = $2, ver = $3, updated_at = now(), updated_by = $4`, [k, v, next, me.gid]);
      for (const k of (await c.query('SELECT key FROM rs_kv')).rows.map(r => r.key)) await c.query('SELECT rs_refresh($1)', [k]);
      await c.query('UPDATE rs_meta SET version = $1, updated_at = now() WHERE id = 1', [next]);
      return next;
    });
    changedSinceBackup = true;
    log('restore', body.name || 'uploaded file', 'by', me.gid, '→ version', version);
    return send(res, 200, { version });
  }

  /* a PC lost a save race: keep its copy as a backup so nothing is lost */
  if (route === 'POST /api/conflict'){
    if (!can.write) return deny();
    const body = await readBody(req);
    return send(res, 200, { name: await backup('conflict', me.gid, { savedAt: new Date().toISOString(), client: String(body.client || '').slice(0, 300), gid: me.gid, base: body.base, keys: body.set || {} }) });
  }
  return send(res, 404, { error: 'unknown api' });
}

/* ---------- user admin API (admins only) ---------- */
const USER_COLS = 'gid, full_name AS name, role, crew, department, active, must_change_password AS "mustChange", last_login_at AS "lastLogin", created_at AS "createdAt", created_by AS "createdBy", (locked_until IS NOT NULL AND locked_until > now()) AS locked';
function cleanUser(b, partial){
  const o = {};
  if (!partial || b.name !== undefined){ o.name = String(b.name ?? '').trim().slice(0, 120); if (!o.name) return { error: 'ใส่ชื่อ-นามสกุล' }; }
  if (!partial || b.role !== undefined){ o.role = String(b.role || 'user').toLowerCase().trim(); if (!ROLES.includes(o.role)) return { error: 'สิทธิ์ต้องเป็น admin / user / viewer' }; }
  if (!partial || b.crew !== undefined) o.crew = String(b.crew ?? '').trim().toUpperCase().slice(0, 10) || null;
  if (!partial || b.department !== undefined) o.department = String(b.department ?? '').trim().slice(0, 80) || null;
  if (b.active !== undefined) o.active = !!b.active;
  return o;
}
async function activeAdmins(c, exceptGid){
  return Number((await c.query(`SELECT count(*) FROM app_users WHERE role = 'admin' AND active AND gid <> $1`, [exceptGid || ''])).rows[0].count);
}
async function usersApi(req, res, url, me){
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/users') return send(res, 200, (await q(`SELECT ${USER_COLS} FROM app_users ORDER BY active DESC, role, full_name`)).rows);
  if (route === 'GET /api/login-log'){
    const limit = Math.min(1000, Number(url.searchParams.get('limit')) || 200);
    return send(res, 200, (await q('SELECT l.at, l.gid, u.full_name AS name, l.ok, l.reason, l.ip FROM login_log l LEFT JOIN app_users u ON u.gid = l.gid ORDER BY l.at DESC LIMIT $1', [limit])).rows);
  }
  /* add one user; they log in with GID / GID */
  if (route === 'POST /api/users'){
    const b = await readBody(req), gid = normGid(b.gid), u = cleanUser(b);
    if (!/^[A-Z0-9._-]{2,20}$/.test(gid)) return send(res, 400, { error: 'GID ต้องเป็น A-Z 0-9 . _ - ยาว 2–20 ตัว' });
    if (u.error) return send(res, 400, { error: u.error });
    if ((await q('SELECT 1 FROM app_users WHERE gid = $1', [gid])).rows[0]) return send(res, 409, { error: `GID ${gid} มีอยู่แล้ว` });
    await q(`INSERT INTO app_users (gid, full_name, role, crew, department, password_hash, must_change_password, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, false, $7, $7)`,
      [gid, u.name, u.role, u.crew, u.department, gidPw(gid), me.gid]);
    await adminLog(me.gid, gid, 'add', { name: u.name, role: u.role, crew: u.crew });
    return send(res, 200, { gid });
  }
  /* add many users from Excel / CSV rows: new GIDs are added (GID / GID log-in), existing GIDs get their name / crew / role updated */
  if (route === 'POST /api/users/import'){
    const b = await readBody(req), list = Array.isArray(b.users) ? b.users.slice(0, 2000) : [];
    const result = { added: [], updated: [], skipped: [] };
    await tx(async c => {
      for (const raw of list){
        const gid = normGid(raw.gid), u = cleanUser(raw, true);
        if (!/^[A-Z0-9._-]{2,20}$/.test(gid)){ result.skipped.push({ gid: raw.gid, why: 'GID ไม่ถูกรูปแบบ' }); continue; }
        if (u.error){ result.skipped.push({ gid, why: u.error }); continue; }
        const had = (await c.query('SELECT gid FROM app_users WHERE gid = $1', [gid])).rows[0];
        if (!had){
          if (!u.name){ result.skipped.push({ gid, why: 'ไม่มีชื่อ' }); continue; }
          await c.query(`INSERT INTO app_users (gid, full_name, role, crew, department, password_hash, must_change_password, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, false, $7, $7)`,
            [gid, u.name, u.role || 'user', u.crew ?? null, u.department ?? null, gidPw(gid), me.gid]);
          result.added.push({ gid, name: u.name, role: u.role || 'user' });
        } else {
          if (gid === me.gid) delete u.role;                                   /* an admin cannot demote themselves by import */
          const sets = Object.keys(u).filter(k => k !== 'active');
          if (!sets.length){ result.skipped.push({ gid, why: 'ไม่มีอะไรเปลี่ยน' }); continue; }
          const col = { name: 'full_name', role: 'role', crew: 'crew', department: 'department' };
          await c.query(`UPDATE app_users SET ${sets.map((k, i) => `${col[k]} = $${i + 2}`).join(', ')}, updated_at = now(), updated_by = $${sets.length + 2} WHERE gid = $1`,
            [gid, ...sets.map(k => u[k]), me.gid]);
          result.updated.push({ gid });
        }
      }
      if (!await activeAdmins(c)) throw Object.assign(new Error('ต้องเหลือแอดมินอย่างน้อย 1 คน'), { status: 400 });
    });
    await adminLog(me.gid, null, 'import', { added: result.added.length, updated: result.updated.length, skipped: result.skipped.length });
    return send(res, 200, result);
  }
  const m = /^\/api\/users\/([^/]+)(\/reset)?$/.exec(url.pathname);
  if (m){
    const gid = normGid(decodeURIComponent(m[1]));
    const cur = (await q('SELECT gid, role, active FROM app_users WHERE gid = $1', [gid])).rows[0];
    if (!cur) return send(res, 404, { error: 'ไม่พบผู้ใช้' });
    /* unlock after 5 wrong tries, and put the password back to the GID */
    if (req.method === 'POST' && m[2]){
      await q(`UPDATE app_users SET password_hash = $2, must_change_password = false, failed_logins = 0, locked_until = NULL, updated_at = now(), updated_by = $3 WHERE gid = $1`, [gid, gidPw(gid), me.gid]);
      await adminLog(me.gid, gid, 'reset-password');
      return send(res, 200, { gid });
    }
    if (req.method === 'PUT' && !m[2]){
      const b = await readBody(req), u = cleanUser(b, true);
      if (u.error) return send(res, 400, { error: u.error });
      if (gid === me.gid && (u.active === false || (u.role && u.role !== 'admin'))) return send(res, 400, { error: 'ปิดหรือลดสิทธิ์บัญชีตัวเองไม่ได้ · ให้แอดมินอีกคนทำ' });
      const losingAdmin = cur.role === 'admin' && cur.active && (u.active === false || (u.role && u.role !== 'admin'));
      if (losingAdmin && !await activeAdmins(pool, gid)) return send(res, 400, { error: 'ต้องเหลือแอดมินอย่างน้อย 1 คน' });
      const col = { name: 'full_name', role: 'role', crew: 'crew', department: 'department', active: 'active' };
      const sets = Object.keys(u);
      if (!sets.length) return send(res, 400, { error: 'ไม่มีอะไรเปลี่ยน' });
      await q(`UPDATE app_users SET ${sets.map((k, i) => `${col[k]} = $${i + 2}`).join(', ')}, updated_at = now(), updated_by = $${sets.length + 2} WHERE gid = $1`,
        [gid, ...sets.map(k => u[k]), me.gid]);
      if (u.active === false || u.role) await q('DELETE FROM user_sessions WHERE gid = $1', [gid]);   /* new rights apply from the next log-in */
      await adminLog(me.gid, gid, 'edit', u);
      return send(res, 200, (await q(`SELECT ${USER_COLS} FROM app_users WHERE gid = $1`, [gid])).rows[0]);
    }
  }
  return send(res, 404, { error: 'unknown api' });
}

/* ---------- static files (only from this folder, never above it; the app itself only after log-in) ---------- */
/* the log-in page uses the app's own stylesheet and the 3D library for its decorative racks; neither holds data */
const PUBLIC = new Set(['/login.html', '/sw.js', '/styles.css', '/lib/three.min.js']);
const BLOCKED = /^[\\/](data|db|node_modules|deploy|_[^\\/]*|\.[^\\/]*)([\\/]|$)|server\.js$|server-config[^\\/]*$|package(-lock)?\.json$|\.(pptx|xlsx|csv|mp4|bak|log|md|bat|vbs|ps1|txt)$/i;
async function serveStatic(req, res, url){
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/favicon.ico'){ res.writeHead(204); return res.end(); }
  if (rel === '/') rel = '/RESONANCE_STORE.html';
  const f = path.join(ROOT, path.normalize(rel));
  if (!f.startsWith(ROOT + path.sep) || f.startsWith(DATA_DIR) || BLOCKED.test(f.slice(ROOT.length))) return send(res, 403, 'forbidden', 'text/plain');
  const isPage = /\.html?$/i.test(f);
  if (!PUBLIC.has(rel)){
    const me = await sessionUser(req);
    if (!me) return isPage ? redirect(res, `/login.html?next=${encodeURIComponent(url.pathname + url.search)}`) : send(res, 401, 'login required', 'text/plain');
    if (rel === '/users.html' && me.role !== 'admin') return redirect(res, '/');
  }
  fs.readFile(f, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e){
    log('ERROR', req.method, url.pathname, e.message);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server error' });
  }
});

(async () => {
  try { await prepareDb(); }
  catch (e){
    console.error(`\n  ✖ Cannot use the database: ${e.message}\n    Check "database" in server-config.json, that PostgreSQL runs, and that the user may create tables\n    (or run db/schema.sql in pgAdmin first).\n`);
    process.exit(1);
  }
  await checkSetup();
  server.listen(PORT, async () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    log(`Resonance Store server · data version ${await currentVersion()} · PostgreSQL ${dbConf.connectionString ? '(DATABASE_URL)' : `${dbConf.host || 'localhost'}:${dbConf.port || 5432}/${dbConf.database}`}`);
    log(`open on this PC:     http://localhost:${PORT}`);
    ips.forEach(ip => log(`open from other PCs: http://${ip}:${PORT}`));
    log('backups  : table rs_backups', BACKUP_DIR ? `+ files in ${BACKUP_DIR}` : '', `· keep ${KEEP_DAYS} days`);
  });
})();

/* backup once more on a normal shutdown (Ctrl+C) */
process.on('SIGINT', async () => { try { if (changedSinceBackup) await backup('shutdown'); await pool.end(); } catch {} process.exit(0); });
