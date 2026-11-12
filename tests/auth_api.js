/* API test of login (user = GID, password = GID) + users + roles + data on a fresh PostgreSQL database.
   usage: node auth_api.js <app dir> <postgres url of an EMPTY test database> */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const [APP, DBURL] = process.argv.slice(2);
const PORT = 18090, BASE = `http://localhost:${PORT}/`;
let pass = 0, fail = 0;
const check = (name, ok, info) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || info === undefined ? '' : ' · ' + JSON.stringify(info).slice(0, 300)}`); };
function client(){
  let cookie = '';
  const call = async (method, url, body, extra) => {
    const r = await fetch(BASE + url, { method, redirect: 'manual', headers: Object.assign({ 'X-Requested-With': 'rs', Cookie: cookie }, body ? { 'Content-Type': 'application/json' } : {}, extra || {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, j, text, loc: r.headers.get('location') };
  };
  return { call, get cookie(){ return cookie; } };
}
(async () => {
  const dataDir = path.join(path.dirname(APP), 'data_authtest'); fs.rmSync(dataDir, { recursive: true, force: true });
  const srv = spawn(process.execPath, [path.join(APP, 'server.js')], { env: { ...process.env, PORT, RS_DATA_DIR: dataDir, DATABASE_URL: DBURL, RS_SETUP_TOKEN: 'setup-123' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; srv.stdout.on('data', d => out += d); srv.stderr.on('data', d => out += d);
  for (let i = 0; i < 60; i++){ try { await fetch(BASE + 'login.html'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  try {
    const anon = client(), admin = client(), u1 = client(), v1 = client();
    let r = await anon.call('GET', '');
    check('not logged in: / redirects to login', r.status === 302 && /login\.html/.test(r.loc), r);
    r = await anon.call('GET', 'app.js'); check('not logged in: app.js is 401', r.status === 401, r.status);
    r = await anon.call('GET', 'styles.css'); check('styles.css is public (login page theme)', r.status === 200, r.status);
    r = await anon.call('GET', 'api/data'); check('not logged in: api/data is 401', r.status === 401, r.status);
    r = await anon.call('GET', 'server-config.example.json'); check('config file blocked', r.status === 403, r.status);
    r = await anon.call('GET', 'db/schema.sql'); check('db folder blocked', r.status === 403, r.status);
    r = await anon.call('GET', 'login.html'); check('login page is public', r.status === 200 && /เข้าสู่ระบบ/.test(r.text), r.status);
    r = await anon.call('GET', 'api/auth/status'); check('setup needed on empty DB', r.j && r.j.setupNeeded === true, r.j);
    r = await anon.call('POST', 'api/auth/setup', { token: 'wrong', gid: '100001', name: 'Admin' });
    check('setup with wrong code refused', r.status === 403, r);
    r = await admin.call('POST', 'api/auth/setup', { token: 'setup-123', gid: '100001', name: 'Admin Tester' });
    check('first admin created + logged in', r.status === 200 && r.j.user.gid === '100001' && admin.cookie, r);
    r = await anon.call('POST', 'api/auth/setup', { token: 'setup-123', gid: '999999', name: 'x' });
    check('second setup refused', r.status === 409, r.status);
    r = await anon.call('POST', 'api/auth/login', { gid: '100001', password: '100001' }, { 'X-Requested-With': '' });
    check('write without custom header refused (CSRF guard)', r.status === 403, r.status);
    r = await client().call('POST', 'api/auth/login', { gid: '100001', password: ' 100001 ' });
    check('admin logs in with GID / GID', r.status === 200 && r.j.user.role === 'admin' && !r.j.user.mustChange, r.j);

    r = await admin.call('POST', 'api/users', { gid: '100002', name: 'User Tester', role: 'user', crew: 'a' });
    check('admin adds user (no temp password)', r.status === 200 && r.j.gid === '100002' && !r.j.tempPassword, r);
    r = await admin.call('POST', 'api/users', { gid: '100002', name: 'dup' }); check('duplicate GID refused', r.status === 409, r.status);
    r = await admin.call('POST', 'api/users/import', { users: [{ gid: '100003', name: 'Viewer Tester', role: 'viewer' }, { gid: '100002', name: 'User T.', crew: 'B' }, { gid: 'bad gid!', name: 'x' }] });
    check('import: 1 added, 1 updated, 1 skipped', r.status === 200 && r.j.added.length === 1 && r.j.updated.length === 1 && r.j.skipped.length === 1, r.j);
    r = await admin.call('GET', 'api/users'); const su = r.j.find(x => x.gid === '100002');
    check('import updated name + crew', su && su.name === 'User T.' && su.crew === 'B', su);

    r = await u1.call('POST', 'api/auth/login', { gid: '100002', password: '100099' }); check('wrong password (other number) refused', r.status === 401, r.status);
    r = await u1.call('POST', 'api/auth/login', { gid: '100002', password: '100002' });
    check('user logs in with GID / GID straight away', r.status === 200 && r.j.user.mustChange === false, r.j);
    r = await u1.call('GET', ''); check('user opens the app', r.status === 200 && /RESONANCE/i.test(r.text), r.status);
    r = await u1.call('POST', 'api/auth/password', { current: '100002', next: 'Other2026x' }, { 'X-RS-Ver': 't' }); check('no change-password API', r.status === 404, r.status);
    r = await u1.call('GET', 'users.html'); check('user cannot open users page', r.status === 302, r.status);
    r = await u1.call('GET', 'api/users'); check('user cannot call users api', r.status === 403, r.status);

    r = await u1.call('GET', 'api/data?since=0'); const base = r.j.version;
    check('data read gives user info', r.status === 200 && r.j.user.role === 'user', r.j && r.j.user);
    const rows = [{ _id: 'r1', RACK: 'A', SIDE: 'L', FLOOR: '2', CELL: 'IN', QUANITY: 16, TRAY: 'IM', JOB_NO: 'RES_TK2611_0001', PRODUCT: 'DORADO', TYPE: 'WKL', TESTER: 'T1', Last_Editor: 'User Tester' }];
    r = await u1.call('PUT', 'api/data', { base, set: { resStoreV7: JSON.stringify(rows), resHoldV1: JSON.stringify({ RES_TK2611_0001: { by: 'QA', reason: 'รอผล', at: new Date().toISOString() } }),
      jobDetailV7: JSON.stringify({ RES_TK2611_0001: { 'Job No.': 'RES_TK2611_0001', 'Requester Name': 'Owner A', Product: 'DORADO', 'Test Status': 'TEST_COMPLETED' } }) } }, { 'X-RS-Ver': 't' });
    check('user saves data', r.status === 200 && r.j.version === base + 1, r);
    r = await u1.call('PUT', 'api/data', { base, set: { resStoreV7: '[]' } }, { 'X-RS-Ver': 't' });
    check('stale base gives 409 conflict', r.status === 409 && r.j.conflicts.includes('resStoreV7'), r.status);

    r = await v1.call('POST', 'api/auth/login', { gid: '100003', password: '100003' });
    r = await v1.call('GET', 'api/data?since=0'); check('viewer reads data', r.status === 200 && r.j.keys.resStoreV7, r.status);
    r = await v1.call('PUT', 'api/data', { base: r.j.version, set: { resStoreV7: '[]' } }, { 'X-RS-Ver': 't' });
    check('viewer cannot save', r.status === 403, r.status);
    r = await u1.call('POST', 'api/restore', { keys: {} }, { 'X-RS-Ver': 't' }); check('user cannot restore', r.status === 403, r.status);

    const { Client } = require(path.join(APP, 'node_modules', 'pg'));
    const pg = new Client({ connectionString: DBURL }); await pg.connect();
    const t = (await pg.query(`SELECT (SELECT count(*) FROM store_rows)::int s, (SELECT quantity FROM store_rows WHERE row_id='r1') qty, (SELECT updated_by FROM rs_kv WHERE key='resStoreV7') by,
      (SELECT count(*) FROM holds)::int h, (SELECT requester FROM jobs WHERE job_no='RES_TK2611_0001') req, (SELECT on_hold FROM v_jobs_in_store LIMIT 1) oh,
      (SELECT count(*) FROM rs_backups)::int b, (SELECT password_hash LIKE 'scrypt$%' AND password_hash NOT LIKE '%100002%' FROM app_users WHERE gid='100002') hashed`)).rows[0];
    check('store_rows / jobs / holds / view filled from save', t.s === 1 && t.qty === 16 && t.by === '100002' && t.h === 1 && t.req === 'Owner A' && t.oh === true, t);
    check('first backup written to rs_backups', t.b >= 1, t.b);
    check('password stored as scrypt hash only', t.hashed === true, t.hashed);

    r = await admin.call('PUT', 'api/users/100001', { role: 'user' }); check('admin cannot demote self', r.status === 400, r.j);
    r = await admin.call('PUT', 'api/users/100002', { active: false }); check('admin deactivates user', r.status === 200 && r.j.active === false, r.j);
    r = await u1.call('GET', 'api/data'); check('deactivated user is logged out', r.status === 401, r.status);
    r = await u1.call('POST', 'api/auth/login', { gid: '100002', password: '100002' }); check('deactivated user cannot log in', r.status === 403, r.status);
    await admin.call('PUT', 'api/users/100002', { active: true });
    for (let i = 0; i < 5; i++) r = await anon.call('POST', 'api/auth/login', { gid: '100002', password: '111111' });
    check('5 wrong passwords lock the account', r.status === 401 && /ชั่วคราว/.test(r.j.error), r.j);
    r = await u1.call('POST', 'api/auth/login', { gid: '100002', password: '100002' }); check('locked account refused even with right password', r.status === 423, r.status);
    r = await admin.call('GET', 'api/users'); check('admin sees the lock', r.j.find(x => x.gid === '100002').locked === true);
    r = await admin.call('POST', 'api/users/100002/reset'); check('admin unlocks', r.status === 200, r.j);
    r = await u1.call('POST', 'api/auth/login', { gid: '100002', password: '100002' }); check('login after unlock', r.status === 200, r.status);
    r = await admin.call('GET', 'api/login-log?limit=50'); check('login log has failures and successes', r.j.some(x => !x.ok) && r.j.some(x => x.ok), r.j && r.j.length);
    r = await admin.call('POST', 'api/auth/logout'); r = await admin.call('GET', 'api/data'); check('logout ends the session', r.status === 401, r.status);
    await pg.end();
  } catch (e){ check('no exception', false, e.stack); }
  srv.kill();
  console.log(`--- ${pass} pass · ${fail} fail`);
  if (fail) console.log(out.slice(-2000));
})();
