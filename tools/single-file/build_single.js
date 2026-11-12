/* Build ONE self-contained HTML of the Resonance Store web app (no server, no log-in, data in this browser).
   usage: node build_single.js <app_dir> <data.json> <out.html> */
const fs = require('fs'), path = require('path');
const [APP, DATA, OUT] = process.argv.slice(2);
const rd = f => fs.readFileSync(path.join(APP, f), 'utf8');
const safe = js => {   // keep inline scripts from closing early
  if (/<!--/.test(js) && /<script/i.test(js)) throw new Error('"<!--" + "<script" inside a script: needs manual escaping');
  return js.replace(/<\/script/gi, '<\\/script');
};
const must = (s, a, b) => { if (!s.includes(a)) throw new Error('not found: ' + a.slice(0, 60)); return s.split(a).join(b); };

let html = rd('RESONANCE_STORE.html');
let app = rd('app.js');
let sync = rd('sync.js');
const css = rd('styles.css');
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const pdf = fs.readFileSync(path.join(APP, 'training-manual.pdf')).toString('base64');

/* sync.js: always single-PC mode, and run the embedded app.js instead of fetching app.js */
sync = must(sync, "mode: location.protocol === 'file:' ? 'local' : 'connecting',", "mode: 'local',");
sync = must(sync, "s.src = 'app.js';", "s.src = URL.createObjectURL(new Blob([document.getElementById('rs-app-src').textContent], { type: 'text/javascript' }));");
/* sync.js: log-in comes from local_auth.js (same chip, menu, editor name and Viewer block as the server version) */
sync = must(sync, "async function boot(){\n    if (st.mode !== 'local'){", "async function boot(){\n    if (window.RS_LOCAL_AUTH) setUser(await window.RS_LOCAL_AUTH.ready);\n    if (st.mode !== 'local'){");
sync = must(sync, `\${u.role === 'admin' ? '<a href="users.html">👥 จัดการผู้ใช้งาน</a>' : ''}`, `\${u.role === 'admin' ? (window.RS_LOCAL_AUTH ? '<button type="button" data-users>👥 จัดการผู้ใช้งาน</button>' : '<a href="users.html">👥 จัดการผู้ใช้งาน</a>') : ''}`);
sync = must(sync, "    if (e.target.closest('[data-logout]')){", "    if (e.target.closest('[data-users]')){ userChip.querySelector('.uc-menu').hidden = true; window.RS_LOCAL_AUTH.openUsers(); return; }\n    if (e.target.closest('[data-logout]') && window.RS_LOCAL_AUTH){ window.RS_LOCAL_AUTH.logout(); return; }\n    if (e.target.closest('[data-logout]')){");
const USERS = process.argv[5] ? JSON.parse(fs.readFileSync(process.argv[5], 'utf8')) : null;
/* the 3D log-in screen from login.html: its style (scoped to #rsLogin), the log-in card only, and the scene script */
const lh = rd('login.html');
const between = (s, a, z) => { const i = s.indexOf(a); if (i < 0) throw new Error('login.html: ' + a); const j = s.indexOf(z, i + a.length); return s.slice(i + a.length, j); };
let lCss = between(lh, '<style>', '</style>');
lCss = must(lCss, 'body{min-height:100vh;overflow:hidden;', '#rsLogin{position:fixed;inset:0;z-index:9999;overflow:hidden;font-family:var(--font);color:var(--ink);');
lCss = must(lCss, ':root[data-theme="dark"] body{', ':root[data-theme="dark"] #rsLogin{');
lCss = must(lCss, '#scene{', '#rsScene{');
lCss = must(lCss, '#scene.on', '#rsScene.on');
lCss = lCss.split(' #scene{').join(' #rsScene{');
lCss += '\n#rsLogin .lg-body{min-height:100%;height:100%;box-sizing:border-box}';
let lHtml = '<canvas id="rsScene" aria-hidden="true"></canvas><div class="lg-veil" aria-hidden="true"></div><main class="lg-body"><div class="lg-col lg-tilt">'
  + '<section class="panel" id="pLogin">' + between(lh, '<section class="panel" id="pLogin" hidden>', '</section>') + '</section></div></main>';
lHtml = must(lHtml, 'id="gid"', 'id="rsU"');
lHtml = must(lHtml, 'id="pw"', 'id="rsP"');
lHtml = must(lHtml, 'id="capsTip"', 'id="rsCaps"');
lHtml = must(lHtml, 'id="fLogin"', 'id="rsLoginForm"');
let lScene = between(lh.slice(lh.indexOf('<script src="lib/three.min.js"></script>')), '<script>', '</script>');
lScene = must(lScene, "document.getElementById('scene')", "document.getElementById('rsScene')");
lScene = must(lScene, "if (!still && !document.hidden) requestAnimationFrame(frame);", "if (!canvas.isConnected){ renderer.dispose(); return; }\n    if (!still && !document.hidden) requestAnimationFrame(frame);");
lScene = must(lScene, "if (!document.hidden && !still) requestAnimationFrame(frame);", "if (canvas.isConnected && !document.hidden && !still) requestAnimationFrame(frame);");
const ui = `window.RS_LOGIN_UI = ${JSON.stringify({ css: lCss, html: lHtml, scene: lScene }).replace(/</g, '\\u003c')};\n`;
const auth = USERS ? ui + `window.RS_SEED_USERS = ${JSON.stringify(USERS).replace(/</g, '\\u003c')};\n` + fs.readFileSync(path.join(__dirname, 'local_auth.js'), 'utf8') : '';
/* app.js: the manual PDF comes from the embedded copy */
app = must(app, "f.src = 'training-manual.pdf#view=FitH'", "f.src = (window.RS_PDF_URL || 'training-manual.pdf') + '#view=FitH'");

/* first open: put the embedded data into this browser (asks before replacing data that is already here) */
const seed = `(function(){
  var D = ${JSON.stringify(data.keys).replace(/</g, '\\u003c')};
  var STAMP = ${JSON.stringify(String(data.at))};
  var ls = window.localStorage;
  if (ls.getItem('rsSingleSeed') === STAMP) return;
  var has = ls.getItem('resStoreV7') !== null;
  if (has && !confirm('พบข้อมูล Resonance Store ที่เคยใช้ในเบราว์เซอร์นี้แล้ว\\n\\nOK = แทนด้วยข้อมูลที่มากับไฟล์นี้ (' + STAMP.slice(0, 16) + ')\\nCancel = ใช้ข้อมูลเดิมในเครื่องต่อ')) { ls.setItem('rsSingleSeed', STAMP); return; }
  try { Object.keys(D).forEach(function(k){ ls.setItem(k, D[k]); }); ls.setItem('rsSingleSeed', STAMP); }
  catch (e) { alert('ใส่ข้อมูลเริ่มต้นไม่สำเร็จ: ' + e.message); }
})();`;

/* the manual PDF as a blob: URL (browsers refuse to open data: PDFs in a new tab) */
const pdfJs = `(function(){
  var b = atob(document.getElementById('rs-pdf').textContent.trim()), a = new Uint8Array(b.length);
  for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  window.RS_PDF_URL = URL.createObjectURL(new Blob([a], { type: 'application/pdf' }));
  document.querySelectorAll('a[href="training-manual.pdf"]').forEach(function(x){ x.href = window.RS_PDF_URL; });
})();`;

const libs = ['xlsx.full.min.js', 'three.min.js', 'OrbitControls.js', 'qrcode.js', 'jsQR.js']
  .map(f => `<script>/* lib/${f} */\n${safe(rd('lib/' + f))}\n</script>`).join('\n');

html = must(html, '<link rel="stylesheet" href="styles.css" />', `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`);
html = must(html, `<!-- libraries are kept in lib/ next to this file; the CDN is only a fallback -->
  <script src="lib/xlsx.full.min.js"></script>
  <script>window.XLSX || document.write('<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"><\\/script>')</script>`,
  `<!-- single-file build: every library is inside this file -->\n${libs}`);
html = must(html, '<script src="sync.js"></script>',
  `<script type="text/plain" id="rs-app-src">${safe(app)}</script>
<script type="text/plain" id="rs-pdf">${pdf}</script>
<script>${seed}</script>
<script>${pdfJs}</script>
${auth ? `<script>${safe(auth)}</script>` : ''}
<script>${safe(sync)}</script>`);
html = html.replace('<head>', '<head>\n  <!-- RESONANCE STORE · single-file build ' + new Date().toISOString().slice(0, 16) + ' · runs without a server; data stays in this browser -->');

fs.writeFileSync(OUT, html);
const left = (html.match(/(src|href)="(?!https?:|data:|#|blob:|mailto:)[^"]+\.(js|css|pdf|png)"/g) || []);
console.log('written', OUT, (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB', '· keys', Object.keys(data.keys).length, '· local file refs left:', left);
