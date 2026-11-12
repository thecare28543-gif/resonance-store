/* End-to-end check of the web app with the real server on a throw-away copy: 2 PCs (A, B), sync, save race, hold guards.
   Each PC logs in through login.html (temp password → own password), data lives in PostgreSQL.
   usage: node e2e.js <copy of the app folder> <postgres url of an EMPTY test database> */
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const APP = process.argv[2], DBURL = process.argv[3], PORT = 18080, URL = `http://localhost:${PORT}/`;
const out = [];
const check = (name, ok, info) => { const s = `${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' · ' + info : ''}`; console.log(s); out.push(s); };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* the test's own admin session (node side) */
let adminCookie = '';
async function api(method, url, body, extra){
  const r = await fetch(URL + 'api/' + url, { method, headers: Object.assign({ 'X-Requested-With': 'rs', Cookie: adminCookie }, body ? { 'Content-Type': 'application/json' } : {}, extra || {}), body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) adminCookie = sc.split(';')[0];
  return r.json();
}
const tempPw = {};
async function openPC(browser, name){
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('resTourV1', '1'); } catch {} });
  const p = await ctx.newPage();
  p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(URL);
  await p.waitForSelector('#fLogin:not([hidden])', { timeout: 15000 });
  await p.fill('#gid', name); await p.fill('#pw', name); await p.click('#fLogin .go');
  await p.waitForFunction(() => window.RS_SYNC && typeof store !== 'undefined', null, { timeout: 15000 });
  await p.waitForFunction(n => document.getElementById('editorName').value === n, name, { timeout: 15000 });
  return p;
}
const addJob = (p, job, pos, extra) => p.evaluate(([job, pos, extra]) => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('fRack', pos[0]); set('fSide', pos[1]); set('fFloor', pos[2]); set('fCell', pos[3]);
  set('fJob', job); set('fItem', extra.type || 'WKL'); set('fProduct', extra.prod || 'DORADO'); set('fQty', extra.qty || 5);
  document.getElementById('fPoka').checked = false;
  if (extra.hold){ document.getElementById('fHold').checked = true; document.getElementById('fHoldReason').value = 'รอผล FA'; }
  document.getElementById('addForm').requestSubmit();
}, [job, pos, extra || {}]);
const jobsIn = p => p.evaluate(() => store.map(r => r.JOB_NO).sort());
/* the test's own reads say they are not an old PC (any version >= the app's) */
const serverStore = async () => { const j = await (await fetch(`${URL}api/data?since=0`, { headers: { 'X-RS-Ver': 'zz-e2e-reader', Cookie: adminCookie } })).json(); return JSON.parse(j.keys.resStoreV7 || '[]'); };
const serverJobs = async () => (await serverStore()).map(r => r.JOB_NO).sort();
/* type a value into a Data Entry cell of the row holding `job` */
const entryEdit = (p, job, col, val) => p.evaluate(([job, col, val]) => {
  setTab('entry'); renderAll();
  const r = store.find(x => x.JOB_NO === job), tr = document.querySelector(`#entryTable tr[data-id="${r._id}"]`), inp = tr.querySelector(`[data-col="${col}"]`);
  inp.value = val; inp.dispatchEvent(new Event('change', { bubbles: true }));
  return { val: String(r[col]), disabled: inp.disabled, held: tr.classList.contains('held') };
}, [job, col, val]);

(async () => {
  const dataDir = path.join(APP, 'data_e2e'); fs.rmSync(dataDir, { recursive: true, force: true });
  const srv = spawn(process.execPath, [path.join(APP, 'server.js')], { env: { ...process.env, PORT, RS_DATA_DIR: dataDir, DATABASE_URL: DBURL, RS_SETUP_TOKEN: 'e2e-setup' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++){ try { await fetch(URL + 'login.html'); break; } catch { await wait(250); } }
  await api('POST', 'auth/setup', { token: 'e2e-setup', gid: 'E2EADMIN', name: 'E2E Admin' });
  for (const n of ['PC-A', 'PC-B']) await api('POST', 'users', { gid: n, name: n, role: 'user' });
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    const A = await openPC(browser, 'PC-A'), B = await openPC(browser, 'PC-B');
    check('both PCs log in with GID / GID and show the user', (await A.evaluate(() => document.querySelector('.uc-btn b')?.textContent)) === 'PC-A');
    check('both PCs online', (await A.evaluate(() => RS_SYNC.status().mode)) === 'online' && (await B.evaluate(() => RS_SYNC.status().mode)) === 'online');
    check('fresh start empty (store + zones)', (await A.evaluate(() => store.length + Object.keys(zones).length)) === 0);

    // 1. sync A -> B
    await addJob(A, 'E2E_001', ['A', 'L', '2', 'IN']); await wait(7000);
    check('A adds a job, B sees it within 7 s', (await jobsIn(B)).includes('E2E_001'), JSON.stringify(await jobsIn(B)));

    // 2. save race: both PCs add a different job at the same moment
    await Promise.all([addJob(A, 'E2E_RACE_A', ['B', 'L', '1', 'IN']), addJob(B, 'E2E_RACE_B', ['B', 'R', '1', 'IN'])]);
    await wait(12000);
    const sj = await serverJobs();
    check('save race: both new jobs kept on the server', sj.includes('E2E_RACE_A') && sj.includes('E2E_RACE_B'), `server has ${JSON.stringify(sj)}`);
    const conflictFiles = (await (await fetch(`${URL}api/backups`, { headers: { Cookie: adminCookie } })).json()).filter(b => b.name.includes('conflict'));
    check('  (info) conflict backups', true, String(conflictFiles.length));

    // 2b. delete on A and add on B at the same moment: the delete and the new job both reach the server
    await wait(3000);
    await Promise.all([A.evaluate(() => { const r = store.find(x => x.JOB_NO === 'E2E_RACE_B'); deleteRow(r._id); saveAll(false); }), addJob(B, 'E2E_RACE_C', ['B', 'L', '2', 'IN'])]);
    await wait(12000);
    const sj2 = await serverJobs();
    check('save race: delete on A + add on B both kept', !sj2.includes('E2E_RACE_B') && sj2.includes('E2E_RACE_C'), `server has ${JSON.stringify(sj2)}`);

    // 2c. A has unsaved Data Entry edits while B saves a new job: A's save keeps both
    await entryEdit(A, 'E2E_RACE_A', 'QUANITY', '7');
    await addJob(B, 'E2E_B_LATER', ['B', 'R', '2', 'IN']); await wait(8000);
    await A.evaluate(() => saveAll(false)); await wait(6000);
    const s3 = await serverStore(), ra = s3.find(r => r.JOB_NO === 'E2E_RACE_A');
    check('unsaved edit on A + new job from B: both kept', s3.some(r => r.JOB_NO === 'E2E_B_LATER') && ra && Number(ra.QUANITY) === 7, `server has ${JSON.stringify(s3.map(r => r.JOB_NO + ':' + r.QUANITY))}`);

    // Undo on A after B saved: only A's own step goes back, B's job stays
    await addJob(A, 'E2E_UNDO_A', ['A', 'L', '3', 'IN']); await wait(3000);
    await addJob(B, 'E2E_UNDO_B', ['A', 'R', '1', 'IN']); await wait(8000);
    const und = await A.evaluate(() => { doUndo(); return store.map(r => r.JOB_NO); }); await wait(8000);
    const sU = await serverJobs();
    check('Undo on A removes only A\'s job, keeps B\'s', !und.includes('E2E_UNDO_A') && und.includes('E2E_UNDO_B') && !sU.includes('E2E_UNDO_A') && sU.includes('E2E_UNDO_B'), `A ${JSON.stringify(und)} · server ${JSON.stringify(sU)}`);
    const red = await A.evaluate(() => { doRedo(); return store.map(r => r.JOB_NO); });
    check('Redo brings A\'s job back, B\'s still there', red.includes('E2E_UNDO_A') && red.includes('E2E_UNDO_B'), JSON.stringify(red));

    // a PC with old files (no version header) is on the server: new PCs warn
    await fetch(`${URL}api/data?since=999999`, { headers: { 'User-Agent': 'old-pc', Cookie: adminCookie } });   /* another client with no X-RS-Ver, like an old sync.js */
    const warned = await A.evaluate(async () => {
      const seen = []; const orig = window.showToast; window.showToast = (t, m, ty) => { seen.push(t); return orig(t, m, ty); };
      await RS_SYNC.poll(); window.showToast = orig; return { seen, ver: RS_SYNC.version, chip: document.querySelector('.sync-chip').textContent };
    });
    check('old-version PC on the server -> warning shown, version on the chip', warned.seen.some(t => t.includes('เวอร์ชันเก่า')) && warned.chip.includes('v' + warned.ver), JSON.stringify(warned));

    // over 80 in one position from Data Entry
    const over = await entryEdit(A, 'E2E_001', 'QUANITY', '90');
    check('Data Entry refuses more than 80 in one position', over.val === '5', JSON.stringify(over));
    const okEdit = await entryEdit(A, 'E2E_001', 'QUANITY', '20'); await A.evaluate(() => saveAll(false));
    check('Data Entry still accepts a normal change (20)', okEdit.val === '20', JSON.stringify(okEdit));

    // 3. hold guards
    await addJob(A, 'E2E_HOLD', ['A', 'R', '3', 'OUT'], { hold: true }); await wait(1500);
    check('held job saved with hold', await A.evaluate(() => !!holdData['E2E_HOLD']));
    const delBlocked = await A.evaluate(() => { const r = store.find(x => x.JOB_NO === 'E2E_HOLD'); deleteRow(r._id); return store.some(x => x.JOB_NO === 'E2E_HOLD'); });
    check('delete of held job blocked', delBlocked);
    const pickBlocked = await A.evaluate(() => { const r = store.find(x => x.JOB_NO === 'E2E_HOLD'); pick.done.add(r._id); pickCheckout(); return store.some(x => x.JOB_NO === 'E2E_HOLD'); });
    check('pick-out of held job blocked', pickBlocked);
    const editBypass = await A.evaluate(() => {
      setTab('entry'); renderAll();
      const r = store.find(x => x.JOB_NO === 'E2E_HOLD'), inp = document.querySelector(`#entryTable tr[data-id="${r._id}"] [data-col="JOB_NO"]`);
      if (!inp) return 'no input';
      inp.value = 'E2E_RENAMED'; inp.dispatchEvent(new Event('change', { bubbles: true })); saveAll(false);
      return store.some(x => normJob(x.JOB_NO) === 'E2E_HOLD') ? 'still held' : 'hold link lost';
    });
    check('Data Entry cannot change Job No. of a held job', editBypass === 'still held', editBypass);
    const heldQty = await entryEdit(A, 'E2E_HOLD', 'QUANITY', '1');
    check('held row locked in Data Entry (qty unchanged, inputs disabled, red row)', heldQty.val === '5' && heldQty.disabled && heldQty.held, JSON.stringify(heldQty));
    const imp = await A.evaluate(async () => {
      const csv = 'RACK,SIDE,FLOOR,CELL,QUANITY,JOB_NO,PRODUCT,TYPE\nA,L,2,IN,5,E2E_001,DORADO,WKL\n';
      await importStore(new File([csv], 'e2e.csv', { type: 'text/csv' })); return store.map(r => r.JOB_NO).sort();
    });
    check('Import keeps a held job that is not in the file', imp.includes('E2E_HOLD') && imp.includes('E2E_001') && !imp.includes('E2E_RACE_A'), JSON.stringify(imp));
    const resetLeft = await A.evaluate(() => { resetData(); return store.map(r => r.JOB_NO); });
    check('Reset keeps held jobs, clears the rest', JSON.stringify(resetLeft) === '["E2E_HOLD"]', JSON.stringify(resetLeft));
    await wait(8000);
    const bEnd = await jobsIn(B), sEnd = await serverJobs();
    check('B ends up the same as the server', JSON.stringify(bEnd) === JSON.stringify(sEnd), `B ${JSON.stringify(bEnd)} · server ${JSON.stringify(sEnd)}`);

    // 4. weekly export + kaizen
    const wk = await A.evaluate(() => { try { exportWeekly(); return 'ok'; } catch (e) { return e.message; } });
    check('Export ผลรายสัปดาห์ runs', wk === 'ok', wk);

    check('no JavaScript errors on A', !A.errors.length, A.errors.join(' | '));
    check('no JavaScript errors on B', !B.errors.length, B.errors.join(' | '));
  } catch (e) { console.log('ERROR ' + e.stack); }
  await browser.close(); srv.kill();
  console.log(`--- ${out.filter(s => s.startsWith('PASS')).length} pass · ${out.filter(s => s.startsWith('FAIL')).length} fail`);
})();

