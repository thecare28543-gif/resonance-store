/* open the single-file HTML from file:// in headless Edge, with ALL network blocked, and check it works */
const { chromium } = require('playwright-core');
const path = require('path');
const FILE = path.resolve(process.argv[2]);
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const errors = [], requests = [];
  await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file:') || u.startsWith('blob:') || u.startsWith('data:')) return r.continue(); requests.push(u); return r.abort(); });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  p.on('dialog', d => { errors.push('dialog: ' + d.message().slice(0, 60)); d.accept(); });
  await p.goto('file:///' + FILE.replace(/\\/g, '/'));
  await p.waitForTimeout(4000);
  const r = await p.evaluate(() => ({
    title: document.title,
    libs: { XLSX: !!window.XLSX, THREE: !!window.THREE, Orbit: !!(window.THREE && THREE.OrbitControls), qrcode: typeof window.qrcode === "function", jsQR: !!window.jsQR },
    sync: window.RS_SYNC && window.RS_SYNC.status().mode,
    seeded: localStorage.getItem('rsSingleSeed'),
    rows: (JSON.parse(localStorage.getItem('resStoreV7') || '[]')).length,
    jobs: Object.keys(JSON.parse(localStorage.getItem('jobDetailV7') || '{}')).length,
    pdf: !!window.RS_PDF_URL,
    pdfLinks: [...document.querySelectorAll('a')].filter(a => /manual|คู่มือ|เต็มจอ|ดาวน์โหลด/.test(a.textContent + a.href)).map(a => a.href.slice(0, 12)),
    canvas: document.querySelectorAll('canvas').length,
    loc: location.href.slice(0, 8),
  }));
  console.log(JSON.stringify(r, null, 1));
  await p.screenshot({ path: path.join(path.dirname(FILE), 'shot_overview.png') });
  // reload: must not ask again and data must persist
  await p.reload(); await p.waitForTimeout(2500);
  console.log('after reload rows:', await p.evaluate(() => JSON.parse(localStorage.getItem('resStoreV7') || '[]').length));
  console.log('blocked network requests:', requests.length, requests.slice(0, 5));
  console.log('errors:', errors.length ? errors : 'none');
  await b.close();
})();
