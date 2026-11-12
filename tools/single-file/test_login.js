/* single-file log-in + user admin test (headless Edge, file://, network blocked) */
const { chromium } = require('playwright-core');
const path = require('path'), fs = require('fs');
const FILE = path.resolve(process.argv[2]);
const ADMIN = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8')).find(u => u.role === 'admin').gid;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  await ctx.route('**/*', r => /^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort());
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('dialog', d => d.accept());
  const url = 'file:///' + FILE.replace(/\\/g, '/');
  await p.goto(url); await p.waitForTimeout(1500);
  ok(await p.isVisible('#rsLogin'), 'login screen shows first');
  ok(!(await p.evaluate(() => !!window.RS_SYNC && window.RS_SYNC.status().appLoaded)), 'app not loaded before log-in');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.sidebar, aside, nav') || document.body).visibility === 'hidden' || !document.querySelector('.sidebar')), 'app hidden behind login');
  ok((await p.textContent('#rsLogin')).indexOf('GID') < 0, 'login screen gives no GID hint');

  await p.fill('#rsU', ADMIN); await p.fill('#rsP', 'WRONG'); await p.click('#rsLogin button');
  await p.waitForTimeout(300);
  ok((await p.textContent('#rsLogin .lg-err')).includes('ไม่ถูกต้อง'), 'wrong password refused');

  await p.fill('#rsU', ADMIN.toLowerCase() + ' '); await p.fill('#rsP', ' ' + ADMIN); await p.click('#rsLogin button');
  await p.waitForTimeout(3000);
  ok(!(await p.$('#rsLogin')), 'admin logs in (GID / GID, spaces + case ignored)');
  const st = await p.evaluate(() => ({ chip: document.querySelector('.user-chip') && !document.querySelector('.user-chip').hidden, ed: document.getElementById('editorName').readOnly, edv: document.getElementById('editorName').value, admin: document.body.classList.contains('role-admin'), loaded: window.RS_SYNC.status().appLoaded }));
  ok(st.chip && st.admin && st.loaded, 'user chip + admin role + app loaded');
  ok(st.ed && st.edv.length > 1, 'editor name = logged-in name (read-only)');

  const skip = await p.$('[data-tour=skip]'); if (skip && await skip.isVisible()) await skip.click();
  await p.click('.uc-btn'); await p.click('[data-users]'); await p.waitForTimeout(300);
  ok(await p.isVisible('#rsUsers'), 'user admin opens from the menu');
  ok((await p.$$('#rsUsers tbody tr')).length === 12, '12 users listed');
  await p.fill('#rsUsers form.add [name=gid]', 'test01'); await p.fill('#rsUsers form.add [name=name]', 'Test Viewer');
  await p.selectOption('#rsUsers form.add [name=role]', 'viewer'); await p.click('#rsUsers form.add button');
  await p.waitForTimeout(300);
  ok((await p.$$('#rsUsers tbody tr')).length === 13 && !!(await p.$('#rsUsers tr[data-gid="TEST01"]')), 'add user TEST01 (viewer)');
  await p.fill('#rsUsers form.add [name=gid]', 'TEST01'); await p.fill('#rsUsers form.add [name=name]', 'dup'); await p.click('#rsUsers form.add button');
  await p.waitForTimeout(200);
  ok((await p.$$('#rsUsers tbody tr')).length === 13, 'duplicate GID refused');
  // cannot demote the last admins below 1: demote the other admin first, then self must be refused
  const other = await p.evaluate(a => JSON.parse(localStorage.getItem('rsUsersV1')).filter(u => u.role === 'admin' && u.gid !== a).map(u => u.gid), ADMIN);
  for (const g of other) { await p.selectOption(`#rsUsers tr[data-gid="${g}"] select[data-f=role]`, 'user'); await p.waitForTimeout(200); }
  await p.selectOption(`#rsUsers tr[data-gid="${ADMIN}"] select[data-f=role]`, 'user'); await p.waitForTimeout(400);
  ok(await p.evaluate(a => JSON.parse(localStorage.getItem('rsUsersV1')).find(u => u.gid === a).role === 'admin', ADMIN), 'last admin cannot be demoted');
  for (const g of other) { await p.selectOption(`#rsUsers tr[data-gid="${g}"] select[data-f=role]`, 'admin'); await p.waitForTimeout(200); }
  await p.click('#rsUsers [data-tab=log]'); await p.waitForTimeout(200);
  ok((await p.textContent('#rsUsers')).includes('ไม่ผ่าน'), 'login log shows the failed attempt');
  await p.click('#rsUsers [data-close]');

  await p.reload(); await p.waitForTimeout(2500);
  ok(!(await p.$('#rsLogin')), 'reload keeps the session');

  await p.click('.uc-btn'); await p.click('[data-logout]'); await p.waitForTimeout(1500);
  ok(await p.isVisible('#rsLogin'), 'log-out returns to the login screen');

  await p.fill('#rsU', 'TEST01'); await p.fill('#rsP', 'TEST01'); await p.click('#rsLogin button'); await p.waitForTimeout(3000);
  const v = await p.evaluate(() => ({ viewer: document.body.classList.contains('role-viewer'), adminItem: !!document.querySelector('[data-users]') }));
  ok(v.viewer && !v.adminItem, 'new viewer logs in, no admin menu');
  const before = await p.evaluate(() => localStorage.getItem('resStoreV7'));
  await p.evaluate(() => { const a = JSON.parse(localStorage.getItem('resStoreV7')); a.push({ fake: 1 }); localStorage.setItem('resStoreV7', JSON.stringify(a)); });
  ok(await p.evaluate(b => localStorage.getItem('resStoreV7') === b, before), 'viewer cannot write store data');

  await p.click('.uc-btn'); await p.click('[data-logout]'); await p.waitForTimeout(1500);
  for (let i = 0; i < 5; i++) { await p.fill('#rsU', 'TEST01'); await p.fill('#rsP', 'nope'); await p.click('#rsLogin button'); await p.waitForTimeout(150); }
  await p.fill('#rsU', 'TEST01'); await p.fill('#rsP', 'TEST01'); await p.click('#rsLogin button'); await p.waitForTimeout(400);
  ok((await p.textContent('#rsLogin .lg-err')).includes('ชั่วคราว') && await p.isVisible('#rsLogin'), '5 wrong = locked, even with the right password');
  await p.screenshot({ path: path.join(path.dirname(FILE), 'shot_login.png') });

  console.log('page errors:', errors.length ? errors : 'none');
  console.log(`${pass} passed, ${fail} failed`);
  await b.close();
})();
