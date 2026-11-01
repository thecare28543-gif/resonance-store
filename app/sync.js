/* =====================================================================
   RESONANCE STORE · sync + backup (loaded before app.js)
   app.js keeps saving to localStorage exactly as before. This file:
   1. on start, pulls the shared data from the server into localStorage, then loads app.js
   2. sends every change of a shared key to the server (PUT /api/data)
   3. polls the server every few seconds and brings in changes made on other PCs
   4. server down: keeps working on this PC, queues the changes, sends them when it is back
   5. opened as a file (no server): works on this PC only, like the original dashboard
   ===================================================================== */
(function(){
  'use strict';
  /* data that must be the same on every PC; everything else (theme, tab, editor name…) stays per PC */
  const SHARED = ['resStoreV7', 'jobDetailV7', 'disposeDataV7', 'lastUpdatedV7', 'resLogV1', 'resLogSnapV1', 'resLogStartV1',
    'resHoldV1', 'resHoldLogV1', 'resHoldAuditV1', 'resKaizenV1', 'resCycleV1', 'resOwnerEmailV1', 'resZoneV1', 'resTrainV1'];
  const API = 'api/', POLL_MS = 5000, RETRY_MS = 15000, BOOT_TIMEOUT = 3000;
  const ls = window.localStorage, rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  const st = {
    mode: location.protocol === 'file:' ? 'local' : 'connecting',   /* local | connecting | online | saving | offline */
    base: Number(ls.getItem('rsSyncBase')) || 0,                   /* last server version this PC has */
    pending: new Set(JSON.parse(ls.getItem('rsSyncPending') || '[]')),
    synced: {},                                                     /* key -> value the server has */
    pushing: false, timer: 0, lastOk: 0, appLoaded: false,
  };
  const keep = () => { rawSet.call(ls, 'rsSyncBase', String(st.base)); rawSet.call(ls, 'rsSyncPending', JSON.stringify([...st.pending])); };
  const toast = (t, m, type) => { if (typeof window.showToast === 'function') window.showToast(t, m, type); };

  function req(method, url, body, ms){
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 20000);
    return fetch(API + url, { method, cache: 'no-store', signal: ctl.signal, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(async r => { clearTimeout(t); const j = await r.json().catch(() => ({})); if (!r.ok && r.status !== 409) throw new Error(j.error || r.status); return { status: r.status, j }; })
      .catch(e => { clearTimeout(t); throw e; });
  }

  /* ---------- status chip in the top bar ---------- */
  const chip = document.createElement('button');
  chip.type = 'button'; chip.className = 'sync-chip'; chip.title = 'สถานะการบันทึกข้อมูล · คลิกเพื่อดู Backup';
  const meta = document.querySelector('.top-meta'); if (meta) meta.insertBefore(chip, meta.firstChild);
  chip.addEventListener('click', openBackup);
  function paint(){
    const n = st.pending.size;
    const txt = { local: 'โหมดเครื่องเดียว (ไม่มี server)', connecting: 'กำลังเชื่อม server…', online: 'ซิงก์แล้ว · ทุกเครื่องเห็นตรงกัน',
      saving: 'กำลังบันทึกขึ้น server…', offline: `ออฟไลน์ · เก็บในเครื่องนี้${n ? ` (รอส่ง ${n})` : ''}` }[st.mode];
    chip.className = `sync-chip ${st.mode}`;
    chip.innerHTML = `<i></i><span>${txt}</span>`;
  }
  paint();

  /* ---------- bring server values into localStorage, tell app.js to reload ---------- */
  function applyRemote(keys){
    let changed = null;
    for (const [k, v] of Object.entries(keys || {})){
      if (!SHARED.includes(k)) continue;
      st.synced[k] = v;
      if (st.pending.has(k)) continue;          /* unsent local change: the next push settles it */
      if (ls.getItem(k) === v) continue;
      if (v === null) rawRemove.call(ls, k); else rawSet.call(ls, k, v);
      changed = changed || k;
    }
    /* app.js already reloads every shared key on a 'storage' event (it is how two tabs stay in step) */
    if (changed && st.appLoaded) window.dispatchEvent(new StorageEvent('storage', { key: 'resStoreV7' }));
    return !!changed;
  }

  /* ---------- capture every write app.js makes to a shared key ---------- */
  Storage.prototype.setItem = function(k, v){
    rawSet.call(this, k, v);
    if (this === ls && SHARED.includes(k) && st.mode !== 'local' && st.synced[k] !== String(v)){ st.pending.add(k); keep(); schedulePush(); }
  };
  function schedulePush(){ clearTimeout(st.timer); st.timer = setTimeout(push, 600); }

  async function push(){
    if (st.pushing || !st.pending.size || st.mode === 'local') return;
    st.pushing = true;
    const keys = [...st.pending], set = {};
    keys.forEach(k => { set[k] = ls.getItem(k); });
    if (st.mode !== 'offline'){ st.mode = 'saving'; paint(); }
    try {
      const { status, j } = await req('PUT', 'data', { base: st.base, set });
      if (status === 409){
        /* another PC saved the same data first: keep this PC's copy as a backup file on the server,
           then take the newer server data so every PC is the same again */
        await req('POST', 'conflict', { base: st.base, set, client: navigator.userAgent }).catch(() => {});
        j.conflicts.forEach(k => st.pending.delete(k));
        st.base = j.version; keep();
        applyRemote(j.keys);
        toast('มีเครื่องอื่นบันทึกพร้อมกัน', 'ระบบใช้ข้อมูลล่าสุดจาก server แล้ว · สำเนาของเครื่องนี้เก็บไว้ใน Backup (conflict) · ตรวจรายการล่าสุดอีกครั้ง', 'warn');
      } else {
        keys.forEach(k => { st.synced[k] = set[k]; if (ls.getItem(k) === set[k]) st.pending.delete(k); });
        st.base = j.version; keep();
        applyRemote(j.keys);
      }
      online();
    } catch { offline(); }
    st.pushing = false;
    if (st.pending.size && st.mode === 'online') schedulePush();
  }

  async function poll(){
    if (st.mode === 'local' || st.pushing) return;
    try {
      const { j } = await req('GET', `data?since=${st.base}`, null, 8000);
      if (j.version < st.base){ st.base = 0; keep(); return poll(); }   /* server data was replaced (new server / restore) */
      applyRemote(j.keys);
      st.base = j.version; keep();
      const wasOffline = st.mode === 'offline';
      online();
      if (wasOffline && st.pending.size){ toast('กลับมาออนไลน์แล้ว', `กำลังส่งข้อมูลที่บันทึกระหว่างออฟไลน์ (${st.pending.size} ชุด)`, 'info'); push(); }
    } catch { offline(); }
  }
  function online(){ st.lastOk = Date.now(); if (st.mode !== 'online'){ st.mode = 'online'; paint(); } }
  function offline(){
    if (st.mode === 'offline') return;
    st.mode = 'offline'; paint();
    toast('เชื่อม server ไม่ได้ · ทำงานต่อได้ตามปกติ', 'ข้อมูลเก็บในเครื่องนี้ก่อน และส่งขึ้น server ให้อัตโนมัติเมื่อกลับมา · ถ้าล่มนาน ใช้ "พิมพ์ผังงานสำรอง"', 'warn');
  }

  /* ---------- start: pull first, then load app.js ---------- */
  async function boot(){
    if (st.mode !== 'local'){
      try {
        if (st.pending.size){ st.mode = 'offline'; await push(); }    /* changes left from an offline session go first */
        const { j } = await req('GET', 'data?since=0', null, BOOT_TIMEOUT);
        if (!j.version){
          /* empty server: this PC's data becomes the first shared copy */
          SHARED.forEach(k => { if (ls.getItem(k) !== null) st.pending.add(k); });
          st.base = 0;
        } else {
          st.base = 0; applyRemote(j.keys); st.base = j.version;
        }
        keep(); online();
      } catch { st.mode = 'offline'; paint(); }
    }
    const s = document.createElement('script');
    s.src = 'app.js';
    s.onload = () => {
      st.appLoaded = true;
      if (st.mode === 'offline') toast('เปิดแบบออฟไลน์', 'เชื่อม server ไม่ได้ · ใช้ข้อมูลล่าสุดที่เก็บในเครื่องนี้ · บันทึกได้ตามปกติ', 'warn');
      if (st.pending.size && st.mode === 'online') push();
      setInterval(() => { if (st.mode === 'offline') poll(); }, RETRY_MS);
      setInterval(() => { if (st.mode !== 'offline' && !document.hidden) poll(); }, POLL_MS);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    };
    document.body.appendChild(s);
  }

  /* ---------- Backup & restore dialog ---------- */
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const when = iso => iso ? new Date(iso).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '-';
  const REASON = { auto:'อัตโนมัติ (รายชั่วโมง)', shift:'เปลี่ยนกะ', manual:'กดเอง', first:'ครั้งแรก', 'before-restore':'ก่อนกู้คืน', conflict:'บันทึกชนกัน', shutdown:'ปิด server' };
  function bundle(){ const keys = {}; SHARED.forEach(k => { const v = ls.getItem(k); if (v !== null) keys[k] = v; }); return { app: 'resonance-store', exportedAt: new Date().toISOString(), keys }; }

  async function openBackup(){
    const dlg = document.getElementById('backupDialog'), body = document.getElementById('backupBody');
    let health = null, list = [];
    if (st.mode !== 'local'){ try { health = (await req('GET', 'health', null, 4000)).j; list = (await req('GET', 'backups', null, 4000)).j; } catch {} }
    const stat = (label, v) => `<div><span>${label}</span><b>${v}</b></div>`;
    body.innerHTML = `
      <div class="bk-status">
        ${stat('สถานะ', health ? '🟢 server ทำงาน' : st.mode === 'local' ? '⚪ เครื่องเดียว' : '🔴 เชื่อม server ไม่ได้')}
        ${stat('Backup ล่าสุด', health ? when(health.lastBackupAt) : '-')}
        ${stat('เก็บย้อนหลัง', health ? `${health.backups} ไฟล์ · ${health.keepDays} วัน` : '-')}
      </div>
      <ol class="bk-layers">
        <li><b>ข้อมูลหลักอยู่ที่ server ที่เดียว</b> · ทุกเครื่องอ่าน/เขียนที่เดียวกัน</li>
        <li><b>Backup อัตโนมัติ</b> ทุกชั่วโมงที่มีการแก้ไข + ทุกครั้งที่เปลี่ยนกะ ${health && health.backupDirs.length > 1 ? '· สำเนาไป OneDrive/SharePoint' : ''}</li>
        <li><b>ระบบล่ม</b> · แต่ละเครื่องมีสำเนาล่าสุด ทำงานต่อได้ + ผังงานกระดาษ (⋯ → พิมพ์ผังงานสำรอง)</li>
      </ol>
      <div class="bk-actions">
        ${health ? '<button type="button" class="btn primary sm" data-bk="now">🛡 Backup ตอนนี้</button>' : ''}
        <button type="button" class="btn soft sm" data-bk="download">⬇ ดาวน์โหลด Backup ไฟล์ (เครื่องนี้)</button>
        <label class="btn ghost sm" style="cursor:pointer">⬆ กู้คืนจากไฟล์<input type="file" accept=".json" data-bk="file" hidden></label>
      </div>
      ${health ? `<div class="bk-list"><table><thead><tr><th>เวลา</th><th>ประเภท</th><th>ขนาด</th><th></th></tr></thead><tbody>
        ${list.slice(0, 100).map(b => { const r = (b.name.match(/-\d{4}-(.+)\.json$/) || [])[1] || ''; return `<tr><td>${when(b.at)}</td><td>${esc(REASON[r] || r)}</td><td>${Math.max(1, Math.round(b.size / 1024))} KB</td>
          <td style="white-space:nowrap"><a class="btn ghost sm" href="${API}backups/${encodeURIComponent(b.name)}">⬇</a> <button type="button" class="btn ghost sm" data-restore="${esc(b.name)}">กู้คืน</button></td></tr>`; }).join('') || '<tr><td colspan="4">ยังไม่มี backup</td></tr>'}
      </tbody></table></div>` : ''}
      <p class="dlg-note">กู้คืนทุกครั้ง server จะ backup ข้อมูลปัจจุบันเก็บไว้ก่อน (ย้อนกลับได้เสมอ) · ทุกเครื่องจะเห็นข้อมูลที่กู้คืนภายในไม่กี่วินาที</p>`;
    if (!dlg.open) dlg.showModal();
  }
  async function restore(payload, label){
    if (!confirm(`กู้คืนข้อมูลจาก ${label} ?\nข้อมูลปัจจุบันจะถูก backup เก็บไว้ก่อน`)) return;
    if (st.mode === 'local' || st.mode === 'offline'){
      if (!payload.keys){ toast('กู้คืนไม่ได้', 'ต้องเชื่อม server ก่อน', 'error'); return; }
      SHARED.forEach(k => rawRemove.call(ls, k));
      Object.entries(payload.keys).forEach(([k, v]) => { if (SHARED.includes(k)) rawSet.call(ls, k, v); });
      if (st.mode === 'offline'){ SHARED.forEach(k => st.pending.add(k)); keep(); }
      location.reload(); return;
    }
    try { await req('POST', 'restore', payload); SHARED.forEach(k => rawRemove.call(ls, k)); st.pending.clear(); st.base = 0; keep(); location.reload(); }
    catch (e){ toast('กู้คืนไม่สำเร็จ', String(e.message || e), 'error'); }
  }
  document.getElementById('backupDialog').addEventListener('click', async e => {
    const b = e.target.closest('[data-bk]');
    if (b && b.dataset.bk === 'now'){
      try { const { j } = await req('POST', 'backup'); toast('Backup แล้ว', j.name); openBackup(); } catch { toast('Backup ไม่สำเร็จ', 'เชื่อม server ไม่ได้', 'error'); }
    }
    if (b && b.dataset.bk === 'download'){
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(bundle())], { type: 'application/json' }));
      a.download = `resonance-backup-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.json`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    const r = e.target.closest('[data-restore]'); if (r) restore({ name: r.dataset.restore }, r.dataset.restore);
  });
  document.getElementById('backupDialog').addEventListener('change', async e => {
    const inp = e.target.closest('[data-bk="file"]'); if (!inp || !inp.files[0]) return;
    try {
      const data = JSON.parse(await inp.files[0].text());
      const keys = data.keys && Object.fromEntries(Object.entries(data.keys).map(([k, x]) => [k, typeof x === 'string' ? x : x && x.v]));
      if (!keys) throw new Error('ไม่ใช่ไฟล์ backup ของ Resonance Store');
      restore({ keys }, inp.files[0].name);
    } catch (err){ toast('อ่านไฟล์ไม่ได้', String(err.message || err), 'error'); }
    inp.value = '';
  });
  document.getElementById('backupBtn').addEventListener('click', openBackup);

  /* keep a copy of the app files in the browser so the page still opens while the server is down
     (browsers allow this only on https:// or localhost) */
  if ('serviceWorker' in navigator && window.isSecureContext && st.mode !== 'local') navigator.serviceWorker.register('sw.js').catch(() => {});

  window.RS_SYNC = { status: () => ({ ...st, pending: [...st.pending] }), push, poll };
  boot();
})();
