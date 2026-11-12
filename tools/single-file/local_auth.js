/* RESONANCE STORE · single-file log-in + user admin (no server).
   Same rule as the server version: User = GID, Password = the same GID. Roles admin / user / viewer.
   Users, session, lock-outs and the log-in log live in this browser's localStorage.
   NOTE: this keeps casual users out and records who did what; it is not real security (anyone can read the file). */
(function(){
  var ls = window.localStorage;
  var K_USERS = 'rsUsersV1', K_SESS = 'rsLocalSessionV1', K_LOCK = 'rsLocalLockV1', K_LOG = 'rsLoginLogV1';
  var SESSION_MS = 12 * 3600e3, MAX_FAIL = 5, LOCK_MS = 15 * 60e3;
  var ROLE_TXT = { admin: 'Admin', user: 'User', viewer: 'Viewer · ดูอย่างเดียว' };
  var SEED = window.RS_SEED_USERS || [];

  function get(k, d){ try { var v = JSON.parse(ls.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v){ try { ls.setItem(k, JSON.stringify(v)); } catch (e) { alert('บันทึกไม่ได้: ' + e.message); } }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(g){ return String(g == null ? '' : g).trim().toUpperCase(); }
  function users(){ return get(K_USERS, []); }
  function saveUsers(a){ put(K_USERS, a); }
  function find(g){ g = norm(g); return users().filter(function(u){ return u.gid === g; })[0]; }
  function log(gid, ok, why){ var a = get(K_LOG, []); a.unshift({ at: new Date().toISOString(), gid: norm(gid), ok: ok, why: why || '' }); put(K_LOG, a.slice(0, 300)); }
  if (!ls.getItem(K_USERS)) saveUsers(SEED.map(function(u){ return { gid: norm(u.gid), name: u.name, role: u.role, crew: u.crew || '', dept: u.dept || '', active: u.active !== false, last: '' }; }));

  /* ---------- session ---------- */
  function current(){
    var s = get(K_SESS, null);
    if (!s || !s.gid || Date.now() > s.exp) return null;
    var u = find(s.gid);
    if (!u || !u.active) return null;
    return u;
  }
  function logout(){ ls.removeItem(K_SESS); location.reload(); }

  /* ---------- log-in screen ---------- */
  var css = document.createElement('style');
  css.textContent = [
    'body.rs-locked>*:not(#rsLogin):not(script):not(style){visibility:hidden}',
    /* user admin dialog */
    '#rsUsers{width:min(1000px,96vw);max-height:90vh;border:1px solid var(--line);border-radius:18px;padding:0;background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}',
    '#rsUsers::backdrop{background:rgba(0,0,0,.35)}',
    '#rsUsers .hd{display:flex;align-items:center;gap:10px;padding:18px 22px;border-bottom:1px solid var(--line)} #rsUsers .hd h3{margin:0;flex:1;font-size:18px}',
    '#rsUsers .tabs{display:flex;gap:6px;padding:12px 22px 0} #rsUsers .tabs button.on{background:var(--brand-soft);color:var(--brand-strong);border-color:var(--brand)}',
    '#rsUsers .bd{padding:14px 22px 22px;overflow:auto;max-height:calc(90vh - 140px)}',
    '#rsUsers form.add{display:grid;grid-template-columns:1.1fr 2fr .8fr 1.2fr auto;gap:8px;align-items:end;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:14px}',
    '#rsUsers label{font-size:12px;font-weight:600;color:var(--muted);display:flex;flex-direction:column;gap:4px}',
    '#rsUsers input,#rsUsers select{height:40px;border:1px solid var(--line);border-radius:9px;padding:0 10px;font:inherit;background:var(--surface);color:var(--ink)}',
    '#rsUsers table{width:100%;border-collapse:collapse;font-size:14px} #rsUsers th{text-align:left;font-size:12px;color:var(--muted);padding:8px;border-bottom:1px solid var(--line)}',
    '#rsUsers td{padding:6px 8px;border-bottom:1px solid var(--line)} #rsUsers td input,#rsUsers td select{height:36px;width:100%;box-sizing:border-box}',
    '#rsUsers tr.off td{opacity:.55} #rsUsers .me{font-size:11px;color:var(--brand-strong);font-weight:700}',
    '#rsUsers .tools{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px} #rsUsers .note{font-size:12.5px;color:var(--muted);margin:10px 0 0}',
    '#rsUsers .ok{color:var(--brand-strong);font-weight:700} #rsUsers .no{color:var(--danger-strong);font-weight:700}',
    '@media (max-width:760px){#rsUsers form.add{grid-template-columns:1fr 1fr}}'
  ].join('\n');
  document.head.appendChild(css);

  /* the log-in screen is the server version's login.html (3D store, glass card), passed in by the build as RS_LOGIN_UI */
  function showLogin(resolve){
    try { if (ls.getItem('resThemeV1') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch (e) {}
    document.body.classList.add('rs-locked');
    var UI = window.RS_LOGIN_UI;
    var st = document.createElement('style'); st.id = 'rsLoginCss'; st.textContent = UI.css; document.head.appendChild(st);
    var box = document.createElement('div'); box.id = 'rsLogin'; box.innerHTML = UI.html;
    document.body.appendChild(box);
    var sc = document.createElement('script'); sc.textContent = UI.scene; document.body.appendChild(sc);
    var scene = function(){ return window.RS_SCENE || { typing: function(){}, focus: function(){}, error: function(){}, success: function(){ return Promise.resolve(); } }; };
    var f = box.querySelector('form'), err = box.querySelector('.lg-err'), card = box.querySelector('.panel'), btn = box.querySelector('.go');
    var U = box.querySelector('#rsU'), P = box.querySelector('#rsP'), caps = box.querySelector('.lg-cap');
    setTimeout(function(){ U.focus(); }, 60);
    [U, P].forEach(function(i){
      i.addEventListener('input', function(){ scene().typing(); });
      i.addEventListener('focus', function(){ scene().focus(true); });
      i.addEventListener('blur', function(){ scene().focus(false); });
    });
    ['keydown', 'keyup'].forEach(function(ev){ P.addEventListener(ev, function(e){ if (e.getModifierState) caps.classList.toggle('on', e.getModifierState('CapsLock')); }); });
    P.addEventListener('blur', function(){ caps.classList.remove('on'); });
    function tilt(e){
      var r = card.getBoundingClientRect(), dx = (e.clientX - (r.left + r.width / 2)) / innerWidth, dy = (e.clientY - (r.top + r.height / 2)) / innerHeight;
      card.style.setProperty('--ry', (dx * 6).toFixed(2) + 'deg'); card.style.setProperty('--rx', (-dy * 6).toFixed(2) + 'deg');
    }
    var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) window.addEventListener('pointermove', tilt, { passive: true });
    f.addEventListener('submit', function(e){
      e.preventDefault();
      if (btn.classList.contains('busy')) return;
      var g = norm(U.value), p = norm(P.value);
      var locks = get(K_LOCK, {}), lk = locks[g] || { n: 0, until: 0 };
      function bad(msg, why){
        log(g, false, why); err.textContent = msg; err.style.display = 'flex';
        card.classList.remove('lg-shake'); void card.offsetWidth; card.classList.add('lg-shake'); scene().error();
        P.value = ''; P.focus();
      }
      if (!g) return bad('User หรือ Password ไม่ถูกต้อง', 'empty');
      if (lk.until > Date.now()) return bad('เข้าระบบไม่ได้ชั่วคราว ลองใหม่ภายหลัง', 'locked');
      var u = find(g);
      if (!u || !u.active || p !== u.gid){
        lk.n = (lk.n || 0) + 1; if (lk.n >= MAX_FAIL){ lk.n = 0; lk.until = Date.now() + LOCK_MS; }
        locks[g] = lk; put(K_LOCK, locks);
        return bad(lk.until > Date.now() ? 'เข้าระบบไม่ได้ชั่วคราว ลองใหม่ภายหลัง' : 'User หรือ Password ไม่ถูกต้อง', !u ? 'unknown gid' : !u.active ? 'inactive' : 'wrong password');
      }
      delete locks[g]; put(K_LOCK, locks);
      var all = users(); all.forEach(function(x){ if (x.gid === u.gid) x.last = new Date().toISOString(); }); saveUsers(all);
      put(K_SESS, { gid: u.gid, exp: Date.now() + SESSION_MS });
      log(u.gid, true, '');
      err.style.display = 'none'; btn.classList.add('busy');
      /* success: the card flies off and the camera dives to the lit tray, then the app shows */
      box.querySelector('.lg-col').classList.add('out');
      Promise.race([scene().success(), new Promise(function(r){ setTimeout(r, 1200); })]).then(function(){
        window.removeEventListener('pointermove', tilt);
        box.style.transition = 'opacity .35s ease'; box.style.opacity = '0';
        document.body.classList.remove('rs-locked');
        resolve(pub(u));
        setTimeout(function(){ box.remove(); st.remove(); delete window.RS_SCENE; }, 380);
      });
    });
  }
  function pub(u){ return { gid: u.gid, name: u.name, role: u.role, crew: u.crew }; }

  /* ---------- user admin (admins only) ---------- */
  var dlg, tab = 'users';
  function me(){ return current(); }
  function adminsLeft(list, exceptGid){ return list.filter(function(u){ return u.role === 'admin' && u.active && u.gid !== exceptGid; }).length; }
  function toast(t, m, type){ if (typeof window.showToast === 'function') window.showToast(t, m, type); else alert(t + (m ? '\n' + m : '')); }
  function openUsers(){
    var m = me(); if (!m || m.role !== 'admin') return toast('เฉพาะ Admin', '', 'warn');
    if (!dlg){
      dlg = document.createElement('dialog'); dlg.id = 'rsUsers'; document.body.appendChild(dlg);
      dlg.addEventListener('click', onClick); dlg.addEventListener('change', onChange); dlg.addEventListener('submit', onAdd);
    }
    render(); dlg.showModal();
  }
  function render(){
    var m = me(), list = users();
    var head = '<div class="hd"><h3>👥 จัดการผู้ใช้งาน</h3><button class="btn ghost sm" data-close>ปิด</button></div>' +
      '<div class="tabs"><button class="btn ghost sm ' + (tab === 'users' ? 'on' : '') + '" data-tab="users">บัญชีผู้ใช้ (' + list.length + ')</button>' +
      '<button class="btn ghost sm ' + (tab === 'roles' ? 'on' : '') + '" data-tab="roles">สิทธิ์การใช้งาน</button>' +
      '<button class="btn ghost sm ' + (tab === 'log' ? 'on' : '') + '" data-tab="log">ประวัติเข้าระบบ</button></div>';
    var body = '';
    if (tab === 'users'){
      body = '<form class="add"><label>GID<input name="gid" required maxlength="20" placeholder="เช่น 123456"></label>' +
        '<label>ชื่อ - นามสกุล<input name="name" required maxlength="120" placeholder="เช่น Somchai Jaidee"></label>' +
        '<label>กะ<select name="crew"><option value="">-</option><option>A</option><option>B</option><option>C</option></select></label>' +
        '<label>สิทธิ์<select name="role"><option value="user">User</option><option value="viewer">Viewer · ดูอย่างเดียว</option><option value="admin">Admin</option></select></label>' +
        '<button class="btn primary" type="submit">+ เพิ่มผู้ใช้</button></form>' +
        '<div class="tools"><label class="btn soft sm" style="flex-direction:row;cursor:pointer">⬆ นำเข้าจาก Excel / CSV<input type="file" data-import accept=".csv,.xlsx,.xls" hidden></label>' +
        '<button class="btn ghost sm" data-export>⬇ Export รายชื่อ (CSV)</button></div>' +
        '<table><thead><tr><th>GID</th><th>ชื่อ</th><th style="width:80px">กะ</th><th style="width:190px">สิทธิ์</th><th style="width:70px">ใช้งาน</th><th>เข้าระบบล่าสุด</th><th></th></tr></thead><tbody>' +
        list.map(function(u){
          var self = u.gid === m.gid;
          return '<tr class="' + (u.active ? '' : 'off') + '" data-gid="' + esc(u.gid) + '"><td><b>' + esc(u.gid) + '</b>' + (self ? ' <span class="me">(คุณ)</span>' : '') + '</td>' +
            '<td><input data-f="name" value="' + esc(u.name) + '" maxlength="120"></td>' +
            '<td><select data-f="crew">' + ['', 'A', 'B', 'C'].map(function(c){ return '<option value="' + c + '"' + (u.crew === c ? ' selected' : '') + '>' + (c || '-') + '</option>'; }).join('') + '</select></td>' +
            '<td><select data-f="role">' + ['admin', 'user', 'viewer'].map(function(r){ return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_TXT[r] + '</option>'; }).join('') + '</select></td>' +
            '<td style="text-align:center"><input type="checkbox" data-f="active"' + (u.active ? ' checked' : '') + (self ? ' disabled' : '') + ' style="width:20px;height:20px"></td>' +
            '<td style="font-size:12.5px;color:var(--muted)">' + (u.last ? new Date(u.last).toLocaleString('th-TH') : '-') + '</td>' +
            '<td style="white-space:nowrap"><button class="btn ghost sm" data-unlock>ปลดล็อก</button> ' + (self ? '' : '<button class="btn ghost sm" data-del>ลบ</button>') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="note">เข้าระบบด้วย GID ทั้งช่อง User และ Password · ผิด 5 ครั้งล็อก 15 นาที (กด "ปลดล็อก" ได้) · ปิด "ใช้งาน" = เข้าระบบไม่ได้แต่เก็บชื่อไว้ · ข้อมูลผู้ใช้เก็บในเบราว์เซอร์เครื่องนี้</p>';
    } else if (tab === 'roles'){
      var Y = '<span class="ok">✓</span>', N = '<span class="no">✕</span>';
      body = '<table><thead><tr><th>สิ่งที่ทำได้</th><th>Admin</th><th>User</th><th>Viewer</th></tr></thead><tbody>' +
        [['ดูภาพรวม 3D รายงาน ค้นหางาน', Y, Y, Y], ['รับงานเข้า / หยิบงานออก / แก้ข้อมูลงาน', Y, Y, N], ['ติด / ปลด Hold · นำเข้า Excel · Backup', Y, Y, N], ['จัดการผู้ใช้งาน (หน้านี้)', Y, N, N]]
          .map(function(r){ return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>'; }).join('') + '</tbody></table>';
    } else {
      var lg = get(K_LOG, []);
      body = '<table><thead><tr><th>เวลา</th><th>GID</th><th>ชื่อ</th><th>ผล</th></tr></thead><tbody>' +
        (lg.length ? lg.slice(0, 200).map(function(x){ var u = find(x.gid); return '<tr><td>' + new Date(x.at).toLocaleString('th-TH') + '</td><td>' + esc(x.gid) + '</td><td>' + esc(u ? u.name : '-') + '</td><td>' + (x.ok ? '<span class="ok">เข้าได้</span>' : '<span class="no">ไม่ผ่าน</span> <small>' + esc(x.why) + '</small>') + '</td></tr>'; }).join('') : '<tr><td colspan="4">ยังไม่มี</td></tr>') +
        '</tbody></table>';
    }
    dlg.innerHTML = head + '<div class="bd">' + body + '</div>';
  }
  function upd(gid, fn){
    var list = users(), u = list.filter(function(x){ return x.gid === gid; })[0]; if (!u) return;
    var before = JSON.stringify(u); var msg = fn(u, list);
    if (msg){ toast(msg, '', 'warn'); render(); return; }
    if (JSON.stringify(u) !== before){ saveUsers(list); toast('บันทึกแล้ว', u.gid + ' · ' + u.name); }
    if (gid === me().gid){ location.reload(); return; }
    render();
  }
  function onChange(e){
    if (e.target.matches('[data-import]')) return importFile(e.target.files[0]);
    var tr = e.target.closest('tr[data-gid]'), f = e.target.getAttribute('data-f'); if (!tr || !f) return;
    var gid = tr.getAttribute('data-gid'), val = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
    upd(gid, function(u, list){
      if (f === 'name' && !val) return 'ชื่อห้ามว่าง';
      if ((f === 'role' && val !== 'admin' && u.role === 'admin') || (f === 'active' && !val && u.role === 'admin'))
        if (!adminsLeft(list, u.gid)) return 'ต้องมี Admin ที่ใช้งานอยู่อย่างน้อย 1 คน';
      u[f] = val;
    });
  }
  function onClick(e){
    var t = e.target;
    if (t.closest('[data-close]')) return dlg.close();
    if (t.closest('[data-tab]')){ tab = t.closest('[data-tab]').getAttribute('data-tab'); return render(); }
    if (t.closest('[data-export]')) return exportCsv();
    var tr = t.closest('tr[data-gid]'); if (!tr) return;
    var gid = tr.getAttribute('data-gid');
    if (t.closest('[data-unlock]')){ var l = get(K_LOCK, {}); delete l[gid]; put(K_LOCK, l); return toast('ปลดล็อกแล้ว', gid); }
    if (t.closest('[data-del]')){
      var list = users(), u = find(gid);
      if (u.role === 'admin' && u.active && !adminsLeft(list, gid)) return toast('ต้องมี Admin ที่ใช้งานอยู่อย่างน้อย 1 คน', '', 'warn');
      if (!confirm('ลบผู้ใช้ ' + gid + ' · ' + u.name + ' ?\n(ถ้าแค่ไม่ให้เข้าระบบ ให้ปิด "ใช้งาน" แทน)')) return;
      saveUsers(list.filter(function(x){ return x.gid !== gid; })); toast('ลบแล้ว', gid); render();
    }
  }
  function addOne(list, gid, name, role, crew){
    gid = norm(gid); name = String(name || '').trim(); role = String(role || 'user').trim().toLowerCase(); crew = String(crew || '').trim().toUpperCase();
    if (!/^[A-Z0-9._-]{2,20}$/.test(gid)) return 'GID ไม่ถูกต้อง: ' + gid;
    if (!name) return 'ไม่มีชื่อ: ' + gid;
    if (['admin', 'user', 'viewer'].indexOf(role) < 0) role = 'user';
    if (['A', 'B', 'C'].indexOf(crew) < 0) crew = '';
    var old = list.filter(function(x){ return x.gid === gid; })[0];
    if (old){ old.name = name; old.role = old.role === 'admin' ? 'admin' : role; old.crew = crew || old.crew; return 'updated'; }
    list.push({ gid: gid, name: name, role: role, crew: crew, dept: '', active: true, last: '' });
    return 'added';
  }
  function onAdd(e){
    e.preventDefault(); var f = e.target, list = users();
    if (find(f.gid.value)) return toast('มี GID นี้แล้ว', norm(f.gid.value), 'warn');
    var r = addOne(list, f.gid.value, f.name.value, f.role.value, f.crew.value);
    if (r !== 'added') return toast(r, '', 'warn');
    saveUsers(list); toast('เพิ่มผู้ใช้แล้ว', norm(f.gid.value) + ' · ' + f.name.value.trim()); render();
  }
  function importFile(file){
    if (!file || !window.XLSX) return;
    var rd = new FileReader();
    rd.onload = function(){
      try {
        var wb = XLSX.read(new Uint8Array(rd.result), { type: 'array' });
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        var pick = function(r, keys){ for (var k in r){ var kk = k.toLowerCase().replace(/\s/g, ''); if (keys.some(function(x){ return kk.indexOf(x) >= 0; })) return r[k]; } return ''; };
        var list = users(), add = 0, up = 0, bad = [];
        rows.forEach(function(r){
          var res = addOne(list, pick(r, ['gid']), pick(r, ['ชื่อ', 'name']), pick(r, ['สิทธิ์', 'role']) || 'user', pick(r, ['กะ', 'crew', 'shift']));
          if (res === 'added') add++; else if (res === 'updated') up++; else bad.push(res);
        });
        saveUsers(list); render();
        toast('นำเข้าแล้ว', 'เพิ่ม ' + add + ' · อัปเดต ' + up + (bad.length ? ' · ข้าม ' + bad.length + ' แถว' : ''), bad.length ? 'warn' : undefined);
      } catch (err) { toast('อ่านไฟล์ไม่ได้', err.message, 'warn'); }
    };
    rd.readAsArrayBuffer(file);
  }
  function exportCsv(){
    var rows = [['GID', 'ชื่อ', 'สิทธิ์', 'กะ', 'ใช้งาน']].concat(users().map(function(u){ return [u.gid, u.name, u.role, u.crew, u.active ? 'Y' : 'N']; }));
    var csv = '﻿' + rows.map(function(r){ return r.map(function(c){ return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'ผู้ใช้_Resonance_Store.csv'; a.click();
  }

  var ready = new Promise(function(resolve){
    var u = current();
    if (u){ put(K_SESS, { gid: u.gid, exp: Date.now() + SESSION_MS }); return resolve(pub(u)); }
    if (document.body) showLogin(resolve); else document.addEventListener('DOMContentLoaded', function(){ showLogin(resolve); });
  });
  window.RS_LOCAL_AUTH = { ready: ready, logout: logout, openUsers: openUsers };
})();
