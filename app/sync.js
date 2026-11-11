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
  /* app version: change it whenever app.js / sync.js change, so a PC on old files shows up */
  const VER = '2026.11.11';
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
    return fetch(API + url, { method, cache: 'no-store', signal: ctl.signal, headers: body ? { 'Content-Type': 'application/json', 'X-RS-Ver': VER } : { 'X-RS-Ver': VER }, body: body ? JSON.stringify(body) : undefined })
      .then(async r => {
        clearTimeout(t); const j = await r.json().catch(() => ({}));
        /* session ended (12 h, logged out, account closed) or a new password is due: back to the log-in page */
        if (r.status === 401 || (r.status === 403 && j.mustChange)){ toLogin(j.mustChange); throw new Error('login'); }
        if (!r.ok && r.status !== 409) throw Object.assign(new Error(j.error || r.status), { status: r.status });
        return { status: r.status, j };
      })
      .catch(e => { clearTimeout(t); throw e; });
  }
  let leaving = false;
  function toLogin(change){
    if (leaving) return; leaving = true;
    location.href = change ? 'login.html?change=1' : `login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
  }

  /* ---------- who is logged in (from the server); file mode has no log-in ---------- */
  const ROLE_TXT = { admin: 'Admin', user: 'User', viewer: 'Viewer · ดูอย่างเดียว' };
  let user = null;
  const userChip = document.createElement('div');
  userChip.className = 'user-chip'; userChip.hidden = true;
  function setUser(u){
    if (!u || (user && user.gid === u.gid && user.role === u.role && user.name === u.name)) return;
    user = u;
    if (!userChip.isConnected){ const m = document.querySelector('.top-meta'); if (m) m.appendChild(userChip); }
    document.body.classList.toggle('role-viewer', u.role === 'viewer');
    document.body.classList.toggle('role-admin', u.role === 'admin');
    userChip.hidden = false;
    userChip.innerHTML = `<button type="button" class="uc-btn" aria-haspopup="true" title="${esc(u.gid)}">👤 <b>${esc(u.name)}</b><small>${esc(ROLE_TXT[u.role] || u.role)}</small></button>
      <div class="uc-menu" hidden>
        <div class="uc-head"><b>${esc(u.name)}</b><span>GID ${esc(u.gid)}${u.crew ? ` · กะ ${esc(u.crew)}` : ''} · ${esc(ROLE_TXT[u.role] || u.role)}</span></div>
        ${u.role === 'admin' ? '<a href="users.html">👥 จัดการผู้ใช้งาน</a>' : ''}
        <button type="button" data-logout>⎋ ออกจากระบบ</button>
      </div>`;
    applyEditor();
  }
  /* the logged-in name is the editor name: Last_Editor and the logs show who really did it */
  function applyEditor(){
    const el = document.getElementById('editorName');
    if (!user || !el || !st.appLoaded) return;
    el.value = user.name; el.readOnly = true; el.title = 'ชื่อจากการล็อกอิน';
    rawSet.call(ls, 'resEditorV1', user.name);
  }
  userChip.addEventListener('click', e => {
    const menu = userChip.querySelector('.uc-menu');
    if (e.target.closest('.uc-btn')){ menu.hidden = !menu.hidden; return; }
    if (e.target.closest('[data-logout]')){
      if (st.pending.size && !confirm(`ยังมีข้อมูลรอส่งขึ้น server ${st.pending.size} ชุด · ออกจากระบบเลยไหม?\n(ข้อมูลยังอยู่ในเครื่องนี้ และส่งให้ตอนล็อกอินครั้งถัดไป)`)) return;
      req('POST', 'auth/logout', {}).catch(() => {}).then(() => { leaving = true; location.href = 'login.html'; });
    }
  });
  document.addEventListener('click', e => { if (!userChip.contains(e.target)){ const m = userChip.querySelector('.uc-menu'); if (m) m.hidden = true; } });
  /* a viewer may look but not change: shared data is not written, the screen goes back to the saved data */
  let viewerWarnAt = 0;
  function viewerBlocked(){
    if (Date.now() - viewerWarnAt > 4000){ viewerWarnAt = Date.now(); toast('สิทธิ์ Viewer ดูได้อย่างเดียว', 'การแก้ไขนี้ไม่ถูกบันทึก · ถ้าต้องทำงาน Store ขอสิทธิ์ User จากแอดมิน', 'warn'); }
    clearTimeout(viewerBlocked.t);
    viewerBlocked.t = setTimeout(() => window.dispatchEvent(new StorageEvent('storage', { key: 'resStoreV7' })), 50);
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
    chip.innerHTML = `<i></i><span>${txt}</span><small style="opacity:.6;margin-left:6px">v${VER}</small>`;
    chip.title = `สถานะการบันทึกข้อมูล · เวอร์ชัน ${VER} · คลิกเพื่อดู Backup`;
  }
  /* another PC on the server runs other (older) files: say so every 30 min until it is updated */
  let appsWarnAt = 0;
  function checkApps(apps){
    const other = Object.entries(apps || {}).filter(([v]) => v !== VER && (v === 'old' || v < VER));
    if (!other.length || Date.now() - appsWarnAt < 1800000) return;
    appsWarnAt = Date.now();
    const n = other.reduce((s, [, c]) => s + c, 0);
    toast(`มี ${n} เครื่องยังใช้ไฟล์เว็บเวอร์ชันเก่า`, `เครื่องนี้ v${VER} · เครื่องนั้น ${other.map(([v]) => v === 'old' ? 'ก่อน 10 พ.ย. 69' : 'v' + v).join(', ')} · ก๊อป app.js + sync.js ใหม่ไปลงเครื่องนั้น ไม่งั้นงานที่บันทึกพร้อมกันอาจหาย`, 'warn');
  }
  paint();

  /* ---------- 3-way merge: base = the server copy this PC's change started from ----------
     only one side changed a value -> take that side; both changed it -> merge deeper, this PC wins a real clash.
     arrays of rows with _id (the store) merge row by row; other arrays (logs) keep the server list + this PC's new entries */
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function mergeVal(b, l, r){
    if (same(l, b)) return r;
    if (same(r, b) || same(l, r)) return l;
    if (Array.isArray(l) && Array.isArray(r)) return mergeList(Array.isArray(b) ? b : [], l, r);
    if (isObj(l) && isObj(r)) return mergeObj(isObj(b) ? b : {}, l, r);
    return l;
  }
  function mergeObj(b, l, r){
    const out = {};
    for (const k of new Set([...Object.keys(r), ...Object.keys(l)])){ const v = mergeVal(b[k], l[k], r[k]); if (v !== undefined) out[k] = v; }
    return out;
  }
  function mergeList(b, l, r){
    const id = x => isObj(x) && x._id;
    if (l.every(id) && r.every(id)){
      const bm = new Map(b.filter(id).map(x => [x._id, x])), lm = new Map(l.map(x => [x._id, x])), rm = new Map(r.map(x => [x._id, x]));
      const out = [];
      r.forEach(x => { const v = mergeVal(bm.get(x._id), lm.get(x._id), x); if (v !== undefined) out.push(v); });
      l.forEach(x => { if (rm.has(x._id)) return; const v = mergeVal(bm.get(x._id), x, undefined); if (v !== undefined) out.push(v); });
      return out;
    }
    const seen = new Set([...b, ...r].map(x => JSON.stringify(x)));
    return r.concat(l.filter(x => !seen.has(JSON.stringify(x))));
  }
  /* stored strings: JSON is merged, plain text (a time stamp) keeps the later one */
  function mergeText(b, l, r){
    if (l === null || r === null) return l;
    try { return JSON.stringify(mergeVal(b == null ? undefined : JSON.parse(b), JSON.parse(l), JSON.parse(r))); }
    catch { return l > r ? l : r; }
  }

  /* ---------- bring server values into localStorage, tell app.js to reload ---------- */
  function applyRemote(keys){
    let changed = null;
    for (const [k, v] of Object.entries(keys || {})){
      if (!SHARED.includes(k)) continue;
      const base = st.synced[k];
      st.synced[k] = v;
      if (st.pending.has(k)){
        /* unsent local change and another PC changed the same data: fold its change into ours, the next push sends both */
        if (v === base) continue;
        const local = ls.getItem(k), merged = mergeText(base, local, v);
        if (merged === local) continue;
        if (merged === null) rawRemove.call(ls, k); else rawSet.call(ls, k, merged);
        changed = changed || k;
        continue;
      }
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
    if (this === ls && user && user.role === 'viewer' && SHARED.includes(k)){
      if (!st.appLoaded) return rawSet.call(this, k, v);                 /* app.js setting itself up: local only, never sent */
      if (ls.getItem(k) !== String(v)) viewerBlocked();
      return;
    }
    rawSet.call(this, k, v);
    if (this === ls && SHARED.includes(k) && st.mode !== 'local' && st.synced[k] !== String(v)){ st.pending.add(k); keep(); schedulePush(); }
  };
  function schedulePush(){ clearTimeout(st.timer); st.timer = setTimeout(push, 600); }

  async function push(){
    if (user && user.role === 'viewer'){ st.pending.clear(); keep(); }
    if (st.pushing || !st.pending.size || st.mode === 'local') return;
    st.pushing = true;
    const keys = [...st.pending], set = {};
    keys.forEach(k => { set[k] = ls.getItem(k); });
    if (st.mode !== 'offline'){ st.mode = 'saving'; paint(); }
    try {
      const { status, j } = await req('PUT', 'data', { base: st.base, set });
      if (status === 409){
        /* another PC saved the same data first: keep this PC's copy as a backup file on the server,
           merge the other PC's change into ours and send again, so both changes are kept */
        await req('POST', 'conflict', { base: st.base, set, client: navigator.userAgent }).catch(() => {});
        st.base = j.version; keep();
        applyRemote(j.keys);
        toast('มีเครื่องอื่นบันทึกพร้อมกัน · รวมข้อมูลให้แล้ว', 'เก็บทั้งรายการของเครื่องนี้และเครื่องอื่น · สำเนาก่อนรวมเก็บไว้ใน Backup (conflict)', 'info');
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
      checkApps(j.apps);
      setUser(j.user);
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
        setUser(j.user);
        if (user && user.role === 'viewer'){ st.pending.clear(); }       /* a viewer never sends data */
        if (!j.version && !(user && user.role === 'viewer')){
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
      applyEditor();
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
  /* file mode / offline before log-in info: no user known, the old rules apply */
  const canWrite = () => !user || user.role !== 'viewer';
  const canRestore = () => !user || user.role === 'admin';
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
        ${health && canWrite() ? '<button type="button" class="btn primary sm" data-bk="now">🛡 Backup ตอนนี้</button>' : ''}
        <button type="button" class="btn soft sm" data-bk="download">⬇ ดาวน์โหลด Backup ไฟล์ (เครื่องนี้)</button>
        ${canRestore() ? '<label class="btn ghost sm" style="cursor:pointer">⬆ กู้คืนจากไฟล์<input type="file" accept=".json" data-bk="file" hidden></label>' : ''}
      </div>
      ${health ? `<div class="bk-list"><table><thead><tr><th>เวลา</th><th>ประเภท</th><th>ขนาด</th><th></th></tr></thead><tbody>
        ${list.slice(0, 100).map(b => { const r = (b.name.match(/-\d{4}-(.+)\.json$/) || [])[1] || ''; return `<tr><td>${when(b.at)}</td><td>${esc(REASON[r] || r)}</td><td>${Math.max(1, Math.round(b.size / 1024))} KB</td>
          <td style="white-space:nowrap"><a class="btn ghost sm" href="${API}backups/${encodeURIComponent(b.name)}">⬇</a>${canRestore() ? ` <button type="button" class="btn ghost sm" data-restore="${esc(b.name)}">กู้คืน</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="4">ยังไม่มี backup</td></tr>'}
      </tbody></table></div>` : ''}
      <p class="dlg-note">${canRestore() ? 'กู้คืนทุกครั้ง server จะ backup ข้อมูลปัจจุบันเก็บไว้ก่อน (ย้อนกลับได้เสมอ) · ทุกเครื่องจะเห็นข้อมูลที่กู้คืนภายในไม่กี่วินาที' : 'การกู้คืนข้อมูลทำได้เฉพาะแอดมิน'}</p>`;
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

  window.RS_SYNC = { status: () => ({ ...st, pending: [...st.pending] }), push, poll, merge: mergeVal, version: VER };
  boot();
})();
