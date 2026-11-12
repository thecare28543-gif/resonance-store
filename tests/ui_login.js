/* Browser check of login.html (app theme, first-admin setup, GID / GID log-in), users.html (add, import, edit, unlock) and the Viewer role.
   usage: node ui_login.js <app copy> <postgres url of an EMPTY db> <screenshot dir> */
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const [APP, DBURL, SHOTS] = process.argv.slice(2);
const PORT = 18095, URL = `http://localhost:${PORT}/`;
let pass = 0, fail = 0;
const check = (n, ok, info) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info !== undefined && !ok ? ' · ' + JSON.stringify(info).slice(0, 300) : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dataDir = path.join(path.dirname(APP), 'data_ui'); fs.rmSync(dataDir, { recursive: true, force: true });
  const srv = spawn(process.execPath, [path.join(APP, 'server.js')], { env: { ...process.env, PORT, RS_DATA_DIR: dataDir, DATABASE_URL: DBURL }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++){ try { await fetch(URL + 'login.html'); break; } catch { await wait(250); } }
  const token = fs.readFileSync(path.join(dataDir, 'setup-token.txt'), 'utf8').trim();
  const b = await chromium.launch({ channel: 'msedge' });
  try {
    /* setup screen (dark from the app's saved theme), then the first admin */
    const c0 = await b.newContext({ viewport: { width: 1400, height: 860 } });
    await c0.addInitScript(() => { try { localStorage.setItem('resThemeV1', 'dark'); } catch {} });
    const p0 = await c0.newPage(); await p0.goto(URL); await p0.waitForSelector('#fSetup:not([hidden])');
    check('login page uses the app stylesheet + saved dark theme', await p0.evaluate(() => document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.body).getPropertyValue('--brand').trim() !== ''));
    await p0.screenshot({ path: `${SHOTS}\\login_setup_dark.png` });
    await p0.fill('#sTok', token); await p0.fill('#sGid', '100001'); await p0.fill('#sName', 'Admin Tester'); await p0.click('#fSetup .go');
    await p0.waitForURL(/users\.html/); check('setup code → first admin → users page', true);
    await c0.close();

    const ac = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await ac.addInitScript(() => { try { localStorage.setItem('resTourV1', '1'); } catch {} });
    const a = await ac.newPage();
    const errs = []; a.on('pageerror', e => errs.push(e.message)); a.on('dialog', d => d.accept());
    await a.goto(URL); await a.waitForSelector('#fLogin:not([hidden])');
    await a.screenshot({ path: `${SHOTS}\\login_form.png` });
    await a.fill('#gid', '100001'); await a.fill('#pw', '111111'); await a.click('#fLogin .go');
    await a.waitForSelector('.lg-err', { state: 'visible' });
    check('wrong password shows an error', /ไม่ถูกต้อง/.test(await a.textContent('#fLogin .lg-err')));
    await a.fill('#pw', '100001'); await a.click('#fLogin .go'); await a.waitForFunction(() => window.RS_SYNC && typeof store !== 'undefined');
    check('GID / GID logs in, editor name from login', (await a.inputValue('#editorName')) === 'Admin Tester' && await a.$eval('#editorName', el => el.readOnly));
    await a.click('.uc-btn');
    check('menu: users link, no change-password item', !!(await a.$('.uc-menu a[href="users.html"]')) && !(await a.$('.uc-menu a[href*="change"]')));

    await a.goto(URL + 'users.html'); await a.waitForSelector('#uBody tr');
    await a.fill('#aGid', '100002'); await a.fill('#aName', 'User Tester'); await a.selectOption('#aCrew', 'A'); await a.click('#fAdd button[type=submit]');
    await a.waitForFunction(() => document.querySelectorAll('#uBody tr').length >= 2);
    check('add user from the form', /GID \/ GID|100002 \/ 100002/.test(await a.textContent('#toast')));
    const teamCsv = path.join(SHOTS, 'team_fake.csv');
    fs.writeFileSync(teamCsv, '\ufeffGID,User Name,Role,Crew,Department\n' + Array.from({ length: 12 }, (_, i) => `100${String(i + 1).padStart(3, '0')},Test Person ${i + 1},${i ? 'user' : 'admin'},,HSA Resonance`).join('\n') + '\n');
    await a.setInputFiles('#impFile', teamCsv); await a.waitForSelector('#impGo:not([hidden])');
    await a.click('#impGo'); await a.waitForFunction(() => document.querySelectorAll('#uBody tr').length >= 12);
    check('team CSV (GID, User Name) imported: 12 users', (await a.$$eval('#uBody tr', t => t.length)) === 12);
    await a.selectOption('#uBody tr[data-gid="100003"] select[data-f="role"]', 'viewer'); await wait(800);
    check('role change saved from the table', (await (await a.request.get(URL + 'api/users')).json()).find(u => u.gid === '100003').role === 'viewer');
    await a.evaluate(() => scrollTo(0, 0)); await wait(300);
    await a.screenshot({ path: `${SHOTS}\\users_page.png` });
    await a.screenshot({ path: `${SHOTS}\\users_full.png`, fullPage: true });
    await a.click('#tabs [data-pane="rights"]'); await a.screenshot({ path: `${SHOTS}\\users_rights.png` });
    await a.click('#tabs [data-pane="log"]'); await a.waitForSelector('#lBody tr'); await a.screenshot({ path: `${SHOTS}\\users_log.png` });
    const dk = await b.newContext({ viewport: { width: 1400, height: 900 } }); await dk.addCookies((await ac.cookies()));
    await dk.addInitScript(() => { try { localStorage.setItem('resThemeV1', 'dark'); } catch {} });
    const dp = await dk.newPage(); await dp.goto(URL + 'users.html'); await dp.waitForSelector('#uBody tr'); await dp.screenshot({ path: `${SHOTS}\\users_dark.png` }); await dk.close();
    check('no JS errors (admin)', !errs.length, errs);

    const vc = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await vc.addInitScript(() => { try { localStorage.setItem('resTourV1', '1'); } catch {} });
    const v = await vc.newPage(); const verr = []; v.on('pageerror', e => verr.push(e.message)); v.on('dialog', d => d.accept());
    await v.goto(URL); await v.waitForSelector('#fLogin:not([hidden])');
    await v.fill('#gid', '100003'); await v.fill('#pw', '100003'); await v.click('#fLogin .go');
    await v.waitForFunction(() => window.RS_SYNC && typeof store !== 'undefined'); await wait(1500);
    const before = await v.evaluate(() => store.length);
    const seen = await v.evaluate(async () => {
      const toasts = []; const orig = window.showToast; window.showToast = (t, m, ty) => { toasts.push(t); return orig(t, m, ty); };
      const set = (id, val) => { const el = document.getElementById(id); el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); };
      set('fRack', 'A'); set('fSide', 'L'); set('fFloor', '2'); set('fCell', 'IN'); set('fJob', 'VIEWER_TRY'); set('fItem', 'WKL'); set('fProduct', 'DORADO'); set('fQty', 5);
      document.getElementById('fPoka').checked = false; document.getElementById('addForm').requestSubmit();
      await new Promise(r => setTimeout(r, 1500)); window.showToast = orig; return toasts;
    });
    const after = await v.evaluate(() => ({ n: store.length, ls: (JSON.parse(localStorage.getItem('resStoreV7') || '[]')).length, pending: RS_SYNC.status().pending.length, mode: RS_SYNC.status().mode }));
    check('viewer: add is not saved, warning shown', after.n === before && after.ls === before && after.pending === 0 && after.mode === 'online' && seen.some(t => /Viewer/.test(t)), { before, after, seen });
    await v.goto(URL + 'users.html'); check('viewer sent away from users.html', !/users\.html/.test(v.url()), v.url());
    check('no JS errors (viewer)', !verr.length, verr);
    await v.click('.uc-btn'); await v.click('.uc-menu [data-logout]'); await v.waitForURL(/login\.html/);
    await v.goto(URL); check('after log-out the app asks to log in again', /login\.html/.test(v.url()), v.url());

    const mc = await b.newContext({ viewport: { width: 390, height: 780 } }); const m = await mc.newPage();
    await m.goto(URL); await m.waitForSelector('#fLogin:not([hidden])'); await m.screenshot({ path: `${SHOTS}\\login_phone.png` });
    check('only the log-in window is shown, no sideways scroll on a phone', await m.evaluate(() => !document.querySelector('.sidebar, .topbar') && document.querySelectorAll('section.panel:not([hidden])').length === 1 && document.documentElement.scrollWidth <= innerWidth));
  } catch (e){ check('no exception', false, e.stack); }
  await b.close(); srv.kill();
  console.log(`--- ${pass} pass · ${fail} fail`);
})();
