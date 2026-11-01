/* =====================================================================
   RESONANCE STORE · data server (Node.js 18+, no packages needed)
   - Serves the web app (RESONANCE_STORE.html + files next to it)
   - Keeps ONE shared copy of the data for every PC:  GET/PUT /api/data
   - Automatic backups: every hour with changes + every shift change (06:00 / 18:00),
     kept KEEP_DAYS days, written to data/backups and (optionally) a OneDrive / SharePoint folder
   Start:  node server.js        then open  http://<this-pc>:8080
   Settings: server-config.json next to this file (see DEPLOY_FOR_DEV.md)
   ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const cfg = Object.assign({ port: 8080, dataDir: 'data', backupDir: '', keepDays: 30 },
  readJsonFile(path.join(ROOT, 'server-config.json')) || {});
const PORT = Number(process.env.PORT || cfg.port);
const DATA_DIR = path.resolve(ROOT, process.env.RS_DATA_DIR || cfg.dataDir);
const DATA_FILE = path.join(DATA_DIR, 'resonance-data.json');
const BACKUP_DIRS = [path.join(DATA_DIR, 'backups'), cfg.backupDir && path.resolve(ROOT, cfg.backupDir)].filter(Boolean);
const KEEP_DAYS = Number(cfg.keepDays) || 30;
const MAX_BODY = 60 * 1024 * 1024;
const HOUR = 36e5;

function readJsonFile(f){ try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function log(...a){ console.log(new Date().toLocaleString('en-GB'), '·', ...a); }

/* ---------- data: { version, updatedAt, keys: { name: { v: <string>, ver: <n> } } } ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = readJsonFile(DATA_FILE) || { version: 0, updatedAt: null, keys: {} };
let lastBackupAt = 0, changedSinceBackup = false;

/* write to a temp file first, then rename: a crash mid-write never leaves a half file */
function saveDb(){
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}
function keysSince(since){
  const out = {};
  for (const [k, x] of Object.entries(db.keys)) if (x.ver > since) out[k] = x.v;
  return out;
}

/* ---------- backups ---------- */
/* local time in the file name, e.g. resonance-20261030-1800-shift.json */
const p2 = n => String(n).padStart(2, '0');
const stampOf = d => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
function backup(reason, payload){
  const name = `resonance-${stampOf(new Date())}-${reason}.json`;
  const text = payload ? JSON.stringify(payload) : JSON.stringify(db);
  const ok = [];
  for (const dir of BACKUP_DIRS){
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text); ok.push(dir); }
    catch (e){ log('BACKUP FAILED', dir, e.message); }
  }
  if (!payload){ lastBackupAt = Date.now(); changedSinceBackup = false; }
  log('backup', name, '→', ok.join(' | ') || 'none');
  prune();
  return name;
}
function prune(){
  const cutoff = Date.now() - KEEP_DAYS * 24 * HOUR;
  for (const dir of BACKUP_DIRS){
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /^resonance-.*\.json$/.test(f)).sort(); } catch { continue; }
    /* always keep the newest 10, whatever their age */
    files.slice(0, -10).forEach(f => {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
    });
  }
}
function listBackups(){
  const dir = BACKUP_DIRS[0];
  try {
    return fs.readdirSync(dir).filter(f => /^resonance-.*\.json$/.test(f)).sort().reverse()
      .map(f => { const s = fs.statSync(path.join(dir, f)); return { name: f, size: s.size, at: s.mtime.toISOString() }; });
  } catch { return []; }
}
/* hourly backup when something changed; a backup at every shift change (06:00 and 18:00) */
let lastShiftMark = shiftMark(new Date());
function shiftMark(d){ const h = d.getHours(); return `${d.toDateString()}-${h >= 6 && h < 18 ? 'D' : 'N'}`; }
setInterval(() => {
  const now = new Date(), mark = shiftMark(now);
  if (mark !== lastShiftMark){ lastShiftMark = mark; backup('shift'); }
  else if (changedSinceBackup && Date.now() - lastBackupAt >= HOUR) backup('auto');
}, 60 * 1000);

/* ---------- http helpers ---------- */
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.csv':'text/csv; charset=utf-8', '.woff2':'font/woff2' };
function send(res, code, body, type){
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}
function readBody(req){
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY){ reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e){ reject(e); } });
    req.on('error', reject);
  });
}
/* replace every key with the given set (restore); all PCs pick it up on their next poll */
function replaceAll(keys){
  backup('before-restore');
  db.version++;
  /* keys missing from the restored set become null, so other PCs drop them too */
  for (const k of Object.keys(db.keys)) db.keys[k] = { v: null, ver: db.version };
  for (const [k, v] of Object.entries(keys)) if (typeof v === 'string') db.keys[k] = { v, ver: db.version };
  db.updatedAt = new Date().toISOString();
  saveDb(); changedSinceBackup = true;
}

/* ---------- API ---------- */
async function api(req, res, url){
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/health')
    return send(res, 200, { ok: true, version: db.version, updatedAt: db.updatedAt, lastBackupAt: lastBackupAt ? new Date(lastBackupAt).toISOString() : null,
      backupDirs: BACKUP_DIRS, keepDays: KEEP_DAYS, backups: listBackups().length });

  /* only keys changed after ?since=<version> (all keys when since is 0 / missing) */
  if (route === 'GET /api/data'){
    const since = Number(url.searchParams.get('since')) || 0;
    return send(res, 200, { version: db.version, keys: keysSince(since) });
  }

  /* { base, set: { key: string } }  ·  409 if another PC changed one of these keys after `base` */
  if (route === 'PUT /api/data'){
    const body = await readBody(req);
    const base = Number(body.base) || 0, set = body.set || {};
    const conflicts = Object.keys(set).filter(k => db.keys[k] && db.keys[k].ver > base);
    if (conflicts.length) return send(res, 409, { version: db.version, conflicts, keys: keysSince(base) });
    const missed = keysSince(base);
    db.version++;
    for (const [k, v] of Object.entries(set)){ db.keys[k] = { v: typeof v === 'string' ? v : null, ver: db.version }; delete missed[k]; }
    db.updatedAt = new Date().toISOString();
    saveDb(); changedSinceBackup = true;
    if (!lastBackupAt) backup('first');
    return send(res, 200, { version: db.version, keys: missed });
  }

  if (route === 'POST /api/backup') return send(res, 200, { name: backup('manual') });
  if (route === 'GET /api/backups') return send(res, 200, listBackups());

  if (req.method === 'GET' && url.pathname.startsWith('/api/backups/')){
    const name = path.basename(decodeURIComponent(url.pathname.slice('/api/backups/'.length)));
    const f = path.join(BACKUP_DIRS[0], name);
    if (!/^resonance-.*\.json$/.test(name) || !fs.existsSync(f)) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}"` });
    return fs.createReadStream(f).pipe(res);
  }

  /* { name } = restore a server backup  ·  { keys } = restore from a file the user uploaded */
  if (route === 'POST /api/restore'){
    const body = await readBody(req);
    let keys = body.keys;
    if (body.name){
      const snap = readJsonFile(path.join(BACKUP_DIRS[0], path.basename(String(body.name))));
      if (!snap || !snap.keys) return send(res, 404, { error: 'backup not found' });
      keys = Object.fromEntries(Object.entries(snap.keys).map(([k, x]) => [k, typeof x === 'string' ? x : x.v]));
    }
    if (!keys || typeof keys !== 'object') return send(res, 400, { error: 'no keys' });
    replaceAll(keys);
    log('restore', body.name || 'uploaded file', '→ version', db.version);
    return send(res, 200, { version: db.version });
  }

  /* a PC lost a save race: keep its copy as a backup file so nothing is lost */
  if (route === 'POST /api/conflict'){
    const body = await readBody(req);
    return send(res, 200, { name: backup('conflict', { savedAt: new Date().toISOString(), client: body.client || '', base: body.base, keys: body.set || {} }) });
  }
  return send(res, 404, { error: 'unknown api' });
}

/* ---------- static files (only from this folder, never above it) ---------- */
function serveStatic(req, res, url){
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/favicon.ico'){ res.writeHead(204); return res.end(); }
  if (rel === '/') rel = '/RESONANCE_STORE.html';
  const f = path.join(ROOT, path.normalize(rel));
  if (!f.startsWith(ROOT + path.sep) || f.startsWith(DATA_DIR) || /server(-config)?\.js(on)?$/i.test(f)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(f, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream');
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e){
    log('ERROR', req.method, url.pathname, e.message);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
}).listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  log(`Resonance Store server · version ${db.version}`);
  log(`open on this PC:     http://localhost:${PORT}`);
  ips.forEach(ip => log(`open from other PCs: http://${ip}:${PORT}`));
  log('data file:', DATA_FILE);
  log('backups  :', BACKUP_DIRS.join(' | '), `· keep ${KEEP_DAYS} days`);
});

/* backup once more on a normal shutdown (Ctrl+C) */
process.on('SIGINT', () => { if (changedSinceBackup) backup('shutdown'); process.exit(0); });
