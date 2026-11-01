/* =====================================================================
   RESONANCE STORE · 2027 edition
   - Base: company Resonance Store Dashboard (same data, same CSV/XLSX columns,
     same localStorage keys V7, so existing data on each PC keeps working)
   - Merged in: 3D store view, IN -> OUT move with capacity check, shift chip (A/B/C),
     position detail dialog, editor name for Last_Editor, dark mode
   ===================================================================== */

/* ===================== CONFIG ===================== */
const LIMIT = 80;
const WARN_AT = 60;
const NEAR_FULL_RATIO = 0.75; // 75% of LIMIT = "near full" warning threshold used for team alert
/* Fixed physical layout: 4 rack-sides (A-L, A-R, B-L, B-R) x 3 floors x 2 cells (IN/OUT) = 24 positions total.
   This is a constant describing the physical store, not something derived from imported data,
   so "Total Locations" always shows 24 regardless of how many positions currently have data. */
const RACK_SIDES = ['A-L','A-R','B-L','B-R'];
const FLOORS_N = 3, CELLS_N = 2;
const TOTAL_STORE_LOCATIONS = RACK_SIDES.length * FLOORS_N * CELLS_N;
const FLOORS = ['3','2','1'];
const CELLS = ['IN','OUT'];
const STORE_COLS = ['RACK','SIDE','FLOOR','CELL','STORE_LOCATION','ITEM','PRODUCT','TYPE','JOB_NO','QUANITY','Last_Editor','REMARK'];
/* extra column kept with each store row: which test bench (T1-T3) the work came from. Exported after the company columns. */
/* TRAY = tray kind for the 3D view (IM 8 / FOF 32 pieces). The company TYPE column is the test type (WKL, EVL, QUL, FA...). */
const EXTRA_COLS = ['TESTER', 'TRAY'];
const EXPORT_COLS = [...STORE_COLS, ...EXTRA_COLS];
const TESTERS = ['T1','T2','T3'];
const JOB_COLS = ['Job No.','Test Status','Work Week','Job Type','Group Name','Product','Requester Name','Description','Test Qty','Special Remark','Received Date','Completed Date','URL Package'];
const DISPOSE_OPTIONS = [
  { value:'Pending', label:'รอตัดสินใจ (Pending)', cls:'pending' },
  { value:'Return to Owner', label:'คืนเจ้าของงาน (Return to Owner)', cls:'return' },
  { value:'Scrap', label:'ส่งทำ Scrap (Scrap)', cls:'scrap' },
  { value:'Other', label:'อื่นๆ (Other)', cls:'other' }
];
/* Team alert target: the lab's Teams chat link and/or team e-mail addresses. Filled in on the server at deployment;
   kept empty in the repository (internal links and addresses do not belong in source control). */
const HSA_TEAM_EMAILS = [];
/* Lab shift rotation (12-day cycle): Day x4, Off x2, Night x4, Off x2. Day 06:00-18:00, Night 18:00-06:00.
   Anchor 4 Oct 2026: crew C on day #4, crew A on night #2, crew B off. */
const SHIFT_PATTERN = 'DDDDOONNNNOO';
const SHIFT_BASE_DAY = Date.UTC(2026, 9, 4);
const SHIFT_BASE_IDX = { A:7, B:11, C:3 };

const DEFAULT_STORE = [];

/* ===================== STATE ===================== */
const readJSON = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback; } catch { return fallback; } };
let store = (readJSON('resStoreV7', null) || structuredClone(DEFAULT_STORE));
let jobs  = readJSON('jobDetailV7', {});
let disposeData = readJSON('disposeDataV7', {});
let lastNotifiedKey = localStorage.getItem('lastNotifiedKeyV7') || '';
let lastUpdated = localStorage.getItem('lastUpdatedV7') || '';
let dirty = false;
let currentTab = localStorage.getItem('resTabV1') || 'overview';

/* Global dashboard filters: excluded values per field. Empty Set = nothing excluded = show all */
const filterState = { rack:new Set(), side:new Set(), cell:new Set(), status:new Set(), product:new Set(), owner:new Set(), jobStatus:new Set() };
/* Jobs-table-only filters (separate from the global dashboard filters) */
const jobFilterState = { dispose:new Set(), owner:new Set(), jobStatus:new Set(), product:new Set() };

/* ===================== HELPERS ===================== */
const $ = id => document.getElementById(id);
const num = v => Number(String(v ?? 0).replace(/,/g,'')) || 0;
const esc = v => String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
/* "N/A", "-" or "NONE" in JOB_NO means the work has no job (museum / hold samples), so it is not counted as a job */
const normJob = v => { const s = String(v ?? '').trim().toUpperCase().replace(/\s+/g,'').replace(/-/g,'_'); return /^(N\/?A|_|NONE|NULL)$/.test(s) ? '' : s; };
const itemName = r => (r.ITEM && String(r.ITEM).trim()) || [r.PRODUCT, r.TYPE].filter(Boolean).join('_') || '-';
const rackKey = r => `${r.RACK || '-'}-${r.SIDE || '-'}`;
const locKey = r => `${rackKey(r)} L${r.FLOOR || '-'} ${String(r.CELL || '').toUpperCase()}`;
const autoLoc = r => `${r.RACK || '-'}-${r.SIDE || '-'}-L${r.FLOOR || '-'}-${String(r.CELL || '').toUpperCase() || '-'}`;
const getStatus = q => q <= 0 ? 'empty' : q >= LIMIT ? 'over' : q >= WARN_AT ? 'warning' : 'normal';
const statusText = s => ({empty:'EMPTY',normal:'NORMAL',warning:'WARNING',over:'OVER LIMIT'}[s]);
const statusColor = s => ({empty:'var(--empty)',normal:'var(--brand)',warning:'var(--warn)',over:'var(--danger)'}[s]);
const newId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = n => Number(n || 0).toLocaleString('en-US');
const editor = () => ($('editorName').value || '').trim();
/* session undo / redo: whole-store snapshots of each saved change (max 30) */
const undo = { stack:[], redo:[], last:null, applying:false };
function saveLocal(){
  const prev = undo.last;
  if (commitLog() && prev && !undo.applying){
    undo.stack.push({ rows: prev, label: evSummary(lastCommit) });
    if (undo.stack.length > 30) undo.stack.shift();
    undo.redo = [];
  }
  undo.last = structuredClone(store);
  updateUndoUI();
  try {
    localStorage.setItem('resStoreV7', JSON.stringify(store));
    localStorage.setItem('jobDetailV7', JSON.stringify(jobs));
    localStorage.setItem('disposeDataV7', JSON.stringify(disposeData));
  } catch (e){ showToast('บันทึกไม่สำเร็จ', 'พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็มหรือถูกปิดไว้', 'error'); }
}
function jobOf(jobNo){ return jobs[normJob(jobNo)] || null; }
function disposeOf(jobNo){ return disposeData[normJob(jobNo)] || { status:'Pending', detail:'' }; }

/* ===================== HOLD (a held job must not be scrapped, picked out or deleted) =====================
   holdData[jobKey] = { by, reason, at } while the job is on hold. Every hold, release and blocked attempt
   goes to holdLog { t, a:'hold'|'release'|'block', job, ed, by, reason } and shows in the Audit Log. */
let holdData = readJSON('resHoldV1', {});
let holdLog = readJSON('resHoldLogV1', []);
const isHeld = jobNo => { const k = normJob(jobNo); return !!(k && holdData[k]); };
function saveHold(){
  try {
    localStorage.setItem('resHoldV1', JSON.stringify(holdData));
    localStorage.setItem('resHoldLogV1', JSON.stringify(holdLog.slice(-5000)));
  } catch {}
}
function holdEvent(a, job, extra){ holdLog.push({ t: Date.now(), a, job: normJob(job), ed: editor(), ...extra }); saveHold(); }
/* someone tried to scrap / pick / delete a held job: stop it, count it as a prevented mistake */
function holdBlock(job, what){
  const h = holdData[normJob(job)] || {};
  kzBlock('hold', `${normJob(job)} · ${what}`);
  holdEvent('block', job, { reason: what });
  beep();
  showToast(`🔒 ${normJob(job)} ติด HOLD · ${what}ไม่ได้`, `Hold โดย ${h.by || '-'} · ${h.reason || ''} · ต้องปลด Hold ก่อน (ใส่ชื่อผู้อนุมัติ)`, 'error');
}

/* ===================== ZONES (each position belongs to one Product + Type; held jobs live in the HOLD zone) =====================
   zones[key "A|L|2|IN"] = { prod:['DORADO'] | ['*'], type:['EVL'] | ['*'], hold:true, note }. A position with no entry takes anything.
   Trays sit in stacks: stack 1 is the left one seen standing in front of the shelf, filled up to TRAYS_PER_STACK before the next. */
const TRAYS_PER_STACK = 4, STACKS_PER_ZONE = 4, TRAYS_PER_ZONE = TRAYS_PER_STACK * STACKS_PER_ZONE;
const DEFAULT_ZONES = {
  'A|L|1|IN': { prod:['*'], type:['N/A'], note:'Dummy / Ref' }, 'A|L|1|OUT': { prod:['*'], type:['N/A'], note:'Dummy / Ref' },
  'A|L|2|IN': { prod:['*'], type:['WKL'] }, 'A|L|2|OUT': { prod:['*'], type:['EVL'] },
  'A|L|3|IN': { prod:['*'], type:['QUL'] }, 'A|L|3|OUT': { prod:['*'], type:['FA', 'WKL_FA'] },
  'A|R|1|IN': { prod:['*'], type:['WKL'] }, 'A|R|1|OUT': { prod:['MARLIN'], type:['WKL'] },
  'A|R|2|IN': { hold:true }, 'A|R|2|OUT': { prod:['MARLINBP'], type:['WKL'] },
  'A|R|3|IN': { prod:['*'], type:['WKL'] }, 'A|R|3|OUT': { prod:['SUMMIT'], type:['WKL'] },
  'B|L|1|IN': { prod:['DORADO'], type:['EVL'] }, 'B|L|1|OUT': { prod:['DORADO'], type:['WKL'] },
  'B|L|2|IN': { prod:['DORADO'], type:['EVL'] }, 'B|L|2|OUT': { prod:['DORADO'], type:['WKL'] },
  'B|L|3|IN': { prod:['DORADO'], type:['FA', 'WKL_FA'] }, 'B|L|3|OUT': { prod:['DORADO', 'DORADO BP1'], type:['QUL'] },
  'B|R|1|IN': { prod:['DORADO'], type:['QUL'] }, 'B|R|1|OUT': { prod:['DORADO'], type:['N/A'] },
  'B|R|2|IN': { prod:['BLUE WHALE'], type:['EVL'] }, 'B|R|2|OUT': { prod:['DORADO'], type:['QUL'] },
  'B|R|3|IN': { prod:['DORADO'], type:['FA', 'WKL_FA'] }, 'B|R|3|OUT': { prod:['DORADO'], type:['EVL'] },
};
let zones = readJSON('resZoneV1', null) || JSON.parse(JSON.stringify(DEFAULT_ZONES));
function saveZones(){ try { localStorage.setItem('resZoneV1', JSON.stringify(zones)); } catch {} }
const zNorm = s => String(s ?? '').toUpperCase().replace(/[\s_-]+/g, ' ').trim();
const zoneOf = key => zones[key] || null;
const holdZoneKeys = () => Object.keys(zones).filter(k => zones[k] && zones[k].hold);
const isHoldZone = key => !!(zones[key] && zones[key].hold);
function zoneText(key, short){
  const z = zoneOf(key);
  if (!z) return short ? '' : 'ไม่กำหนดโซน';
  if (z.hold) return short ? 'HOLD ZONE' : '🔒 โซน HOLD (งาน Hold เท่านั้น)';
  const p = (z.prod || ['*']).includes('*') ? (short ? 'ทุก Product' : 'ทุก Product') : z.prod.join('/');
  const t = (z.type || ['*']).includes('*') ? 'ทุก Type' : z.type.join('/');
  return `${p} · ${t}${z.note && !short ? ` (${z.note})` : ''}`;
}
/* why a row (product, type, held?) may not go into a position; null = allowed */
function zoneCheck(key, prod, type, held){
  const z = zoneOf(key);
  if (!z) return null;
  if (z.hold) return held ? null : 'โซนนี้เป็นโซน HOLD รับเฉพาะงานที่ติด Hold';
  if (held && holdZoneKeys().length) return `งาน Hold ต้องวางในโซน HOLD (${holdZoneKeys().map(keyTxt).join(', ')})`;
  const types = (z.type || ['*']).map(zNorm), prods = (z.prod || ['*']).map(zNorm);
  if (!types.includes('*') && !types.includes(zNorm(type))) return `โซนนี้รับ Type ${z.type.join('/')} เท่านั้น (งานนี้ ${type || '-'})`;
  if (!prods.includes('*') && !prods.includes(zNorm(prod))) return prod ? `โซนนี้รับ Product ${z.prod.join('/')} เท่านั้น (งานนี้ ${prod})` : `โซนนี้รับ Product ${z.prod.join('/')} · ใส่ Product ของงานก่อน`;
  return null;
}
const rowZoneCheck = r => zoneCheck(`${r.RACK}|${r.SIDE}|${r.FLOOR}|${String(r.CELL).toUpperCase()}`, r.PRODUCT, r.TYPE, isHeld(r.JOB_NO));
/* rows of the store that sit in the wrong zone right now */
const zoneViolations = () => store.map(r => ({ r, why: rowZoneCheck(r) })).filter(x => x.why);
/* trays: IM holds 8, FOF 32, anything else counts as one tray per 8 pieces */
const trayKind = r => { const t = String(r.TRAY || '').toUpperCase(); return t === 'IM' || t === 'FOF' ? t : 'OTHER'; };
const traysOf = (qty, kind) => Math.ceil(num(qty) / ({ IM:8, FOF:32 }[kind] || 8));
const zoneTrays = key => { const [rk, sd, f, c] = key.split('|'); return positionRows(store, rk, sd, f, c).reduce((a, r) => a + traysOf(r.QUANITY, trayKind(r)), 0); };
/* where the next tray goes: stack s (from the left), level l (from the bottom) */
function slotText(key, addTrays){
  const n = zoneTrays(key);
  if (n + (addTrays || 1) > TRAYS_PER_ZONE) return { full: true, text: `โซนนี้วางได้ ${TRAYS_PER_ZONE} ถาด (${STACKS_PER_ZONE} ตั้ง × ${TRAYS_PER_STACK}) มีอยู่ ${n} ถาด` };
  return { full: false, n, text: `วางถาดแรกที่ ตั้ง ${Math.floor(n / TRAYS_PER_STACK) + 1} เป็นถาดที่ ${n % TRAYS_PER_STACK + 1} จากล่าง (ตั้งนับจากซ้ายเมื่อยืนหน้าชั้น · ตั้งละ ≤ ${TRAYS_PER_STACK} ถาด)` };
}
/* best position for a job that has to move (hold <-> normal zone): allowed, room for all of it, dedicated zone first */
function findZoneFor(jobKey){
  const rows = store.filter(r => normJob(r.JOB_NO) === jobKey); if (!rows.length) return null;
  const qty = sumQty(rows), trays = rows.reduce((a, r) => a + traysOf(r.QUANITY, trayKind(r)), 0), r0 = rows[0], held = isHeld(jobKey);
  const cands = posKeys().filter(k => !zoneCheck(k, r0.PRODUCT, r0.TYPE, held) && rows.some(r => `${r.RACK}|${r.SIDE}|${r.FLOOR}|${String(r.CELL).toUpperCase()}` !== k))
    .map(k => { const [rk, sd, f, c] = k.split('|'), cur = sumQty(positionRows(store, rk, sd, f, c)), z = zoneOf(k);
      return { k, cur, ok: cur + qty <= LIMIT && zoneTrays(k) + trays <= TRAYS_PER_ZONE, s: (z && z.prod && !z.prod.includes('*') ? 30 : 0) + (f === '2' ? 8 : 0) - cur / LIMIT * 20 }; })
    .filter(c => c.ok).sort((a, b) => b.s - a.s);
  return cands[0] ? cands[0].k : null;
}
function moveJobTo(jobKey, key, why){
  const [rk, sd, f, c] = key.split('|');
  store.forEach(r => { if (normJob(r.JOB_NO) !== jobKey) return; r.RACK = rk; r.SIDE = sd; r.FLOOR = f; r.CELL = c; r.STORE_LOCATION = autoLoc(r); if (editor()) r.Last_Editor = editor(); });
  logCtx = { src:'zone' };
  saveAll(false);
  showToast(`ย้าย ${jobKey} → ${keyTxt(key)} แล้ว`, `${why} · ${slotText(key, 1).text} · ย้ายถาดจริงให้ตรงด้วย`, 'warn');
  renderAll();
  if (three.ready){ three.flyTo(key); }
}

/* Normalise one store row so imported files with slightly different spellings still land in the right cell */
function normRow(r){
  const o = { _id: r._id || newId() };
  STORE_COLS.forEach(c => { const v = r[c] ?? ''; o[c] = typeof v === 'string' ? v.trim().replace(/\s{2,}/g, ' ') : v; });
  o.TESTER = String(r.TESTER ?? '').trim().toUpperCase().replace(/^TESTER\s*/, '').replace(/^(\d)$/, 'T$1');
  o.TRAY = String(r.TRAY ?? '').trim().toUpperCase();
  /* rows saved before TRAY existed kept IM / FOF in TYPE */
  if (!o.TRAY && /^(IM|FOF)$/i.test(String(o.TYPE))){ o.TRAY = String(o.TYPE).toUpperCase(); o.TYPE = ''; }
  o.RACK = String(o.RACK).trim().toUpperCase().replace(/^RACK[\s_-]*/,'');
  let s = String(o.SIDE).trim().toUpperCase();
  if (s.startsWith('L')) s = 'L'; else if (s.startsWith('R')) s = 'R';
  o.SIDE = s;
  o.FLOOR = String(o.FLOOR).trim().toUpperCase().replace(/^L|^FLOOR\s*/,'');
  o.CELL = String(o.CELL).trim().toUpperCase();
  o.QUANITY = num(o.QUANITY);
  if (!String(o.STORE_LOCATION).trim()) o.STORE_LOCATION = autoLoc(o);
  return o;
}
store = store.map(normRow);

/* ===================== HISTORY LOG (Time Machine · audit · forecast · tester stats) =====================
   Every save is diffed against the last saved snapshot; each changed row becomes one event
   { t, a, id, b (before), f (after), ed (editor), src }. Rows are packed small so 180 days fit in localStorage.
   Any past moment is rebuilt by walking the events backwards from the current snapshot. */
const LOG_DAYS = 180, LOG_MAX_CHARS = 3000000;
/* packed row: [rack, side, floor, cell, qty, type, job, item, tester, product] */
const packRow = r => [r.RACK, r.SIDE, String(r.FLOOR), String(r.CELL).toUpperCase(), num(r.QUANITY), r.TYPE || '', r.JOB_NO || '', r.ITEM || '', r.TESTER || '', r.PRODUCT || '', r.TRAY || ''];
const unpackRow = (id, p) => ({ _id:id, RACK:p[0], SIDE:p[1], FLOOR:p[2], CELL:p[3], QUANITY:p[4], TYPE:p[5], JOB_NO:p[6], ITEM:p[7], TESTER:p[8], PRODUCT:p[9], TRAY:p[10] || '' });
const packPos = p => `${p[0]}|${p[1]}|${p[2]}|${p[3]}`;
const packLoc = p => p ? `${p[0]}-${p[1]} L${p[2]} ${p[3]}` : '';
const snapOf = rows => Object.fromEntries(rows.map(r => [r._id, packRow(r)]));
let histLog = readJSON('resLogV1', []);
let histSnap = readJSON('resLogSnapV1', null);
let histStart = Number(localStorage.getItem('resLogStartV1')) || 0;
let logCtx = null;   /* set just before a save to tag where the change came from (form / move / entry / import / reset) */
const evAction = e => !e.b ? 'add' : !e.f ? 'del'
  : packPos(e.b) === packPos(e.f) ? 'edit'
  : e.b[3] === 'IN' && e.f[3] === 'OUT' && e.b.slice(0, 3).join() === e.f.slice(0, 3).join() ? 'move' : 'relocate';
function commitLog(){
  const next = snapOf(store);
  if (!histSnap){ histSnap = next; histStart = Date.now(); persistLog(); return 0; }
  const t = Date.now(), ctx = logCtx || {}, ed = ctx.ed ?? editor(), src = ctx.src || 'entry';
  logCtx = null;
  /* older snapshots have fewer fields; a missing trailing field equals an empty one */
  const same = (a, b) => { for (let i = 0, n = Math.max(a.length, b.length); i < n; i++) if (String(a[i] ?? '') !== String(b[i] ?? '')) return false; return true; };
  const ev = [];
  for (const id in next){ const b = histSnap[id], f = next[id]; if (!b || !same(b, f)) ev.push({ t, id, b: b || 0, f, ed, src }); }
  for (const id in histSnap) if (!next[id]) ev.push({ t, id, b: histSnap[id], f: 0, ed, src });
  histSnap = next;
  if (!ev.length) return 0;
  ev.forEach(e => { e.a = evAction(e); });
  histLog.push(...ev);
  persistLog();
  lastCommit = ev;
  return ev.length;
}
let lastCommit = [];
/* short text for a group of history events, e.g. "รับเข้า J-2000 24 ชิ้น" */
function evSummary(ev){
  if (!ev || !ev.length) return '';
  if (ev.length > 1) return `${ev.length} รายการ (${[...new Set(ev.map(e => ACTION_TEXT[e.a] || e.a))].join(', ')})`;
  const e = ev[0], p = e.f || e.b;
  return `${ACTION_TEXT[e.a] || e.a} ${p[6] || p[7] || ''} ${p[4]} ชิ้น · ${packLoc(p)}`;
}
function persistLog(){
  const cutoff = Date.now() - LOG_DAYS * 864e5, before = histLog.length;
  if (histLog.length && histLog[0].t < cutoff) histLog = histLog.filter(e => e.t >= cutoff);
  let s = JSON.stringify(histLog);
  while (s.length > LOG_MAX_CHARS && histLog.length > 50){ histLog = histLog.slice(Math.ceil(histLog.length * 0.1)); s = JSON.stringify(histLog); }
  /* older events were dropped: the history can only be rebuilt from the oldest event that is left */
  if (histLog.length < before && histLog.length) histStart = Math.max(histStart, histLog[0].t);
  try {
    localStorage.setItem('resLogV1', s);
    localStorage.setItem('resLogSnapV1', JSON.stringify(histSnap));
    localStorage.setItem('resLogStartV1', String(histStart));
  } catch {}
}
/* rows imported from a file (or written by the original dashboard) have new ids: reuse the old id of an
   identical row, so only real differences become history events */
function adoptIds(rows, snap){
  if (!snap) return;
  const pool = new Map();
  Object.entries(snap).forEach(([id, p]) => { const k = p.join('\u0001'); if (!pool.has(k)) pool.set(k, []); pool.get(k).push(id); });
  const used = new Set(rows.filter(r => snap[r._id]).map(r => r._id));
  rows.forEach(r => {
    if (snap[r._id]) return;
    const list = pool.get(packRow(r).join('\u0001'));
    while (list && list.length){ const id = list.shift(); if (!used.has(id)){ r._id = id; used.add(id); break; } }
  });
}
/* store as it was at time T (ms) */
function rowsAt(T){
  const m = { ...(histSnap || snapOf(store)) };
  for (let i = histLog.length - 1; i >= 0 && histLog[i].t > T; i--){
    const e = histLog[i];
    if (e.f) delete m[e.id];
    if (e.b) m[e.id] = e.b;
  }
  return Object.entries(m).map(([id, p]) => unpackRow(id, p));
}
const tmMin = () => Math.min(Date.now() - 36e5, histStart || Date.now());

/* ===================== DATE HELPERS (for "Days in Store") ===================== */
const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
function parseFlexibleDate(v){
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number'){
    const utcDays = Math.floor(v - 25569);
    const d = new Date(utcDays * 86400 * 1000);
    return isNaN(d) ? null : d;
  }
  const str = String(v).trim();
  if (!str) return null;
  if (/^\d{5}(\.\d+)?$/.test(str)) return parseFlexibleDate(Number(str));
  let m = str.match(/^(\d{1,2})[-\/\s](\w{3,})[-\/\s](\d{2,4})$/);
  if (m){
    const day = parseInt(m[1], 10);
    const mon = MONTHS[m[2].slice(0,3).toLowerCase()];
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (mon !== undefined){
      const d = new Date(year, mon, day);
      return isNaN(d) ? null : d;
    }
  }
  m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m){
    const d = new Date(parseInt(m[1],10), parseInt(m[2],10) - 1, parseInt(m[3],10));
    return isNaN(d) ? null : d;
  }
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m){
    const d = new Date(parseInt(m[3],10), parseInt(m[1],10) - 1, parseInt(m[2],10));
    return isNaN(d) ? null : d;
  }
  const native = new Date(str);
  return isNaN(native) ? null : native;
}
function daysBetween(date){
  if (!date) return null;
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((a - b) / 86400000);
}
function daysBadgeClass(days){
  if (days === null) return '';
  if (days >= 14) return 'days-danger';
  if (days >= 7) return 'days-warn';
  return 'days-ok';
}
const ageClass = d => d === null ? 'none' : d >= 14 ? 'old' : d >= 7 ? 'warn' : 'ok';
const rowAge = r => { const d = jobOf(r.JOB_NO); return daysBetween(parseFlexibleDate(d && d['Received Date'])); };
const fmtDate = d => d ?d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}) : '-';
const fmtStamp = iso => { if (!iso) return '-'; const d = new Date(iso); return isNaN(d) ? '-' : d.toLocaleString('en-GB', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}); };

/* ===================== TOAST NOTIFICATION ===================== */
function showToast(title, message, type){
  type = type || 'success';
  const box = document.createElement('div');
  box.className = `toast ${type}`;
  box.innerHTML = `<b>${esc(title)}</b><span>${esc(message)}</span>`;
  $('toastContainer').appendChild(box);
  setTimeout(() => box.remove(), 3600);
}

/* ===================== CSV PARSER (robust, handles quoted multi-line fields) ===================== */
function parseCSV(text){
  text = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++){
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes){
      if (char === '"'){
        if (next === '"'){ field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += char;
      }
    } else {
      if (char === '"'){ inQuotes = true; }
      else if (char === ','){ row.push(field); field = ''; }
      else if (char === '\r'){ /* skip */ }
      else if (char === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
      else { field += char; }
    }
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows.shift().map(h => String(h).trim());
  return rows
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => {
      const obj = {};
      header.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
      return obj;
    });
}
const csvCell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
function toCSV(cols, rows){ return '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n'); }
function downloadFile(name, text){
  const blob = new Blob([text], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; };

/* ===================== AGGREGATION ===================== */
function positionRows(rows, rack, side, floor, cell){
  return rows.filter(r => r.RACK === rack && r.SIDE === side && String(r.FLOOR) === String(floor) && String(r.CELL).toUpperCase() === cell);
}
const sumQty = rows => rows.reduce((a, r) => a + num(r.QUANITY), 0);
function locationTotals(rows){
  const map = {};
  rows.forEach(r => { const k = locKey(r); map[k] = (map[k] || 0) + num(r.QUANITY); });
  return map;
}
function aggregateByItem(rows){
  const map = {};
  rows.forEach(r => {
    const k = `${locKey(r)}|${itemName(r)}`;
    map[k] ||= { ...r, location: locKey(r), item: itemName(r), qty: 0, jobs: new Set() };
    map[k].qty += num(r.QUANITY);
    if (r.JOB_NO) map[k].jobs.add(normJob(r.JOB_NO));
  });
  return Object.values(map).map(x => ({ ...x, jobCount: x.jobs.size })).sort((a,b) => b.qty - a.qty);
}
function aggregateByLocation(rows){
  const map = {};
  rows.forEach(r => {
    const k = locKey(r);
    map[k] ||= { location:k, rack:r.RACK, side:r.SIDE, floor:String(r.FLOOR), cell:String(r.CELL).toUpperCase(), qty:0, items:new Set(), jobs:new Set(), owners:new Set() };
    map[k].qty += num(r.QUANITY);
    map[k].items.add(itemName(r));
    if (r.JOB_NO){
      map[k].jobs.add(normJob(r.JOB_NO));
      const d = jobOf(r.JOB_NO);
      map[k].owners.add(d && d['Requester Name'] ? d['Requester Name'] : `${r.JOB_NO} (ไม่พบเจ้าของ)`);
    }
  });
  return Object.values(map).map(x => ({ ...x, itemsList:[...x.items].filter(i=>i!=='-').join(', '), jobCount:x.jobs.size, ownersList:[...x.owners].join(', ') || '-' })).sort((a,b)=>b.qty-a.qty);
}
function storeJobs(rows){
  const map = {};
  rows.forEach(r => {
    const j = normJob(r.JOB_NO);
    if (!j) return;
    map[j] ||= { jobNo: r.JOB_NO, key: j, qty: 0, locations: new Set(), items: new Set(), testerSet: new Set() };
    map[j].qty += num(r.QUANITY);
    map[j].locations.add(locKey(r));
    map[j].items.add(itemName(r));
    if (r.TESTER) map[j].testerSet.add(r.TESTER);
  });
  return Object.values(map).map(x => ({ ...x, detail: jobOf(x.jobNo), locationsArr: [...x.locations], locations: [...x.locations].join(', '), items: [...x.items].join(', '), testers: [...x.testerSet].sort().join(', ') })).sort((a,b) => b.qty - a.qty);
}
/* Per rack-side card status, used both for rendering and for the team alert */
function rackCardStatuses(rows){
  return RACK_SIDES.map(key => {
    const [rack, side] = key.split('-');
    let maxQty = 0;
    FLOORS.forEach(f => CELLS.forEach(cell => { maxQty = Math.max(maxQty, sumQty(positionRows(rows, rack, side, f, cell))); }));
    return { key, maxQty, status: getStatus(maxQty), nearFull: maxQty >= LIMIT * NEAR_FULL_RATIO && maxQty < LIMIT };
  });
}

/* ===================== FILTER UI (Tick Box / Checkbox multi-select) ===================== */
const FILTER_DEFS = [
  { id:'rack',      label:'Rack',            get: () => [...new Set(store.map(r => r.RACK).filter(Boolean))].sort() },
  { id:'side',      label:'Side',            get: () => [...new Set(store.map(r => r.SIDE).filter(Boolean))].sort() },
  { id:'cell',      label:'Cell',            get: () => [...new Set(store.map(r => String(r.CELL).toUpperCase()).filter(Boolean))].sort() },
  { id:'status',    label:'Status',          get: () => ['empty','normal','warning','over'] },
  { id:'product',   label:'Product / Item',  get: () => [...new Set(store.map(itemName).filter(x => x && x !== '-'))].sort() },
  { id:'owner',     label:'Owner',           get: () => [...new Set(Object.values(jobs).map(j => j['Requester Name']).filter(Boolean))].sort() },
  { id:'jobStatus', label:'Job Status',      get: () => [...new Set(Object.values(jobs).map(j => j['Test Status']).filter(Boolean))].sort() },
];
const STATUS_LABELS = { empty:'Empty', normal:'Normal', warning:'Warning', over:'Over Limit' };

/* The filter bar DOM is built ONLY on init / after data structure changes (import, add row, delete row, reset).
   Toggling a checkbox only updates the single panel + chip label, so the open dropdown stays open. */
function buildFilterBar(){
  const bar = $('filterBar');
  bar.innerHTML = FILTER_DEFS.map(def => {
    const excluded = filterState[def.id].size;
    return `<div class="filter-chip" data-id="${def.id}">
      <button type="button" class="chip-btn ${excluded ? 'active' : ''}" data-toggle="${def.id}">
        ${def.label}${excluded ? `<span class="chip-count">-${excluded}</span>` : ''}
      </button>
      <div class="chip-panel" id="panel-${def.id}"></div>
    </div>`;
  }).join('');
  FILTER_DEFS.forEach(def => renderFilterPanel(def));
  bar.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.toggle;
      const isOpen = $(`panel-${id}`).classList.contains('open');
      document.querySelectorAll('.chip-panel').forEach(p => p.classList.remove('open'));
      if (!isOpen) $(`panel-${id}`).classList.add('open');
    });
  });
}
function renderFilterPanel(def){
  const values = def.get();
  const excludedSet = filterState[def.id];
  const allChecked = excludedSet.size === 0;
  const panel = $(`panel-${def.id}`);
  const wasOpen = panel.classList.contains('open');
  panel.innerHTML = `
    <label class="all-row"><input type="checkbox" data-all="${def.id}" ${allChecked ? 'checked' : ''}/> All</label>
    ${values.map(v => `<label><input type="checkbox" data-field="${def.id}" value="${esc(v)}" ${excludedSet.has(v) ? '' : 'checked'}/> ${esc(def.id === 'status' ? STATUS_LABELS[v] : v)}</label>`).join('') || '<p class="hint-small">No data</p>'}
  `;
  if (wasOpen) panel.classList.add('open');
  panel.querySelector(`[data-all="${def.id}"]`).addEventListener('change', e => {
    if (e.target.checked) filterState[def.id].clear();
    else values.forEach(v => filterState[def.id].add(v));
    renderFilterPanel(def);
    refreshChipLabel(def.id);
    renderDashboard();
  });
  panel.querySelectorAll(`[data-field="${def.id}"]`).forEach(cb => {
    cb.addEventListener('change', e => {
      const v = e.target.value;
      if (e.target.checked) filterState[def.id].delete(v);
      else filterState[def.id].add(v);
      const allCb = panel.querySelector(`[data-all="${def.id}"]`);
      if (allCb) allCb.checked = filterState[def.id].size === 0;
      refreshChipLabel(def.id);
      renderDashboard();
    });
  });
}
function refreshChipLabel(id){
  const def = FILTER_DEFS.find(d => d.id === id);
  const btn = document.querySelector(`[data-toggle="${id}"]`);
  if (!btn) return;
  const excluded = filterState[id].size;
  btn.classList.toggle('active', excluded > 0);
  btn.innerHTML = `${def.label}${excluded ? `<span class="chip-count">-${excluded}</span>` : ''}`;
}
document.addEventListener('click', e => {
  if (!e.target.closest('.filter-chip')) document.querySelectorAll('.chip-panel').forEach(p => p.classList.remove('open'));
});

function passesFilter(id, value){ return !filterState[id].has(value); }
function filteredData(){
  const q = $('searchBox').value.toLowerCase().trim();
  const totals = locationTotals(store);
  return store.filter(r => {
    const d = jobOf(r.JOB_NO);
    if (!passesFilter('rack', r.RACK || '')) return false;
    if (!passesFilter('side', r.SIDE || '')) return false;
    if (!passesFilter('cell', String(r.CELL || '').toUpperCase())) return false;
    if (!passesFilter('status', getStatus(totals[locKey(r)] || 0))) return false;
    if (!passesFilter('product', itemName(r))) return false;
    const ownerVal = d ? d['Requester Name'] : '';
    if (ownerVal && !passesFilter('owner', ownerVal)) return false;
    const jsVal = d ? d['Test Status'] : '';
    if (jsVal && !passesFilter('jobStatus', jsVal)) return false;
    if (q){
      const combined = [...STORE_COLS.map(c => r[c]), d && d['Requester Name'], d && d['Description'], d && d['Test Status'], locKey(r), itemName(r)].join(' ').toLowerCase();
      if (!combined.includes(q)) return false;
    }
    return true;
  });
}
function renderActiveFilterText(){
  const parts = [];
  FILTER_DEFS.forEach(def => {
    if (filterState[def.id].size > 0) parts.push(`${def.label} excludes ${filterState[def.id].size} value(s)`);
  });
  if ($('searchBox').value.trim()) parts.push(`Search = ${$('searchBox').value.trim()}`);
  $('activeFilterText').textContent = parts.length ? `Active Filter: ${parts.join(' | ')}` : 'Active Filter: All data';
}

/* ===================== JOB TABLE FILTER ===================== */
/* Options are derived from ALL jobs currently in store (unaffected by the global Dashboard Filters)
   so the Jobs table filter panel always shows the full universe of choices. */
function allStoreJobsForOptions(){ return storeJobs(store); }
const jobProduct = x => (x.detail && x.detail['Product']) || x.items;
const JOB_FILTER_DEFS = [
  { id:'owner',     label:'Owner',          get: () => [...new Set(allStoreJobsForOptions().map(x => x.detail?.['Requester Name']).filter(Boolean))].sort() },
  { id:'jobStatus', label:'Job Status',     get: () => [...new Set(allStoreJobsForOptions().map(x => x.detail?.['Test Status']).filter(Boolean))].sort() },
  { id:'product',   label:'Product',        get: () => [...new Set(allStoreJobsForOptions().map(jobProduct).filter(Boolean))].sort() },
  { id:'dispose',   label:'Dispose Status', get: () => DISPOSE_OPTIONS.map(o => o.value) },
];
function jobFilterOptionLabel(defId, v){
  if (defId === 'dispose'){
    const opt = DISPOSE_OPTIONS.find(o => o.value === v);
    return opt ? opt.label : v;
  }
  return v;
}
function buildJobFilterBar(){
  const bar = $('jobFilterBar');
  bar.innerHTML = JOB_FILTER_DEFS.map(def => {
    const excluded = jobFilterState[def.id].size;
    return `<div class="filter-chip" data-id="job-${def.id}">
      <button type="button" class="chip-btn ${excluded ? 'active' : ''}" data-jobtoggle="${def.id}">
        ${def.label}${excluded ? `<span class="chip-count">-${excluded}</span>` : ''}
      </button>
      <div class="chip-panel" id="jobpanel-${def.id}"></div>
    </div>`;
  }).join('');
  JOB_FILTER_DEFS.forEach(def => renderJobFilterPanel(def));
  bar.querySelectorAll('[data-jobtoggle]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.jobtoggle;
      const isOpen = $(`jobpanel-${id}`).classList.contains('open');
      document.querySelectorAll('.chip-panel').forEach(p => p.classList.remove('open'));
      if (!isOpen) $(`jobpanel-${id}`).classList.add('open');
    });
  });
}
function renderJobFilterPanel(def){
  const values = def.get();
  const ex = jobFilterState[def.id];
  const panel = $(`jobpanel-${def.id}`);
  const wasOpen = panel.classList.contains('open');
  panel.innerHTML = `
    <label class="all-row"><input type="checkbox" data-jall="${def.id}" ${ex.size === 0 ? 'checked' : ''}/> All</label>
    ${values.map(v => `<label><input type="checkbox" data-jfield="${def.id}" value="${esc(v)}" ${ex.has(v) ? '' : 'checked'}/> ${esc(jobFilterOptionLabel(def.id, v))}</label>`).join('') || '<p class="hint-small">No data</p>'}
  `;
  if (wasOpen) panel.classList.add('open');
  panel.querySelector(`[data-jall="${def.id}"]`).addEventListener('change', e => {
    if (e.target.checked) ex.clear(); else values.forEach(v => ex.add(v));
    renderJobFilterPanel(def); refreshJobChipLabel(def.id); renderJobsTable();
  });
  panel.querySelectorAll(`[data-jfield="${def.id}"]`).forEach(cb => {
    cb.addEventListener('change', e => {
      if (e.target.checked) ex.delete(e.target.value); else ex.add(e.target.value);
      const allCb = panel.querySelector(`[data-jall="${def.id}"]`);
      if (allCb) allCb.checked = ex.size === 0;
      refreshJobChipLabel(def.id); renderJobsTable();
    });
  });
}
function refreshJobChipLabel(id){
  const def = JOB_FILTER_DEFS.find(d => d.id === id);
  const btn = document.querySelector(`[data-jobtoggle="${id}"]`);
  if (!btn) return;
  const excluded = jobFilterState[id].size;
  btn.classList.toggle('active', excluded > 0);
  btn.innerHTML = `${def.label}${excluded ? `<span class="chip-count">-${excluded}</span>` : ''}`;
}

/* ===================== KPIs ===================== */
function renderKPIs(rows){
  const total = sumQty(rows);
  const rackA = sumQty(rows.filter(r => r.RACK === 'A'));
  const rackB = sumQty(rows.filter(r => r.RACK === 'B'));
  const locs = aggregateByLocation(rows);
  const over = locs.filter(l => l.qty >= LIMIT).length;
  const cap = TOTAL_STORE_LOCATIONS * LIMIT;
  const pct = cap ? Math.round(total / cap * 100) : 0;
  $('kLocation').textContent = TOTAL_STORE_LOCATIONS;
  $('kLocationSub').textContent = `Fixed: ${TOTAL_STORE_LOCATIONS} positions`;
  $('kIn').textContent = fmt(rackA);
  $('kOut').textContent = fmt(rackB);
  $('kTotal').textContent = fmt(total);
  $('kCapacity').textContent = `${pct}% of ${fmt(cap)} capacity`;
  $('kCapBar').style.width = Math.min(100, pct) + '%';
  $('kJobs').textContent = fmt(new Set(rows.map(r => normJob(r.JOB_NO)).filter(Boolean)).size);
  $('kOver').textContent = over;
  $('kOver').closest('.kpi').classList.toggle('zero', over === 0);
}

/* ===================== RACK MAP ===================== */
function cellHTML(rows, rack, side, f, cell){
  const pr = positionRows(rows, rack, side, f, cell);
  const qty = sumQty(pr);
  const st = getStatus(qty);
  const items = {};
  pr.forEach(r => { const n = itemName(r); items[n] = (items[n] || 0) + num(r.QUANITY); });
  const list = Object.entries(items).sort((a, b) => b[1] - a[1]);
  const owners = [...new Set(pr.map(r => { const d = jobOf(r.JOB_NO); return d && d['Requester Name']; }).filter(Boolean))];
  const jobsN = new Set(pr.map(r => normJob(r.JOB_NO)).filter(Boolean)).size;
  const heldN = new Set(pr.filter(r => isHeld(r.JOB_NO)).map(r => normJob(r.JOB_NO))).size;
  const key = `${rack}|${side}|${f}|${cell}`, hz = isHoldZone(key), wrong = pr.filter(r => rowZoneCheck(r)).length;
  return `<div class="cell st-${st}${heldN ? ' has-hold' : ''}${hz ? ' zone-hold' : ''}${wrong ? ' zone-wrong' : ''}" role="button" tabindex="0" data-pos="${key}" aria-label="${rack}-${side} ชั้น ${f} ${cell} ${qty} units · โซน ${esc(zoneText(key))}${heldN ? ` · HOLD ${heldN} job` : ''}${wrong ? ` · ผิดโซน ${wrong} รายการ` : ''}" title="${rack}-${side} · ชั้น ${f} · ${cell} · โซน ${esc(zoneText(key))}">
    <div class="cell-head"><span>${side} · ${cell}</span><span class="badge ${st}">${st === 'over' ? 'OVER' : statusText(st)}</span></div>
    <div class="zone-tag">${hz ? '🔒 โซน HOLD' : esc(zoneText(key, true)) || '&nbsp;'}${wrong ? ` <b>⚠ ผิดโซน ${wrong}</b>` : ''}</div>
    <div class="items-list">${list.slice(0, 2).map(([n, q]) => `<div class="item-line"><span>${esc(n)}</span><b>${q}</b></div>`).join('') || '<div class="item-line muted">ว่าง</div>'}${list.length > 2 ? `<div class="item-line muted">+${list.length - 2} รายการ</div>` : ''}</div>
    <div class="jobhint">${heldN ? `<span class="hold-tag">🔒 HOLD ${heldN}</span> ` : ''}${jobsN ? `${jobsN} job${jobsN > 1 ? 's' : ''}${owners.length ? ' · ' + esc(owners.join(', ')) : ''}` : ''}</div>
    <div class="qty">${qty}<small> / ${LIMIT}</small></div>
    <div class="bar"><span style="width:${Math.min(100, qty / LIMIT * 100)}%;background:${statusColor(st)}"></span></div>
  </div>`;
}
/* Naming, as seen by the operator of T1 standing up and facing the racks:
   rack A on the left (against the wall), rack B on the right; inside each rack L = left half, R = right half;
   OUT = the end nearest T1, IN = the end at the back of the room.
   The 2D map draws exactly that view: A | aisle | B, each floor with L · R across and IN on top, OUT below. */
const PLAN_COLS = ['L', 'R'];
const PLAN_ROWS = ['IN', 'OUT'];  /* back of the room first, the end near T1 below */
const sideTxt = sd => sd === 'L' ? 'ซ้าย' : 'ขวา';
const cellTxt = c => c === 'IN' ? 'หลังห้อง' : 'ใกล้ T1';
function rackCardHTML(rows, rack){
  const sides = PLAN_COLS.filter(sd => RACK_SIDES.includes(`${rack}-${sd}`));
  let total = 0, maxQ = 0;
  const sideTotals = {};
  sides.forEach(sd => { sideTotals[sd] = 0; FLOORS.forEach(f => CELLS.forEach(c => { const q = sumQty(positionRows(rows, rack, sd, f, c)); total += q; sideTotals[sd] += q; maxQ = Math.max(maxQ, q); })); });
  const positions = sides.length * FLOORS.length * CELLS.length;
  const pct = Math.round(total / (positions * LIMIT) * 100);
  const st = getStatus(maxQ);
  return `<article class="rack-card">
    <div class="card-head">
      <div class="rack-id">
        <div class="ring" style="--p:${Math.min(100, pct)};--c:${statusColor(st)}" data-label="${pct}%"></div>
        <div><div class="rack-name">RACK ${rack} <small>${rack === 'A' ? 'ซ้ายมือ' : 'ขวามือ'}</small></div><div class="rack-sub">${fmt(total)} units · ${positions} positions · ยืนที่ T1 หันหน้าเข้าชั้นวาง</div></div>
      </div>
      <div class="side-chips">${sides.map(sd => `<span class="side-chip">${rack}-${sd} <b>${fmt(sideTotals[sd])}</b></span>`).join('')}<span class="badge ${st}">${statusText(st)}</span></div>
    </div>
    <div class="card-body"><div class="floors">
      ${FLOORS.map(f => `<section class="floor-block">
        <div class="floor-title">ชั้น ${f}<small>${f === FLOORS[0] ? 'บนสุด' : f === FLOORS[FLOORS.length - 1] ? 'ล่างสุด' : 'กลาง'}</small></div>
        <div class="plan">
          <span></span>${sides.map(sd => `<span class="plan-col">${rack}-${sd} · ${sideTxt(sd)}</span>`).join('')}
          ${PLAN_ROWS.map(c => `<span class="plan-row" title="${c} = ${cellTxt(c)}">${c}<small>${cellTxt(c)}</small></span>${sides.map(sd => cellHTML(rows, rack, sd, f, c)).join('')}`).join('')}
        </div>
      </section>`).join('')}
    </div></div>
  </article>`;
}
function renderRackMap(rows){
  const racks = [...new Set(RACK_SIDES.map(k => k.split('-')[0]))];
  const back = `<div class="lab-strip wall"><span>↑ หลังห้อง (IN)</span></div>`;
  const front = `<div class="lab-strip wall"><span>↓ ฝั่ง OUT ใกล้ T1 · T1 ยืนตรงนี้ หันหน้าเข้าชั้นวาง (T2 · T3 อยู่ถัดไปทางซ้าย)</span></div>`;
  const aisle = `<div class="lab-strip aisle aisle-v"><span>ทางเดิน</span></div>`;
  $('rackMap').innerHTML = back + `<div class="rack-pair">${racks.map(rk => rackCardHTML(rows, rk)).join(aisle)}</div>` + front;
}

/* ===================== SIDE PANELS ===================== */
function renderTopItems(rows){
  const locs = aggregateByLocation(rows).filter(l => l.qty > 0).slice(0, 5);
  $('topItems').innerHTML = locs.length ? locs.map((l, i) => {
    const st = getStatus(l.qty);
    return `<div class="top-row">
      <div class="top-rank">${i + 1}</div>
      <div style="min-width:0"><div class="top-name">${esc(l.location)}</div><div class="top-sub">${esc(l.itemsList || '-')}</div>
        <div class="mini"><span style="width:${Math.min(100, l.qty / LIMIT * 100)}%;background:${statusColor(st)}"></span></div></div>
      <div class="top-qty">${l.qty}<small>${Math.round(l.qty / LIMIT * 100)}%</small></div>
    </div>`;
  }).join('') : '<p class="hint-small">ยังไม่มีข้อมูล · Import Store CSV/XLSX เพื่อเริ่มต้น</p>';
}
function renderAlerts(rows){
  const locs = aggregateByLocation(rows).filter(l => l.qty >= WARN_AT);
  if (!locs.length){ $('alerts').innerHTML = '<div class="ok-state"><i>✓</i>ไม่มีตำแหน่งที่ใกล้เต็มหรือเกินกำหนด</div>'; return; }
  $('alerts').innerHTML = `<table class="alert-table"><thead><tr><th>Location</th><th>Qty</th><th>Status</th></tr></thead><tbody>
    ${locs.map(l => { const st = getStatus(l.qty); return `<tr><td><b>${esc(l.location)}</b><div class="top-sub">${esc(l.ownersList)}</div></td><td class="n"><b>${l.qty}</b>/${LIMIT}</td><td><span class="badge ${st}">${statusText(st)}</span></td></tr>`; }).join('')}
  </tbody></table>`;
}
/* held jobs, the ones still in the store first; a held job that left the store is still listed until released */
function heldJobs(){
  const inStore = Object.fromEntries(storeJobs(store).map(j => [j.key, j]));
  return Object.entries(holdData).map(([k, h]) => ({ key:k, ...h, sj: inStore[k] || null }))
    .sort((a, b) => !!b.sj - !!a.sj || String(a.at).localeCompare(String(b.at)));
}
function renderHoldList(){
  const list = heldJobs();
  /* jobs sitting in the wrong zone: a held job outside the HOLD zone, a released one still inside it, wrong Product / Type */
  const wrongJobs = {};
  zoneViolations().forEach(({ r, why }) => { const k = normJob(r.JOB_NO) || r._id; wrongJobs[k] ||= { k, loc: keyTxt(`${r.RACK}|${r.SIDE}|${r.FLOOR}|${String(r.CELL).toUpperCase()}`), why }; });
  const wrong = Object.values(wrongJobs);
  const holdHTML = list.length ? list.map(h => `<div class="hold-row">
      <div style="min-width:0"><b>🔒 ${esc(h.key)}</b><div class="top-sub">${esc(h.reason)} · โดย ${esc(h.by)}</div>
        <div class="top-sub">${h.sj ? `อยู่ที่ ${esc(h.sj.locations)} · ${h.sj.qty} ชิ้น` : '<span class="missing">ไม่อยู่ใน Store แล้ว</span>'}</div></div>
      <div class="hold-acts">${h.sj ? `<button type="button" class="pk-fly" data-holdfly="${esc(h.key)}">หา</button>` : ''}<button type="button" class="mini-btn" data-hold="${esc(h.key)}">ปลด</button></div>
    </div>`).join('') : '<div class="ok-state"><i>✓</i>ไม่มีงาน Hold · ติด Hold ได้ที่แท็บ Jobs หรือคลิกช่องในผัง</div>';
  const wrongHTML = wrong.length ? `<div class="sum-title zone-wrong-title">⚠ งานผิดโซน ${wrong.length} Job · ย้ายถาดจริงแล้วกด "ย้าย"</div>` + wrong.map(w => `<div class="hold-row wrong">
      <div style="min-width:0"><b>${esc(w.k)}</b><div class="top-sub">อยู่ที่ ${esc(w.loc)}</div><div class="top-sub">${esc(w.why)}</div></div>
      <div class="hold-acts"><button type="button" class="pk-fly" data-holdfly="${esc(w.k)}">หา</button><button type="button" class="mini-btn" data-zmove="${esc(w.k)}">ย้าย</button></div>
    </div>`).join('') : '';
  $('holdList').innerHTML = holdHTML + wrongHTML;
}
const PALETTE = ['#6EBE49','#3B82C4','#E3A008','#8B5CF6','#14B8A6','#EC4899','#F97316','#64748B'];
const DISPOSE_COLORS = { 'Pending':'var(--warn)', 'Return to Owner':'var(--brand)', 'Scrap':'var(--danger)', 'Other':'var(--info)' };
function stackHTML(entries, colorOf){
  const total = entries.reduce((a, e) => a + e[1], 0) || 1;
  return `<div class="stack-bar">${entries.map(([k, v], i) => `<span style="width:${v / total * 100}%;background:${colorOf(k, i)}" title="${esc(k)}: ${v}"></span>`).join('')}</div>
  <div class="sum-rows">${entries.map(([k, v], i) => `<span><i class="dot" style="background:${colorOf(k, i)}"></i>${esc(k)}</span><b>${v}</b>`).join('')}</div>`;
}
function renderJobSummary(rows){
  const list = storeJobs(rows);
  if (!list.length){ $('jobSummary').innerHTML = '<p class="hint-small">ยังไม่มี Job ใน Store</p>'; return; }
  const ts = {}, dp = {};
  let missing = 0;
  list.forEach(j => {
    const s = (j.detail && j.detail['Test Status']) || 'ไม่พบใน Job Detail';
    if (!j.detail) missing++;
    ts[s] = (ts[s] || 0) + 1;
    const d = disposeOf(j.jobNo).status;
    dp[d] = (dp[d] || 0) + 1;
  });
  const tsE = Object.entries(ts).sort((a, b) => b[1] - a[1]);
  const dpE = DISPOSE_OPTIONS.map(o => [o.value, dp[o.value] || 0]).filter(e => e[1]);
  $('jobSummary').innerHTML = `
    <div class="sum-group"><div class="sum-title">Test Status · ${list.length} jobs</div>${stackHTML(tsE, (k, i) => k === 'ไม่พบใน Job Detail' ? 'var(--empty)' : PALETTE[i % PALETTE.length])}</div>
    <div class="sum-group"><div class="sum-title">Dispose Decision</div>${stackHTML(dpE, k => DISPOSE_COLORS[k] || 'var(--muted)')}</div>
    ${missing ? `<p class="hint-small">${missing} job ยังไม่มีข้อมูลใน Job Detail · Import Job Detail เพื่อเติมข้อมูล</p>` : ''}`;
}

/* ===================== TEAM ALERT ===================== */
function teamAlertInfo(){
  const flagged = rackCardStatuses(store).filter(s => s.status === 'over' || s.nearFull);
  if (!flagged.length) return null;
  const parts = flagged.map(s => `Rack ${s.key} ${s.status === 'over' ? 'เต็มเกินกำหนด' : 'ใกล้เต็ม'} (สูงสุด ${s.maxQty}/${LIMIT} ต่อตำแหน่ง)`);
  return { key: flagged.map(s => `${s.key}:${s.status}:${s.nearFull}`).join('|'), message: `แจ้งเตือน Resonance Store: ${parts.join(' · ')}` };
}
function renderTeamAlert(){
  const info = teamAlertInfo();
  $('teamAlertBanner').hidden = !info;
  if (!info) return;
  $('teamAlertMessage').textContent = info.message;
  $('notifyTeamBtn').textContent = lastNotifiedKey === info.key ? 'แจ้งทีมแล้ว · แจ้งอีกครั้ง' : 'แจ้งเตือนทีม HSA Resonance';
}
async function copyText(text){
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); return ok;
  }
}
async function notifyTeam(){
  const info = teamAlertInfo(); if (!info) return;
  const copied = await copyText(info.message);
  const links = HSA_TEAM_EMAILS.filter(x => /^https?:/i.test(x));
  const emails = HSA_TEAM_EMAILS.filter(x => x.includes('@') && !/^https?:/i.test(x));
  if (links.length) window.open(links[0], '_blank', 'noopener');
  else if (emails.length) location.href = `mailto:${emails.join(';')}?subject=${encodeURIComponent('Resonance Store Alert')}&body=${encodeURIComponent(info.message)}`;
  lastNotifiedKey = info.key;
  localStorage.setItem('lastNotifiedKeyV7', lastNotifiedKey);
  renderTeamAlert();
  showToast('เปิดแชททีมแล้ว', copied ? 'คัดลอกข้อความแจ้งเตือนไว้แล้ว วาง (Ctrl+V) ในแชทได้เลย' : 'คัดลอกข้อความไม่ได้ กด "คัดลอกข้อความ" อีกครั้ง', copied ? 'success' : 'warn');
}

/* ===================== JOBS TABLE ===================== */
function jobsForTable(){
  const q = $('jobSearchBox').value.toLowerCase().trim();
  return storeJobs(store).filter(x => {
    const d = x.detail || {};
    if (d['Requester Name'] && jobFilterState.owner.has(d['Requester Name'])) return false;
    if (d['Test Status'] && jobFilterState.jobStatus.has(d['Test Status'])) return false;
    if (jobProduct(x) && jobFilterState.product.has(jobProduct(x))) return false;
    if (jobFilterState.dispose.has(disposeOf(x.jobNo).status)) return false;
    if (q){
      const all = [x.jobNo, x.items, x.locations, ...JOB_COLS.map(c => d[c]), disposeOf(x.jobNo).detail].join(' ').toLowerCase();
      if (!all.includes(q)) return false;
    }
    return true;
  }).map(x => {
    const recv = parseFlexibleDate(x.detail && x.detail['Received Date']);
    return { ...x, recv, days: daysBetween(recv) };
  }).sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || b.qty - a.qty);
}
function renderJobsTable(){
  const list = jobsForTable();
  const head = `<thead><tr><th>Job No.</th><th>Hold</th><th>Owner</th><th>Product</th><th>Description</th><th>Test Status</th><th>Qty</th><th>Locations</th><th>From Tester</th><th>Received</th><th>Days in Store</th><th>Dispose Decision</th><th>Dispose Detail</th></tr></thead>`;
  if (!list.length){ $('currentJobTable').innerHTML = head + `<tbody><tr><td colspan="13" class="empty-table">ไม่มี Job ที่ตรงกับตัวกรอง</td></tr></tbody>`; return; }
  $('currentJobTable').innerHTML = head + '<tbody>' + list.map(x => {
    const d = x.detail;
    const dp = disposeOf(x.jobNo);
    const opt = DISPOSE_OPTIONS.find(o => o.value === dp.status) || DISPOSE_OPTIONS[0];
    const h = holdData[x.key];
    return `<tr class="${h ? 'held' : ''}">
      <td><b>${esc(x.jobNo)}</b></td>
      <td><button type="button" class="hold-btn ${h ? 'on' : ''}" data-hold="${esc(x.key)}" title="${h ? esc(`Hold โดย ${h.by} · ${h.reason} · กดเพื่อปลด`) : 'ติด Hold: ห้าม Scrap / ห้ามหยิบออก'}">${h ? '🔒 HOLD' : 'ติด Hold'}</button></td>
      <td>${d ? esc(d['Requester Name'] || '-') : '<span class="missing">ไม่พบใน Job Detail</span>'}</td>
      <td>${esc(jobProduct(x) || '-')}</td>
      <td><div class="jobdesc" title="${esc(d && d['Description'])}">${esc((d && d['Description']) || '-')}</div></td>
      <td>${d && d['Test Status'] ? `<span class="status-pill">${esc(d['Test Status'])}</span>` : '-'}</td>
      <td class="n"><b>${x.qty}</b></td>
      <td><div class="loc-tags">${x.locationsArr.map(l => `<span class="loc-tag">${esc(l)}</span>`).join('')}</div></td>
      <td>${x.testers ? `<span class="status-pill">${esc(x.testers)}</span>` : '-'}</td>
      <td>${fmtDate(x.recv)}</td>
      <td>${x.days === null ? '-' : `<span class="days-badge ${daysBadgeClass(x.days)}">${x.days} วัน</span>`}</td>
      <td class="dispose-cell"><select class="dispose-select ${opt.cls}" data-dispose="${esc(x.key)}">${DISPOSE_OPTIONS.map(o => `<option value="${esc(o.value)}" ${o.value === opt.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></td>
      <td><input class="dispose-detail" data-dispose-detail="${esc(x.key)}" value="${esc(dp.detail || '')}" placeholder="รายละเอียด"></td>
    </tr>`;
  }).join('') + '</tbody>';
}
function setDispose(k, status){
  disposeData[k] = { ...(disposeData[k] || { detail:'' }), status };
  saveLocal(); renderJobSummary(filteredData()); renderJobsTable();
  showToast('บันทึก Dispose แล้ว', `${k} → ${status}`);
}
function exportJobs(){
  const cols = ['Job No.','Hold','Hold By','Hold Reason','Requester Name','Group Name','Product','Description','Test Status','Qty in Store','Locations','From Tester','Received Date','Days in Store','Dispose Decision','Dispose Detail'];
  const rows = jobsForTable().map(x => {
    const d = x.detail || {}, dp = disposeOf(x.jobNo), h = holdData[x.key];
    return { 'Job No.':x.jobNo, 'Hold':h ? 'HOLD' : '', 'Hold By':h ? h.by : '', 'Hold Reason':h ? h.reason : '', 'Requester Name':d['Requester Name'] || '', 'Group Name':d['Group Name'] || '', 'Product':jobProduct(x) || '', 'Description':d['Description'] || '', 'Test Status':d['Test Status'] || '', 'Qty in Store':x.qty, 'Locations':x.locations, 'From Tester':x.testers || '', 'Received Date':x.recv ? fmtDate(x.recv) : '', 'Days in Store':x.days ?? '', 'Dispose Decision':dp.status, 'Dispose Detail':dp.detail || '' };
  });
  downloadFile(`resonance_jobs_${stamp()}.csv`, toCSV(cols, rows));
  showToast('Export สำเร็จ', `${rows.length} jobs`);
}

/* ===================== DATA ENTRY TABLE ===================== */
const SELECTS = { RACK:['A','B'], SIDE:['L','R'], FLOOR:['1','2','3'], CELL:['IN','OUT'], TESTER:['', ...TESTERS], TRAY:['', 'IM', 'FOF'] };
function entryCell(r, c){
  if (SELECTS[c]){
    const opts = SELECTS[c].includes(String(r[c])) ? SELECTS[c] : [String(r[c]), ...SELECTS[c]];
    return `<td><select data-col="${c}">${opts.map(v => `<option ${String(r[c]) === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>`;
  }
  if (c === 'QUANITY') return `<td><input data-col="${c}" type="number" min="0" step="1" value="${esc(r[c])}" style="width:84px"></td>`;
  if (c === 'STORE_LOCATION') return `<td><input data-col="${c}" value="${esc(r[c])}" readonly tabindex="-1" title="คำนวณอัตโนมัติจาก Rack/Side/Floor/Cell"></td>`;
  if (c === 'Last_Editor') return `<td><input data-col="${c}" value="${esc(r[c])}" readonly tabindex="-1"></td>`;
  return `<td><input data-col="${c}" value="${esc(r[c])}"></td>`;
}
function renderEntryTable(){
  const head = `<thead><tr>${EXPORT_COLS.map(c => `<th>${c}</th>`).join('')}<th></th></tr></thead>`;
  if (!store.length){ $('entryTable').innerHTML = head + `<tbody><tr><td colspan="${EXPORT_COLS.length + 1}" class="empty-table">ยังไม่มีข้อมูล · Import Store CSV/XLSX หรือกด "+ เพิ่ม Store Row"</td></tr></tbody>`; return; }
  $('entryTable').innerHTML = head + '<tbody>' + store.map(r => `<tr data-id="${r._id}">${EXPORT_COLS.map(c => entryCell(r, c)).join('')}
    <td><div class="row-actions">${String(r.CELL).toUpperCase() === 'IN' ? `<button type="button" class="mini-btn move" data-move="${r._id}">ย้าย → OUT</button>` : ''}<button type="button" class="mini-btn del" data-del="${r._id}" aria-label="ลบแถว">ลบ</button></div></td></tr>`).join('') + '</tbody>';
}
function setDirty(v){
  dirty = v;
  $('dirtyDot').hidden = !v;
  $('saveBtn').hidden = !v;   /* only shown while Data Entry has unsaved edits */
  $('entryTip').textContent = v ? 'มีการแก้ไขที่ยังไม่ได้บันทึก · กด "บันทึกการแก้ไข" ด้านบน (Ctrl+S)' : 'แก้ไขข้อมูล Store แล้วกด บันทึกการแก้ไข';
}
function touch(){
  lastUpdated = new Date().toISOString();
  localStorage.setItem('lastUpdatedV7', lastUpdated);
  $('lastUpdated').textContent = fmtStamp(lastUpdated);
}
function saveAll(msg){
  saveLocal(); touch(); setDirty(false);
  if (msg !== false) showToast('บันทึกแล้ว', msg || `${store.length} rows · ${fmtStamp(lastUpdated)}`);
}
function addRow(pos){
  const [rack, side, floor, cell] = pos || ['A','L','1','IN'];
  const r = normRow({ RACK:rack, SIDE:side, FLOOR:floor, CELL:cell, QUANITY:0, Last_Editor:editor() });
  store.push(r);
  setDirty(true);
  buildFilterBar();
  if (currentTab !== 'entry') setTab('entry');
  renderAll();
  const tr = document.querySelector(`#entryTable tr[data-id="${r._id}"]`);
  if (tr){ tr.scrollIntoView({block:'center'}); const inp = tr.querySelector('[data-col="ITEM"]'); if (inp) inp.focus(); }
  if (!editor()) showToast('ใส่ชื่อผู้บันทึก', 'กรอกช่อง "ผู้บันทึก" ด้านบน เพื่อให้ระบบบันทึก Last_Editor ให้อัตโนมัติ', 'info');
}
/* Move one store row from IN to the OUT cell of the same rack/side/floor, blocked if OUT would exceed LIMIT */
function moveToOut(id){
  const r = store.find(x => x._id === id);
  if (!r || String(r.CELL).toUpperCase() !== 'IN') return false;
  const zWhy = zoneCheck(`${r.RACK}|${r.SIDE}|${r.FLOOR}|OUT`, r.PRODUCT, r.TYPE, isHeld(r.JOB_NO));
  if (zWhy){ kzBlock('zone', `${r.RACK}|${r.SIDE}|${r.FLOOR}|OUT|${r.JOB_NO}`); showToast('ย้ายไม่ได้ · ผิดโซน', `${r.RACK}-${r.SIDE} ชั้น ${r.FLOOR} OUT: ${zWhy}`, 'error'); return false; }
  const target = sumQty(positionRows(store, r.RACK, r.SIDE, r.FLOOR, 'OUT'));
  const q = num(r.QUANITY);
  if (target + q > LIMIT){
    kzBlock('over', `${r.RACK}-${r.SIDE}-${r.FLOOR}-OUT`);
    showToast('ย้ายไม่ได้ · เกินกำหนด', `ช่อง ${r.RACK}-${r.SIDE} L${r.FLOOR} OUT มี ${target} units แล้ว ถ้าย้ายอีก ${q} จะเป็น ${target + q}/${LIMIT}`, 'error');
    return false;
  }
  r.CELL = 'OUT';
  r.STORE_LOCATION = autoLoc(r);
  if (editor()) r.Last_Editor = editor();
  logCtx = { src:'move' };
  saveAll(false);
  showToast('ย้ายไป OUT แล้ว', `${itemName(r)} · ${r.JOB_NO || '-'} · ${q} units → ${r.RACK}-${r.SIDE} L${r.FLOOR} OUT (${target + q}/${LIMIT})`);
  renderAll();
  return true;
}
function deleteRow(id){
  const r = store.find(x => x._id === id); if (!r) return;
  if (isHeld(r.JOB_NO)){ holdBlock(r.JOB_NO, 'ลบ'); return; }
  if (!confirm(`ลบแถว ${itemName(r)} · Job ${r.JOB_NO || '-'} · ${num(r.QUANITY)} units ?\n(ต้องกด Save Changes เพื่อบันทึก)`)) return;
  store = store.filter(x => x._id !== id);
  setDirty(true); buildFilterBar(); renderAll();
}

/* ===================== IMPORT / EXPORT ===================== */
const hkey = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/* Read a CSV or Excel file into row objects. `want` lists the header groups the data table must have
   (each group = accepted spellings, already hkey-normalised). Workbooks like the team's store file keep a
   layout sheet and a pivot first, so every sheet is scanned and the first one whose header row matches is used;
   the header may also sit a few rows down. Resolves { rows, sheet }. */
function readSheetFile(file, want){
  const findTable = grid => {
    for (let i = 0; i < Math.min(20, grid.length); i++){
      const keys = (grid[i] || []).map(hkey);
      if (want.every(alts => alts.some(a => keys.includes(a)))){
        const hdr = grid[i].map(h => String(h ?? '').trim());
        return grid.slice(i + 1).map(r => { const o = {}; hdr.forEach((h, j) => { if (h) o[h] = r[j] ?? ''; }); return o; });
      }
    }
    return null;
  };
  return new Promise((resolve, reject) => {
    const isCSV = /\.csv$/i.test(file.name);
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
    fr.onload = () => {
      try {
        if (isCSV) return resolve({ rows: parseCSV(fr.result), sheet: '' });
        if (!window.XLSX) return reject(new Error('โหลดตัวอ่าน Excel ไม่ได้ · ใช้ไฟล์ CSV แทน'));
        const wb = XLSX.read(new Uint8Array(fr.result), { type:'array', cellDates:false });
        for (const name of wb.SheetNames){
          const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, defval:'', raw:true, blankrows:false });
          const rows = findTable(grid);
          if (rows) return resolve({ rows, sheet: name });
        }
        resolve({ rows: [], sheet: '' });
      } catch (e){ reject(e); }
    };
    if (isCSV) fr.readAsText(file, 'utf-8'); else fr.readAsArrayBuffer(file);
  });
}
const STORE_HEADERS = [['rack'], ['side'], ['floor'], ['cell'], ['quanity', 'quantity', 'qty']];
const JOB_HEADERS = [['jobno', 'job']];
/* placeholder rows in the team file carry only the location; real rows have a quantity or something to identify the work */
const hasWork = r => num(r.QUANITY) > 0 || ['PRODUCT', 'ITEM', 'JOB_NO', 'TYPE'].some(c => String(r[c] ?? '').trim() !== '');
function mapColumns(rows, cols, aliases){
  if (!rows.length) return [];
  const lookup = {};
  cols.forEach(c => { lookup[hkey(c)] = c; });
  Object.entries(aliases || {}).forEach(([a, c]) => { lookup[hkey(a)] = c; });
  const map = {};
  Object.keys(rows[0]).forEach(h => { if (lookup[hkey(h)]) map[h] = lookup[hkey(h)]; });
  return rows.map(r => { const o = {}; Object.entries(map).forEach(([h, c]) => { o[c] = r[h]; }); return o; });
}
async function importStore(file){
  try {
    const { rows: raw, sheet } = await readSheetFile(file, STORE_HEADERS);
    const mapped = mapColumns(raw, EXPORT_COLS, { FROMTESTER:'TESTER', BENCH:'TESTER', TRAYTYPE:'TRAY', QUANTITY:'QUANITY', QTY:'QUANITY', LOCATION:'STORE_LOCATION', JOBNO:'JOB_NO', JOB:'JOB_NO', EDITOR:'Last_Editor', LASTEDITOR:'Last_Editor' });
    const rows = mapped.filter(hasWork).map(normRow);
    const skipped = mapped.length - rows.length;
    if (!rows.length){ showToast('ไม่พบข้อมูล', 'ไม่พบชีตที่มีหัวคอลัมน์ RACK, SIDE, FLOOR, CELL, QUANITY ในไฟล์นี้', 'error'); return; }
    const bad = rows.filter(r => !RACK_SIDES.includes(`${r.RACK}-${r.SIDE}`) || !FLOORS.includes(String(r.FLOOR)) || !CELLS.includes(r.CELL)).length;
    if (dirty && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก การ Import จะเขียนทับข้อมูล Store ทั้งหมด ต้องการทำต่อไหม?')) return;
    adoptIds(rows, histSnap);
    store = rows;
    logCtx = { src:'import' };
    saveAll(false); buildFilterBar(); buildJobFilterBar(); renderAll();
    /* the 3D store redraws from the same data; bring the camera back to the full view so the new trays are visible */
    if (three.ready){ tmLive(); clearFly(); three.go('home'); }
    showToast('Import Store สำเร็จ · อัปเดต 3D แล้ว', `${rows.length} รายการ · ${fmt(sumQty(rows))} ชิ้น${sheet ? ` · จากชีต "${sheet}"` : ''}${skipped ? ` · ข้ามแถวว่าง ${skipped}` : ''}${bad ? ` · ${bad} แถวตำแหน่งไม่ตรงผัง` : ''}`, bad ? 'warn' : 'success');
  } catch (e){ showToast('Import ไม่สำเร็จ', e.message || String(e), 'error'); }
}
async function importJobs(file){
  try {
    const { rows: raw } = await readSheetFile(file, JOB_HEADERS);
    const rows = mapColumns(raw, JOB_COLS, { JOBNO:'Job No.', JOB:'Job No.', OWNER:'Requester Name', REQUESTER:'Requester Name', STATUS:'Test Status' });
    const next = {};
    rows.forEach(r => {
      const k = normJob(r['Job No.']); if (!k) return;
      Object.keys(r).forEach(c => { if (typeof r[c] === 'string') r[c] = r[c].trim(); if (r[c] === '') delete r[c]; });   /* keep it small: 5,000+ jobs must fit in browser storage */
      next[k] = r;
    });
    const n = Object.keys(next).length;
    if (!n){ showToast('ไม่พบข้อมูล', 'ตรวจสอบว่าไฟล์มีคอลัมน์ "Job No."', 'error'); return; }
    const before = jobs;
    jobs = next;
    try { localStorage.setItem('jobDetailV7', JSON.stringify(jobs)); }
    catch { jobs = before; showToast('Import ไม่สำเร็จ · ไฟล์ใหญ่เกินพื้นที่เบราว์เซอร์', `${fmt(n)} jobs · ลองตัดเหลือเฉพาะ Job ปีนี้แล้ว Import ใหม่`, 'error'); return; }
    saveLocal(); touch(); buildFilterBar(); buildJobFilterBar(); renderAll();
    const sj = storeJobs(store), matched = sj.filter(j => j.detail).length;
    showToast('Import Job Detail สำเร็จ · เชื่อมกับ Store แล้ว', `${fmt(n)} jobs · ตรงกับงานใน Store ${matched}/${sj.length} jobs · 3D แสดงอายุงานและเจ้าของได้แล้ว`);
  } catch (e){ showToast('Import ไม่สำเร็จ', e.message || String(e), 'error'); }
}
function exportStore(){
  downloadFile(`resonance_store_${stamp()}.csv`, toCSV(EXPORT_COLS, store));
  showToast('Export สำเร็จ', `${store.length} rows${dirty ? ' (รวมรายการที่ยังไม่ได้ Save)' : ''}`);
}
function resetData(){
  if (!confirm('ลบข้อมูล Store, Job Detail และ Dispose ทั้งหมดในเครื่องนี้?\nควร Export CSV เก็บไว้ก่อน')) return;
  store = []; jobs = {}; disposeData = {};
  Object.keys(filterState).forEach(k => filterState[k].clear());
  Object.keys(jobFilterState).forEach(k => jobFilterState[k].clear());
  logCtx = { src:'reset' };
  saveAll(false); buildFilterBar(); buildJobFilterBar(); renderAll();
  showToast('Reset แล้ว', 'ข้อมูลในเครื่องนี้ถูกล้างแล้ว', 'info');
}

/* ===================== ADD WORK (receive into store) ===================== */
const TRAY_CAP = { IM:8, FOF:32 };
const fPos = () => [$('fRack').value, $('fSide').value, $('fFloor').value, $('fCell').value];
function initAddForm(){
  const opt = (id, list) => { $(id).innerHTML = list.map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); };
  const racks = [...new Set(RACK_SIDES.map(k => k.split('-')[0]))];
  opt('fRack', racks.map(r => [r, r]));
  opt('fSide', [...new Set(RACK_SIDES.map(k => k.split('-')[1]))].map(s => [s, `${s} · ${sideTxt(s)}`]));
  opt('fFloor', FLOORS.map(f => [f, f]));
  opt('fCell', CELLS.map(c => [c, `${c} · ${cellTxt(c)}`]));
  opt('fTester', [...TESTERS.map(t => [t, `${t} · HDD Tester`]), ['', 'ไม่ระบุ']]);
  try { const lt = localStorage.getItem('resLastTesterV1'); if (lt !== null) $('fTester').value = lt; } catch {}
  $('fCell').value = 'IN';
  try { $('fType').value = localStorage.getItem('resLastTypeV1') ?? 'IM'; } catch {}
  $('fRecv').value = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  ['fRack', 'fSide', 'fFloor', 'fCell', 'fQty', 'fType'].forEach(id => $(id).addEventListener('input', updateAddForm));
  $('fJob').addEventListener('input', jobHint);
  $('fFindBtn').addEventListener('click', findSpace);
  $('addForm').addEventListener('submit', submitAdd);
  $('addForm').addEventListener('input', kzAddStart);
  try { $('fPoka').checked = localStorage.getItem('resPokaV1') === '1'; } catch {}
  $('fPoka').addEventListener('change', () => { try { localStorage.setItem('resPokaV1', $('fPoka').checked ? '1' : '0'); } catch {} showToast($('fPoka').checked ? 'เปิด Poka-yoke แล้ว' : 'ปิด Poka-yoke แล้ว', $('fPoka').checked ? 'ก่อนบันทึกต้องสแกน QR ของช่องให้ตรง (พิมพ์ป้ายจากปุ่ม "ป้าย QR")' : '', 'info'); });
  $('fHold').addEventListener('change', () => {
    $('fHoldReason').hidden = !$('fHold').checked;
    if (!$('fHold').checked){ updateAddForm(); return; }
    /* a held job goes to the HOLD zone: pick the one with the most room */
    const add = Math.max(0, Math.floor(num($('fQty').value)));
    const hz = holdZoneKeys().map(k => { const [rk, sd, f, c] = k.split('|'); return { k, cur: sumQty(positionRows(store, rk, sd, f, c)) }; })
      .filter(z => z.cur + add <= LIMIT).sort((a, b) => a.cur - b.cur)[0];
    if (hz){ const [rk, sd, f, c] = hz.k.split('|'); $('fRack').value = rk; $('fSide').value = sd; $('fFloor').value = f; $('fCell').value = c; }
    updateAddForm();
    $('fHoldReason').focus();
  });
  $('addForm').addEventListener('reset', () => setTimeout(() => { kzRun.addAt = 0; $('fCell').value = 'IN'; $('fJobHint').textContent = ''; $('fSuggest').hidden = true; $('fHoldReason').hidden = true; if (three.ready) three.hideRoute(); updateAddForm(); }, 0));
  $('fSuggest').addEventListener('click', e => { const b = e.target.closest('[data-sg]'); if (b) pickSuggestion(Number(b.dataset.sg)); });
  /* picking a position by hand drops the smart-route preview */
  ['fRack', 'fSide', 'fFloor', 'fCell'].forEach(id => $(id).addEventListener('change', () => { document.querySelectorAll('#fSuggest .sg').forEach(b => b.classList.remove('on')); if (three.ready) three.hideRoute(); }));
}
function updateAddForm(){
  if (!$('fRack').options.length) return;
  const [rk, sd, f, cell] = fPos();
  if (!RACK_SIDES.includes(`${rk}-${sd}`)){ $('fCap').innerHTML = `<span class="cap over">ไม่มีตำแหน่ง ${rk}-${sd}</span>`; return; }
  const cur = sumQty(positionRows(store, rk, sd, f, cell));
  const add = Math.max(0, Math.floor(num($('fQty').value)));
  const after = cur + add, left = Math.max(0, LIMIT - cur);
  const st = add ? getStatus(after) : getStatus(cur);
  const cap = TRAY_CAP[$('fType').value];
  const trays = add && cap ? ` · ≈ ${Math.ceil(add / cap)} ถาด ${$('fType').value}` : '';
  /* zone rule + where the first tray goes */
  const key = `${rk}|${sd}|${f}|${cell}`, held = $('fHold').checked || isHeld($('fJob').value.trim());
  const zWhy = zoneCheck(key, $('fProduct').value.trim(), $('fItem').value.trim().toUpperCase(), held);
  const slot = slotText(key, add ? traysOf(add, $('fType').value || 'OTHER') : 1);
  $('fCap').innerHTML = `<span class="cap ${after > LIMIT ? 'over' : st}">${rk}-${sd} · ชั้น ${f} · ${cell}: มีอยู่ ${cur}/${LIMIT} · รับเพิ่มได้ ${left} ชิ้น${add ? ` · หลังเพิ่ม ${after}/${LIMIT}` : ''}${trays}</span>
    <span class="cap zone${isHoldZone(key) ? ' hold' : ''}">โซน: ${esc(zoneText(key))}</span>
    ${zWhy ? `<span class="cap over">⛔ ผิดโซน: ${esc(zWhy)}</span>` : `<span class="cap ${slot.full ? 'over' : 'slot'}">${slot.full ? '⛔ ' : '▦ '}${esc(slot.text)}</span>`}`;
  /* a wrong zone stays clickable: submitAdd blocks it and counts one prevented mistake per attempt */
  $('fSubmit').disabled = after > LIMIT || slot.full;
  if (after > LIMIT && add) kzBlock('over', `${rk}-${sd}-${f}-${cell}`);
  $('statusList').innerHTML = [...new Set(Object.values(jobs).map(j => j['Test Status']).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('');
  const prods = [...new Set(store.map(r => r.PRODUCT).filter(Boolean))].sort();
  if ($('productList').childElementCount !== prods.length) $('productList').innerHTML = prods.map(p => `<option value="${esc(p)}">`).join('');
}
function jobHint(){
  const j = $('fJob').value.trim();
  const d = j && jobOf(j);
  const inStore = j && store.filter(r => normJob(r.JOB_NO) === normJob(j));
  let msg = '';
  if (d) msg = `พบใน Job Detail · Owner: ${d['Requester Name'] || '-'} · ${d['Test Status'] || '-'}`;
  else if (j) msg = 'ยังไม่มีใน Job Detail · ใส่ข้อมูล Job ด้านล่างได้ (ไม่บังคับ)';
  if (inStore && inStore.length) msg += ` · มีใน Store แล้ว ${sumQty(inStore)} ชิ้น (${[...new Set(inStore.map(locKey))].join(', ')})`;
  if (j && isHeld(j)) msg += ` · 🔒 ติด HOLD อยู่แล้ว (${holdData[normJob(j)].reason || ''})`;
  $('fJobHint').textContent = msg;
  if (d){
    if (!$('fProduct').value && d['Product']) $('fProduct').value = d['Product'];
    $('fOwner').value = d['Requester Name'] || ''; $('fDesc').value = d['Description'] || ''; $('fStatus').value = d['Test Status'] || '';
  }
}
/* Smart slotting: score every position whose zone takes this job and that can take the whole quantity.
   Dedicated Product zone, shorter walk from the tester, lower fill after placing, same job / same tray type together and
   floor 2 (waist height) score higher; landing in the warning band scores much lower. */
let suggestions = [];
function findSpace(){
  const qty = Math.max(1, Math.floor(num($('fQty').value)) || 1);
  const tester = $('fTester').value, type = $('fType').value, job = normJob($('fJob').value);
  const ti = TESTERS.indexOf(tester);
  const prod = $('fProduct').value.trim(), typ = $('fItem').value.trim().toUpperCase(), held = $('fHold').checked || isHeld(job);
  const nTrays = traysOf(qty, type || 'OTHER');
  const cands = [];
  /* with zones, IN and OUT of one shelf can belong to different Product / Type, so both are searched */
  RACK_SIDES.forEach(key => {
    const [rk, sd] = key.split('-');
    FLOORS.forEach(f => CELLS.forEach(cell => {
      const pr = positionRows(store, rk, sd, f, cell), cur = sumQty(pr), after = cur + qty;
      if (after > LIMIT) return;
      const k = `${rk}|${sd}|${f}|${cell}`, why = [];
      /* only positions whose zone takes this Product / Type (or the HOLD zone for a held job), with room for the trays */
      if (zoneCheck(k, prod, typ, held) || zoneTrays(k) + nTrays > TRAYS_PER_ZONE) return;
      let s = 100;
      const z = zoneOf(k);
      if (z && z.hold) why.push('โซน HOLD');
      else if (z && z.prod && !z.prod.includes('*')){ s += 25; why.push(`โซนเฉพาะ ${z.prod.join('/')} · ${z.type.join('/')}`); }
      else if (z) why.push(`โซน ${zoneText(k, true)}`);
      if (ti >= 0){ const d = walkPath(ti, k).len; s -= d * 4; why.push(`เดิน ~${d.toFixed(1)} ม. จาก ${tester}`); }
      s -= after / LIMIT * 35;
      if (after >= WARN_AT){ s -= 25; why.push(`หลังวาง ${after}/${LIMIT} เข้าเขต Warning`); } else why.push(`หลังวาง ${after}/${LIMIT}`);
      if (job && pr.some(r => normJob(r.JOB_NO) === job)){ s += 22; why.unshift('มี Job เดียวกันอยู่แล้ว'); }
      else if (type && pr.some(r => String(r.TRAY).toUpperCase() === type)){ s += 6; why.push(`รวมกับถาด ${type}`); }
      if (f === '2'){ s += 8; why.push('ชั้น 2 ระดับเอว หยิบง่าย'); } else if (f === '1') s += 2;
      cands.push({ rk, sd, f, cell, k, s, why });
    }));
  });
  cands.sort((a, b) => b.s - a.s);
  suggestions = cands.slice(0, 3);
  if (!suggestions.length){ $('fSuggest').hidden = true; showToast('ไม่มีช่องที่รับได้', `ไม่มีโซนของ ${prod || '(ไม่ระบุ Product)'} · ${typ || '-'}${held ? ' (Hold)' : ''} ที่รับ ${qty} ชิ้นได้ · ใส่ Product/Type ให้ครบ หรือแก้ผังโซนที่เมนู ⋯ → ตั้งค่าโซน`, 'error'); return; }
  const top = suggestions[0].s, low = Math.min(...cands.map(c => c.s));
  $('fSuggest').innerHTML = `<div class="sg-head">✦ แนะนำ ${suggestions.length} อันดับ สำหรับ ${qty} ชิ้น · ${esc(prod || '-')} · ${esc(typ || '-')}${held ? ' · 🔒 Hold' : ''}${ti >= 0 ? ` · เดินจาก ${tester}` : ' · เลือก Tester เพื่อคิดระยะเดิน'}</div>
    <div class="sg-list">${suggestions.map((c, i) => `<button type="button" class="sg${i === 0 ? ' on' : ''}" data-sg="${i}">
      <span class="sg-rank">${i + 1}</span>
      <span class="sg-main"><b>${c.rk}-${c.sd} · ชั้น ${c.f} · ${c.cell}</b><small>${esc(c.why.join(' · '))}</small></span>
      <span class="sg-score" title="คะแนน"><i style="width:${Math.round(20 + 80 * (c.s - low) / ((top - low) || 1))}%"></i></span>
    </button>`).join('')}</div>`;
  $('fSuggest').hidden = false;
  pickSuggestion(0);
  kzBlock('smart', `${suggestions[0].k}|${qty}`);
}
function pickSuggestion(i){
  const c = suggestions[i]; if (!c) return;
  $('fRack').value = c.rk; $('fSide').value = c.sd; $('fFloor').value = c.f; $('fCell').value = c.cell;
  document.querySelectorAll('#fSuggest .sg').forEach(b => b.classList.toggle('on', Number(b.dataset.sg) === i));
  updateAddForm();
  if (three.ready){ three.showRoute(TESTERS.indexOf($('fTester').value), c.k); three.flyTo(c.k); }
}
function prefillAdd(pos){
  if (currentTab !== 'overview') setTab('overview');
  const [rk, sd, f, cell] = pos;
  $('fRack').value = rk; $('fSide').value = sd; $('fFloor').value = String(f); $('fCell').value = cell;
  updateAddForm();
  $('addPanel').scrollIntoView({ behavior:'smooth', block:'start' });
  setTimeout(() => $('fJob').focus(), 350);
}
function submitAdd(e){
  e.preventDefault();
  const job = $('fJob').value.trim(), item = $('fItem').value.trim(), qty = Math.floor(num($('fQty').value));
  const miss = [!job && 'Job No.', !item && 'Type', !(qty > 0) && 'จำนวน'].filter(Boolean);
  if (miss.length){ showToast('กรอกข้อมูลไม่ครบ', `ต้องใส่ ${miss.join(', ')}`, 'error'); (!job ? $('fJob') : !item ? $('fItem') : $('fQty')).focus(); return; }
  const [rk, sd, f, cell] = fPos();
  const cur = sumQty(positionRows(store, rk, sd, f, cell));
  if (cur + qty > LIMIT){ kzBlock('over', `${rk}-${sd}-${f}-${cell}`); showToast('เกินกำหนด · ไม่ได้บันทึก', `${rk}-${sd} ชั้น ${f} ${cell} มี ${cur} ชิ้น รับเพิ่มได้อีก ${LIMIT - cur} ชิ้น`, 'error'); return; }
  /* Poka-yoke: the shelf QR must be scanned and match before the record is saved */
  const holdIt = $('fHold').checked, holdReason = $('fHoldReason').value.trim();
  if (holdIt && !holdReason){ showToast('ใส่เหตุผล Hold', 'งาน Hold ต้องมีเหตุผลทุกครั้ง', 'warn'); $('fHoldReason').focus(); return; }
  /* zone rule: right Product / Type, held jobs only in the HOLD zone, and room for the trays */
  const zKey = `${rk}|${sd}|${f}|${cell}`;
  const zWhy = zoneCheck(zKey, $('fProduct').value.trim(), item.toUpperCase(), holdIt || isHeld(job));
  if (zWhy){ kzBlock('zone', `${zKey}|${job}`); beep(); showToast(`⛔ วางผิดโซน · ไม่ได้บันทึก`, `${keyTxt(zKey)} = ${zoneText(zKey)} · ${zWhy} · กด ✦ แนะนำช่อง เพื่อหาช่องที่ถูกโซน`, 'error'); return; }
  const zSlot = slotText(zKey, traysOf(qty, $('fType').value || 'OTHER'));
  if (zSlot.full){ showToast('ชั้นนี้วางถาดเต็มแล้ว', zSlot.text, 'error'); return; }
  if (pokaOn() && !e.pokaOk){
    pokaPending = `${rk}|${sd}|${f}|${cell}`;
    openScan('poka');
    $('scanTitle').textContent = `สแกน QR ที่ชั้น ${rk}-${sd} ชั้น ${f} ${cell}`;
    return;
  }
  if (!editor()) showToast('ยังไม่ได้ใส่ชื่อผู้บันทึก', 'Last_Editor จะว่าง · กรอกช่อง "ผู้บันทึก" ด้านบนสำหรับครั้งต่อไป', 'info');
  const type = $('fType').value, tester = $('fTester').value;
  /* "Type" in the form is the company TYPE (WKL / EVL / QUL / FA ...); the tray kind goes to TRAY */
  const row = normRow({ RACK:rk, SIDE:sd, FLOOR:f, CELL:cell, PRODUCT:$('fProduct').value.trim(), TYPE:item.toUpperCase(), TRAY:type, JOB_NO:job, QUANITY:qty, Last_Editor:editor(), REMARK:$('fRemark').value.trim(), TESTER:tester });
  store.push(row);
  /* the operator of that tester walks the tray over in the 3D view; the tray shows on the shelf when it is put down */
  const walking = tester && three.ready && three.carry(tester, row._id, `${rk}|${sd}|${f}|${cell}`, `${rk}-${sd} ชั้น ${f} ${cell}`);
  try { localStorage.setItem('resLastTesterV1', tester); } catch {}
  /* optional job detail for jobs that are not in the imported Job Detail yet (existing imported data is kept) */
  const owner = $('fOwner').value.trim(), desc = $('fDesc').value.trim(), status = $('fStatus').value.trim(), recv = $('fRecv').value;
  const k = normJob(job);
  if (!jobs[k] && (owner || desc || status)){
    jobs[k] = { 'Job No.':job, 'Requester Name':owner, 'Description':desc, 'Test Status':status, 'Product':row.PRODUCT, 'Received Date':recv, 'Special Remark':'เพิ่มเองจากหน้า Overview' };
  }
  try { localStorage.setItem('resLastTypeV1', type); } catch {}
  if (holdIt && !holdData[k]){
    holdData[k] = { by: editor() || '-', reason: holdReason, at: new Date().toISOString() };
    holdEvent('hold', k, { by: editor() || '-', reason: holdReason });
  }
  logCtx = { src:'form' };
  saveAll(false);
  lightPut(zKey, row);   /* guide light on screen: this position is highlighted until the tray is placed */
  kzAddDone();
  if (three.ready) three.hideRoute();
  $('fSuggest').hidden = true;
  buildFilterBar(); buildJobFilterBar(); renderAll();
  showToast(`เพิ่มงานเข้า Store แล้ว${isHeld(k) ? ' · 🔒 HOLD' : ''}`, `${job} · ${item} · ${qty} ชิ้น → ${rk}-${sd} ชั้น ${f} ${cell} (${cur + qty}/${LIMIT}) · ${zSlot.text}${walking ? ` · พนักงาน ${tester} กำลังถือไปวางในวิว 3D` : ''}`);
  ['fItem', 'fQty', 'fRemark', 'fHoldReason'].forEach(id => { $(id).value = ''; });
  $('fHold').checked = false; $('fHoldReason').hidden = true;
  updateAddForm(); jobHint();
  $('fItem').focus();
}

/* ===================== POSITION DIALOG ===================== */
let dlgPos = null;
function openPos(rack, side, floor, cell){
  dlgPos = [rack, side, String(floor), cell];
  renderPosDialog();
  const dlg = $('posDialog');
  if (!dlg.open) dlg.showModal();
}
function renderPosDialog(){
  if (!dlgPos) return;
  const [rack, side, floor, cell] = dlgPos;
  const rows = positionRows(store, rack, side, floor, cell);
  const qty = sumQty(rows), st = getStatus(qty);
  const otherCell = cell === 'IN' ? 'OUT' : 'IN';
  const other = sumQty(positionRows(store, rack, side, floor, otherCell));
  $('posEyebrow').textContent = `Rack ${rack} · ${side === 'L' ? 'Left' : 'Right'} · Floor ${floor}`;
  $('posTitle').innerHTML = `${rack}-${side} L${floor} ${cell} <span class="badge ${st}" style="vertical-align:middle;margin-left:6px">${statusText(st)}</span>`;
  const jobsN = new Set(rows.map(r => normJob(r.JOB_NO)).filter(Boolean)).size;
  $('posBody').innerHTML = `
    <div class="dlg-stats">
      <div class="dlg-stat"><span>Units</span><b>${qty} <small class="hint-small">/ ${LIMIT}</small></b><div class="bar"><span style="width:${Math.min(100, qty / LIMIT * 100)}%;background:${statusColor(st)}"></span></div></div>
      <div class="dlg-stat"><span>Jobs</span><b>${jobsN}</b></div>
      <div class="dlg-stat"><span>ช่อง ${otherCell} คู่กัน</span><b>${other} <small class="hint-small">/ ${LIMIT}</small></b></div>
    </div>
    ${rows.length ? `<div class="table-wrap" style="padding:0;max-height:none"><table><thead><tr><th>Item</th><th>Job No.</th><th>Tester</th><th>Owner</th><th>Test Status</th><th>Days</th><th>Qty</th><th></th></tr></thead><tbody>
      ${rows.map(r => {
        const d = jobOf(r.JOB_NO);
        const days = daysBetween(parseFlexibleDate(d && d['Received Date']));
        const jk = normJob(r.JOB_NO), held = isHeld(r.JOB_NO);
        return `<tr class="${held ? 'held' : ''}"><td><b>${esc(itemName(r))}</b>${r.REMARK ? `<div class="top-sub">${esc(r.REMARK)}</div>` : ''}</td><td>${esc(r.JOB_NO || '-')}${held ? ` <span class="hold-tag" title="${esc(holdData[jk].reason)}">🔒 HOLD</span>` : ''}</td><td>${esc(r.TESTER || '-')}</td>
          <td>${d ? esc(d['Requester Name'] || '-') : '<span class="missing">ไม่พบ</span>'}</td><td>${d && d['Test Status'] ? `<span class="status-pill">${esc(d['Test Status'])}</span>` : '-'}</td>
          <td>${days === null ? '-' : `<span class="days-badge ${daysBadgeClass(days)}">${days} วัน</span>`}</td><td class="n"><b>${num(r.QUANITY)}</b></td>
          <td><div class="row-actions">${cell === 'IN' ? `<button type="button" class="mini-btn move" data-dmove="${r._id}">ย้าย → OUT</button>` : ''}${jk ? `<button type="button" class="hold-btn ${held ? 'on' : ''}" data-hold="${esc(jk)}">${held ? 'ปลด Hold' : 'ติด Hold'}</button>` : ''}</div></td></tr>`;
      }).join('')}
    </tbody></table></div>` : '<div class="empty-table" style="padding:20px">ตำแหน่งนี้ว่าง</div>'}
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
      <span class="dlg-note">${cell === 'IN' ? 'ย้าย → OUT จะบันทึกทันที และไม่ยอมให้ช่อง OUT เกิน 80 units' : 'ช่อง OUT · งานที่ทดสอบเสร็จ รอส่งคืนหรือรอตัดสินใจ Dispose'}</span>
      <button type="button" class="btn soft sm" data-dadd="1">+ เพิ่มงานในตำแหน่งนี้</button>
    </div>`;
}

/* ===================== HOLD DIALOG (hold needs a name + reason, release needs an approver + reason) ===================== */
let holdDlgJob = null;
function openHold(jobKey){
  const k = normJob(jobKey); if (!k) return;
  holdDlgJob = k;
  const h = holdData[k];
  $('holdTitle').textContent = h ? `ปลด Hold · ${k}` : `ติด Hold · ${k}`;
  $('holdEyebrow').textContent = h ? 'ต้องมีผู้อนุมัติ · บันทึกใน Audit Log' : 'ห้าม Scrap · ห้ามหยิบออก · ห้ามลบ จนกว่าจะปลด';
  $('holdNow').hidden = !h;
  $('holdNow').innerHTML = h ? `<b>🔒 Hold อยู่</b> โดย ${esc(h.by)} · ${fmtStamp(h.at)}<br>เหตุผล: ${esc(h.reason)}` : '';
  $('holdWhoLbl').textContent = h ? 'ผู้อนุมัติปลด Hold *' : 'ผู้ติด Hold *';
  $('holdWho').value = editor();
  $('holdReason').value = '';
  $('holdReason').placeholder = h ? 'เช่น Owner ยืนยันให้ Scrap ได้แล้ว' : 'เช่น รอผล FA / Owner สั่ง Hold';
  $('holdOk').textContent = h ? 'ปลด Hold' : '🔒 ติด Hold';
  $('holdOk').className = `btn ${h ? 'primary' : 'danger'}`;
  if (!$('holdDialog').open) $('holdDialog').showModal();
  setTimeout(() => $(editor() ? 'holdReason' : 'holdWho').focus(), 50);
}
function submitHold(e){
  e.preventDefault();
  const k = holdDlgJob; if (!k) return;
  const who = $('holdWho').value.trim(), reason = $('holdReason').value.trim();
  if (!who || !reason){ showToast('กรอกให้ครบ', 'ต้องมีชื่อและเหตุผลทุกครั้ง', 'warn'); return; }
  if (holdData[k]){
    delete holdData[k];
    holdEvent('release', k, { by: who, reason });
    showToast('ปลด Hold แล้ว', `${k} · อนุมัติโดย ${who}`);
  } else {
    holdData[k] = { by: who, reason, at: new Date().toISOString() };
    holdEvent('hold', k, { by: who, reason });
    showToast(`🔒 ติด Hold แล้ว · ${k}`, 'ห้าม Scrap / หยิบออก / ลบ จนกว่าจะปลด · พิมพ์ป้าย QR ใหม่เพื่อติดแถบ HOLD', 'warn');
  }
  $('holdDialog').close();
  renderAll();
  /* held -> must sit in the HOLD zone; released -> back to its Product / Type zone */
  const mis = store.find(r => normJob(r.JOB_NO) === k && rowZoneCheck(r));
  if (mis){
    const to = findZoneFor(k);
    if (to && confirm(`${k} ${holdData[k] ? 'ติด Hold แล้ว ต้องย้ายเข้าโซน HOLD' : 'ปลด Hold แล้ว ต้องย้ายกลับโซนปกติ'}\nย้ายไป ${keyTxt(to)} (${zoneText(to)}) เลยไหม?\nย้ายถาดจริงไปที่ช่องนั้นด้วย`)) moveJobTo(k, to, holdData[k] ? 'เข้าโซน HOLD' : 'กลับโซนปกติ');
    else showToast(`${k} ยังอยู่ผิดโซน`, 'ดูรายการ "งานผิดโซน" ในแผง 🔒 แล้วกด "ย้าย" เมื่อย้ายถาดจริงแล้ว', 'warn');
  }
}
function flyToJob(job){
  if ($('posDialog').open) $('posDialog').close();
  if (currentTab !== 'overview' && currentTab !== '3d') setTab('3d');
  $('stagePanel').scrollIntoView({ behavior:'smooth', block:'center' });
  $('flyBox').value = job;
  setTimeout(() => flySearch(job), 300);
}

/* ===================== PAPER FALLBACK (system down: the printed sheet still tells where everything is) ===================== */
function printPaperMap(){
  const w = window.open('', '_blank');
  if (!w){ showToast('เปิดหน้าพิมพ์ไม่ได้', 'อนุญาต Pop-up ให้หน้านี้ก่อน', 'error'); return; }
  const rows = posKeys().map(k => {
    const [rk, sd, f, c] = k.split('|'), pr = positionRows(store, rk, sd, f, c);
    return pr.length ? pr.map((r, i) => {
      const d = jobOf(r.JOB_NO), held = isHeld(r.JOB_NO);
      return `<tr class="${held ? 'h' : ''}">${i ? '<td></td>' : `<td><b>${keyTxt(k)}</b></td>`}<td>${esc(r.JOB_NO || '-')}${held ? ' <b class="hb">HOLD</b>' : ''}</td><td>${esc(itemName(r))}</td><td class="n">${num(r.QUANITY)}</td><td>${esc((d && d['Requester Name']) || '')}</td><td>${held ? esc(holdData[normJob(r.JOB_NO)].reason) : ''}</td><td class="chk"></td></tr>`;
    }).join('') : `<tr class="e"><td><b>${keyTxt(k)}</b></td><td colspan="5">ว่าง</td><td class="chk"></td></tr>`;
  }).join('');
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Resonance Store · ผังงานสำรอง ${stamp()}</title><style>
    @page{size:A4;margin:10mm} body{font-family:"IBM Plex Sans Thai","Segoe UI",Tahoma,sans-serif;font-size:9.5pt;color:#111;margin:0}
    h1{font-size:15pt;margin:0} .m{color:#555;margin:2px 0 8px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}
    th{background:#eee} .n{text-align:right} tr.e td{color:#888} tr.h td{background:#fdecea;-webkit-print-color-adjust:exact;print-color-adjust:exact} .hb{background:#C62828;color:#fff;padding:0 4px;border-radius:3px;-webkit-print-color-adjust:exact;print-color-adjust:exact} .chk{width:16mm}
  </style></head><body><h1>Resonance Store · ผังงานสำรอง (ใช้เมื่อระบบล่ม)</h1>
  <div class="m">พิมพ์ ${fmtStamp(new Date().toISOString())} · ${storeJobs(store).length} Job · ${fmt(sumQty(store))} ชิ้น · งาน Hold ${Object.keys(holdData).length} Job · เขียนรายการเข้า–ออกด้วยมือที่ด้านหลัง แล้วคีย์เข้าระบบเมื่อกลับมาใช้ได้</div>
  <table><thead><tr><th>ตำแหน่ง</th><th>Job No.</th><th>Item</th><th>ชิ้น</th><th>Owner</th><th>เหตุผล Hold</th><th>เช็ก ✓</th></tr></thead><tbody>${rows}</tbody></table>
  <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
  w.document.close();
}

/* ===================== SHIFT ===================== */
function shiftInfo(now){
  now = now || new Date();
  const h = now.getHours();
  const isDay = h >= 6 && h < 18;
  const ref = new Date(now); if (h < 6) ref.setDate(ref.getDate() - 1);
  const dayIdx = Math.round((Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate()) - SHIFT_BASE_DAY) / 864e5);
  const want = isDay ? 'D' : 'N';
  for (const [crew, base] of Object.entries(SHIFT_BASE_IDX)){
    const i = ((base + dayIdx) % 12 + 12) % 12;
    if (SHIFT_PATTERN[i] === want) return { crew, isDay, n: i - (isDay ? 0 : 6) + 1 };
  }
  return null;
}
function renderShift(){
  const s = shiftInfo();
  if (three.ready && three.ambience) three.applyShiftLight();
  $('shiftChip').innerHTML = s ?`<span class="${s.isDay ? 'sun' : 'moon'}"></span><b>กะ ${s.crew}</b> ${s.isDay ? 'เช้า 06–18' : 'ดึก 18–06'} · วันที่ ${s.n}/4` : '-';
}

/* ===================== THEME ===================== */
function applyTheme(t){
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const lbl = document.querySelector('#themeBtn span'); if (lbl) lbl.textContent = isDark() ? 'โหมดสว่าง' : 'โหมดมืด';
  if (three.ready) three.applyTheme();
}
/* light is the default look; dark only when chosen with the theme button */
function isDark(){ return document.documentElement.dataset.theme === 'dark'; }

/* ===================== 3D STORE ===================== */
const three = { ready:false, loading:false, running:false };
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888888';
function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
/* local copy in lib/ first, CDN only when the local file is missing */
async function loadLib(file, cdn, ready){
  if (ready()) return;
  try { await loadScript('lib/' + file); } catch {}
  if (!ready()) await loadScript(cdn);
}
/* Room geometry shared by the 3D scene and the smart-slot walking distance (metres, world space).
   The real lab: a long room, the three test benches in a row along the back wall (T3 · T2 · T1 from the left),
   then 4-5 steps (~3.2 m) to the right of T1 the two racks, parallel to the bench row: rack A in line with the
   benches, the aisle, then rack B turned around to face it. RX = centre of the racks along x. */
const GEO = { W:3.6, D:1.2, AISLE:1.9, RX:4.8, RW:16, SEAT_Z:-3.6, CORRIDOR_Z:-2.35, BX:[-1.15, -3.45, -5.75] };
GEO.RZ = { A: -3.45 };
GEO.RZ.B = GEO.RZ.A + GEO.D + GEO.AISLE;
GEO.END_L = GEO.RX - GEO.W / 2 - 0.55;   /* walk round the rack ends to reach the back rows */
GEO.END_R = GEO.RX + GEO.W / 2 + 0.55;
const inAisle = z => z > GEO.RZ.A + GEO.D / 2 && z < GEO.RZ.B - GEO.D / 2;
function zoneXZ(key){
  const [rk, sd, , cell] = key.split('|');
  /* IN = +x (back of the room), OUT = -x (towards T1); L = -z half, R = +z half (left / right of someone at T1 facing +x) */
  return { x: GEO.RX + (cell === 'IN' ? 1 : -1) * GEO.W / 4, z: GEO.RZ[rk] + (sd === 'L' ? -1 : 1) * GEO.D / 4 };
}
/* walking route from tester bench ti (0 = T1) to a zone: out from the bench, right along the front of the benches
   into the aisle (A-R, B-L), or round the near rack end to A-L (behind rack A) and B-R (beyond rack B).
   Returns the floor polyline and its length. */
function walkPath(ti, key){
  const { D, RZ, SEAT_Z, CORRIDOR_Z, END_L, BX } = GEO;
  const [rk, sd] = key.split('|');
  const { x: wx, z: wz } = zoneXZ(key), bx = BX[ti] ?? BX[0];
  /* the L half is reached from the -z side of its rack, the R half from the +z side */
  const accZ = sd === 'L' ? RZ[rk] - D / 2 - 0.3 : RZ[rk] + D / 2 + 0.3, back = !inAisle(accZ);
  const pts = [[bx, SEAT_Z + 0.45], [bx, CORRIDOR_Z]];
  if (!back){ pts.push([wx, CORRIDOR_Z]); if (Math.abs(accZ - CORRIDOR_Z) > 0.01) pts.push([wx, accZ]); }
  else pts.push([END_L, CORRIDOR_Z], [END_L, accZ], [wx, accZ]);
  const len = pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);
  return { pts, accZ, face: wz > accZ ? 1 : -1, len };   /* face +1 = look toward +z */
}
async function init3D(){
  if (three.ready || three.loading) return;
  three.loading = true;
  try {
    await loadLib('three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js', () => !!window.THREE);
    await loadLib('OrbitControls.js', 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js', () => !!(window.THREE && THREE.OrbitControls));
  } catch {
    $('stageMsg').textContent = 'โหลดโมเดล 3D ไม่ได้ (ไม่พบไฟล์ใน lib/ และต่อ cdn.jsdelivr.net ไม่ได้) · ส่วนอื่นของหน้ายังใช้งานได้ปกติ';
    three.loading = false;
    return;
  }
  try { build3D(); }
  catch (e){ $('stageMsg').textContent = 'เครื่องนี้แสดงผล 3D ไม่ได้ (WebGL ถูกปิด) · ส่วนอื่นของหน้ายังใช้งานได้ปกติ'; three.loading = false; return; }
  three.ready = true; three.loading = false;
  $('stageMsg').hidden = true;
  three.update(filteredData());
  /* the walker animation is only an illustration: the lamp stays on until a person confirms (✓ วางแล้ว or shelf QR scan) */
  syncLights();
  if (currentTab === '3d' || currentTab === 'overview') start3D();
}
function build3D(){
  const T = THREE;
  const stage = $('stage');
  const renderer = new T.WebGLRenderer({ antialias:true });
  if (!renderer.getContext()) throw new Error('WebGL unavailable');
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', 'โมเดล 3D ห้อง HSA Resonance Lab คลิกช่องเพื่อดูรายละเอียด');
  stage.prepend(renderer.domElement);

  const lin = c => new T.Color(c).convertSRGBToLinear();
  const std = (hex, r, m) => new T.MeshStandardMaterial({ color: lin(hex), roughness: r ?? .6, metalness: m ?? .1 });
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(40, 1.6, 0.1, 80);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 2; controls.maxDistance = 20;
  controls.minPolarAngle = 0.15; controls.maxPolarAngle = Math.PI * 0.49;
  controls.screenSpacePanning = true;
  controls.autoRotateSpeed = 0.6;

  const hemi = new T.HemisphereLight(0xffffff, 0x7d8a96, 0.85);
  scene.add(hemi);
  const sun = new T.DirectionalLight(0xffffff, 0.75);
  sun.position.set(5, 10, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0006;
  Object.assign(sun.shadow.camera, { left:-9, right:9, top:9, bottom:-9, near:1, far:30 });
  scene.add(sun);
  const fillL = new T.DirectionalLight(0xffffff, 0.3); fillL.position.set(-6, 4, -3); scene.add(fillL);

  /* Two racks either side of the aisle, both in world orientation (see zoneXZ):
     OUT = -x half (towards T1), IN = +x half (back of the room); L = -z half, R = +z half.
     A-L is reached from behind rack A, A-R and B-L from the aisle, B-R from beyond rack B. */
  const { W, D, RZ } = GEO, H = 2.8, P = 0.08, BEAM = 0.1, DECK = 0.025;
  const LY = { 1:0.32, 2:1.22, 3:2.12 };
  const TW = 0.36, TD = 0.48, TH = 0.05, STACKS = 4, SP = (W / 2 - 0.14) / STACKS;

  const floorMat = new T.MeshStandardMaterial({ roughness:.95, metalness:0 });
  const outside = new T.Mesh(new T.PlaneGeometry(44, 44), floorMat);
  outside.rotation.x = -Math.PI / 2; outside.position.y = -0.02; outside.receiveShadow = true; scene.add(outside);

  /* Clean-room lab: an inward-facing box, so walls between the camera and the room cull away (dollhouse view) */
  const RW = GEO.RW, RD = 9.6, RH = 3.3;
  const tex = (n, draw, rx, ry) => {
    const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d'), n);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4; return t;
  };
  const floorTex = tex(256, (g, n) => {              /* 60 cm conductive vinyl tiles */
    g.fillStyle = '#D6DCE1'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 260; i++){ g.fillStyle = i % 2 ? '#C6CED5' : '#E3E7EB'; g.fillRect(Math.random() * n, Math.random() * n, 2, 2); }
    g.strokeStyle = '#B7C0C8'; g.lineWidth = 3; g.strokeRect(0, 0, n, n);
  }, RW / 0.6, RD / 0.6);
  const wallTex = len => tex(256, (g, n) => {         /* 1.2 m sandwich wall panels with a kick plate */
    g.fillStyle = '#EEF1F3'; g.fillRect(0, 0, n, n);
    g.fillStyle = '#D2D8DD'; g.fillRect(0, 0, 3, n);
    g.fillStyle = '#C8CFD5'; g.fillRect(0, n * 0.93, n, n * 0.07);
  }, len / 1.2, 1);
  const ceilTex = tex(256, (g, n) => {                /* FFU ceiling grid */
    g.fillStyle = '#AEB7BF'; g.fillRect(0, 0, n, n);
    g.fillStyle = '#E7EBEE'; g.fillRect(8, 8, n - 16, n - 16);
    g.fillStyle = '#D5DBE0';
    for (let y = 20; y < n - 16; y += 10) for (let x = 20; x < n - 16; x += 10) g.fillRect(x, y, 4, 4);
  }, RW / 1.2, RD / 1.2);
  const wm = len => new T.MeshStandardMaterial({ map: wallTex(len), roughness:.9, side:T.BackSide });
  const room = new T.Mesh(new T.BoxGeometry(RW, RH, RD), [
    wm(RD), wm(RD),
    new T.MeshBasicMaterial({ map: ceilTex, side:T.BackSide }),
    new T.MeshStandardMaterial({ map: floorTex, roughness:.55, metalness:.05, side:T.BackSide }),
    wm(RW), wm(RW),
  ]);
  room.position.y = RH / 2; room.receiveShadow = true; scene.add(room);
  const ledMat = new T.MeshBasicMaterial({ color:0xffffff });
  for (let x = -7.2; x <= 7.2; x += 2.4) for (const z of [-3.2, 0, 3.2]){
    const p = new T.Mesh(new T.PlaneGeometry(1.1, 0.5), ledMat); p.rotation.x = Math.PI / 2; p.position.set(x, RH - 0.01, z); scene.add(p);
  }
  const prop = (w, h, d, hex, x, y, z, r, m, ry) => {
    const o = new T.Mesh(new T.BoxGeometry(w, h, d), std(hex, r, m)); o.position.set(x, y, z); o.rotation.y = ry || 0;
    o.castShadow = true; o.receiveShadow = true; scene.add(o); return o;
  };
  const sign = (text, w, h) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
    const g = c.getContext('2d'); g.fillStyle = '#1F2D55'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#FFFFFF'; g.font = `700 ${Math.round(c.height * 0.5)}px Inter, "Segoe UI", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, c.height / 2 + 2);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding;
    return new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map:t }));
  };
  const s1 = sign('HSA RESONANCE LAB', 2.8, 0.4); s1.rotation.y = Math.PI / 2; s1.position.set(-RW / 2 + 0.02, 2.65, -1.2); scene.add(s1);
  prop(0.08, 2.2, 1.1, '#C9D1D8', -RW / 2 + 0.04, 1.1, 2.6, .5, .3);
  prop(0.09, 0.6, 0.5, '#4A5866', -RW / 2 + 0.045, 1.55, 2.6, .1, .4);
  const s2 = sign('LAB ENTRANCE', 1.3, 0.24);   /* lab door (the lab sits inside the clean room) */ s2.rotation.y = Math.PI / 2; s2.position.set(-RW / 2 + 0.02, 2.42, 2.6); scene.add(s2);

  /* yellow floor tape around each rack */
  const tapeMat = new T.MeshStandardMaterial({ color: lin('#E3B416'), roughness:.7 });
  const tape = (w, d, x, z) => { const m = new T.Mesh(new T.PlaneGeometry(w, d), tapeMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.003, z); scene.add(m); };
  Object.values(RZ).forEach(z0 => {
    const hw = W / 2 + 0.16, hd = D / 2 + 0.16;
    tape(hw * 2, 0.06, GEO.RX, z0 + hd); tape(hw * 2, 0.06, GEO.RX, z0 - hd);
    tape(0.06, hd * 2, GEO.RX - hw, z0); tape(0.06, hd * 2, GEO.RX + hw, z0);
  });

  /* Test benches T1-T3 against the wall behind rack A: ESD mat, PC, two monitors, tester, keyboard, chair + operator */
  const { BX, SEAT_Z } = GEO, BENCH_Z = -RD / 2 + 0.45, DESK_Y = 0.76;
  const screenMat = new T.MeshBasicMaterial({ color: lin('#2C5C8C') });
  /* clean-room operator in a navy bunny suit: one-piece coverall + hood, goggles, face mask,
     nitrile gloves and knee-high boot covers. Seated, facing -z (the monitors), hands on the keyboard. */
  const suitMat = std('#24366A', .85, 0), seamMat = std('#33498A', .8, 0), whiteMat = std('#F2F5F8', .7, 0);
  const skinMat = std('#E2B894', .7, 0), gloveMat = std('#7FC3EE', .45, 0), goggleMat = std('#1B2B3A', .15, .4), lensMat = std('#6FA8D6', .1, .3);
  const bootMat = std('#E9EDF1', .75, 0), soleMat = std('#8C96A0', .6, 0);
  const limb = (grp, a, b, r1, r2, mat) => {          /* tapered cylinder from point a to point b */
    const va = new T.Vector3(...a), vb = new T.Vector3(...b), dir = vb.clone().sub(va), len = dir.length();
    const m = new T.Mesh(new T.CylinderGeometry(r2, r1, len, 14), mat);
    m.position.copy(va).add(dir.multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    m.castShadow = true; grp.add(m); return m;
  };
  const ball = (grp, r, mat, p, s) => {
    const m = new T.Mesh(new T.SphereGeometry(r, 18, 14), mat); m.position.set(...p); if (s) m.scale.set(...s);
    m.castShadow = true; grp.add(m); return m;
  };
  /* hooded upper body shared by the seated and the walking operator; el / hd = elbow and hand points (body space) */
  const addUpper = (body, el, hd) => {
    limb(body, [0, 0, 0], [0, 0.44, 0], 0.2, 0.18, suitMat);
    ball(body, 0.2, suitMat, [0, 0, 0], [1, 0.6, 0.9]);
    ball(body, 0.19, suitMat, [0, 0.44, 0], [1.15, 0.55, 0.85]);                   /* shoulders */
    const zip = new T.Mesh(new T.BoxGeometry(0.018, 0.38, 0.01), seamMat); zip.position.set(0, 0.22, -0.185); body.add(zip);
    const tag = new T.Mesh(new T.BoxGeometry(0.09, 0.045, 0.01), whiteMat); tag.position.set(0.085, 0.36, -0.17); body.add(tag);   /* name badge */
    /* hood: covers head and neck, only the eye area shows */
    limb(body, [0, 0.44, 0], [0, 0.56, -0.01], 0.075, 0.07, suitMat);
    ball(body, 0.125, suitMat, [0, 0.66, -0.02], [1, 1.12, 1.05]);
    ball(body, 0.1, skinMat, [0, 0.675, -0.112], [0.95, 0.42, 0.55]);              /* eye-area skin */
    const goggles = new T.Mesh(new T.BoxGeometry(0.2, 0.05, 0.05), goggleMat); goggles.position.set(0, 0.685, -0.148); body.add(goggles);
    for (const sx of [-1, 1]){ const l = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.012, 16), lensMat); l.rotation.x = Math.PI / 2; l.position.set(sx * 0.045, 0.685, -0.176); body.add(l); }
    ball(body, 0.085, whiteMat, [0, 0.612, -0.118], [1, 0.62, 0.62]);              /* face mask */
    limb(body, [-0.1, 0.688, -0.135], [-0.137, 0.68, -0.02], 0.007, 0.007, goggleMat);   /* goggle strap */
    limb(body, [0.1, 0.688, -0.135], [0.137, 0.68, -0.02], 0.007, 0.007, goggleMat);
    for (const sx of [-1, 1]){                                                     /* arms + nitrile gloves */
      const sh = [sx * 0.2, 0.42, 0], e = [sx * el[0], el[1], el[2]], h = [sx * hd[0], hd[1], hd[2]];
      limb(body, sh, e, 0.065, 0.058, suitMat);
      ball(body, 0.058, suitMat, e);
      limb(body, e, h, 0.056, 0.045, suitMat);
      const dir = new T.Vector3(h[0] - e[0], h[1] - e[1], h[2] - e[2]).normalize().multiplyScalar(0.07);
      limb(body, [h[0] - dir.x, h[1] - dir.y, h[2] - dir.z], h, 0.05, 0.05, gloveMat);   /* glove cuff over the sleeve */
      ball(body, 0.048, gloveMat, [h[0] + dir.x * 0.5, h[1] + dir.y * 0.5, h[2] + dir.z * 0.5], [0.9, 0.7, 1.15]);
    }
  };
  const addBootFoot = (grp, x, y, z) => {
    const foot = new T.Mesh(new T.BoxGeometry(0.12, 0.08, 0.24), bootMat); foot.position.set(x, y + 0.035, z); foot.castShadow = true; grp.add(foot);
    const sole = new T.Mesh(new T.BoxGeometry(0.125, 0.02, 0.245), soleMat); sole.position.set(x, y, z); grp.add(sole);
  };
  /* seated at the bench, facing -z (the monitors), hands on the keyboard */
  const makeOperator = (px, pz) => {
    const op = new T.Group(); op.position.set(px, 0, pz);
    const body = new T.Group(); body.rotation.x = -0.12; body.position.set(0, 0.55, 0.02); op.add(body);   /* lean toward the desk */
    addUpper(body, [0.23, 0.25, -0.2], [0.13, 0.33, -0.46]);
    for (const sx of [-1, 1]){
      const knee = [sx * 0.11, 0.55, -0.4];
      limb(op, [sx * 0.1, 0.56, 0.02], knee, 0.085, 0.072, suitMat);
      ball(op, 0.074, suitMat, knee);
      limb(op, knee, [sx * 0.11, 0.33, -0.43], 0.066, 0.06, suitMat);
      limb(op, [sx * 0.11, 0.06, -0.44], [sx * 0.11, 0.36, -0.43], 0.068, 0.072, bootMat);   /* boot cover up to mid shin */
      addBootFoot(op, sx * 0.11, 0.01, -0.5);
    }
    return op;
  };
  /* standing / walking, facing -z, carrying a black tray in both hands */
  const makeWalker = () => {
    const root = new T.Group();
    const hips = [];
    for (const sx of [-1, 1]){
      const hip = new T.Group(); hip.position.set(sx * 0.1, 0.9, 0); root.add(hip);
      limb(hip, [0, 0, 0], [0, -0.45, 0], 0.085, 0.072, suitMat);
      ball(hip, 0.074, suitMat, [0, -0.45, 0]);
      limb(hip, [0, -0.45, 0], [0, -0.6, 0], 0.066, 0.062, suitMat);
      limb(hip, [0, -0.85, 0.01], [0, -0.55, 0.01], 0.068, 0.072, bootMat);
      addBootFoot(hip, 0, -0.89, -0.05);
      hips.push(hip);
    }
    const body = new T.Group(); body.position.set(0, 0.9, 0); root.add(body);
    addUpper(body, [0.23, 0.2, -0.12], [0.2, 0.17, -0.34]);
    const tray = new T.Mesh(new T.BoxGeometry(0.48, 0.05, 0.36), std('#1C1F23', .55, .1));
    tray.position.set(0, 0.2, -0.36); tray.castShadow = true; body.add(tray);
    const strip = new T.Mesh(new T.BoxGeometry(0.3, 0.022, 0.006), std('#2F6FD6', .4, 0)); strip.position.set(0, 0, -0.183); tray.add(strip);
    return { root, hips, body, tray, strip, trayHome: tray.position.clone() };
  };
  const benches = [], benchOps = [];
  BX.forEach((x, i) => {
    prop(1.9, 0.04, 0.75, '#9FB3C2', x, DESK_Y - 0.02, BENCH_Z, .7, .05);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) prop(0.05, DESK_Y - 0.04, 0.05, '#8D99A4', x + sx * 0.88, (DESK_Y - 0.04) / 2, BENCH_Z + sz * 0.33, .4, .6);
    for (const sx of [-1, 1]){
      prop(0.05, 0.16, 0.05, '#2A2F36', x + sx * 0.3, DESK_Y + 0.08, BENCH_Z - 0.22);
      const mon = prop(0.56, 0.34, 0.03, '#1E2329', x + sx * 0.3, DESK_Y + 0.33, BENCH_Z - 0.2, .3, .2, -sx * 0.18);
      const scr = new T.Mesh(new T.PlaneGeometry(0.52, 0.3), screenMat); scr.position.set(0, 0, 0.017); mon.add(scr);
    }
    prop(0.2, 0.44, 0.44, '#2A2F36', x + 0.7, 0.22, BENCH_Z + 0.05, .4, .3);
    const tester = prop(0.46, 0.3, 0.42, '#D9DEE3', x - 0.62, DESK_Y + 0.15, BENCH_Z - 0.06, .5, .3);
    const pnl = new T.Mesh(new T.PlaneGeometry(0.18, 0.08), new T.MeshBasicMaterial({ color: lin('#1F3B2A') })); pnl.position.set(-0.08, 0.05, 0.212); tester.add(pnl);
    const led = new T.Mesh(new T.SphereGeometry(0.012, 8, 6), new T.MeshBasicMaterial({ color:0x35d07f })); led.position.set(0.15, 0.06, 0.212); tester.add(led);
    prop(0.44, 0.02, 0.14, '#2A2F36', x, DESK_Y + 0.01, BENCH_Z + 0.2);
    prop(0.06, 0.025, 0.1, '#2A2F36', x + 0.3, DESK_Y + 0.012, BENCH_Z + 0.24);
    prop(0.46, 0.06, 0.44, '#3B4652', x, 0.46, SEAT_Z, .7, .1);
    prop(0.44, 0.46, 0.05, '#3B4652', x, 0.76, SEAT_Z + 0.24, .7, .1);
    prop(0.05, 0.4, 0.05, '#7D8892', x, 0.22, SEAT_Z, .3, .7);
    prop(0.5, 0.03, 0.5, '#4A535C', x, 0.03, SEAT_Z, .5, .5);
    const seated = makeOperator(x, SEAT_Z); scene.add(seated);
    benchOps[i] = { seated, x };
    benches.push({ label:`T${i + 1} · HDD Tester`, pos:new T.Vector3(x, 1.5, BENCH_Z) });
  });

  /* Racks: blue uprights, orange beams, steel decks, yellow zone lines (same look as the original HSA 3D store) */
  const upMat = std('#2D5C8F', .5, .35), beamMat = std('#E07A1E', .45, .25), deckMat = std('#9AA6B1', .6, .5);
  const lineMat = new T.MeshStandardMaterial({ color: lin('#E3B416'), roughness:.6 });
  const outlineMat = new T.LineBasicMaterial({ color:0xffffff });
  const groups = {};
  const cells = {};
  const hitMeshes = [];
  const sections = [];
  ['A', 'B'].forEach(rk => {
    const g = new T.Group();
    g.position.set(GEO.RX, 0, RZ[rk]);   /* not rotated: local axes = world axes, so A and B share the L / R / IN / OUT layout */
    scene.add(g); groups[rk] = g;
    const box = (w, h, d, mat, x, y, z, shadow) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = shadow !== false; m.receiveShadow = true; g.add(m); return m;
    };
    for (const sx of [-1, 1]){
      for (const sz of [-1, 1]) box(P, H, P, upMat, sx * W / 2, H / 2, sz * D / 2);
      for (const y of [0.1, 0.77, 1.67, H - 0.05]) box(0.035, 0.035, D, upMat, sx * W / 2, y, 0);
    }
    box(P, H, P, upMat, 0, H / 2, D / 2); box(P, H, P, upMat, 0, H / 2, -D / 2);   /* centre upright splits L / R */
    g.updateMatrixWorld(true);
    [1, 2, 3].forEach(lv => {
      const y = LY[lv], top = y + BEAM / 2 + DECK;
      box(W, BEAM, 0.05, beamMat, 0, y, D / 2);
      box(W, BEAM, 0.05, beamMat, 0, y, -D / 2);
      box(W - 0.02, DECK, D - 0.02, deckMat, 0, top - DECK / 2, 0);
      box(W - 0.06, 0.003, 0.02, lineMat, 0, top + 0.0015, 0, false);
      box(0.02, 0.003, D - 0.06, lineMat, 0, top + 0.0015, 0, false);
      ['L', 'R'].forEach(sd => {
        if (!RACK_SIDES.includes(`${rk}-${sd}`)) return;
        CELLS.forEach(cell => {
          const zx = (cell === 'IN' ? 1 : -1) * W / 4, zz = (sd === 'L' ? -1 : 1) * D / 4;
          const plate = new T.Mesh(new T.PlaneGeometry(W / 2 - 0.1, D / 2 - 0.1), new T.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:.0, depthWrite:false }));
          plate.rotation.x = -Math.PI / 2; plate.position.set(zx, top + 0.004, zz); g.add(plate);
          const hit = new T.Mesh(new T.BoxGeometry(W / 2 - 0.03, 0.6, D / 2 - 0.03), new T.MeshBasicMaterial({ visible:false }));
          hit.position.set(zx, top + 0.3, zz); g.add(hit);
          const ol = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(W / 2 - 0.02, 0.62, D / 2 - 0.02)), outlineMat);
          ol.position.copy(hit.position); ol.visible = false; g.add(ol);
          const k = `${rk}|${sd}|${lv}|${cell}`;
          hit.userData.key = k; hitMeshes.push(hit);
          /* real label plate on this zone's own orange beam, facing the side people reach it from: L = -z beam, R = +z beam */
          const lc = document.createElement('canvas'); lc.width = 1024; lc.height = 176;
          const ltex = new T.CanvasTexture(lc); ltex.encoding = T.sRGBEncoding; ltex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          const LH = 1.5 * 176 / 1024;   /* plate hangs from the beam top edge */
          const plateLabel = new T.Mesh(new T.PlaneGeometry(1.5, LH), new T.MeshBasicMaterial({ map: ltex }));
          plateLabel.position.set(zx, y + BEAM / 2 - LH / 2, (sd === 'L' ? -1 : 1) * (D / 2 + 0.028));
          if (sd === 'L') plateLabel.rotation.y = Math.PI;
          g.add(plateLabel);
          /* on-screen guide light: a glowing box over the zone (the real shelves have no lamps) */
          const glow = new T.Mesh(new T.BoxGeometry(W / 2 - 0.04, 0.58, D / 2 - 0.04), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
          glow.position.set(zx, top + 0.3, zz); glow.visible = false; g.add(glow);
          const lampInfo = { glow, pos: new T.Vector3(GEO.RX + zx, top + 0.62, RZ[rk] + zz), on: null };
          const labelInfo = { canvas: lc, ctx: lc.getContext('2d'), tex: ltex, key: '' };
          /* translucent volume over the zone: heatmap / age X-ray / search hit / smart-route target */
          const heat = new T.Mesh(new T.BoxGeometry(W / 2 - 0.06, 0.56, D / 2 - 0.06), new T.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0, depthWrite:false }));
          heat.position.set(zx, top + 0.29, zz); heat.visible = false; g.add(heat);
          cells[k] = { rk, plate, outline:ol, zx, zz, top, label: labelInfo, lamp: lampInfo, qty:0, heat, heatOp:0, pulse:false };
        });
      });
    });
    sections.push({ key: rk, pos: new T.Vector3(0, H + 0.25, 0).applyMatrix4(g.matrixWorld) });
  });

  /* Trays: instanced black bodies + coloured front label strip (IM blue / FOF purple, length = how full the tray is) */
  const MAX_T = Object.keys(cells).length * 16;
  const unit = new T.BoxGeometry(1, 1, 1);
  const trayBody = new T.InstancedMesh(unit, new T.MeshStandardMaterial({ color:0xffffff, roughness:.55, metalness:.1 }), MAX_T);
  const trayLabel = new T.InstancedMesh(unit, new T.MeshStandardMaterial({ color:0xffffff, roughness:.4 }), MAX_T);
  trayBody.castShadow = true; trayBody.receiveShadow = true;
  const BODY_DARK = lin('#1C1F23'), GHOST_BODY = lin('#B9C1C8'), GHOST_LABEL = lin('#D3D9DE'), HIT_LABEL = lin('#FFD43B'), HOLD_BODY = lin('#C62828');
  /* r128 sizes the colour buffer from .count on the first setColorAt, so create it while count = MAX_T */
  trayBody.setColorAt(0, BODY_DARK);
  trayLabel.setColorAt(0, new T.Color(1, 1, 1));
  trayBody.count = 0; trayLabel.count = 0;
  scene.add(trayBody, trayLabel);
  const TYPE_COLOR = { IM: lin('#2F6FD6'), FOF: lin('#8B4FD0'), OTHER: lin('#0B9E8A') };
  const AGE_HEX = { ok:'#2FA84F', warn:'#E3A008', old:'#E5484D', none:'#7A8794' };
  const AGE_COLOR = Object.fromEntries(Object.entries(AGE_HEX).map(([k, h]) => [k, lin(h)]));
  /* heatmap ramp: green -> amber at the warning line (75%) -> red at the limit */
  const heatHex = p => {
    const stops = [[0, [63, 185, 80]], [WARN_AT / LIMIT, [242, 183, 5]], [1, [229, 72, 77]]];
    p = Math.max(0, Math.min(1, p));
    const i = p <= stops[1][0] ? 0 : 1, [a, ca] = stops[i], [b, cb] = stops[i + 1], f = (p - a) / (b - a || 1);
    return '#' + ca.map((v, j) => Math.round(v + (cb[j] - v) * f).toString(16).padStart(2, '0')).join('');
  };
  const xray = on => [upMat, beamMat, deckMat].forEach(m => { if (m.transparent === on) return; m.transparent = on; m.opacity = on ? 0.18 : 1; m.depthWrite = !on; m.needsUpdate = true; });
  const TYPE_CAP = { IM:8, FOF:32, OTHER:8 };
  const trayType = r => {
    const t = String(r.TRAY || '').toUpperCase(); if (t === 'IM' || t === 'FOF') return t;
    const s = `${r.TYPE} ${r.ITEM} ${r.PRODUCT}`.toUpperCase(); return /FOF/.test(s) ? 'FOF' : /\bIM\b|IM[_\s-]|^IM/.test(s) ? 'IM' : 'OTHER';
  };

  /* HTML overlay tags */
  const tagLayer = $('stageTags');
  tagLayer.innerHTML = '';
  const mkTag = cls => { const el = document.createElement('div'); el.className = 'tag3d ' + cls; tagLayer.appendChild(el); return el; };
  sections.forEach(s => { s.el = mkTag('big'); s.el.textContent = `RACK ${s.key}`; });
  benches.forEach(b => { b.el = mkTag('bench'); b.el.textContent = b.label; });

  /* draw one shelf label: zone name on the left, units + % on the right, fill bar along the bottom */
  const LABEL_COLORS = { empty:'#9AA6B1', normal:'#4A9635', warning:'#E3A008', over:'#D64545' };
  const drawLabel = (c, name, qty, pct, st, extra, held, zoneTxt, hz) => {
    const key = `${name}|${qty}|${st}|${extra}|${held}|${zoneTxt}|${hz}`;
    if (c.label.key === key) return;
    c.label.key = key;
    const g2 = c.label.ctx, w = c.label.canvas.width, h = c.label.canvas.height;
    const over = st === 'over';
    g2.fillStyle = over ? '#D64545' : hz ? '#FDE3E3' : '#FFFFFF'; g2.fillRect(0, 0, w, h);
    g2.fillStyle = hz ? '#C62828' : '#E07A1E'; g2.fillRect(0, 0, w, 8);       /* orange top edge like the beam, red on the HOLD zone */
    g2.fillStyle = over ? '#FFFFFF' : LABEL_COLORS[st]; g2.fillRect(0, 8, 14, h - 8);   /* status stripe */
    g2.textBaseline = 'middle'; g2.textAlign = 'left';
    g2.fillStyle = over ? '#FFFFFF' : '#15212B';
    g2.font = '800 54px Inter, "Segoe UI", Tahoma, sans-serif';
    g2.fillText(name, 36, 52);                                               /* line 1: position + zone */
    if (zoneTxt){
      const nx = 36 + g2.measureText(name).width + 22;
      g2.font = '700 40px Inter, "Segoe UI", Tahoma, sans-serif';
      g2.fillStyle = over ? '#FFFFFF' : hz ? '#C62828' : '#2D7C31';
      g2.fillText(zoneTxt, nx, 54, w - nx - (held ? 230 : 20));
    }
    g2.font = '800 64px Inter, "Segoe UI", Tahoma, sans-serif';
    g2.fillStyle = over ? '#FFFFFF' : (st === 'empty' ? '#7A8794' : LABEL_COLORS[st]);
    g2.fillText(`${qty} ชิ้น · ${pct}%${extra}`, 36, 120);                    /* line 2: units + % */
    g2.fillStyle = over ? 'rgba(255,255,255,.35)' : '#E6EAED'; g2.fillRect(14, h - 18, w - 14, 18);   /* fill bar */
    g2.fillStyle = over ? '#FFFFFF' : LABEL_COLORS[st]; g2.fillRect(14, h - 18, (w - 14) * Math.min(1, pct / 100), 18);
    if (held){                                                               /* red HOLD pill, top right */
      const txt = `HOLD ${held}`;
      g2.font = '800 46px Inter, "Segoe UI", Tahoma, sans-serif';
      const pw = g2.measureText(txt).width + 36;
      g2.fillStyle = over ? '#FFFFFF' : '#C62828'; g2.fillRect(w - pw - 14, 20, pw, 62);
      g2.fillStyle = over ? '#C62828' : '#FFFFFF'; g2.textAlign = 'center'; g2.fillText(txt, w - pw / 2 - 14, 52);
    }
    c.label.tex.needsUpdate = true;
  };

  /* ---------- operators carrying new work from their tester to the rack ---------- */
  const SPEED = 1.15;
  const ease = p => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const walkers = benchOps.map((b, i) => { const w = makeWalker(); w.root.visible = false; scene.add(w.root); return { ...b, w, i, queue: [], task: null }; });
  const benchTag = (i, extra) => { if (benches[i]) { benches[i].el.textContent = benches[i].label + (extra ? ` · ${extra}` : ''); benches[i].el.classList.toggle('busy', !!extra); } };
  const zoneWorld = k => { const c = cells[k]; return new T.Vector3(c.zx, c.top + TH / 2 + 0.004, c.zz).applyMatrix4(groups[c.rk].matrixWorld); };
  /* walk behind rack A, round the rack end, then along the aisle (front row) or behind the rack (back row) */
  const planPath = (wk, k) => { const p = walkPath(wk.i, k); return { pts: p.pts, zp: zoneWorld(k), face: p.face }; };
  const startTask = (wk, job) => {
    const p = planPath(wk, job.key);
    wk.task = { ...job, ...p, phase:'stand', t:0 };
    wk.seated.visible = false;
    const W = wk.w;
    W.root.visible = true; W.tray.visible = true;
    W.root.position.set(wk.x, 0, SEAT_Z + 0.15); W.root.rotation.y = Math.PI;
    benchTag(wk.i, `กำลังนำงานไปเก็บ ${job.label}`);
  };
  const moveAlong = (W, tk, dt) => {
    let step = SPEED * dt;
    while (step > 0 && tk.idx < tk.path.length){
      const [tx, tz] = tk.path[tk.idx], p = W.root.position, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < 1e-4){ tk.idx++; continue; }
      W.root.rotation.y = Math.atan2(-dx, -dz);
      if (d <= step){ p.x = tx; p.z = tz; step -= d; tk.idx++; }
      else { p.x += dx / d * step; p.z += dz / d * step; step = 0; }
    }
    return tk.idx >= tk.path.length;
  };
  const swing = (W, t, still) => { const a = still ? 0 : Math.sin(t * 9) * 0.45; W.hips[0].rotation.x = a; W.hips[1].rotation.x = -a; W.body.position.y = 0.9 + (still ? 0 : Math.abs(Math.sin(t * 9)) * 0.015); };
  const stepWalkers = dt => walkers.forEach(wk => {
    if (!wk.task){ if (wk.queue.length) startTask(wk, wk.queue.shift()); return; }
    const tk = wk.task, W = wk.w;
    tk.t += dt;
    if (tk.phase === 'stand'){ if (tk.t > 0.35){ tk.phase = 'go'; tk.path = tk.pts; tk.idx = 0; tk.t = 0; } return; }
    if (tk.phase === 'go' || tk.phase === 'back'){
      const done = moveAlong(W, tk, dt);
      swing(W, tk.t, done);
      if (!done) return;
      if (tk.phase === 'go'){
        tk.phase = 'place'; tk.t = 0;
        W.root.rotation.y = tk.face > 0 ? Math.PI : 0;
        W.root.updateMatrixWorld(true);
        tk.from = W.tray.getWorldPosition(new T.Vector3());
        scene.attach(W.tray);
      } else {
        tk.phase = 'sit'; tk.t = 0; W.root.rotation.y = 0;
      }
      return;
    }
    if (tk.phase === 'place'){
      const p = Math.min(1, tk.t / 0.8);
      W.tray.position.lerpVectors(tk.from, tk.zp, ease(p));
      W.tray.position.y += Math.sin(p * Math.PI) * 0.12;
      if (p < 1) return;
      W.tray.visible = false;
      W.body.attach(W.tray); W.tray.position.copy(W.trayHome); W.tray.rotation.set(0, 0, 0);
      three.transit.delete(tk.rowId);
      three.update(filteredData());
      if (three.onPlaced) three.onPlaced(tk.key, tk.rowId);   /* the walker "presses" the lamp: put light goes off */
      tk.phase = 'back'; tk.t = 0; tk.idx = 0;
      tk.path = [...tk.pts].reverse().slice(1).concat([[wk.x, SEAT_Z + 0.15]]);
      return;
    }
    if (tk.phase === 'sit' && tk.t > 0.3){
      W.root.visible = false; wk.seated.visible = true; wk.task = null; benchTag(wk.i, '');
    }
  });
  three.transit = new Set();
  /* queue a carry: tester "T1".."T3", the new store row id, zone key "A|L|3|IN" */
  three.carry = (tester, rowId, key, label) => {
    const wk = walkers[Number(String(tester).replace(/\D/g, '')) - 1];
    if (!wk || !cells[key]) return false;
    three.transit.add(rowId);
    wk.queue.push({ rowId, key, label });
    return true;
  };
  let lastT = performance.now();

  /* camera presets, built from the room layout:
     home  = the whole lab (benches + racks) from the front, a little high
     aisle = what the T1 operator sees standing at the OUT end of the aisle: rack A left, rack B right
     racks = the two racks large, from beyond rack B, so the shelf labels are readable
     top   = plan view, x to the right like the 2D map */
  const AZ = (RZ.A + RZ.B) / 2, LX = (GEO.BX[GEO.BX.length - 1] + GEO.RX + W / 2) / 2;
  const presets = {
    home:  { pos:[LX + 0.6, 8.6, 7.6], target:[LX + 0.6, 0.6, -2.3] },
    aisle: { pos:[GEO.END_L - 3.4, 2.3, AZ], target:[GEO.RX + 0.6, 1.1, AZ] },
    racks: { pos:[GEO.RX - 3.2, 3.6, RZ.B + 4.6], target:[GEO.RX + 0.2, 1.0, AZ] },
    top:   { pos:[LX - 0.2, 13.8, -1.9], target:[LX - 0.2, 0, -2.1] }
  };
  /* smooth camera flight (presets, search hits, kiosk tour) */
  const anim = { on:false, t:0, dur:1.3, p0:new T.Vector3(), t0:new T.Vector3(), p1:new T.Vector3(), t1:new T.Vector3() };
  const flyCam = (pos, target, dur) => {
    anim.p0.copy(camera.position); anim.t0.copy(controls.target);
    anim.p1.set(...pos); anim.t1.set(...target); anim.t = 0; anim.dur = dur || 1.3; anim.on = true;
  };
  const go = (p, instant) => {
    if (instant){ camera.position.set(...presets[p].pos); controls.target.set(...presets[p].target); controls.update(); return; }
    flyCam(presets[p].pos, presets[p].target);
  };
  go('home', true);
  /* look at one zone from the side people reach it from (aisle for the front row, behind the rack for the back row) */
  three.flyTo = (key, instant) => {
    if (!cells[key]) return;
    const zp = zoneWorld(key), back = !inAisle(walkPath(0, key).accZ);
    const s = Math.sign(walkPath(0, key).accZ - zp.z) || 1;
    flyCam([zp.x + 0.6, zp.y + (back ? 1.15 : 0.8), zp.z + s * (back ? 1.95 : 2.1)], [zp.x, zp.y + 0.05, zp.z], instant ? 0.001 : 0);
    controls.autoRotate = false; $('spinBtn').setAttribute('aria-pressed', 'false');
  };

  /* smart-slot route: glowing footsteps on the floor from the tester bench to the chosen zone */
  const routeGroup = new T.Group(); scene.add(routeGroup);
  const dotGeo = new T.CircleGeometry(0.05, 18), ringGeo = new T.RingGeometry(0.13, 0.2, 36);
  let routeDots = [];
  const clearRoute = () => {
    routeGroup.children.slice().forEach(m => { m.material.dispose(); routeGroup.remove(m); });
    routeDots = [];
  };
  three.routeKeys = new Set();
  let stopTags = [];
  const clearStops = () => { stopTags.forEach(s => s.el.remove()); stopTags = []; };
  /* draw a floor route through pts [[x,z]...]; keys = zones to light up; stops = [{key, label}] numbered pins */
  three.showPath = (pts, keys, stops) => {
    clearRoute(); clearStops();
    three.routeKeys = new Set((keys || []).filter(k => cells[k]));
    if (pts && pts.length > 1){
      const flat = (geo, x, z, color) => { const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: lin(color), transparent:true, opacity:.9, depthWrite:false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); routeGroup.add(m); return m; };
      let carry = 0;
      for (let i = 1; i < pts.length; i++){
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i], seg = Math.hypot(bx - ax, bz - az);
        let s = carry;
        for (; s < seg; s += 0.22) routeDots.push(flat(dotGeo, ax + (bx - ax) * s / seg, az + (bz - az) * s / seg, '#6EBE49'));
        carry = s - seg;
      }
      flat(ringGeo, pts[0][0], pts[0][1], '#2F6FD6');
      flat(ringGeo, pts[pts.length - 1][0], pts[pts.length - 1][1], '#6EBE49');
    }
    (stops || []).forEach(s => { if (!cells[s.key]) return; const el = mkTag('stop'); el.textContent = s.label; stopTags.push({ el, pos: zoneWorld(s.key).add(new T.Vector3(0, 0.45, 0)) }); });
    if (three.rows) three.update(three.rows);
  };
  /* on-screen guide light: map key -> { kind:'put'|'pick'|'hold', text } ; everything else off */
  const LAMP_HEX = { put:'#22E06B', pick:'#FFB020', hold:'#FF3B3B' };
  let litLamps = [];
  three.setLights = map => {
    litLamps.forEach(l => { l.lamp.on = null; l.lamp.glow.visible = false; l.el.remove(); });
    litLamps = [];
    Object.entries(map || {}).forEach(([k, l]) => {
      const c = cells[k]; if (!c) return;
      const col = lin(LAMP_HEX[l.kind] || '#FFFFFF');
      c.lamp.on = l.kind; c.lamp.glow.material.color.copy(col); c.lamp.glow.visible = true;
      const el = mkTag('lamp ' + l.kind); el.textContent = '▶ ' + l.text;
      litLamps.push({ lamp: c.lamp, el, pos: c.lamp.pos.clone() });
    });
  };
  three.showRoute = (ti, key) => three.showPath(cells[key] && ti >= 0 ? walkPath(ti, key).pts : null, [key]);
  three.hideRoute = () => { if (!three.routeKeys.size && !routeDots.length && !stopTags.length) return; clearRoute(); clearStops(); three.routeKeys = new Set(); if (three.rows) three.update(three.rows); };

  /* ---------- clean-room ambience: shift lighting, warning beacons ---------- */
  three.ambience = (() => { try { return localStorage.getItem('resAmbV1') !== '0'; } catch { return true; } })();
  const beacons = {};
  ['A', 'B'].forEach(rk => {
    const b = new T.Group(); b.position.set(0, 2.8 + 0.02, 0); groups[rk].add(b);
    const base = new T.Mesh(new T.CylinderGeometry(0.07, 0.08, 0.06, 20), std('#2A2F36', .4, .4)); base.position.y = 0.03; b.add(base);
    const dome = new T.Mesh(new T.SphereGeometry(0.07, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshBasicMaterial({ color:0xff3b3b })); dome.position.y = 0.06; b.add(dome);
    const beam = new T.Group(); beam.position.y = 0.1; b.add(beam);
    /* two rotating light fans: a wedge that fades out from the lamp */
    const fan = new T.BufferGeometry();
    fan.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0.75, 0.16, 0, 0.75, -0.12, 0], 3));
    fan.setAttribute('color', new T.Float32BufferAttribute([1, 0.15, 0.15, 1, 0.15, 0.15, 1, 0.15, 0.15], 3));
    for (const s of [0, Math.PI]){ const p = new T.Mesh(fan, new T.MeshBasicMaterial({ color:0xff3030, transparent:true, opacity:.5, side:T.DoubleSide, depthWrite:false })); const arm = new T.Group(); arm.rotation.y = s; arm.add(p); beam.add(arm); }
    b.visible = false; beacons[rk] = { g:b, beam };
  });
  three.applyShiftLight = () => {
    const s = shiftInfo(), night = s ? !s.isDay : false;
    hemi.intensity = night ? 0.62 : 0.85; hemi.color.set(night ? 0xd6e2ff : 0xffffff);
    sun.intensity = night ? 0.45 : 0.75; sun.color.set(night ? 0xcfdcff : 0xfff8ee);
    ledMat.color.set(night ? 0xdfe8ff : 0xffffff);
  };
  three.setAmbience = on => {
    three.ambience = on;
    try { localStorage.setItem('resAmbV1', on ? '1' : '0'); } catch {}
    if (on) three.applyShiftLight(); else { hemi.intensity = .85; hemi.color.set(0xffffff); sun.intensity = .75; sun.color.set(0xffffff); ledMat.color.set(0xffffff); }
    if (three.rows) three.update(three.rows);
  };
  if (three.ambience) three.applyShiftLight();
  three.beacons = beacons;

  /* ---------- first-person walk mode ---------- */
  const walk = { on:false, yaw:-Math.PI / 2, pitch:-0.05, keys:new Set(), drag:null };
  const EYE = 1.6;
  const blocked = (x, z) => {
    if (Math.abs(x) > RW / 2 - 0.3 || Math.abs(z) > RD / 2 - 0.3) return true;
    for (const rz of Object.values(RZ)) if (Math.abs(x - GEO.RX) < W / 2 + 0.2 && Math.abs(z - rz) < D / 2 + 0.2) return true;
    for (const bx of BX) if (Math.abs(x - bx) < 1.05 && z < SEAT_Z + 0.35) return true;
    return false;
  };
  three.walkStart = () => {
    if (walk.on) return;
    walk.on = true; anim.on = false; controls.enabled = false; controls.autoRotate = false;
    walk.yaw = -Math.PI / 2; walk.pitch = -0.05;
    camera.position.set(-RW / 2 + 0.8, EYE, 2.6);   /* just inside the lab entrance */
    camera.rotation.order = 'YXZ';
    $('walkHud').hidden = false; $('walkBtn').setAttribute('aria-pressed', 'true');
    stage.focus();
  };
  three.walkStop = () => {
    if (!walk.on) return;
    walk.on = false; walk.keys.clear();
    const f = new T.Vector3(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
    controls.target.copy(camera.position).addScaledVector(f, 2);
    camera.rotation.order = 'XYZ'; controls.enabled = true; controls.update();
    $('walkHud').hidden = true; $('walkBtn').setAttribute('aria-pressed', 'false');
    go('home');
  };
  three.walking = () => walk.on;
  const stepWalk = dt => {
    const k = walk.keys, sp = (k.has('shift') ? 3 : 1.5) * dt;
    let fw = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    let st = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    if (k.has('arrowleft')) walk.yaw += 1.8 * dt;
    if (k.has('arrowright')) walk.yaw -= 1.8 * dt;
    if (fw || st){
      const len = Math.hypot(fw, st); fw /= len; st /= len;
      const sy = Math.sin(walk.yaw), cy = Math.cos(walk.yaw);
      const dx = (-sy * fw + cy * st) * sp, dz = (-cy * fw - sy * st) * sp;
      const p = camera.position;
      if (!blocked(p.x + dx, p.z + dz)){ p.x += dx; p.z += dz; }
      else if (!blocked(p.x + dx, p.z)) p.x += dx;
      else if (!blocked(p.x, p.z + dz)) p.z += dz;
    }
    camera.position.y = EYE + (fw || st ? Math.sin(performance.now() / 120) * 0.012 : 0);
    camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
  };
  stage.tabIndex = -1;
  window.addEventListener('keydown', e => {
    if (!walk.on) return;
    if (e.target.closest && e.target.closest('input,textarea,select,dialog')) return;
    const key = e.key.toLowerCase();
    if (key === 'escape'){ three.walkStop(); return; }
    if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)){ walk.keys.add(key); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => walk.keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => walk.keys.clear());
  renderer.domElement.addEventListener('pointerdown', e => { if (walk.on) walk.drag = [e.clientX, e.clientY]; });
  window.addEventListener('pointerup', () => { walk.drag = null; });
  window.addEventListener('pointermove', e => {
    if (!walk.on || !walk.drag) return;
    walk.yaw -= (e.clientX - walk.drag[0]) * 0.005;
    walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - (e.clientY - walk.drag[1]) * 0.004));
    walk.drag = [e.clientX, e.clientY];
  });

  /* still image of the current view (weekly report) */
  three.snapshot = () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.86); };

  /* hover + click */
  const ray = new T.Raycaster(), mouse = new T.Vector2();
  let hoverKey = null, downAt = null;
  const pick = e => {
    const rc = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(hitMeshes)[0];
    return hit ? hit.object.userData.key : null;
  };
  const setHover = k => {
    if (hoverKey && cells[hoverKey]) cells[hoverKey].outline.visible = false;
    hoverKey = k;
    if (k) cells[k].outline.visible = true;
  };
  renderer.domElement.addEventListener('pointermove', e => {
    const k = pick(e);
    if (k === hoverKey) return;
    setHover(k);
    const card = $('stageCard');
    if (!k){ card.hidden = true; renderer.domElement.style.cursor = ''; return; }
    renderer.domElement.style.cursor = 'pointer';
    const [rk, sd, f, cell] = k.split('|');
    const rows = positionRows(three.rows || [], rk, sd, f, cell);
    const qty = sumQty(rows), st = getStatus(qty);
    const items = [...new Set(rows.map(itemName))].filter(x => x !== '-');
    card.innerHTML = `<b>${rk}-${sd} L${f} ${cell}</b> <span class="badge ${st}">${statusText(st)}</span>
      <div style="margin-top:6px"><b class="num">${qty}</b> / ${LIMIT} units · ${new Set(rows.map(r => normJob(r.JOB_NO)).filter(Boolean)).size} jobs</div>
      <div class="hint-small" style="margin-top:2px">${esc(items.slice(0, 4).join(', ') || 'ว่าง')}${cells[k].trays && qty ? ` · ${cells[k].trays}` : ''}</div>
      <div class="hint-small" style="margin-top:6px">คลิกเพื่อดูรายละเอียด</div>`;
    card.hidden = false;
  });
  renderer.domElement.addEventListener('pointerleave', () => { setHover(null); $('stageCard').hidden = true; });
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; controls.autoRotate = false; $('spinBtn').setAttribute('aria-pressed', 'false'); });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const k = pick(e); if (k) openPos(...k.split('|'));
  });

  /* resize */
  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(stage);
  resize();

  /* overlay projection */
  const v = new T.Vector3();
  const place = (el, p) => {
    v.copy(p).project(camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1){ el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.left = ((v.x + 1) / 2 * stage.clientWidth) + 'px';
    el.style.top = ((1 - v.y) / 2 * stage.clientHeight) + 'px';
  };
  const loop = () => {
    if (!three.running) return;
    const now = performance.now(), rawDt = (now - lastT) / 1000, dt = Math.min(0.05, rawDt); lastT = now;
    stepWalkers(dt);
    if (anim.on){
      anim.t += Math.min(0.25, rawDt);   /* camera flights keep wall-clock time even on a slow PC */
      const p = ease(Math.min(1, anim.t / anim.dur));
      camera.position.lerpVectors(anim.p0, anim.p1, p);
      controls.target.lerpVectors(anim.t0, anim.t1, p);
      if (p >= 1) anim.on = false;
    }
    const ts = now / 1000;
    pulsing.forEach(c => { c.heat.material.opacity = c.heatOp * (0.55 + 0.45 * Math.sin(ts * 4.2)) + 0.05; });
    routeDots.forEach((m, i) => { m.material.opacity = 0.25 + 0.75 * Math.max(0, Math.sin(ts * 5 - i * 0.45)); });
    Object.values(beacons).forEach(b => { if (b.g.visible) b.beam.rotation.y = ts * 4; });
    litLamps.forEach(l => { const s = 0.5 + 0.5 * Math.sin(ts * (l.lamp.on === 'hold' ? 9 : 5)); l.lamp.glow.material.opacity = 0.2 + 0.35 * s; });
    if (walk.on) stepWalk(dt); else controls.update();
    renderer.render(scene, camera);
    sections.forEach(s => place(s.el, s.pos));
    benches.forEach(b => place(b.el, b.pos));
    stopTags.forEach(s => place(s.el, s.pos));
    litLamps.forEach(l => place(l.el, l.pos));
    requestAnimationFrame(loop);
  };

  const m4 = new T.Matrix4(), q0 = new T.Quaternion(), vp = new T.Vector3(), vs = new T.Vector3();
  let pulsing = [];
  three.mode = 'normal';     /* normal | fill (heatmap) | age (X-ray by days in store) */
  three.match = null;        /* search predicate: matching trays light up, everything else fades */
  three.update = rows => {
    three.rows = rows;
    if (three.transit && three.transit.size) rows = rows.filter(r => !three.transit.has(r._id));   /* trays still being carried are not on the shelf yet */
    const colors = { empty:cssVar('--empty'), normal:cssVar('--brand'), warning:cssVar('--warn'), over:cssVar('--danger') };
    const mode = three.mode, match = three.match;
    xray(mode !== 'normal' && !match);
    pulsing = [];
    three.hitKeys = [];
    let n = 0;
    Object.entries(cells).forEach(([k, c]) => {
      const [rk, sd, f, cell] = k.split('|');
      const pr = positionRows(rows, rk, sd, f, cell);
      const qty = sumQty(pr), st = getStatus(qty);
      c.qty = qty;
      const hz = isHoldZone(k);
      c.plate.material.color.set(hz && st !== 'over' ? '#E5484D' : colors[st]);
      c.plate.material.opacity = mode === 'normal' && !match && (st === 'warning' || st === 'over' || hz) ? .45 : 0;
      /* zone volume: heatmap colour, oldest-tray colour, search hit or smart-route target */
      const ages = mode === 'age' ? pr.map(rowAge).filter(d => d !== null) : [];
      const hit = match ? pr.some(match) : false;
      if (hit) three.hitKeys.push(k);
      let hc = null, hop = 0, pulse = false;
      if (three.routeKeys.has(k)){ hc = '#6EBE49'; hop = .4; pulse = true; }
      else if (hit){ hc = '#FFD43B'; hop = .38; pulse = true; }
      else if (!match && mode === 'fill'){ hc = heatHex(qty / LIMIT); hop = qty ? .2 + .42 * Math.min(1, qty / LIMIT) : .07; pulse = qty >= LIMIT; }
      else if (!match && mode === 'age' && ages.length){ const mx = Math.max(...ages); hc = AGE_HEX[ageClass(mx)]; hop = .32; pulse = mx >= 14; }
      c.heat.visible = !!hc; c.heatOp = hop; c.heat.material.opacity = hop;
      if (hc) c.heat.material.color.set(lin(hc));
      if (pulse) pulsing.push(c);
      /* split each row into trays: IM holds 8, FOF holds 32 */
      const list = [];
      pr.forEach(r => {
        const t = trayType(r), cap = TYPE_CAP[t];
        let left = num(r.QUANITY);
        while (left > 0){ const inTray = Math.min(cap, left); list.push({ t, fill: inTray / cap, r }); left -= inTray; }
      });
      const shown = Math.min(16, list.length);
      const g = groups[rk];
      for (let i = 0; i < shown; i++){
        /* fill stack 1 (left, seen from where people stand) up to TRAYS_PER_STACK, then stack 2 ... */
        const tr = list[i], stack = Math.floor(i / TRAYS_PER_STACK), lvl = i % TRAYS_PER_STACK, dir = sd === 'L' ? -1 : 1;
        const lx = c.zx + dir * (stack - (STACKS - 1) / 2) * SP, ly = c.top + 0.003 + lvl * (TH + 0.004) + TH / 2;
        vp.set(lx, ly, c.zz).applyMatrix4(g.matrixWorld);
        m4.compose(vp, q0, vs.set(TW, TH, TD)); trayBody.setMatrixAt(n, m4);
        const fw = Math.max(0.03, Math.min(1, tr.fill)) * (TW - 0.05);
        vp.set(lx, ly, c.zz + dir * (TD / 2 + 0.004)).applyMatrix4(g.matrixWorld);   /* label strip faces the side people stand on */
        m4.compose(vp, q0, vs.set(fw, TH * 0.45, 0.008)); trayLabel.setMatrixAt(n, m4);
        let bc = BODY_DARK, lc = TYPE_COLOR[tr.t];
        if (match){ if (match(tr.r)) lc = HIT_LABEL; else { bc = GHOST_BODY; lc = GHOST_LABEL; } }
        else if (mode === 'age') bc = AGE_COLOR[ageClass(rowAge(tr.r))];
        else if (isHeld(tr.r.JOB_NO)) bc = HOLD_BODY;
        trayBody.setColorAt(n, bc);
        trayLabel.setColorAt(n, lc);
        n++;
      }
      const im = list.filter(x => x.t === 'IM').length, fof = list.filter(x => x.t === 'FOF').length;
      const pct = Math.round(qty / LIMIT * 100);
      const heldN = new Set(pr.filter(r => isHeld(r.JOB_NO)).map(r => normJob(r.JOB_NO))).size;
      drawLabel(c, `${rk}-${sd}·${f}·${cell}`, qty, pct, st, list.length > 16 ? ` · +${list.length - 16} ถาด` : '', heldN, zoneText(k, true), hz);
      c.trays = `${list.length} ถาด (IM ${im} · FOF ${fof})`;
    });
    trayBody.count = n; trayLabel.count = n;
    trayBody.instanceMatrix.needsUpdate = true; trayLabel.instanceMatrix.needsUpdate = true;
    if (trayLabel.instanceColor) trayLabel.instanceColor.needsUpdate = true;
    if (trayBody.instanceColor) trayBody.instanceColor.needsUpdate = true;
    /* Andon beacon spins on top of a rack that has a zone over the limit */
    if (three.beacons) ['A', 'B'].forEach(rk => { three.beacons[rk].g.visible = !!three.ambience && Object.values(cells).some(c => c.rk === rk && c.qty >= LIMIT); });
    $('rack3dSummary').innerHTML = RACK_SIDES.map(key => {
      const [rk, sd] = key.split('-');
      const q = sumQty(rows.filter(r => r.RACK === rk && r.SIDE === sd));
      return `<span>Rack ${key} <b>${fmt(q)}</b> units · ${Math.round(q / (FLOORS.length * CELLS.length * LIMIT) * 100)}%</span>`;
    }).join('');
  };
  three.applyTheme = () => {
    const dark = isDark();
    const bg = dark ? '#0B1117' : '#E2E7EB';
    scene.background = lin(bg);
    scene.fog = new T.Fog(lin(bg), 18, 38);
    floorMat.color.copy(lin(dark ? '#18222B' : '#CCD4DB'));
    if (three.rows) three.update(three.rows);
  };
  three.applyTheme();
  three.go = go;
  three.scene = scene;
  three.controls = controls;
  three.loop = loop;
  three.resize = resize;
}
function start3D(){ if (!three.ready || three.running) return; three.running = true; three.resize(); requestAnimationFrame(three.loop); }
function stop3D(){ three.running = false; }

/* ===================== 3D: SEARCH & FLY · COLOUR MODES · LEGEND ===================== */
const MODE_LEGEND = {
  normal: `<span><i style="background:var(--empty)"></i>Empty</span><span><i style="background:var(--brand)"></i>Normal</span><span><i style="background:var(--warn)"></i>Warning</span><span><i style="background:var(--danger)"></i>Over</span>
    <span><i style="background:#2F6FD6"></i>ถาด IM (8 ชิ้น)</span><span><i style="background:#8B4FD0"></i>ถาด FOF (32 ชิ้น)</span><span><i style="background:#0B9E8A"></i>ไม่ระบุชนิดถาด</span>`,
  fill: `<span class="ramp"><i></i></span><span>0%</span><span>75% (Warning)</span><span>100% (Over · กะพริบ)</span><span class="hint-small">โครงแร็กโปร่งใสเพื่อให้เห็นทะลุ</span>`,
  age: `<span><i style="background:#2FA84F"></i>&lt; 7 วัน</span><span><i style="background:#E3A008"></i>7–13 วัน</span><span><i style="background:#E5484D"></i>≥ 14 วัน (กะพริบ)</span><span><i style="background:#7A8794"></i>ไม่มี Received Date</span>`,
  search: `<span><i style="background:#FFD43B"></i>ตรงกับคำค้น</span><span><i style="background:#D3D9DE"></i>อื่นๆ (จางลง)</span>`,
  pick: `<span><i style="background:#FFD43B"></i>ถาดที่ต้องหยิบ</span><span><i style="background:#6EBE49"></i>จุดหยิบ + เส้นทางเดิน (เลข = ลำดับ)</span><span><i style="background:#D3D9DE"></i>อื่นๆ</span>`,
};
function renderLegend(){ $('stageLegend').innerHTML = three.match === pickMatch ? MODE_LEGEND.pick : MODE_LEGEND[three.match ? 'search' : (three.mode || 'normal')]; }
function setMode(m){
  document.querySelectorAll('#modeSeg [data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  three.mode = m;
  renderLegend();
  if (three.ready) three.update(three.rows || filteredData());
}
let flyHits = [], flyIdx = 0;
function flySearch(q, via){
  q = String(q || '').trim();
  if (!q){ clearFly(); return; }
  if (!three.ready){ showToast('3D ยังไม่พร้อม', 'รอให้โมเดล 3D โหลดเสร็จก่อน', 'info'); return; }
  if (pick.open) closePick();
  const ql = q.toLowerCase();
  const match = r => [r.JOB_NO, r.ITEM, r.PRODUCT, itemName(r)].some(v => String(v || '').toLowerCase().includes(ql));
  three.match = match;
  three.update(three.rows || filteredData());
  const rows = (three.rows || []).filter(match);
  const byKey = {};
  rows.forEach(r => { const k = `${r.RACK}|${r.SIDE}|${r.FLOOR}|${String(r.CELL).toUpperCase()}`; (byKey[k] ||= { k, qty:0, jobs:new Set() }); byKey[k].qty += num(r.QUANITY); if (r.JOB_NO) byKey[k].jobs.add(r.JOB_NO); });
  flyHits = Object.values(byKey).filter(h => three.hitKeys.includes(h.k)).sort((a, b) => b.qty - a.qty);
  $('flyClear').hidden = false;
  renderLegend();
  if (!flyHits.length){
    $('flyResults').innerHTML = `<b>ไม่พบ "${esc(q)}"</b><span class="hint-small">ใน Store ที่แสดงอยู่ (ตัวกรองหรือ Time Machine อาจซ่อนไว้)</span>`;
    $('flyResults').hidden = false; return;
  }
  $('flyResults').innerHTML = `<b>พบ "${esc(q)}" ${fmt(sumQty(rows))} ชิ้น ใน ${flyHits.length} ช่อง</b>
    <div class="fr-list">${flyHits.map((h, i) => `<button type="button" data-fly="${i}" class="${i === 0 ? 'on' : ''}"><span>${keyTxt(h.k)}</span><b>${h.qty}</b><small>${esc([...h.jobs].slice(0, 3).join(', '))}</small></button>`).join('')}</div>`;
  $('flyResults').hidden = false;
  flyIdx = 0; three.flyTo(flyHits[0].k);
  kzFindDone(via || 'search');
}
function clearFly(){
  $('flyBox').value = ''; $('flyClear').hidden = true; $('flyResults').hidden = true; flyHits = [];
  if (three.ready && three.match && three.match !== pickMatch){ three.match = null; three.update(three.rows || filteredData()); }
  renderLegend();
}
function refreshFlyList(){
  const vals = new Set();
  store.forEach(r => { if (r.JOB_NO) vals.add(r.JOB_NO); if (r.ITEM) vals.add(r.ITEM); });
  $('flyList').innerHTML = [...vals].sort().slice(0, 400).map(v => `<option value="${esc(v)}">`).join('');
}

/* ===================== TIME MACHINE ===================== */
const tm = { active:false, T:0, playing:false, raf:0 };
const tmTimeOf = v => { const lo = tmMin(), hi = Date.now(); return lo + (hi - lo) * v / 1000; };
const fmtWhen = ms => new Date(ms).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
function tmSet(v){
  v = Math.max(0, Math.min(1000, Math.round(v)));
  $('tmRange').value = v;
  if (v >= 1000){ tmLive(); return; }
  tm.active = true; tm.T = tmTimeOf(v);
  const rows = rowsAt(tm.T);
  $('tmTime').textContent = fmtWhen(tm.T);
  $('tmLive').hidden = false;
  $('tmBadge').innerHTML = `⏱ ย้อนเวลา · <b>${fmtWhen(tm.T)}</b> · ${fmt(sumQty(rows))} ชิ้น`;
  $('tmBadge').hidden = false;
  $('stagePanel').classList.add('tm-on');
  if (three.ready) three.update(rows);
}
function tmLive(){
  tm.active = false; tmStop();
  $('tmRange').value = 1000; $('tmTime').textContent = 'ตอนนี้ (Live)'; $('tmLive').hidden = true; $('tmBadge').hidden = true;
  $('stagePanel').classList.remove('tm-on');
  if (three.ready) three.update(filteredData());
}
function tmStop(){ tm.playing = false; cancelAnimationFrame(tm.raf); $('tmPlay').textContent = '▶ เล่น'; }
function tmPlay(){
  if (tm.playing){ tmStop(); return; }
  if (!histLog.length){ showToast('ยังไม่มีประวัติ', 'ระบบเริ่มเก็บประวัติแล้ว จะย้อนดูได้หลังมีการเพิ่ม ย้าย หรือแก้ไขงาน', 'info'); return; }
  let v = Number($('tmRange').value); if (v >= 1000) v = 0;
  tm.playing = true; $('tmPlay').textContent = '❚❚ หยุด';
  let last = performance.now();
  const step = now => {
    if (!tm.playing) return;
    v += (now - last) / 12000 * 1000; last = now;   /* whole history in ~12 s */
    if (v >= 1000){ tmLive(); return; }
    tmSet(v); tm.raf = requestAnimationFrame(step);
  };
  tm.raf = requestAnimationFrame(step);
}

/* ===================== INSIGHTS: FORECAST ===================== */
const DAY = 864e5;
const posKeys = () => RACK_SIDES.flatMap(key => { const [rk, sd] = key.split('-'); return FLOORS.flatMap(f => CELLS.map(c => `${rk}|${sd}|${f}|${c}`)); });
const qtyBy = (rows, pred) => rows.reduce((a, r) => a + (pred(r) ? num(r.QUANITY) : 0), 0);
function forecastData(){
  const now = Date.now(), start = histStart || now;
  const win = Math.min(14, (now - start) / DAY);
  if (win < 1 || !histLog.length) return { ready:false, start };
  const from = now - win * DAY;
  /* net change per position over the window -> units per day */
  const net = {};
  histLog.forEach(e => {
    if (e.t <= from) return;
    if (e.f){ const k = packPos(e.f); net[k] = (net[k] || 0) + e.f[4]; }
    if (e.b){ const k = packPos(e.b); net[k] = (net[k] || 0) - e.b[4]; }
  });
  const cur = {};
  store.forEach(r => { const k = `${r.RACK}|${r.SIDE}|${r.FLOOR}|${String(r.CELL).toUpperCase()}`; cur[k] = (cur[k] || 0) + num(r.QUANITY); });
  const locs = posKeys().map(k => {
    const rate = (net[k] || 0) / win, q = cur[k] || 0;
    const days = q >= LIMIT ? 0 : rate > 0.05 ? (LIMIT - q) / rate : null;
    return { k, q, rate, days };
  });
  const soon = locs.filter(l => l.days !== null).sort((a, b) => a.days - b.days);
  const racks = ['A', 'B'].map(rk => {
    const cap = RACK_SIDES.filter(s => s.startsWith(rk + '-')).length * FLOORS.length * CELLS.length * LIMIT;
    const q = qtyBy(store, r => r.RACK === rk);
    const rate = locs.filter(l => l.k.startsWith(rk + '|')).reduce((a, l) => a + l.rate, 0);
    return { rk, cap, q, rate, days: rate > 0.05 ? (cap - q) / rate : null };
  });
  /* end-of-day totals for the chart */
  const series = { A:[], B:[] };
  const nDays = Math.ceil(win);
  for (let i = nDays; i >= 0; i--){
    const d = new Date(now - i * DAY); d.setHours(23, 59, 59, 999);
    const t = Math.min(now, d.getTime()), rows = rowsAt(t);
    series.A.push([t, qtyBy(rows, r => r.RACK === 'A')]); series.B.push([t, qtyBy(rows, r => r.RACK === 'B')]);
  }
  return { ready:true, start, win, soon, racks, series };
}
const daysTxt = d => d === null ? 'ไม่เพิ่มขึ้น' : d <= 0 ? 'เต็มแล้ว' : d < 1 ? 'ภายในวันนี้' : `~${d < 10 ? d.toFixed(1) : Math.round(d)} วัน`;
const keyTxt = k => { const [rk, sd, f, c] = k.split('|'); return `${rk}-${sd} ชั้น ${f} ${c}`; };
function lineChartSVG(lines, yMax){
  const Wd = 560, Ht = 190, L = 40, R = 12, Tp = 12, B = 26;
  const xs = lines.flatMap(l => l.pts.map(p => p[0])), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ym = Math.max(10, yMax || Math.max(...lines.flatMap(l => l.pts.map(p => p[1])))) * 1.12;
  const X = x => L + (x - x0) / ((x1 - x0) || 1) * (Wd - L - R), Y = y => Tp + (1 - y / ym) * (Ht - Tp - B);
  const grid = [0, .25, .5, .75, 1].map(f => { const y = ym * f; return `<line x1="${L}" x2="${Wd - R}" y1="${Y(y)}" y2="${Y(y)}" class="gl"/><text x="${L - 6}" y="${Y(y) + 4}" text-anchor="end">${Math.round(y)}</text>`; }).join('');
  const dl = t => new Date(t).toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
  const xl = [x0, (x0 + x1) / 2, x1].map((t, i) => `<text x="${X(t)}" y="${Ht - 6}" text-anchor="${['start', 'middle', 'end'][i]}">${dl(t)}</text>`).join('');
  const paths = lines.map(l => `<path d="${l.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="${l.color}" stroke-width="${l.dash ? 2 : 2.6}" ${l.dash ? 'stroke-dasharray="5 5"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="กราฟจำนวนชิ้นในแต่ละแร็ก">${grid}${xl}${paths}</svg>`;
}
function renderForecast(){
  const fd = forecastData(), el = $('forecastBody');
  if (!fd.ready){
    el.innerHTML = `<div class="empty-ins"><b>กำลังสะสมข้อมูล</b><span>เริ่มเก็บประวัติเมื่อ ${fmtStamp(new Date(fd.start).toISOString())} · ต้องมีประวัติการเข้า–ออกอย่างน้อย 1 วันจึงพยากรณ์ได้ ยิ่งนานยิ่งแม่น</span></div>`;
    return;
  }
  const COL = { A:'#3B82C4', B:'#8B5CF6' };
  const lines = [];
  fd.racks.forEach(r => {
    const pts = fd.series[r.rk];
    lines.push({ color: COL[r.rk], pts });
    if (r.rate > 0.05){ const [t, q] = pts[pts.length - 1]; lines.push({ color: COL[r.rk], dash:true, pts:[[t, q], [t + 7 * DAY, Math.min(r.cap, q + r.rate * 7)]] }); }
  });
  el.innerHTML = `
    <div class="fc-racks">${fd.racks.map(r => `<div class="fc-rack" style="--c:${COL[r.rk]}"><span>Rack ${r.rk}</span><b>${daysTxt(r.days)}</b><small>${fmt(r.q)}/${fmt(r.cap)} ชิ้น · ${r.rate >= 0 ? '+' : ''}${r.rate.toFixed(1)} ชิ้น/วัน</small></div>`).join('')}</div>
    ${lineChartSVG(lines)}
    <div class="chart-legend"><span><i style="background:${COL.A}"></i>Rack A</span><span><i style="background:${COL.B}"></i>Rack B</span><span><i class="dash"></i>คาดการณ์ 7 วัน</span></div>
    <div class="sum-title" style="margin-top:12px">ช่องที่จะเต็มเร็วที่สุด</div>
    ${fd.soon.length ? `<div class="fc-soon">${fd.soon.slice(0, 4).map(l => `<button type="button" data-flykey="${l.k}"><span>${keyTxt(l.k)}</span><b class="${l.days < 3 ? 'bad' : l.days < 7 ? 'warn' : ''}">${daysTxt(l.days)}</b><small>${l.q}/${LIMIT} · +${l.rate.toFixed(1)}/วัน</small></button>`).join('')}</div>` : '<p class="hint-small">ไม่มีช่องไหนที่จำนวนเพิ่มขึ้นในช่วงนี้</p>'}
    <p class="hint-small">อิงข้อมูล ${fd.win.toFixed(1)} วันล่าสุด · คลิกช่องเพื่อบินไปดูใน 3D</p>`;
}

/* ===================== INSIGHTS: TESTER STATS ===================== */
const TESTER_COLORS = { T1:'#3B82C4', T2:'#6EBE49', T3:'#E3A008', '':'#9AA6B1' };
const shiftStartOf = ms => { const d = new Date(ms), h = d.getHours(); const s = new Date(d); s.setMinutes(0, 0, 0); if (h >= 6 && h < 18) s.setHours(6); else if (h >= 18) s.setHours(18); else { s.setDate(s.getDate() - 1); s.setHours(18); } return s.getTime(); };
const dayStartOf = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
let statBy = 'day';
const trayCount = p => Math.ceil(p[4] / ({ IM:8, FOF:32 }[String(p[10] || p[5]).toUpperCase()] || 8));
function renderStats(){
  const el = $('statBody');
  const adds = histLog.filter(e => e.a === 'add' && e.f && e.f[4] > 0 && e.src !== 'external');
  if (!adds.length){ el.innerHTML = '<div class="empty-ins"><b>ยังไม่มีข้อมูลการนำงานเข้า</b><span>ใช้ฟอร์ม "รับงานเข้า Store" แล้วเลือก Tester · สถิติจะขึ้นที่นี่</span></div>'; return; }
  const N = 14, now = Date.now();
  const bucketOf = statBy === 'day' ? dayStartOf : shiftStartOf, stepMs = statBy === 'day' ? DAY : DAY / 2;
  const last = bucketOf(now), buckets = [];
  for (let i = N - 1; i >= 0; i--) buckets.push(last - i * stepMs);
  const data = Object.fromEntries(buckets.map(b => [b, { T1:0, T2:0, T3:0, '':0 }]));
  const tot = { T1:{ q:0, tr:0, jobs:new Set() }, T2:{ q:0, tr:0, jobs:new Set() }, T3:{ q:0, tr:0, jobs:new Set() }, '':{ q:0, tr:0, jobs:new Set() } };
  adds.forEach(e => {
    const t = TESTERS.includes(e.f[8]) ? e.f[8] : '';
    const b = bucketOf(e.t);
    if (data[b]) data[b][t] += e.f[4];
    if (e.t > last - (N - 1) * stepMs){ tot[t].q += e.f[4]; tot[t].tr += trayCount(e.f); if (e.f[6]) tot[t].jobs.add(normJob(e.f[6])); }
  });
  const keys = ['T1', 'T2', 'T3', ''];
  const mx = Math.max(8, ...buckets.map(b => keys.reduce((a, k) => a + data[b][k], 0)));
  const label = b => { const d = new Date(b); const dd = d.toLocaleDateString('en-GB', { day:'2-digit', month:'short' }); if (statBy === 'day') return dd; const s = shiftInfo(new Date(b + 36e5)); return `${dd} ${d.getHours() === 6 ? '☀' : '☾'}${s ? s.crew : ''}`; };
  el.innerHTML = `
    <div class="st-tot">${keys.filter(k => k || tot[k].q).map(k => `<div style="--c:${TESTER_COLORS[k]}"><span>${k || 'ไม่ระบุ'}</span><b>${fmt(tot[k].q)}</b><small>ชิ้น · ${tot[k].tr} ถาด · ${tot[k].jobs.size} งาน</small></div>`).join('')}</div>
    <div class="bars">${buckets.map(b => { const sum = keys.reduce((a, k) => a + data[b][k], 0); return `<div class="bar-col" title="${label(b)} · ${keys.map(k => `${k || 'ไม่ระบุ'} ${data[b][k]}`).join(' · ')}">
      <div class="bar-stack">${keys.map(k => data[b][k] ? `<i style="height:${data[b][k] / mx * 100}%;background:${TESTER_COLORS[k]}"></i>` : '').join('')}</div>
      <b>${sum || ''}</b><span>${label(b)}</span></div>`; }).join('')}</div>
    <p class="hint-small">${statBy === 'day' ? '14 วันล่าสุด' : '14 กะล่าสุด (☀ เช้า 06–18 · ☾ ดึก 18–06)'} · นับเฉพาะงานที่รับเข้า (ชิ้น)</p>`;
}

/* ===================== INSIGHTS: SHIFT HANDOVER ===================== */
let hoOffset = 0;
function handoverData(){
  const start = shiftStartOf(Date.now()) - hoOffset * DAY / 2, end = start + DAY / 2;
  const s = shiftInfo(new Date(start + 36e5));
  const ev = histLog.filter(e => e.t >= start && e.t < end && e.src !== 'external');
  const adds = ev.filter(e => e.a === 'add'), moves = ev.filter(e => e.a === 'move'), dels = ev.filter(e => e.a === 'del'), edits = ev.filter(e => e.a === 'edit' || e.a === 'relocate');
  const byT = {}; adds.forEach(e => { const t = e.f[8] || 'ไม่ระบุ'; byT[t] = (byT[t] || 0) + e.f[4]; });
  const locs = aggregateByLocation(store);
  const over = locs.filter(l => l.qty >= LIMIT), warn = locs.filter(l => l.qty >= WARN_AT && l.qty < LIMIT);
  const aging = storeJobs(store).map(j => ({ ...j, days: daysBetween(parseFlexibleDate(j.detail && j.detail['Received Date'])) })).filter(j => j.days !== null && j.days >= 14).sort((a, b) => b.days - a.days);
  const fd = forecastData();
  const total = sumQty(store), cap = TOTAL_STORE_LOCATIONS * LIMIT;
  return { start, end, s, adds, moves, dels, edits, addQty: adds.reduce((a, e) => a + e.f[4], 0), moveQty: moves.reduce((a, e) => a + e.f[4], 0), delQty: dels.reduce((a, e) => a + e.b[4], 0), byT, over, warn, aging, soon: fd.ready ? fd.soon.slice(0, 2) : [], total, cap };
}
function handoverText(h){
  const when = new Date(h.start).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  const shiftName = h.s ? `กะ ${h.s.crew} · ${h.s.isDay ? 'เช้า 06:00–18:00' : 'ดึก 18:00–06:00'}` : '';
  const L = [
    '📋 Resonance Store · รายงานส่งกะ',
    `${shiftName} · ${when}`,
    `ผู้ส่งกะ: ${editor() || '-'}`,
    '',
    `▶ รับงานเข้า: ${h.adds.length} รายการ · ${fmt(h.addQty)} ชิ้น${Object.keys(h.byT).length ? ` (${Object.entries(h.byT).map(([t, q]) => `${t} ${q}`).join(' · ')})` : ''}`,
    `▶ ย้าย IN → OUT: ${h.moves.length} รายการ · ${fmt(h.moveQty)} ชิ้น`,
    `▶ นำออก / ลบ: ${h.dels.length} รายการ · ${fmt(h.delQty)} ชิ้น`,
    `▶ แก้ไขข้อมูล: ${h.edits.length} ครั้ง`,
    '',
    `สถานะ Store ตอนนี้: ${fmt(h.total)}/${fmt(h.cap)} ชิ้น (${Math.round(h.total / h.cap * 100)}%)`,
    h.over.length ? `🔴 เกินกำหนด: ${h.over.map(l => `${l.location} (${l.qty})`).join(', ')}` : '🟢 ไม่มีช่องเกินกำหนด',
    h.warn.length ? `🟡 ใกล้เต็ม: ${h.warn.map(l => `${l.location} (${l.qty})`).join(', ')}` : '',
    h.aging.length ? `⏳ ค้างเกิน 14 วัน: ${h.aging.length} งาน (${h.aging.slice(0, 5).map(j => `${j.jobNo} ${j.days} วัน`).join(', ')}${h.aging.length > 5 ? ' …' : ''})` : '⏳ ไม่มีงานค้างเกิน 14 วัน',
    Object.keys(holdData).length ? `🔒 งาน Hold ห้าม Scrap: ${Object.entries(holdData).map(([k, x]) => `${k} (${x.reason})`).join(', ')}` : '',
    h.soon.length ? `📈 ช่องที่จะเต็มเร็วสุด: ${h.soon.map(l => `${keyTxt(l.k)} ${daysTxt(l.days)}`).join(', ')}` : '',
  ];
  return L.filter((x, i) => x !== '' || (L[i - 1] !== '' && i)).join('\n').trim();
}
function renderHandover(){
  const h = handoverData();
  const when = `${fmtWhen(h.start)} – ${new Date(Math.min(h.end, Date.now())).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}`;
  const tile = (label, n, q, cls) => `<div class="ho-tile ${cls || ''}"><span>${label}</span><b>${n}</b><small>${q}</small></div>`;
  $('hoBody').innerHTML = `
    <div class="ho-shift">${h.s ? `<b>กะ ${h.s.crew}</b> ${h.s.isDay ? '☀ เช้า' : '☾ ดึก'}` : ''} <span>${when}${hoOffset === 0 ? ' (ถึงตอนนี้)' : ''}</span></div>
    <div class="ho-tiles">
      ${tile('รับงานเข้า', h.adds.length, `${fmt(h.addQty)} ชิ้น`, 'in')}
      ${tile('ย้าย IN → OUT', h.moves.length, `${fmt(h.moveQty)} ชิ้น`, 'mv')}
      ${tile('นำออก / ลบ', h.dels.length, `${fmt(h.delQty)} ชิ้น`, 'out')}
      ${tile('แก้ไข', h.edits.length, 'ครั้ง')}
    </div>
    ${Object.keys(h.byT).length ? `<div class="ho-line">รับเข้าตาม Tester: ${Object.entries(h.byT).map(([t, q]) => `<span class="pill" style="--c:${TESTER_COLORS[t] || '#9AA6B1'}">${esc(t)} · ${q} ชิ้น</span>`).join(' ')}</div>` : ''}
    <div class="ho-line">${h.over.length ? `<span class="badge over">OVER</span> ${h.over.map(l => esc(`${l.location} (${l.qty})`)).join(', ')}` : '<span class="badge normal">OK</span> ไม่มีช่องเกินกำหนด'}</div>
    ${h.warn.length ? `<div class="ho-line"><span class="badge warning">WARNING</span> ${h.warn.map(l => esc(`${l.location} (${l.qty})`)).join(', ')}</div>` : ''}
    <div class="ho-line">${h.aging.length ? `<span class="days-badge days-danger">≥14 วัน</span> ${h.aging.length} งาน: ${h.aging.slice(0, 5).map(j => esc(`${j.jobNo} (${j.days} วัน)`)).join(', ')}${h.aging.length > 5 ? ' …' : ''}` : '<span class="days-badge days-ok">อายุงาน</span> ไม่มีงานค้างเกิน 14 วัน'}</div>
    ${h.soon.length ? `<div class="ho-line">📈 จะเต็มเร็วสุด: ${h.soon.map(l => `${keyTxt(l.k)} <b>${daysTxt(l.days)}</b>`).join(', ')}</div>` : ''}`;
}
function handoverPNG(){
  const text = handoverText(handoverData()).split('\n');
  const c = document.createElement('canvas'), sc = 2, Wd = 860, lh = 30, Ht = 120 + text.length * lh;
  c.width = Wd * sc; c.height = Ht * sc;
  const g = c.getContext('2d'); g.scale(sc, sc);
  const font = '"IBM Plex Sans Thai","Leelawadee UI","Segoe UI",Tahoma,sans-serif';
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, Wd, Ht);
  g.fillStyle = '#111814'; g.fillRect(0, 0, Wd, 74);
  g.fillStyle = '#6EBE49'; g.fillRect(0, 74, Wd, 5);
  g.fillStyle = '#FFFFFF'; g.font = `700 26px ${font}`; g.fillText('RESONANCE STORE · Shift Handover', 28, 46);
  g.fillStyle = '#93A19A'; g.font = `500 14px ${font}`; g.textAlign = 'right'; g.fillText(fmtStamp(new Date().toISOString()), Wd - 28, 46); g.textAlign = 'left';
  text.slice(1).forEach((line, i) => {
    g.fillStyle = line.startsWith('🔴') ? '#AE2B2B' : line.startsWith('🟡') ? '#8F6200' : '#111814';
    g.font = `${i < 2 ? 600 : 500} ${i === 0 ? 19 : 17}px ${font}`;
    let s = line; while (g.measureText(s).width > Wd - 56 && s.length > 10) s = s.slice(0, -2);
    g.fillText(s === line ? s : s + '…', 28, 112 + i * lh);
  });
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `handover_${stamp()}_${new Date().getHours() >= 6 && new Date().getHours() < 18 ? 'day' : 'night'}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  showToast('บันทึกรูปแล้ว', 'แนบรูปนี้ในแชท Teams ได้เลย');
}

/* ===================== INSIGHTS: AUDIT LOG ===================== */
const ACTION_TEXT = { add:'รับเข้า', del:'นำออก / ลบ', move:'ย้าย IN → OUT', relocate:'ย้ายตำแหน่ง', edit:'แก้ไข' };
const SRC_TEXT = { form:'ฟอร์มรับงาน', move:'ปุ่มย้าย', entry:'Data Entry', import:'Import ไฟล์', reset:'Reset', external:'แก้จากที่อื่น', undo:'Undo', redo:'Redo', pick:'Pick List' };
const HOLD_TEXT = { hold:'🔒 ติด Hold', release:'ปลด Hold', block:'⛔ กัน Hold' };
function logRows(){
  const q = $('logSearch').value.toLowerCase().trim();
  const out = [];
  for (let i = histLog.length - 1; i >= 0; i--){
    const e = histLog[i], p = e.f || e.b;
    out.push({ e, when: fmtStamp(new Date(e.t).toISOString()), act: ACTION_TEXT[e.a] || e.a, job: p[6], item: p[7] || [p[9], p[5]].filter(Boolean).join('_'), from: e.b ? packLoc(e.b) : '', to: e.f ? packLoc(e.f) : '',
      qty: e.a === 'add' ? `+${e.f[4]}` : e.a === 'del' ? `-${e.b[4]}` : e.b[4] !== e.f[4] ? `${e.b[4]} → ${e.f[4]}` : String(e.f[4]), tester: p[8], ed: e.ed || '', src: SRC_TEXT[e.src] || e.src || '' });
  }
  /* hold events: "item" carries the reason, "ที่มา" who approved / held it */
  holdLog.forEach(e => out.push({ e, when: fmtStamp(new Date(e.t).toISOString()), act: HOLD_TEXT[e.a] || e.a, job: e.job, item: e.reason || '', from: '', to: '', qty: '', tester: '',
    ed: e.ed || '', src: e.a === 'block' ? 'ระบบบล็อก' : e.a === 'release' ? `อนุมัติโดย ${e.by || '-'}` : `Hold โดย ${e.by || '-'}` }));
  out.sort((a, b) => b.e.t - a.e.t);
  return q ? out.filter(row => Object.values(row).some(v => typeof v === 'string' && v.toLowerCase().includes(q))) : out;
}
function renderLog(){
  const rows = logRows(), shown = rows.slice(0, 300);
  const head = '<thead><tr><th>เวลา</th><th>การกระทำ</th><th>Job No.</th><th>Item</th><th>จาก</th><th>ไป</th><th>จำนวน</th><th>Tester</th><th>ผู้บันทึก</th><th>ที่มา</th></tr></thead>';
  $('logTable').innerHTML = head + '<tbody>' + (shown.map(r => `<tr><td>${r.when}</td><td><span class="act act-${r.e.a}">${r.act}</span></td><td><b>${esc(r.job || '-')}</b></td><td>${esc(r.item || '-')}</td><td>${esc(r.from || '-')}</td><td>${esc(r.to || '-')}</td><td class="n"><b>${esc(r.qty)}</b></td><td>${esc(r.tester || '-')}</td><td>${esc(r.ed || '-')}</td><td class="muted-cell">${esc(r.src)}</td></tr>`).join('')
    || `<tr><td colspan="10" class="empty-table">${histLog.length || holdLog.length ? 'ไม่พบรายการที่ตรงกับคำค้น' : 'ยังไม่มีประวัติ · ทุกการเพิ่ม ย้าย แก้ไข หรือลบหลังจากนี้จะถูกบันทึกที่นี่'}</td></tr>`) + '</tbody>';
  let kb = 0; try { kb = Math.round((localStorage.getItem('resLogV1') || '').length / 1024); } catch {}
  $('logNote').textContent = `เริ่มเก็บประวัติ ${histStart ? fmtStamp(new Date(histStart).toISOString()) : '-'} · เก็บย้อนหลัง ${LOG_DAYS} วัน · ${fmt(histLog.length)} รายการ (${kb} KB)${rows.length > shown.length ? ` · แสดง 300 รายการล่าสุด กด Export เพื่อดูทั้งหมด` : ''}`;
}
function exportLog(){
  const cols = ['Time', 'Action', 'Job No.', 'Item', 'From', 'To', 'Qty', 'Tester', 'Editor', 'Source'];
  const rows = logRows().map(r => ({ Time:r.when, Action:r.act, 'Job No.':r.job, Item:r.item, From:r.from, To:r.to, Qty:r.qty, Tester:r.tester, Editor:r.ed, Source:r.src }));
  downloadFile(`resonance_audit_${stamp()}.csv`, toCSV(cols, rows));
  showToast('Export สำเร็จ', `${rows.length} รายการ`);
}
function renderInsights(){
  if (currentTab !== 'insights') return;
  renderHandover(); renderForecast(); renderStats(); renderLog();
  renderKaizen(); renderCycle(); renderOwners();
}

/* ===================== TV / KIOSK MODE ===================== */
const kiosk = { on:false, prevTab:'3d', clock:0, tour:0, idx:0 };
function enterKiosk(){
  if (!three.ready){ showToast('3D ยังไม่พร้อม', 'รอให้โมเดล 3D โหลดเสร็จก่อน', 'info'); return; }
  if (three.walking()) three.walkStop();
  kiosk.on = true; kiosk.prevTab = currentTab;
  if (currentTab !== '3d') setTab('3d');
  tmLive(); clearFly();
  document.body.classList.add('kiosk'); $('kioskHud').hidden = false;
  try { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch {}
  three.go('home'); three.controls.autoRotate = true;
  renderKiosk(); kioskClock();
  kiosk.clock = setInterval(kioskClock, 1000);
  kiosk.tour = setInterval(kioskTour, 9000);
}
function exitKiosk(){
  if (!kiosk.on) return;
  kiosk.on = false;
  clearInterval(kiosk.clock); clearInterval(kiosk.tour);
  document.body.classList.remove('kiosk'); $('kioskHud').hidden = true; $('kFocus').hidden = true;
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  three.controls.autoRotate = false; three.go('home');
  setTab(kiosk.prevTab);
  setTimeout(() => three.resize(), 50);
}
function kioskClock(){
  const d = new Date();
  $('kClock').textContent = d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const s = shiftInfo(d);
  $('kShift').textContent = `${d.toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short' })}${s ? ` · กะ ${s.crew} ${s.isDay ? 'เช้า' : 'ดึก'}` : ''}`;
}
/* tour: every other tick fly to the next busiest zone and show its card, then back to the slow orbit */
function kioskTour(){
  if (!kiosk.on) return;
  const busy = posKeys().map(k => { const [rk, sd, f, c] = k.split('|'); return { k, q: sumQty(positionRows(store, rk, sd, f, c)) }; }).filter(x => x.q > 0).sort((a, b) => b.q - a.q).slice(0, 6);
  kiosk.idx++;
  if (kiosk.idx % 2 === 1 && busy.length){
    const z = busy[Math.floor(kiosk.idx / 2) % busy.length], [rk, sd, f, c] = z.k.split('|'), st = getStatus(z.q);
    const rows = positionRows(store, rk, sd, f, c);
    const jobsN = new Set(rows.map(r => normJob(r.JOB_NO)).filter(Boolean)).size;
    three.flyTo(z.k);
    $('kFocus').innerHTML = `<span>โฟกัสช่อง</span><b>${rk}-${sd} · ชั้น ${f} · ${c}</b><div class="kf-num"><b>${z.q}</b>/${LIMIT} ชิ้น <span class="badge ${st}">${statusText(st)}</span></div><div class="bar"><span style="width:${Math.min(100, z.q / LIMIT * 100)}%;background:${statusColor(st)}"></span></div><small>${jobsN} งาน · ${esc([...new Set(rows.map(itemName))].filter(x => x !== '-').slice(0, 3).join(', '))}</small>`;
    $('kFocus').hidden = false;
  } else {
    $('kFocus').hidden = true; three.go('home');
    setTimeout(() => { if (kiosk.on) three.controls.autoRotate = true; }, 1400);
  }
}
function renderKiosk(){
  if (!kiosk.on) return;
  const locs = aggregateByLocation(store), total = sumQty(store), cap = TOTAL_STORE_LOCATIONS * LIMIT;
  const over = locs.filter(l => l.qty >= LIMIT), warn = locs.filter(l => l.qty >= WARN_AT && l.qty < LIMIT);
  const aging = storeJobs(store).map(j => ({ ...j, days: daysBetween(parseFlexibleDate(j.detail && j.detail['Received Date'])) })).filter(j => j.days !== null && j.days >= 14);
  const k = (label, val, sub, cls) => `<div class="kk ${cls || ''}"><span>${label}</span><b>${val}</b><small>${sub}</small></div>`;
  $('kKpis').innerHTML = k('ในสโตร์', fmt(total), `${Math.round(total / cap * 100)}% ของ ${fmt(cap)}`)
    + k('งาน', fmt(storeJobs(store).length), 'Job No.')
    + k('Over', over.length, '≥ 80 ชิ้น/ช่อง', over.length ? 'bad' : '')
    + k('Warning', warn.length, '60–79 ชิ้น/ช่อง', warn.length ? 'warn' : '')
    + k('ค้าง ≥14 วัน', aging.length, 'งาน', aging.length ? 'bad' : '');
  /* Andon: stack light for the whole store + one lamp per rack side */
  const sideSt = rackCardStatuses(store);
  const worst = over.length ? 'red' : warn.length || aging.length ? 'yellow' : 'green';
  const lamp = s => s.status === 'over' ? 'red' : s.status === 'warning' ? 'yellow' : 'green';
  $('kAndon').innerHTML = `<div class="andon-tower" aria-label="สถานะรวม ${worst}">${['red', 'yellow', 'green'].map(c => `<i class="${c} ${c === worst ? 'on' : ''}"></i>`).join('')}<span></span></div>
    <div class="andon-lamps">${sideSt.map(s => `<div class="andon-lamp ${lamp(s)}"><i></i><b>${s.key}</b><small>สูงสุด ${s.maxQty}/${LIMIT}</small></div>`).join('')}</div>`;
  const recent = histLog.filter(e => e.a === 'add' || e.a === 'move').slice(-6).reverse()
    .map(e => `${new Date(e.t).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })} ${e.a === 'add' ? `${e.f[8] || ''} รับเข้า` : 'ย้าย → OUT'} ${e.f[6] || ''} ${e.f[4]} ชิ้น → ${packLoc(e.f)}`);
  const fd = forecastData();
  const items = [
    ...over.map(l => `<i class="bad">●</i> เกินกำหนด ${l.location} ${l.qty}/${LIMIT}`),
    ...warn.map(l => `<i class="warn">●</i> ใกล้เต็ม ${l.location} ${l.qty}/${LIMIT}`),
    ...aging.slice(0, 6).map(j => `<i class="bad">⏳</i> ${esc(j.jobNo)} ค้าง ${j.days} วัน`),
    ...(fd.ready ? fd.soon.slice(0, 2).map(l => `<i class="warn">📈</i> ${keyTxt(l.k)} จะเต็ม ${daysTxt(l.days)}`) : []),
    ...recent.map(t => `<i class="ok">●</i> ${esc(t)}`),
  ];
  if (!items.length) items.push('<i class="ok">●</i> Store ปกติ ไม่มีการแจ้งเตือน');
  const html = items.map(t => `<span>${t}</span>`).join('');
  $('kTicker').innerHTML = html + html;   /* doubled so the marquee loops seamlessly */
  $('kTicker').style.animationDuration = Math.max(20, items.length * 6) + 's';
}

/* ===================== QR LABELS ===================== */
let qrKind = 'loc';
const qrSVG = text => { if (!window.qrcode) return '<div class="hint-small">ไม่พบไลบรารี QR</div>'; const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize:4, margin:1, scalable:true }); };
function qrLabels(){
  if (qrKind === 'loc') return posKeys().map(k => { const [rk, sd, f, c] = k.split('|'); return { code:`RS:LOC:${rk}-${sd}-${f}-${c}`, big:`${rk}-${sd} · ชั้น ${f} · ${c}`, sub:`โซน ${zoneText(k, true)} · ${sideTxt(sd)} · ${cellTxt(c)} · Max ${LIMIT} ชิ้น`, hold: isHoldZone(k) ? 'HOLD ZONE · งาน Hold เท่านั้น' : '' }; });
  return storeJobs(store).map(j => {
    const h = holdData[j.key];
    return { code:`RS:JOB:${j.jobNo}`, big:j.jobNo, sub:`${j.items} · ${(j.detail && j.detail['Requester Name']) || ''}`.replace(/ · $/, ''), hold: h ? `HOLD · ห้าม Scrap · ${h.reason}` : '' };
  });
}
const qrLabelHTML = (l, cls) => `<div class="${cls}${l.hold ? ' hold' : ''}">${qrSVG(l.code)}<div>${l.hold ? `<i class="hb">🔒 ${esc(l.hold)}</i>` : ''}<b>${esc(l.big)}</b><span>${esc(l.sub)}</span><code>${esc(l.code)}</code></div></div>`;
async function openQR(){
  try { await loadLib('qrcode.js', 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', () => !!window.qrcode); } catch {}
  renderQR();
  if (!$('qrDialog').open) $('qrDialog').showModal();
}
function renderQR(){
  document.querySelectorAll('#qrSeg [data-qr]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.qr === qrKind)));
  const list = qrLabels();
  $('qrPreview').innerHTML = list.length ? list.map(l => qrLabelHTML(l, 'qr-label')).join('') : '<p class="hint-small">ยังไม่มีงานใน Store</p>';
}
function printQR(){
  const list = qrLabels(); if (!list.length) return;
  const w = window.open('', '_blank');
  if (!w){ showToast('เปิดหน้าพิมพ์ไม่ได้', 'อนุญาต Pop-up ให้หน้านี้ก่อน', 'error'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Resonance Store QR</title><style>
    @page{size:A4;margin:10mm} body{font-family:"IBM Plex Sans Thai","Segoe UI",Tahoma,sans-serif;margin:0}
    .g{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm} .l{border:1.5px solid #111;border-radius:3mm;padding:3mm;display:flex;gap:3mm;align-items:center;break-inside:avoid;border-top:3mm solid #E07A1E}
    .l svg{width:26mm;height:26mm;flex:none} b{display:block;font-size:15pt;line-height:1.1} span{display:block;font-size:8.5pt;color:#333;margin-top:1mm} code{font-size:7pt;color:#666}
    .l.hold{border:2px solid #C62828;border-top:3mm solid #C62828} .hb{display:block;background:#C62828;color:#fff;font-style:normal;font-weight:800;font-size:8.5pt;padding:.6mm 2mm;border-radius:1.5mm;margin-bottom:1mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  </style></head><body><div class="g">${list.map(l => qrLabelHTML(l, 'l')).join('')}</div>
  <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
  w.document.close();
}

/* ===================== ZONE SETUP (dialog + printable zone signs) ===================== */
const zList = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
function renderZoneDialog(z){
  $('zoneStackTxt').textContent = `${TRAYS_PER_STACK} ถาด · ${STACKS_PER_ZONE} ตั้ง/ช่อง · เริ่มตั้งที่ 1 ด้านซ้ายเมื่อยืนหน้าชั้น`;
  $('zoneBody').innerHTML = posKeys().map(k => {
    const c = z[k] || {}, [rk, sd, f, cl] = k.split('|'), pr = positionRows(store, rk, sd, f, cl);
    const now = [...new Set(pr.map(r => `${r.PRODUCT || '-'} · ${r.TYPE || '-'}`))];
    const wrong = pr.filter(r => rowZoneCheck(r)).length;
    return `<tr data-zk="${k}" class="${c.hold ? 'hold' : ''}">
      <td><b>${keyTxt(k)}</b><small>${sideTxt(sd)} · ${cellTxt(cl)}</small></td>
      <td><input type="checkbox" data-zf="hold" ${c.hold ? 'checked' : ''} aria-label="โซน HOLD ${keyTxt(k)}"></td>
      <td><input data-zf="prod" value="${esc((c.prod || []).join(', '))}" placeholder="* หรือ DORADO" ${c.hold ? 'disabled' : ''}></td>
      <td><input data-zf="type" value="${esc((c.type || []).join(', '))}" placeholder="EVL / QUL / FA / WKL / N/A" ${c.hold ? 'disabled' : ''}></td>
      <td><input data-zf="note" value="${esc(c.note || '')}"></td>
      <td class="${wrong ? 'bad' : ''}">${now.length ? esc(now.join(' | ')) : '<span class="muted">ว่าง</span>'}${wrong ? `<br><b>⚠ ผิดโซน ${wrong}</b>` : ''}</td></tr>`;
  }).join('');
}
function openZones(){ renderZoneDialog(zones); if (!$('zoneDialog').open) $('zoneDialog').showModal(); }
function readZoneDialog(){
  const z = {};
  document.querySelectorAll('#zoneBody tr[data-zk]').forEach(tr => {
    const g = f => tr.querySelector(`[data-zf="${f}"]`);
    if (g('hold').checked){ z[tr.dataset.zk] = { hold: true, note: g('note').value.trim() }; return; }
    const prod = zList(g('prod').value), type = zList(g('type').value).map(t => t.toUpperCase());
    if (prod.length || type.length) z[tr.dataset.zk] = { prod: prod.length ? prod : ['*'], type: type.length ? type : ['*'], note: g('note').value.trim() };
  });
  return z;
}
function printZoneSigns(){
  const w = window.open('', '_blank');
  if (!w){ showToast('เปิดหน้าพิมพ์ไม่ได้', 'อนุญาต Pop-up ให้หน้านี้ก่อน', 'error'); return; }
  const signs = posKeys().map(k => {
    const [rk, sd, f, c] = k.split('|'), hz = isHoldZone(k);
    return `<div class="s${hz ? ' h' : ''}">${window.qrcode ? qrSVG(`RS:LOC:${rk}-${sd}-${f}-${c}`) : ''}<div><small>${rk}-${sd} · ชั้น ${f} · ${c}</small><b>${esc(hz ? 'HOLD ZONE' : zoneText(k, true))}</b>
      <span>${hz ? 'งาน Hold เท่านั้น · ห้าม Scrap' : 'ห้ามวางงาน Product / Type อื่น'}</span>
      <div class="st">${Array.from({ length: STACKS_PER_ZONE }, (_, i) => `<i>${i + 1}</i>`).join('')}</div><em>เริ่มวางตั้ง 1 (ซ้าย) · ตั้งละ ≤ ${TRAYS_PER_STACK} ถาด · ≤ ${LIMIT} ชิ้น/ช่อง</em></div></div>`;
  }).join('');
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ป้ายโซน Resonance Store</title><style>
    @page{size:A4;margin:8mm} body{font-family:"IBM Plex Sans Thai","Segoe UI",Tahoma,sans-serif;margin:0} .g{display:grid;grid-template-columns:repeat(2,1fr);gap:4mm}
    .s{border:2px solid #2D7C31;border-left:6mm solid #6EBE49;border-radius:3mm;padding:3mm;display:flex;gap:3mm;align-items:center;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .s.h{border-color:#C62828;border-left-color:#C62828;background:#FDECEA} .s svg{width:24mm;height:24mm;flex:none} small{font-size:9pt;color:#444} b{display:block;font-size:17pt;line-height:1.15}
    span{display:block;font-size:9pt;font-weight:700;color:#C62828} .st{display:flex;gap:1.5mm;margin:1.5mm 0} .st i{font-style:normal;border:1px solid #888;border-radius:1mm;width:9mm;text-align:center;font-size:8pt} .st i:first-child{background:#6EBE49;color:#fff;border-color:#6EBE49}
    em{font-style:normal;font-size:8pt;color:#333}
  </style></head><body><div class="g">${signs}</div><script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
  w.document.close();
}

/* ===================== SCAN (camera QR or USB barcode gun) ===================== */
const scan = { target:'form', stream:null, raf:0 };
async function openScan(target){
  scan.target = target;
  if (target === 'fly') kzFindStart();
  $('scanTitle').textContent = target === 'scrap' ? `ยืนยัน Scrap · สแกนป้ายงาน ${scrapPending}` : 'สแกน QR / บาร์โค้ด';
  $('scanInput').value = '';
  $('scanDialog').showModal();
  setTimeout(() => $('scanInput').focus(), 50);
  $('scanMsg').textContent = 'กำลังเปิดกล้อง…'; $('scanMsg').hidden = false;
  try {
    await loadLib('jsQR.js', 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js', () => !!window.jsQR);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
    scan.stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } });
    const v = $('scanVideo'); v.srcObject = scan.stream; await v.play();
    $('scanMsg').hidden = true;
    const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently:true });
    const tick = () => {
      if (!scan.stream) return;
      if (v.readyState >= 2 && v.videoWidth){
        c.width = Math.min(640, v.videoWidth); c.height = Math.round(c.width * v.videoHeight / v.videoWidth);
        g.drawImage(v, 0, 0, c.width, c.height);
        const res = jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts:'dontInvert' });
        if (res && res.data){ handleScan(res.data); return; }
      }
      scan.raf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    $('scanMsg').textContent = 'ไม่พบกล้อง หรือไม่ได้อนุญาตให้ใช้กล้อง · ใช้เครื่องยิงบาร์โค้ด USB หรือพิมพ์ในช่องด้านล่างได้';
    $('scanMsg').hidden = false;
  }
}
function stopScan(){
  cancelAnimationFrame(scan.raf);
  if (scan.stream){ scan.stream.getTracks().forEach(t => t.stop()); scan.stream = null; }
  $('scanVideo').srcObject = null;
}
function handleScan(raw){
  const code = String(raw || '').trim(); if (!code) return;
  if ($('scanDialog').open) $('scanDialog').close();
  const loc = code.match(/^RS:LOC:([AB])-([LR])-([123])-(IN|OUT)$/i);
  const job = code.match(/^RS:JOB:(.+)$/i);
  if (scan.target === 'poka'){
    const want = pokaPending; pokaPending = null;
    const got = loc ? loc.slice(1).map(x => x.toUpperCase()).join('|') : null;
    if (got && got === want){ showToast('Poka-yoke ✓ ช่องถูกต้อง', keyTxt(want)); submitAdd({ preventDefault(){}, pokaOk:true }); }
    else { kzBlock('poka', `${want} ≠ ${got || code}`); showToast('Poka-yoke ✗ ช่องไม่ตรง · ยังไม่ได้บันทึก', `ต้องวางที่ ${keyTxt(want)} แต่สแกนได้ ${got ? keyTxt(got) : code}`, 'error'); beep(); }
    return;
  }
  if (scan.target === 'scrap'){
    const want = scrapPending; scrapPending = null;
    const got = normJob(job ? job[1] : code);
    if (got !== want){ kzBlock('scrap', `${want} ≠ ${got || code}`); beep(); showToast('Scrap ✗ ป้ายงานไม่ตรง · ยังไม่ได้บันทึก', `ต้องสแกน ${want} แต่ได้ ${got || code}`, 'error'); return; }
    if (holdData[want]){ holdBlock(want, 'Scrap'); return; }
    setDispose(want, 'Scrap');
    return;
  }
  if (loc){
    const [, rk, sd, f, c] = loc.map(x => String(x).toUpperCase()), k = `${rk}|${sd}|${f}|${c}`;
    /* scanning the shelf of a lit put-away position confirms the tray is placed */
    if (scan.target !== 'form' && plight.put[k]){ confirmPut(k, null, 'scan'); return; }
    if (scan.target === 'form'){ prefillAdd([rk, sd, f, c]); showToast('สแกนตำแหน่งแล้ว', `เลือก ${rk}-${sd} ชั้น ${f} ${c} ในฟอร์ม`, 'info'); }
    else if (three.ready){ clearFly(); three.flyTo(k); kzFindDone('scan'); showToast('สแกนตำแหน่งแล้ว', `บินไปที่ ${rk}-${sd} ชั้น ${f} ${c}`, 'info'); }
    return;
  }
  const jobNo = job ? job[1].trim() : code;
  if (scan.target === 'form'){ $('fJob').value = jobNo; jobHint(); $('fItem').focus(); showToast('สแกนแล้ว', `Job No. ${jobNo}`, 'info'); }
  else { $('flyBox').value = jobNo; flySearch(jobNo, 'scan'); }
  if (isHeld(jobNo)){ const h = holdData[normJob(jobNo)]; showToast(`🔒 ${normJob(jobNo)} ติด HOLD`, `ห้าม Scrap / ห้ามหยิบออก · ${h.reason} (โดย ${h.by})`, 'warn'); }
}
let scrapPending = null;

/* ===================== UNDO / REDO UI ===================== */
function updateUndoUI(){
  const u = $('undoBtn'), r = $('redoBtn'); if (!u) return;
  u.disabled = !undo.stack.length; r.disabled = !undo.redo.length;
  u.title = undo.stack.length ? `ย้อน: ${undo.stack[undo.stack.length - 1].label} (Ctrl+Z)` : 'ยังไม่มีอะไรให้ย้อน';
  r.title = undo.redo.length ? `ทำซ้ำ: ${undo.redo[undo.redo.length - 1].label} (Ctrl+Y)` : 'ยังไม่มีอะไรให้ทำซ้ำ';
}
function applyUndo(from, to, src, title){
  if (dirty){ showToast('มีการแก้ไขที่ยังไม่ได้บันทึก', 'กด Save Changes ก่อน แล้วค่อย Undo / Redo', 'warn'); return; }
  const s = from.pop(); if (!s){ showToast(title, 'ไม่มีรายการ', 'info'); return; }
  to.push({ rows: structuredClone(store), label: s.label });
  undo.applying = true;
  store = structuredClone(s.rows);
  logCtx = { src };
  saveAll(false);
  undo.applying = false;
  updateUndoUI();
  buildFilterBar(); buildJobFilterBar(); renderAll();
  showToast(title, s.label || '', 'info');
}
const doUndo = () => applyUndo(undo.stack, undo.redo, 'undo', 'ย้อนแล้ว (Undo)');
const doRedo = () => applyUndo(undo.redo, undo.stack, 'redo', 'ทำซ้ำแล้ว (Redo)');

/* ===================== PICK LIST (pick work out along the shortest walk) ===================== */
const pick = { mode:'job', sort:'route', ids:new Set(), done:new Set(), open:false };
/* where a person stands to reach a zone, and a walkable floor path between two such points */
const accessPt = key => { const { x } = zoneXZ(key); return [x, walkPath(0, key).accZ]; };
function floorPath(a, b){
  if (Math.abs(a[1] - b[1]) < 0.01) return [a, b];
  const ex = (a[0] + b[0]) / 2 >= 0 ? GEO.END_X : -GEO.END_X;   /* go round the nearer rack end */
  return [a, [ex, a[1]], [ex, b[1]], b];
}
const pathLen = pts => pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : s, 0);
function pickRows(){
  const q = $('pickInput').value.trim();
  if (!q) return [];
  if (pick.mode === 'owner') return store.filter(r => { const d = jobOf(r.JOB_NO); return d && String(d['Requester Name'] || '').toLowerCase() === q.toLowerCase(); });
  const wanted = q.split(/[,\s]+/).map(normJob).filter(Boolean);
  return store.filter(r => wanted.includes(normJob(r.JOB_NO)));
}
function openPick(){
  if (currentTab !== '3d' && currentTab !== 'overview') setTab('3d');
  pick.open = true; $('pickPanel').hidden = false;
  clearFly();
  fillPickList();
  $('stagePanel').scrollIntoView({ behavior:'smooth', block:'center' });
  setTimeout(() => $('pickInput').focus(), 250);
  renderPick();
}
function closePick(){
  pick.open = false; $('pickPanel').hidden = true; pick.done.clear(); pick.stops = null; syncLights();
  if (three.ready){ three.hideRoute(); if (three.match === pickMatch){ three.match = null; three.update(three.rows || filteredData()); } }
  renderLegend();
}
const pickMatch = r => pick.ids.has(r._id);
function fillPickList(){
  const vals = pick.mode === 'owner'
    ? [...new Set(Object.values(jobs).map(j => j['Requester Name']).filter(Boolean))]
    : [...new Set(store.map(r => r.JOB_NO).filter(Boolean))];
  $('pickList').innerHTML = vals.sort().map(v => `<option value="${esc(v)}">`).join('');
  $('pickInput').placeholder = pick.mode === 'owner' ? 'ชื่อเจ้าของงาน (Requester)' : 'Job No. (หลาย Job คั่นด้วย ,)';
}
function renderPick(){
  if (!pick.open) return;
  const rows = pickRows();
  pick.ids = new Set(rows.map(r => r._id));
  [...pick.done].forEach(id => { if (!pick.ids.has(id)) pick.done.delete(id); });
  if (!rows.length){
    $('pickItems').innerHTML = `<div class="empty-ins"><b>${$('pickInput').value.trim() ? 'ไม่พบงานนี้ใน Store' : 'เลือกงานที่ต้องหยิบ'}</b><span>${pick.mode === 'owner' ? 'เลือกชื่อเจ้าของงาน ระบบจะรวมทุก Job ของคนนั้น' : 'พิมพ์ Job No. ได้หลาย Job คั่นด้วยเครื่องหมาย ,'}</span></div>`;
    $('pickSum').textContent = ''; $('pickDone').disabled = true;
    if (three.ready){ three.hideRoute(); if (three.match === pickMatch){ three.match = null; three.update(three.rows || filteredData()); } }
    return;
  }
  /* group rows into stops (one per zone), order by nearest-next walking distance from the chosen bench */
  const byKey = {};
  rows.forEach(r => { const k = `${r.RACK}|${r.SIDE}|${r.FLOOR}|${String(r.CELL).toUpperCase()}`; (byKey[k] ||= []).push(r); });
  const ti = Number($('pickFrom').value) || 0;
  const keys = Object.keys(byKey).filter(k => RACK_SIDES.includes(k.split('|').slice(0, 2).join('-')));
  const ageOfKey = k => Math.max(...byKey[k].map(r => rowAge(r) ?? -1));
  let order = [], pts = [];
  if (keys.length){
    let left = [...keys];
    let first = left.reduce((b, k) => !b || walkPath(ti, k).len < walkPath(ti, b).len ? k : b, null);
    if (pick.sort === 'fifo') { left.sort((a, b) => ageOfKey(b) - ageOfKey(a)); first = left[0]; }
    order.push(first); left = left.filter(k => k !== first);
    pts = walkPath(ti, first).pts.slice();
    while (left.length){
      const cur = accessPt(order[order.length - 1]);
      const next = pick.sort === 'fifo' ? left[0] : left.reduce((b, k) => !b || pathLen(floorPath(cur, accessPt(k))) < pathLen(floorPath(cur, accessPt(b))) ? k : b, null);
      pts.push(...floorPath(cur, accessPt(next)).slice(1));
      order.push(next); left = left.filter(k => k !== next);
    }
  }
  const dist = pathLen(pts);
  pick.stops = order.map((k, i) => ({ k, i, rows: byKey[k] }));
  let qty = 0;
  $('pickItems').innerHTML = order.map((k, i) => {
    const list = byKey[k].slice().sort((a, b) => (rowAge(b) ?? -1) - (rowAge(a) ?? -1));
    return `<div class="pk-stop"><div class="pk-stop-h"><span class="pk-n">${i + 1}</span><b>${keyTxt(k)}</b><button type="button" class="pk-fly" data-pkfly="${k}" title="ดูใน 3D">ดู</button></div>
      ${list.map(r => { qty += num(r.QUANITY); const d = rowAge(r), held = isHeld(r.JOB_NO); return `<label class="pk-item ${pick.done.has(r._id) ? 'done' : ''}${held ? ' held' : ''}" ${held ? `data-pkhold="${esc(r.JOB_NO)}"` : ''}><input type="checkbox" data-pkid="${r._id}" ${pick.done.has(r._id) ? 'checked' : ''} ${held ? 'disabled' : ''}/>
        <span><b>${esc(r.JOB_NO || '-')}</b>${held ? ' <span class="hold-tag">🔒 HOLD</span>' : ''} · ${esc(itemName(r))}<small>${num(r.QUANITY)} ชิ้น · ${trayCount(packRow(r))} ถาด${r.TESTER ? ` · ${esc(r.TESTER)}` : ''}${held ? ' · ห้ามหยิบออกจนกว่าจะปลด Hold' : ''}</small></span>
        ${d === null ? '' : `<span class="days-badge ${daysBadgeClass(d)}">${d} วัน</span>`}</label>`; }).join('')}</div>`;
  }).join('');
  const nDone = pick.done.size;
  $('pickSum').textContent = `${order.length} จุด · ${rows.length} รายการ · ${fmt(qty)} ชิ้น · เดินประมาณ ${dist.toFixed(1)} ม.${nDone ? ` · ติ๊กแล้ว ${nDone}` : ''}`;
  $('pickDone').disabled = !nDone;
  $('pickDone').textContent = nDone ? `นำออกที่ติ๊ก (${nDone})` : 'นำออกที่ติ๊ก';
  if (three.ready){
    if (flyHits.length) clearFly();
    three.match = pickMatch;
    three.showPath(pts, order, order.map((k, i) => ({ key:k, label:String(i + 1) })));
    renderLegend();
  }
  syncLights();
}
function pickCheckout(){
  const ids = [...pick.done]; if (!ids.length) return;
  const rows = store.filter(r => pick.done.has(r._id));
  const held = rows.filter(r => isHeld(r.JOB_NO));
  if (held.length){ holdBlock(held[0].JOB_NO, 'หยิบออก'); held.forEach(r => pick.done.delete(r._id)); renderPick(); return; }
  if (!confirm(`นำออกจาก Store ${rows.length} รายการ · ${fmt(sumQty(rows))} ชิ้น ?\n(บันทึกทันที · กด Undo ได้ถ้าผิด)`)) return;
  store = store.filter(r => !pick.done.has(r._id));
  pick.done.clear();
  logCtx = { src:'pick' };
  saveAll(false);
  buildFilterBar(); buildJobFilterBar(); renderAll();
  showToast('นำออกแล้ว', `${rows.length} รายการ · ${fmt(sumQty(rows))} ชิ้น · กด Undo ได้ถ้าผิด`);
  renderPick();
}

/* ===================== CTRL+K COMMAND PALETTE ===================== */
const cmdk = { items:[], sel:0 };
function cmdkCommands(){
  const C = (icon, label, hint, run, kw) => ({ icon, label, hint, run, kw: (kw || '') + ' ' + label });
  const list = [
    C('🏠', 'ไปหน้า Overview', 'แท็บ', () => setTab('overview'), 'overview หน้าแรก'),
    C('🧊', 'ไปหน้า 3D Store', 'แท็บ', () => setTab('3d'), '3d'),
    C('📊', 'ไปหน้า Insights', 'แท็บ', () => setTab('insights'), 'insights รายงาน สถิติ kaizen'),
    C('📋', 'ไปหน้า Jobs', 'แท็บ', () => setTab('jobs'), 'jobs งาน'),
    C('✏️', 'ไปหน้า Data Entry', 'แท็บ', () => setTab('entry'), 'data entry แก้ไข'),
    C('➕', 'รับงานเข้า Store', 'ฟอร์ม', () => { setTab('overview'); $('addPanel').scrollIntoView({ behavior:'smooth' }); setTimeout(() => $('fJob').focus(), 300); }, 'add เพิ่มงาน รับเข้า'),
    C('📦', 'Pick List · หยิบงานออก', 'เครื่องมือ', openPick, 'pick หยิบ นำออก'),
    C('↶', 'Undo · ย้อนการเปลี่ยนแปลง', 'Ctrl+Z', doUndo, 'undo ย้อน'),
    C('↷', 'Redo · ทำซ้ำ', 'Ctrl+Y', doRedo, 'redo'),
    C('📺', 'โหมดจอทีวี (Kiosk / Andon)', '3D', () => { setTab('3d'); setTimeout(enterKiosk, 200); }, 'tv kiosk andon ทีวี'),
    C('🚶', 'เดินในแลป (First-person)', '3D', () => { setTab('3d'); setTimeout(() => three.ready && three.walkStart(), 200); }, 'walk เดิน'),
    C('🌡️', 'Heatmap ความเต็ม', '3D', () => setMode('fill'), 'heatmap ความเต็ม'),
    C('⏳', 'X-ray อายุงาน', '3D', () => setMode('age'), 'xray อายุ'),
    C('🎨', 'สีปกติ', '3D', () => setMode('normal'), 'normal ปกติ'),
    C('⏱', 'Time Machine · เล่นย้อนหลัง', '3D', () => { setTab('3d'); setTimeout(tmPlay, 200); }, 'time machine ย้อน'),
    C('🏷️', 'พิมพ์ป้าย QR', 'เครื่องมือ', openQR, 'qr ป้าย'),
    C('⌗', 'สแกน QR / บาร์โค้ด', 'เครื่องมือ', () => openScan('fly'), 'scan สแกน'),
    C('📝', 'คัดลอกรายงานส่งกะ', 'Insights', async () => { const ok = await copyText(handoverText(handoverData())); showToast(ok ? 'คัดลอกรายงานส่งกะแล้ว' : 'คัดลอกไม่ได้', '', ok ? 'success' : 'error'); }, 'handover ส่งกะ'),
    C('📄', 'รายงานประจำสัปดาห์ (PDF)', 'Insights', weeklyReport, 'weekly report pdf สัปดาห์'),
    C('🔢', 'Cycle Count ประจำกะ', 'Insights', () => { setTab('insights'); setTimeout(() => $('ccBody').scrollIntoView({ behavior:'smooth', block:'center' }), 200); }, 'cycle count นับ'),
    C('⏲', 'จับเวลาแบบเดิม (Before)', 'Kaizen', () => { setTab('insights'); setTimeout(() => $('kaizenCard').scrollIntoView({ behavior:'smooth' }), 200); }, 'kaizen before จับเวลา'),
    C('💾', 'Export Store CSV', 'ไฟล์', exportStore, 'export csv'),
    C('📘', 'คู่มือการใช้งาน', 'ช่วยเหลือ', openGuide, 'guide คู่มือ help'),
    C('🧭', 'เริ่มทัวร์แนะนำ', 'ช่วยเหลือ', startTour, 'tour ทัวร์'),
    C('🌗', 'สลับโหมดสว่าง / มืด', 'ธีม', () => $('themeBtn').click(), 'theme dark light'),
  ];
  posKeys().forEach(k => { const [rk, sd, f, c] = k.split('|'); const q = sumQty(positionRows(store, rk, sd, f, c)); list.push(C('📍', keyTxt(k), `${q}/${LIMIT} ชิ้น`, () => { setTab('3d'); setTimeout(() => { if (three.ready){ clearFly(); three.flyTo(k); kzFindDone('palette'); } openPos(rk, sd, f, c); }, 250); }, `${rk}-${sd} ${rk}${sd} ${f} ${c} ช่อง ตำแหน่ง`)); });
  storeJobs(store).forEach(j => list.push(C('🔎', j.jobNo, `${j.qty} ชิ้น · ${j.locations}`, () => { setTab('3d'); setTimeout(() => { $('flyBox').value = j.jobNo; flySearch(j.jobNo, 'palette'); }, 250); }, `${j.items} ${(j.detail && j.detail['Requester Name']) || ''}`)));
  return list;
}
function openCmdk(){
  kzFindStart();
  cmdk.all = cmdkCommands();
  $('cmdkInput').value = ''; renderCmdk();
  if (!$('cmdk').open) $('cmdk').showModal();
  $('cmdkInput').focus();
}
function renderCmdk(){
  const q = $('cmdkInput').value.toLowerCase().trim().replace(/\s+/g, ' ');
  const words = q.split(' ').filter(Boolean);
  cmdk.items = (words.length ? cmdk.all.filter(c => { const hay = `${c.label} ${c.kw} ${c.hint}`.toLowerCase().replace(/[-·]/g, ' '); return words.every(w => hay.includes(w.replace(/-/g, ' ').trim()) || hay.replace(/\s/g, '').includes(w.replace(/[-\s]/g, ''))); }) : cmdk.all.filter(c => c.icon !== '📍' && c.icon !== '🔎')).slice(0, 40);
  cmdk.sel = Math.min(cmdk.sel, Math.max(0, cmdk.items.length - 1));
  $('cmdkList').innerHTML = cmdk.items.map((c, i) => `<button type="button" role="option" class="${i === cmdk.sel ? 'on' : ''}" data-ci="${i}"><span class="ci">${c.icon}</span><span class="cl">${esc(c.label)}</span><span class="ch">${esc(c.hint)}</span></button>`).join('') || '<div class="empty-ins" style="margin:8px">ไม่พบคำสั่งหรือข้อมูลที่ตรงกัน</div>';
  const on = $('cmdkList').querySelector('.on'); if (on) on.scrollIntoView({ block:'nearest' });
}
function runCmdk(i){ const c = cmdk.items[i]; if (!c) return; $('cmdk').close(); c.run(); }

/* ===================== DESKTOP NOTIFICATIONS + SOUND ===================== */
const notif = { on: (() => { try { return localStorage.getItem('resNotifyV1') === '1'; } catch { return false; } })(), seen: new Set(readJSON('resNotifiedV1', [])) };
function beep(){
  try {
    const ac = beep.ac || (beep.ac = new (window.AudioContext || window.webkitAudioContext)());
    [[880, 0], [660, 0.18], [880, 0.36]].forEach(([f, at]) => {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ac.currentTime + at); g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + 0.16);
      o.connect(g).connect(ac.destination); o.start(ac.currentTime + at); o.stop(ac.currentTime + at + 0.18);
    });
  } catch {}
}
function currentAlerts(){
  const out = [];
  aggregateByLocation(store).filter(l => l.qty >= LIMIT).forEach(l => out.push({ key:`over:${l.location}`, text:`เกินกำหนด ${l.location} ${l.qty}/${LIMIT}` }));
  storeJobs(store).forEach(j => { const d = daysBetween(parseFlexibleDate(j.detail && j.detail['Received Date'])); if (d !== null && d >= 14) out.push({ key:`age:${j.key}`, text:`${j.jobNo} ค้าง ${d} วัน` }); });
  return out;
}
function checkAlerts(){
  const now = currentAlerts();
  if (!notif.on){ return; }
  const fresh = now.filter(a => !notif.seen.has(a.key));
  notif.seen = new Set(now.map(a => a.key));   /* a resolved alert that comes back is announced again */
  try { localStorage.setItem('resNotifiedV1', JSON.stringify([...notif.seen])); } catch {}
  if (!fresh.length) return;
  beep();
  const body = fresh.slice(0, 6).map(a => '• ' + a.text).join('\n') + (fresh.length > 6 ? `\n… และอีก ${fresh.length - 6} รายการ` : '');
  try { if (window.Notification && Notification.permission === 'granted') new Notification('Resonance Store · แจ้งเตือน', { body, tag:'resonance-store' }); } catch {}
  showToast('แจ้งเตือนใหม่', fresh.slice(0, 3).map(a => a.text).join(' · '), 'warn');
}
async function toggleNotify(){
  if (!notif.on){
    let perm = 'denied';
    try { perm = window.Notification ? await Notification.requestPermission() : 'denied'; } catch {}
    notif.on = true; notif.seen = new Set();
    showToast('เปิดการแจ้งเตือนแล้ว', perm === 'granted' ? 'จะมีป๊อปอัปของ Windows + เสียง เมื่อมีช่องเกิน 80 หรืองานค้างครบ 14 วัน' : 'เบราว์เซอร์ไม่อนุญาตป๊อปอัป · จะแจ้งด้วยเสียง + แถบแจ้งเตือนในหน้าแทน', 'info');
    beep();
  } else { notif.on = false; showToast('ปิดการแจ้งเตือนแล้ว', '', 'info'); }
  try { localStorage.setItem('resNotifyV1', notif.on ? '1' : '0'); } catch {}
  $('notifyBtn').setAttribute('aria-pressed', String(notif.on));
  checkAlerts();
}

/* ===================== VOICE COMMANDS (Thai, push to talk) ===================== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const THAI_NUM = { 'หนึ่ง':'1', 'สอง':'2', 'สาม':'3', 'สี่':'4', 'ห้า':'5', 'หก':'6', 'เจ็ด':'7', 'แปด':'8', 'เก้า':'9', 'ศูนย์':'0' };
function voiceListen(){
  if (!SR) return;
  kzFindStart();
  const rec = new SR(); rec.lang = 'th-TH'; rec.interimResults = true; rec.maxAlternatives = 1;
  const hud = $('voiceHud'); hud.hidden = false; hud.innerHTML = '<i></i> กำลังฟัง… พูดได้เลย';
  $('voiceBtn').classList.add('live');
  let final = '';
  rec.onresult = e => { const t = [...e.results].map(r => r[0].transcript).join(''); hud.innerHTML = `<i></i> “${esc(t)}”`; if (e.results[e.results.length - 1].isFinal) final = t; };
  rec.onerror = e => { hud.innerHTML = e.error === 'not-allowed' ? 'ไม่ได้รับอนุญาตให้ใช้ไมค์' : e.error === 'network' ? 'ต้องต่ออินเทอร์เน็ตเพื่อใช้สั่งด้วยเสียง' : 'ฟังไม่ออก ลองใหม่อีกครั้ง'; };
  rec.onend = () => { $('voiceBtn').classList.remove('live'); setTimeout(() => { hud.hidden = true; }, final ? 1800 : 2600); if (final) runVoice(final); };
  try { rec.start(); } catch { hud.hidden = true; }
}
function runVoice(raw){
  let t = ` ${raw.toLowerCase()} `;
  Object.entries(THAI_NUM).forEach(([w, d]) => { t = t.split(w).join(` ${d} `); });
  t = t.replace(/เอ/g, ' a ').replace(/บี/g, ' b ').replace(/แอล|ซ้าย/g, ' l ').replace(/อาร์|ขวา/g, ' r ').replace(/อิน|เข้า/g, ' in ').replace(/เอาท์|เอ้าท์|ออก(?!จาก)/g, ' out ').replace(/\s+/g, ' ');
  const has = (...w) => w.some(x => t.includes(x));
  if (has('ทีวี', 'tv', 'kiosk', 'คีออส')){ setTab('3d'); setTimeout(enterKiosk, 200); return; }
  if (has('heatmap', 'ฮีท', 'ความเต็ม')){ setMode('fill'); return; }
  if (has('อายุ', 'x-ray', 'เอ็กซ์เรย์')){ setMode('age'); return; }
  if (has('ปกติ')){ setMode('normal'); clearFly(); return; }
  if (has('ย้อน', 'undo', 'อันดู')){ doUndo(); return; }
  if (has('ส่งกะ', 'รายงาน')){ setTab('insights'); return; }
  if (has('เพิ่มงาน', 'รับงาน')){ setTab('overview'); $('addPanel').scrollIntoView({ behavior:'smooth' }); return; }
  if (has('หยิบ', 'pick')){ openPick(); return; }
  if (has('เดิน')){ setTab('3d'); setTimeout(() => three.ready && three.walkStart(), 200); return; }
  /* zone: "ช่อง A R ชั้น 2 อิน" */
  const z = t.match(/\b([ab])\s*-?\s*([lr])\b.*?([123]).*?\b(in|out)\b/);
  if (z){ const k = `${z[1].toUpperCase()}|${z[2].toUpperCase()}|${z[3]}|${z[4].toUpperCase()}`; setTab('3d'); setTimeout(() => { if (three.ready){ clearFly(); three.flyTo(k); kzFindDone('voice'); } }, 250); showToast('สั่งด้วยเสียง', keyTxt(k), 'info'); return; }
  /* otherwise search: digits are the safest part of a spoken job number */
  const digits = t.replace(/\s/g, '').match(/\d{3,}/);
  const q = digits ? digits[0] : raw.replace(/^(หา|ค้นหา)\s*/, '').trim();
  setTab(currentTab === 'overview' ? 'overview' : '3d');
  setTimeout(() => { $('flyBox').value = q; flySearch(q, 'voice'); }, 250);
}

/* ===================== OWNER E-MAILS FOR OVERDUE WORK ===================== */
const ownerMail = readJSON('resOwnerEmailV1', {});
const guessEmail = name => { const p = String(name || '').trim().toLowerCase().split(/\s+/).filter(Boolean); return p.length >= 2 && p.every(w => /^[a-z][a-z'-]*$/.test(w)) ? `${p[0]}.${p[p.length - 1]}@seagate.com` : ''; };
function overdueByOwner(){
  const map = {};
  storeJobs(store).forEach(j => {
    const d = daysBetween(parseFlexibleDate(j.detail && j.detail['Received Date']));
    if (d === null || d < 14) return;
    const owner = (j.detail && j.detail['Requester Name']) || '(ไม่ทราบเจ้าของ)';
    (map[owner] ||= []).push({ ...j, days: d });
  });
  return Object.entries(map).map(([owner, list]) => ({ owner, list: list.sort((a, b) => b.days - a.days) })).sort((a, b) => b.list[0].days - a.list[0].days);
}
function renderOwners(){
  const groups = overdueByOwner();
  const head = '<thead><tr><th>เจ้าของงาน</th><th>งานค้าง</th><th>นานสุด</th><th>อีเมล</th><th></th></tr></thead>';
  $('ownerTable').innerHTML = head + '<tbody>' + (groups.map(g => `<tr>
    <td><b>${esc(g.owner)}</b><div class="top-sub">${esc(g.list.map(j => j.jobNo).join(', '))}</div></td>
    <td class="n"><b>${g.list.length}</b> งาน · ${fmt(g.list.reduce((a, j) => a + j.qty, 0))} ชิ้น</td>
    <td><span class="days-badge days-danger">${g.list[0].days} วัน</span></td>
    <td><input class="mail-input" data-mail="${esc(g.owner)}" value="${esc(ownerMail[g.owner] ?? guessEmail(g.owner))}" placeholder="name.surname@seagate.com" /></td>
    <td><button type="button" class="btn soft sm" data-draft="${esc(g.owner)}">ร่างอีเมล</button></td></tr>`).join('')
    || '<tr><td colspan="5" class="empty-table">ไม่มีงานค้างเกิน 14 วัน 🎉</td></tr>') + '</tbody>';
}
function draftMail(owner){
  const g = overdueByOwner().find(x => x.owner === owner); if (!g) return;
  const to = ($(`ownerTable`).querySelector(`[data-mail="${CSS.escape(owner)}"]`) || {}).value || '';
  const lines = g.list.map((j, i) => `${i + 1}. ${j.jobNo} · ${j.items} · ${j.qty} ชิ้น · ค้าง ${j.days} วัน · ตำแหน่ง ${j.locations}`);
  const body = [`เรียน คุณ${owner}`, '', `ทาง HSA Resonance Lab ขอแจ้งว่ามีงานของคุณค้างอยู่ใน Resonance Store เกิน 14 วัน จำนวน ${g.list.length} งาน ดังนี้`, '', ...lines, '',
    'รบกวนแจ้งการจัดการสำหรับแต่ละงาน:', '  ☐ รับคืน (Return to Owner)', '  ☐ ส่ง Scrap', '  ☐ เก็บต่อ (โปรดระบุวันที่ต้องการ)', '',
    'ขอบคุณครับ/ค่ะ', editor() || 'HSA Resonance Lab'].join('\n');
  const subject = `[Resonance Store] งานค้างเกิน 14 วัน ${g.list.length} งาน – กรุณาแจ้งการจัดการ`;
  location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  kzBlock('mail', owner);
}

/* ===================== WEEKLY REPORT (print / save as PDF) ===================== */
function weeklyReport(){
  const now = Date.now(), from = now - 7 * DAY;
  const ev = histLog.filter(e => e.t >= from && e.src !== 'external');
  const adds = ev.filter(e => e.a === 'add'), outs = ev.filter(e => e.a === 'del'), moves = ev.filter(e => e.a === 'move');
  const sum = (l, side) => l.reduce((a, e) => a + (side === 'b' ? e.b[4] : e.f[4]), 0);
  const days = Array.from({ length:7 }, (_, i) => dayStartOf(now - (6 - i) * DAY));
  const perDay = days.map(d => ({ d, in: adds.filter(e => dayStartOf(e.t) === d).reduce((a, e) => a + e.f[4], 0), out: outs.filter(e => dayStartOf(e.t) === d).reduce((a, e) => a + e.b[4], 0) }));
  const mx = Math.max(10, ...perDay.map(p => Math.max(p.in, p.out)));
  const byT = {}; adds.forEach(e => { const t = e.f[8] || 'ไม่ระบุ'; byT[t] = (byT[t] || 0) + e.f[4]; });
  const locs = aggregateByLocation(store), total = sumQty(store), cap = TOTAL_STORE_LOCATIONS * LIMIT;
  const over = locs.filter(l => l.qty >= LIMIT), warn = locs.filter(l => l.qty >= WARN_AT && l.qty < LIMIT);
  const aging = overdueByOwner();
  const fd = forecastData(), kz = kaizenStats();
  let img = ''; try { if (three.ready) img = three.snapshot(); } catch {}
  const bar = (v, c) => `<i style="height:${v / mx * 100}%;background:${c}"></i>`;
  const range = `${new Date(from).toLocaleDateString('en-GB', { day:'2-digit', month:'short' })} – ${new Date(now).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`;
  const w = window.open('', '_blank');
  if (!w){ showToast('เปิดหน้ารายงานไม่ได้', 'อนุญาต Pop-up ให้หน้านี้ก่อน', 'error'); return; }
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Resonance Store Weekly ${stamp()}</title><style>
    @page{size:A4;margin:12mm} *{box-sizing:border-box} body{font-family:"IBM Plex Sans Thai","Segoe UI",Tahoma,sans-serif;color:#111814;margin:0;font-size:11pt}
    header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #6EBE49;padding-bottom:6px;margin-bottom:10px} h1{margin:0;font-size:20pt} h2{font-size:12.5pt;margin:14px 0 6px;border-left:4px solid #6EBE49;padding-left:8px}
    .k{display:grid;grid-template-columns:repeat(5,1fr);gap:6px} .k div{border:1px solid #dfe5e1;border-radius:6px;padding:6px 8px} .k b{display:block;font-size:17pt} .k span{font-size:8.5pt;color:#5E6A64;text-transform:uppercase}
    .bars{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;height:110px;align-items:end;border-bottom:1px solid #ccc;padding:0 4px} .bars>div{display:flex;gap:3px;align-items:flex-end;height:100%;justify-content:center} .bars i{display:block;width:14px;border-radius:3px 3px 0 0}
    .lbl{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;font-size:8.5pt;color:#5E6A64;text-align:center;padding:2px 4px}
    table{width:100%;border-collapse:collapse;font-size:9.5pt} th,td{border-bottom:1px solid #e3e8e5;padding:4px 6px;text-align:left} th{background:#f2f5f3}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:12px} img{width:100%;border-radius:6px;border:1px solid #dfe5e1} .muted{color:#5E6A64;font-size:9pt} .bad{color:#AE2B2B;font-weight:700}
  </style></head><body>
  <header><div><h1>Resonance Store · Weekly Report</h1><div class="muted">HSA Resonance Lab · ${range}</div></div><div class="muted">ออกรายงาน ${fmtStamp(new Date().toISOString())}${editor() ? ' · ' + esc(editor()) : ''}</div></header>
  <div class="k"><div><span>ในสโตร์ตอนนี้</span><b>${fmt(total)}</b>${Math.round(total / cap * 100)}% ของ ${fmt(cap)}</div><div><span>รับเข้า 7 วัน</span><b>${fmt(sum(adds))}</b>${adds.length} รายการ</div><div><span>นำออก 7 วัน</span><b>${fmt(sum(outs, 'b'))}</b>${outs.length} รายการ</div><div><span>ย้าย IN→OUT</span><b>${moves.length}</b>${fmt(sum(moves))} ชิ้น</div><div><span>Over / Warning</span><b class="${over.length ? 'bad' : ''}">${over.length} / ${warn.length}</b>ช่อง</div></div>
  <h2>เข้า – ออกรายวัน</h2>
  <div class="bars">${perDay.map(p => `<div>${bar(p.in, '#6EBE49')}${bar(p.out, '#E3A008')}</div>`).join('')}</div>
  <div class="lbl">${perDay.map(p => `<span>${new Date(p.d).toLocaleDateString('en-GB', { weekday:'short', day:'2-digit' })}<br>+${p.in} / −${p.out}</span>`).join('')}</div>
  <p class="muted">■ เขียว = รับเข้า · ■ เหลือง = นำออก (ชิ้น)</p>
  <div class="two">
    <div><h2>รับเข้าตาม Tester</h2><table><tr><th>Tester</th><th>ชิ้น</th></tr>${Object.entries(byT).map(([t, q]) => `<tr><td>${esc(t)}</td><td>${q}</td></tr>`).join('') || '<tr><td colspan="2">-</td></tr>'}</table>
      <h2>พยากรณ์</h2>${fd.ready ? `<table><tr><th>Rack</th><th>เต็มใน</th><th>อัตรา/วัน</th></tr>${fd.racks.map(r => `<tr><td>${r.rk}</td><td>${daysTxt(r.days)}</td><td>${r.rate.toFixed(1)}</td></tr>`).join('')}</table>` : '<p class="muted">ข้อมูลยังไม่พอ</p>'}</div>
    <div><h2>ภาพ Store ตอนออกรายงาน</h2>${img ? `<img src="${img}" alt="3D store">` : '<p class="muted">(เปิดหน้า 3D ก่อนเพื่อแนบภาพ)</p>'}</div>
  </div>
  <h2>ช่องที่ต้องดูแล</h2><table><tr><th>ตำแหน่ง</th><th>จำนวน</th><th>สถานะ</th></tr>${[...over, ...warn].map(l => `<tr><td>${esc(l.location)}</td><td>${l.qty}/${LIMIT}</td><td class="${l.qty >= LIMIT ? 'bad' : ''}">${l.qty >= LIMIT ? 'Over' : 'Warning'}</td></tr>`).join('') || '<tr><td colspan="3">ไม่มี</td></tr>'}</table>
  <h2>งานค้าง ≥ 14 วัน</h2><table><tr><th>เจ้าของ</th><th>Job</th><th>นานสุด</th></tr>${aging.map(g => `<tr><td>${esc(g.owner)}</td><td>${esc(g.list.map(j => j.jobNo).join(', '))}</td><td class="bad">${g.list[0].days} วัน</td></tr>`).join('') || '<tr><td colspan="3">ไม่มี</td></tr>'}</table>
  <h2>Kaizen</h2><table><tr><th>ตัวชี้วัด</th><th>ก่อน</th><th>หลัง</th><th>ผล</th></tr>
    <tr><td>เวลาหางาน</td><td>${secTxt(kz.findBefore)}</td><td>${secTxt(kz.findAfter)}</td><td>${pctTxt(kz.findBefore, kz.findAfter)}</td></tr>
    <tr><td>เวลารับงานเข้า</td><td>${secTxt(kz.addBefore)}</td><td>${secTxt(kz.addAfter)}</td><td>${pctTxt(kz.addBefore, kz.addAfter)}</td></tr>
    <tr><td>ป้องกันวางเกิน 80 / Poka-yoke</td><td colspan="3">${kz.blocksOver} ครั้ง / ${kz.blocksPoka} ครั้ง</td></tr>
    <tr><td>กัน Scrap / หยิบงาน Hold · สแกนป้ายผิดตอน Scrap</td><td colspan="3">${kz.blocksHold} ครั้ง / ${kz.blocksScrap} ครั้ง · Hold อยู่ ${kz.heldNow} Job</td></tr>
    <tr><td>กันวางผิดโซน (Product / Type / HOLD)</td><td colspan="3">${kz.blocksZone} ครั้ง · ผิดโซนตอนนี้ ${kz.zoneWrong} รายการ</td></tr>
    <tr><td>ความแม่นยำสต็อก (Cycle Count)</td><td colspan="3">${kz.ccTotal ? `${kz.ccAcc}% (${kz.ccOk}/${kz.ccTotal})` : '-'}</td></tr></table>
  <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`);
  w.document.close();
}

/* ===================== KAIZEN: timing, before / after, ROI ===================== */
const kz = Object.assign({ find:[], add:[], base:[], blocks:[], set:{ wage:'', findPerDay:'', addPerDay:'' } }, readJSON('resKaizenV1', {}));
const kzRun = { findAt:0, addAt:0, stopwatch:null };
const kzSave = () => { ['find', 'add', 'base', 'blocks'].forEach(k => { if (kz[k].length > 3000) kz[k] = kz[k].slice(-3000); }); try { localStorage.setItem('resKaizenV1', JSON.stringify(kz)); } catch {} };
/* "finding" starts when someone starts to look (search box, Ctrl+K, scan, voice) and ends when the zone is on screen */
function kzFindStart(){ if (!kzRun.findAt || performance.now() - kzRun.findAt > 3e5) kzRun.findAt = performance.now(); }
function kzFindDone(via){
  if (!kzRun.findAt) return;
  const ms = performance.now() - kzRun.findAt; kzRun.findAt = 0;
  if (ms > 300 && ms < 3e5){ kz.find.push({ t: Date.now(), ms: Math.round(ms), via }); kzSave(); }
}
function kzAddStart(){ if (!kzRun.addAt) kzRun.addAt = performance.now(); }
function kzAddDone(){
  if (!kzRun.addAt) return;
  const ms = performance.now() - kzRun.addAt; kzRun.addAt = 0;
  if (ms > 500 && ms < 9e5){ kz.add.push({ t: Date.now(), ms: Math.round(ms) }); kzSave(); }
}
/* a mistake the system stopped (over limit, wrong shelf, count mismatch…) */
function kzBlock(kind, detail){
  const last = kz.blocks[kz.blocks.length - 1];
  if (last && last.kind === kind && last.detail === detail && Date.now() - last.t < 6e4) return;
  kz.blocks.push({ t: Date.now(), kind, detail: String(detail || '') }); kzSave();
}
const avg = l => l.length ? l.reduce((a, x) => a + x.ms, 0) / l.length / 1000 : null;
const secTxt = s => s === null || s === undefined ? '-' : s >= 60 ? `${Math.floor(s / 60)} นาที ${Math.round(s % 60)} วิ` : `${s.toFixed(1)} วิ`;
const pctTxt = (b, a) => b && a !== null && a !== undefined ? `${b > a ? '↓' : '↑'} ${Math.abs(Math.round((b - a) / b * 100))}%` : '-';
function kaizenStats(){
  const now = Date.now(), d14 = now - 14 * DAY;
  const cc = readJSON('resCycleV1', []).filter(c => c.t > now - 30 * DAY);
  const ccOk = cc.filter(c => c.counted === c.expected).length;
  const perDay = (list, from) => { const l = list.filter(x => x.t > from); if (!l.length) return null; const span = Math.max(1, (now - Math.min(...l.map(x => x.t))) / DAY); return l.length / span; };
  const agingNow = storeJobs(store).filter(j => { const d = daysBetween(parseFlexibleDate(j.detail && j.detail['Received Date'])); return d !== null && d >= 14; }).length;
  const startRows = histStart ? rowsAt(histStart) : store;
  const agingStart = [...new Set(startRows.map(r => normJob(r.JOB_NO)).filter(Boolean))].filter(k => { const d = parseFlexibleDate(jobs[k] && jobs[k]['Received Date']); return d && (histStart - d) / DAY >= 14; }).length;
  return {
    findBefore: avg(kz.base.filter(b => b.task === 'find')), findAfter: avg(kz.find.slice(-200)), nFind: kz.find.length, nFindBase: kz.base.filter(b => b.task === 'find').length,
    addBefore: avg(kz.base.filter(b => b.task === 'add')), addAfter: avg(kz.add.slice(-200)), nAdd: kz.add.length, nAddBase: kz.base.filter(b => b.task === 'add').length,
    findPerDay: perDay(kz.find, d14), addPerDay: perDay(kz.add, d14),
    blocksOver: kz.blocks.filter(b => b.kind === 'over').length, blocksPoka: kz.blocks.filter(b => b.kind === 'poka').length,
    smart: kz.blocks.filter(b => b.kind === 'smart').length, mails: kz.blocks.filter(b => b.kind === 'mail').length,
    blocksHold: kz.blocks.filter(b => b.kind === 'hold').length, blocksScrap: kz.blocks.filter(b => b.kind === 'scrap').length,
    blocksZone: kz.blocks.filter(b => b.kind === 'zone').length, zoneWrong: zoneViolations().length,
    heldNow: Object.keys(holdData).length, holdAudits: readJSON('resHoldAuditV1', []).filter(a => a.t > now - 30 * DAY),
    ccTotal: cc.length, ccOk, ccAcc: cc.length ? Math.round(ccOk / cc.length * 100) : null,
    agingNow, agingStart, outs7: histLog.filter(e => e.a === 'del' && e.t > now - 7 * DAY).length,
  };
}
function renderKaizen(){
  const s = kaizenStats(), set = kz.set;
  const cmp = (title, b, a, nb, na) => {
    const mx = Math.max(b || 0, a || 0) || 1;
    return `<div class="kz-cmp"><div class="kz-cmp-h"><b>${title}</b><span class="kz-pct ${b && a !== null && a < b ? 'good' : ''}">${pctTxt(b, a)}</span></div>
      <div class="kz-bar"><span>ก่อน</span><i style="width:${(b || 0) / mx * 100}%" class="b"></i><em>${secTxt(b)}</em></div>
      <div class="kz-bar"><span>หลัง</span><i style="width:${(a || 0) / mx * 100}%" class="a"></i><em>${secTxt(a)}</em></div>
      <small>วัด Before ${nb} ครั้ง · After ${na} ครั้ง (อัตโนมัติ)</small></div>`;
  };
  const fpd = Number(set.findPerDay) || (s.findPerDay ? Math.round(s.findPerDay) : 20), apd = Number(set.addPerDay) || (s.addPerDay ? Math.round(s.addPerDay) : 10);
  const savedSec = ((s.findBefore && s.findAfter !== null ? Math.max(0, s.findBefore - s.findAfter) : 0) * fpd + (s.addBefore && s.addAfter !== null ? Math.max(0, s.addBefore - s.addAfter) : 0) * apd);
  const hYear = savedSec * 365 / 3600, wage = Number(set.wage) || 0;
  const sw = kzRun.stopwatch;
  $('kzBody').innerHTML = `
    <div class="kz-grid">
      ${cmp('⏱ เวลาหางาน (หาช่อง / ถาด)', s.findBefore, s.findAfter, s.nFindBase, s.nFind)}
      ${cmp('📥 เวลารับงานเข้า Store', s.addBefore, s.addAfter, s.nAddBase, s.nAdd)}
      <div class="kz-tiles">
        <div><span>ป้องกันวางเกิน 80</span><b>${s.blocksOver}</b><small>ครั้งที่ระบบบล็อก</small></div>
        <div><span>Poka-yoke จับช่องผิด</span><b>${s.blocksPoka}</b><small>ครั้ง</small></div>
        <div><span>ความแม่นยำสต็อก</span><b>${s.ccAcc === null ? '-' : s.ccAcc + '%'}</b><small>Cycle Count 30 วัน (${s.ccOk}/${s.ccTotal})</small></div>
        <div><span>งานค้าง ≥14 วัน</span><b>${s.agingStart} → ${s.agingNow}</b><small>ตอนเริ่มเก็บข้อมูล → ตอนนี้</small></div>
        <div><span>นำออก 7 วัน</span><b>${s.outs7}</b><small>รายการ (ปิดงาน / Dispose)</small></div>
        <div><span>ใช้ Smart / แจ้งเจ้าของ</span><b>${s.smart} / ${s.mails}</b><small>ครั้ง</small></div>
        <div class="kz-hold"><span>🔒 กัน Scrap / หยิบงาน Hold</span><b>${s.blocksHold}</b><small>ครั้งที่ระบบบล็อก · Hold อยู่ ${s.heldNow} Job</small></div>
        <div class="kz-hold"><span>สแกนป้ายผิดตอน Scrap</span><b>${s.blocksScrap}</b><small>ครั้งที่กันได้</small></div>
        <div class="kz-hold"><span>ตรวจงาน Hold ประจำกะ</span><b>${s.holdAudits.length ? Math.round(s.holdAudits.filter(a => a.ok).length / s.holdAudits.length * 100) + '%' : '-'}</b><small>พบครบ 30 วัน (${s.holdAudits.filter(a => a.ok).length}/${s.holdAudits.length})</small></div>
        <div class="kz-zone"><span>🗂 กันวางผิดโซน (Product / Type / HOLD)</span><b>${s.blocksZone}</b><small>ครั้งที่ระบบบล็อก · ตอนนี้ผิดโซน ${s.zoneWrong} รายการ</small></div>
      </div>
    </div>
    <div class="kz-row">
      <div class="kz-base">
        <div class="sum-title">โหมดจับเวลาแบบเดิม (Before)</div>
        <p class="hint-small">ให้คนทำงานแบบเดิม (ไม่ใช้ระบบนี้) แล้วกดจับเวลา · หรือใส่เวลาที่วัดไว้แล้วเป็นวินาที</p>
        <div class="kz-sw">
          <div class="seg sm" id="kzTask" role="radiogroup" aria-label="งานที่วัด">
            <button type="button" role="radio" data-kt="find" aria-checked="${(sw ? sw.task : kzRun.task || 'find') === 'find'}">หางาน</button>
            <button type="button" role="radio" data-kt="add" aria-checked="${(sw ? sw.task : kzRun.task || 'find') === 'add'}">รับงานเข้า</button>
          </div>
          <button type="button" class="btn ${sw ? 'danger' : 'primary'} sm" id="kzSw">${sw ? '■ หยุด' : '▶ เริ่มจับเวลา'}</button>
          <b class="kz-clock" id="kzClock">${sw ? '…' : '0.0 วิ'}</b>
        </div>
        <div class="kz-man"><input id="kzManual" type="number" min="1" step="0.1" placeholder="วินาที" /><input id="kzNote" placeholder="หมายเหตุ เช่น ชื่อคนวัด" /><button type="button" class="btn ghost sm" id="kzAddMan">+ เพิ่มค่า Before</button><button type="button" class="btn ghost sm" id="kzDelLast" ${kz.base.length ? '' : 'disabled'}>ลบค่าล่าสุด</button></div>
      </div>
      <div class="kz-roi">
        <div class="sum-title">ROI · ผลประหยัด</div>
        <div class="kz-in">
          <label>หางาน ครั้ง/วัน<input type="number" min="0" data-kset="findPerDay" value="${esc(set.findPerDay)}" placeholder="${fpd}" /></label>
          <label>รับงาน ครั้ง/วัน<input type="number" min="0" data-kset="addPerDay" value="${esc(set.addPerDay)}" placeholder="${apd}" /></label>
          <label>ค่าแรง บาท/ชม.<input type="number" min="0" data-kset="wage" value="${esc(set.wage)}" placeholder="ไม่บังคับ" /></label>
        </div>
        <div class="kz-out">
          <div><span>ประหยัด/วัน</span><b>${secTxt(savedSec)}</b></div>
          <div><span>ต่อเดือน</span><b>${(hYear / 12).toFixed(1)} ชม.</b></div>
          <div><span>ต่อปี</span><b>${hYear.toFixed(0)} ชม.</b></div>
          <div><span>คิดเป็นเงิน/ปี</span><b>${wage ? '฿' + fmt(Math.round(hYear * wage)) : '-'}</b></div>
        </div>
        <p class="hint-small">= (เวลาก่อน − หลัง) × จำนวนครั้งต่อวัน × 365 วัน · ช่องว่างใช้ค่าที่วัดได้จริงจากระบบ</p>
      </div>
    </div>`;
}
function kzStopwatch(){
  if (kzRun.stopwatch){
    const sw = kzRun.stopwatch, ms = performance.now() - sw.at;
    clearInterval(sw.timer); kzRun.stopwatch = null;
    kz.base.push({ t: Date.now(), ms: Math.round(ms), task: sw.task, note: $('kzNote') ? $('kzNote').value.trim() : '' }); kzSave();
    showToast('บันทึกค่า Before แล้ว', `${sw.task === 'find' ? 'หางาน' : 'รับงานเข้า'} ${secTxt(ms / 1000)}`);
    renderKaizen(); return;
  }
  const task = kzRun.task || 'find';
  kzRun.stopwatch = { task, at: performance.now(), timer: setInterval(() => { const c = $('kzClock'); if (c && kzRun.stopwatch) c.textContent = secTxt((performance.now() - kzRun.stopwatch.at) / 1000); }, 100) };
  renderKaizen();
}
function exportKaizen(){
  const rows = [
    ...kz.base.map(b => ({ Time: fmtStamp(new Date(b.t).toISOString()), Type: 'Before', Task: b.task, Seconds: (b.ms / 1000).toFixed(1), Detail: b.note || '' })),
    ...kz.find.map(b => ({ Time: fmtStamp(new Date(b.t).toISOString()), Type: 'After', Task: 'find', Seconds: (b.ms / 1000).toFixed(1), Detail: b.via || '' })),
    ...kz.add.map(b => ({ Time: fmtStamp(new Date(b.t).toISOString()), Type: 'After', Task: 'add', Seconds: (b.ms / 1000).toFixed(1), Detail: '' })),
    ...kz.blocks.map(b => ({ Time: fmtStamp(new Date(b.t).toISOString()), Type: 'Event', Task: b.kind, Seconds: '', Detail: b.detail })),
  ];
  downloadFile(`resonance_kaizen_${stamp()}.csv`, toCSV(['Time', 'Type', 'Task', 'Seconds', 'Detail'], rows));
  showToast('Export สำเร็จ', `${rows.length} รายการ`);
}

/* ===================== CYCLE COUNT (blind count of a few positions every shift) ===================== */
const CC_PER_SHIFT = 3;
function ccPicks(){
  const seed0 = shiftStartOf(Date.now());
  let s = seed0 % 2147483647;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const keys = posKeys().map(k => { const [rk, sd, f, c] = k.split('|'); return { k, q: sumQty(positionRows(store, rk, sd, f, c)) }; });
  const pool = keys.filter(x => x.q > 0).length >= CC_PER_SHIFT ? keys.filter(x => x.q > 0) : keys;
  const out = [];
  while (out.length < Math.min(CC_PER_SHIFT, pool.length)){ const x = pool[Math.floor(rnd() * pool.length)]; if (!out.includes(x.k)) out.push(x.k); }
  return { shift: seed0, keys: out };
}
function renderCycle(){
  const { shift, keys } = ccPicks();
  const log = readJSON('resCycleV1', []);
  const s = shiftInfo(new Date(shift + 36e5));
  $('ccTip').textContent = `${s ? `กะ ${s.crew} ${s.isDay ? 'เช้า' : 'ดึก'}` : ''} · สุ่ม ${CC_PER_SHIFT} ช่อง · นับโดยไม่ดูยอดในระบบ`;
  const st = kaizenStats();
  $('ccBody').innerHTML = keys.map(k => {
    const done = log.find(c => c.shift === shift && c.key === k);
    const res = done ? (done.counted === done.expected ? `<span class="cc-ok">✓ ตรง (${done.counted})</span>` : `<span class="cc-bad">✗ นับได้ ${done.counted} · ระบบ ${done.expected} (${done.counted - done.expected > 0 ? '+' : ''}${done.counted - done.expected})</span>`) : '';
    return `<div class="cc-row"><b>${keyTxt(k)}</b>${done ? res : `<input type="number" min="0" data-cck="${k}" placeholder="นับได้ (ชิ้น)" /><button type="button" class="btn soft sm" data-ccsave="${k}">บันทึก</button>`}<button type="button" class="pk-fly" data-ccopen="${k}">ดู</button></div>`;
  }).join('') + `<div class="cc-acc"><span>ความแม่นยำ 30 วัน</span><b>${st.ccAcc === null ? '-' : st.ccAcc + '%'}</b><small>${st.ccOk}/${st.ccTotal} ช่องตรง</small></div>`
    + holdAuditHTML(shift);
}
/* roving audit: every shift someone checks each held job is still on its shelf and carries the HOLD label */
function holdAuditHTML(shift){
  const held = heldJobs().filter(h => h.sj);
  if (!held.length) return '';
  const log = readJSON('resHoldAuditV1', []);
  return `<div class="sum-title" style="margin-top:12px">🔒 ตรวจงาน Hold ประจำกะ (Roving audit)</div>` + held.map(h => {
    const done = log.find(a => a.shift === shift && a.job === h.key);
    return `<div class="cc-row"><b>${esc(h.key)}<small class="ha-loc">${esc(h.sj.locations)}</small></b>${done
      ? (done.ok ? '<span class="cc-ok">✓ อยู่ครบ + มีป้าย HOLD</span>' : `<span class="cc-bad">✗ ${esc(done.note || 'ไม่พบ / ไม่มีป้าย')}</span>`)
      : `<button type="button" class="btn soft sm" data-hacheck="${esc(h.key)}" data-ok="1">✓ ครบ</button><button type="button" class="btn ghost sm" data-hacheck="${esc(h.key)}" data-ok="0">✗ ไม่พบ / ไม่มีป้าย</button>`}
      <button type="button" class="pk-fly" data-holdfly="${esc(h.key)}">หา</button></div>`;
  }).join('');
}
function holdAuditSave(job, ok){
  const log = readJSON('resHoldAuditV1', []);
  const note = ok ? '' : (prompt(`${job}: พบปัญหาอะไร? (เช่น ไม่พบงาน / ป้าย HOLD หลุด)`) || 'ไม่พบ / ไม่มีป้าย');
  log.push({ t: Date.now(), shift: ccPicks().shift, job, ok, note, ed: editor() });
  try { localStorage.setItem('resHoldAuditV1', JSON.stringify(log.slice(-3000))); } catch {}
  if (!ok){ kzBlock('holdaudit', `${job} · ${note}`); showToast(`ตรวจ Hold: ${job} มีปัญหา`, `${note} · แจ้งหัวหน้า/เจ้าของงานทันที`, 'warn'); }
  else showToast('ตรวจ Hold ✓', job);
  renderCycle(); renderKaizen();
}
function ccSave(k){
  const inp = $('ccBody').querySelector(`[data-cck="${k}"]`); if (!inp || inp.value === '') { showToast('ใส่จำนวนที่นับได้', '', 'warn'); return; }
  const [rk, sd, f, c] = k.split('|'), expected = sumQty(positionRows(store, rk, sd, f, c)), counted = Math.max(0, Math.floor(num(inp.value)));
  const log = readJSON('resCycleV1', []);
  log.push({ t: Date.now(), shift: ccPicks().shift, key: k, expected, counted, ed: editor() });
  try { localStorage.setItem('resCycleV1', JSON.stringify(log.slice(-2000))); } catch {}
  if (counted !== expected){ kzBlock('cycle', `${keyTxt(k)} ${counted}/${expected}`); showToast('ยอดไม่ตรง', `${keyTxt(k)} นับได้ ${counted} ระบบมี ${expected} · ตรวจสอบและแก้ใน Data Entry`, 'warn'); }
  else showToast('ยอดตรง ✓', keyTxt(k));
  renderCycle(); renderKaizen();
}

/* ===================== POKA-YOKE: scan the shelf QR before saving ===================== */
let pokaPending = null;
function pokaOn(){ return $('fPoka').checked; }

/* ===================== GUIDE (one-page standard work) + FIRST-RUN TOUR ===================== */
function openGuide(){
  $('guideBody').innerHTML = `
    <div class="g-rules"><div><b>80</b><span>ชิ้น/ช่อง สูงสุด</span></div><div><b>60</b><span>เริ่ม Warning</span></div><div><b>14</b><span>วัน = ค้างนาน</span></div><div><b>24</b><span>ตำแหน่ง (4 ฝั่ง × 3 ชั้น × IN/OUT)</span></div></div>
    <div class="g-grid">
      <section><h4>① รับงานเข้า Store</h4><ol><li>ใส่ชื่อ "ผู้บันทึก" ด้านบน (ครั้งแรกครั้งเดียว)</li><li>Overview → "รับงานเข้า Store" กรอก Job / Type / จำนวน · เลือก Tester</li><li>กด <b>✦ แนะนำช่อง</b> แล้วเลือกช่อง (ดูเส้นทางเดินใน 3D)</li><li>ถ้าเปิด Poka-yoke: สแกน QR ที่ชั้นให้ตรง ระบบจึงบันทึก</li><li>วางถาดตามช่อง · ระบบไม่ยอมให้เกิน 80</li></ol></section>
      <section><h4>② ย้าย IN → OUT</h4><ol><li>คลิกช่องในผัง 2D หรือ 3D</li><li>กด "ย้าย → OUT" ที่แถวงานที่ทดสอบเสร็จ</li><li>ระบบบันทึกทันที และกันไม่ให้ OUT เกิน 80</li></ol></section>
      <section><h4>③ หยิบงานออก (Pick List)</h4><ol><li>กดปุ่ม "Pick List" หรือ Ctrl+K → หยิบ</li><li>เลือก Job หรือเจ้าของงาน · เลือกเริ่มจาก T1–T3</li><li>เดินตามเลขจุด 1, 2, 3 ใน 3D แล้วติ๊กที่หยิบแล้ว</li><li>กด "นำออกที่ติ๊ก" (ผิดกด Undo ได้)</li></ol></section>
      <section><h4>④ ส่งกะ</h4><ol><li>Insights → รายงานส่งกะ → "คัดลอก + เปิด Teams"</li><li>ทำ Cycle Count 3 ช่องของกะ (นับโดยไม่ดูยอด)</li><li>งานค้าง ≥14 วัน → "ร่างอีเมล" ถึงเจ้าของงาน</li></ol></section>
      <section><h4>⑤ หางานเร็ว</h4><ul><li><kbd>Ctrl</kbd>+<kbd>K</kbd> พิมพ์ Job / ตำแหน่ง / คำสั่ง</li><li>ช่องค้นหาใน 3D → บินไปหา</li><li>⌗ สแกน QR · 🎤 สั่งด้วยเสียง</li></ul></section>
      <section><h4>🔒 งาน Hold · ห้าม Scrap</h4><ol><li>Jobs หรือคลิกช่อง → "ติด Hold" ใส่ชื่อ + เหตุผล</li><li>พิมพ์ป้าย QR งานใหม่ → มีแถบแดง HOLD ติดที่ถาด</li><li>ระบบล็อก Scrap / หยิบออก / ลบ งาน Hold อัตโนมัติ</li><li>จะ Scrap งานใด ต้องสแกนป้ายงานให้ตรงก่อน</li><li>ปลด Hold ต้องมีชื่อผู้อนุมัติ · ตรวจงาน Hold ทุกกะใน Insights</li><li>งาน Hold ต้องอยู่ในโซน HOLD (ช่องสีแดง) · ระบบถามให้ย้ายทันทีเมื่อติด/ปลด Hold</li></ol></section>
      <section><h4>🗂 โซนชั้นวาง</h4><ol><li>1 ช่อง = 1 Product + 1 Type · ตั้งที่ ⋯ → ตั้งค่าโซน</li><li>วางผิดโซน ระบบไม่บันทึก · ✦ แนะนำช่อง เลือกเฉพาะช่องที่ถูกโซน</li><li>วางถาด: เริ่มตั้ง 1 ด้านซ้ายเมื่อยืนหน้าชั้น · ตั้งละ ≤ ${TRAYS_PER_STACK} ถาด · ${STACKS_PER_ZONE} ตั้ง/ช่อง · ≤ ${LIMIT} ชิ้น</li><li>งานที่อยู่ผิดโซนขึ้นในแผง 🔒 → ย้ายถาดจริงแล้วกด "ย้าย"</li><li>พิมพ์ป้ายโซนไปติดชั้น: ตั้งค่าโซน → 🖨 พิมพ์ป้ายโซน</li></ol></section>
      <section><h4>🛡 ระบบล่ม / Backup</h4><ul><li>ข้อมูลอยู่บน server + backup อัตโนมัติทุกชั่วโมงและทุกกะ</li><li>ออฟไลน์: ทำงานต่อได้ ระบบส่งข้อมูลให้เองเมื่อกลับมา</li><li>⋯ → "พิมพ์ผังงานสำรอง" ทุกกะ ใช้หางานตอนระบบล่ม</li></ul></section>
      <section><h4>⑥ ปุ่มลัด</h4><ul><li><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> ย้อน / ทำซ้ำ</li><li><kbd>Ctrl</kbd>+<kbd>S</kbd> บันทึก Data Entry</li><li><kbd>Esc</kbd> ออกจากโหมดทีวี / โหมดเดิน</li><li>🔔 เปิดแจ้งเตือนเดสก์ท็อป</li></ul></section>
    </div>`;
  if (!$('guideDialog').open) $('guideDialog').showModal();
}
function printGuide(){
  const w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Resonance Store · Standard Work</title><style>@page{size:A4;margin:12mm}body{font-family:"IBM Plex Sans Thai","Segoe UI",Tahoma,sans-serif;font-size:10.5pt;color:#111}h1{font-size:17pt;margin:0 0 8px;border-bottom:3px solid #6EBE49}h4{margin:0 0 4px;font-size:11.5pt}.g-rules{display:flex;gap:8px;margin-bottom:10px}.g-rules div{border:1px solid #ccc;border-radius:6px;padding:6px 10px}.g-rules b{font-size:16pt;display:block}.g-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}section{border:1px solid #ddd;border-radius:6px;padding:8px 10px}ol,ul{margin:0;padding-left:18px}kbd{border:1px solid #999;border-radius:3px;padding:0 4px;font-size:9pt}</style></head><body><h1>Resonance Store · Standard Work</h1>${$('guideBody').innerHTML}<script>window.onload=function(){window.print()}<\/script></body></html>`);
  w.document.close();
}
const TOUR = [
  ['#tabs', 'เมนูด้านซ้าย', 'ภาพรวม · 3D Store ดูเต็มจอ · Insights รายงานและ Kaizen · Jobs · Data Entry'],
  ['.toolbar', 'ปุ่มที่ใช้บ่อย', 'ใส่ชื่อผู้บันทึกครั้งเดียว · รับงานเข้า · หยิบงานออก · ย้อน (Undo) · ⋯ เพิ่มเติม = Import / Export / ป้าย QR'],
  ['#addPanel', 'รับงานเข้า Store', 'กรอกงาน เลือก Tester แล้วกด ✦ แนะนำช่อง ระบบเลือกช่องที่ดีที่สุดและกันไม่ให้เกิน 80'],
  ['#flyForm', 'ค้นหาแล้วบินไปหา', 'พิมพ์ Job แล้วกด Enter กล้อง 3D บินไปที่ถาด · ⌗ สแกน QR · 🎤 สั่งด้วยเสียง'],
  ['#modeSeg', 'Heatmap / X-ray', 'ดูความเต็มหรืออายุงานแบบมองทะลุแร็ก ช่องที่ต้องรีบจัดการจะกะพริบ'],
  ['#stagePanel .stage', 'Store 3D', 'ลากหมุน · ล้อเมาส์ซูม · คลิกช่องดูรายละเอียด · พนักงานจะเดินถือถาดไปวางเมื่อรับงานเข้า'],
  ['#tmBar', 'Time Machine', 'เลื่อนย้อนดู Store ณ เวลาใดก็ได้ หรือกด ▶ เล่นย้อนหลัง'],
  ['#kioskBtn', 'โหมดจอทีวี / Andon', 'เปิดค้างบนจอในแลป มีไฟสถานะ เขียว-เหลือง-แดง และแถบแจ้งเตือนวิ่ง'],
  ['[data-tab="insights"]', 'Insights + Kaizen', 'ส่งกะ · พยากรณ์วันเต็ม · สถิติ Tester · Kaizen Dashboard ก่อน/หลัง · Cycle Count'],
  ['#cmdkBtn', 'Ctrl + K', 'ทางลัดทุกอย่าง พิมพ์ชื่อคำสั่ง ตำแหน่ง หรือ Job ได้จากทุกหน้า'],
  ['#guideBtn', 'คู่มือ', 'เปิดคู่มือ 1 หน้า (Standard Work) หรือเริ่มทัวร์นี้ใหม่ได้ที่ปุ่ม ?'],
];
const tour = { i:0, el:null };
function startTour(){
  if ($('guideDialog').open) $('guideDialog').close();
  if (kiosk.on) exitKiosk();
  setTab('overview');
  tour.i = 0;
  if (!tour.el){
    tour.el = document.createElement('div'); tour.el.className = 'tour';
    tour.el.innerHTML = '<div class="tour-spot"></div><div class="tour-tip" role="dialog" aria-live="polite"><span class="tour-n"></span><b></b><p></p><div><button type="button" class="btn ghost sm" data-tour="skip">ข้าม</button><button type="button" class="btn ghost sm" data-tour="back">ย้อน</button><button type="button" class="btn primary sm" data-tour="next">ถัดไป</button></div></div>';
    document.body.appendChild(tour.el);
    tour.el.addEventListener('click', e => { const b = e.target.closest('[data-tour]'); if (!b) return; const a = b.dataset.tour; if (a === 'skip') endTour(); else { tour.i += a === 'next' ? 1 : -1; if (tour.i >= TOUR.length) endTour(); else showTour(); } });
  }
  tour.el.hidden = false;
  showTour();
}
function showTour(){
  tour.i = Math.max(0, tour.i);
  const [sel, title, text] = TOUR[tour.i], target = document.querySelector(sel);
  if (!target){ tour.i++; if (tour.i < TOUR.length) showTour(); else endTour(); return; }
  target.scrollIntoView({ block:'center', behavior:'smooth' });
  setTimeout(() => {
    const r = target.getBoundingClientRect(), pad = 8;
    const spot = tour.el.querySelector('.tour-spot'), tip = tour.el.querySelector('.tour-tip');
    Object.assign(spot.style, { left:`${r.left - pad}px`, top:`${r.top - pad}px`, width:`${r.width + pad * 2}px`, height:`${Math.min(r.height + pad * 2, innerHeight - 20)}px` });
    tip.querySelector('.tour-n').textContent = `${tour.i + 1} / ${TOUR.length}`;
    tip.querySelector('b').textContent = title; tip.querySelector('p').textContent = text;
    tip.querySelector('[data-tour="back"]').disabled = tour.i === 0;
    tip.querySelector('[data-tour="next"]').textContent = tour.i === TOUR.length - 1 ? 'เสร็จสิ้น' : 'ถัดไป';
    const below = r.bottom + 190 < innerHeight;
    tip.style.top = `${Math.max(12, below ? r.bottom + 14 : r.top - 14 - tip.offsetHeight)}px`;
    tip.style.left = `${Math.min(innerWidth - tip.offsetWidth - 12, Math.max(12, r.left))}px`;
  }, 420);
}
function endTour(){ if (tour.el) tour.el.hidden = true; try { localStorage.setItem('resTourV1', '1'); } catch {} }

/* ===================== TRAINING (who has been trained, hands-on check + quiz, shared on the server) =====================
   train = { attempts: [{ id, at, name, empId, crew, trainer, score, total, passed, practical:[bool], wrong:[qid] }] }
   A person is keyed by employee ID (or by name when there is none); their best attempt decides the status. */
const TRAIN_PASS = 0.8, TRAIN_QN = 10;
const TRAIN_PRACTICAL = [
  'รับงานเข้า: ใส่ข้อมูล → ✦ แนะนำช่อง → วางตามไฮไลต์ → กด ✓ วางแล้ว',
  'หางาน: พิมพ์ Job No. ในช่องค้นหา 3D แล้วไปหยิบถูกช่อง',
  'หยิบงานออกด้วย Pick List: ติ๊กทีละจุด แล้วกด นำออกที่ติ๊ก',
  'ติด Hold (ชื่อ + เหตุผล) และรู้ว่าปลด Hold ต้องมีผู้อนุมัติ',
  'รู้วิธีใช้ผังกระดาษเมื่อระบบใช้ไม่ได้',
];
const TRAIN_QUIZ = [
  { id:'limit', q:'ตำแหน่งหนึ่ง (1 ช่อง) เก็บงานได้สูงสุดกี่ชิ้น?', c:['60 ชิ้น', '80 ชิ้น', '100 ชิ้น', 'ไม่จำกัด'], a:1, why:'สูงสุด 80 ชิ้นต่อช่อง ระบบเตือน (Warning) ตั้งแต่ 60 ชิ้น และไม่ให้บันทึกเกิน 80' },
  { id:'editor', q:'ก่อนบันทึกข้อมูลทุกครั้ง ต้องทำอะไรก่อน?', c:['รีเฟรชหน้าเว็บ', 'ใส่ชื่อตัวเองในช่อง "ผู้บันทึก"', 'กด Export ไฟล์', 'ไม่ต้องทำอะไร'], a:1, why:'ชื่อในช่อง "ผู้บันทึก" ถูกบันทึกไว้กับทุกการแก้ไข (Last_Editor และ Audit Log) เพื่อตรวจย้อนหลังได้' },
  { id:'smart', q:'ปุ่ม "✦ แนะนำช่อง (Smart)" ตอนรับงานเข้า ทำอะไร?', c:['เลือกช่องที่ว่างที่สุดเสมอ', 'เลือกช่องที่ถูกโซน Product/Type มีที่พอ และใกล้ Tester', 'สุ่มช่องให้', 'ลบงานเก่าออกให้มีที่ว่าง'], a:1, why:'Smart เลือกเฉพาะช่องที่โซนรับ Product/Type นั้น รับจำนวนได้ครบ และเดินจาก Tester ใกล้ที่สุด' },
  { id:'zone', q:'ถ้าพยายามบันทึกงานลงช่องที่ผิดโซน ระบบจะทำอย่างไร?', c:['บันทึกให้ปกติ', 'บันทึกแต่ขึ้นสีเหลือง', 'ไม่บันทึก และบอกว่าโซนนั้นรับอะไร', 'ย้ายงานไปช่องอื่นเอง'], a:2, why:'ระบบไม่บันทึกงานที่ผิดโซน (Poka-yoke) ต้องเลือกช่องที่ถูกโซน หรือใช้ ✦ แนะนำช่อง' },
  { id:'placed', q:'วางถาดลงช่องที่ไฮไลต์สีเขียวเสร็จแล้ว ต้องทำอะไรต่อ?', c:['ไม่ต้องทำอะไร', 'กด "✓ วางแล้ว" ให้ไฮไลต์ดับ', 'ปิดหน้าเว็บ', 'กด Export'], a:1, why:'กด ✓ วางแล้ว เพื่อยืนยันว่าวางจริง ไฮไลต์จะดับ คนถัดไปจะไม่สับสน' },
  { id:'find', q:'วิธีที่เร็วที่สุดในการหางาน 1 งาน คือ?', c:['เดินดูทีละชั้น', 'ถามเพื่อนในกะ', 'พิมพ์ Job No. ในช่องค้นหา 3D ระบบชี้ช่องให้', 'เปิดไฟล์ Excel'], a:2, why:'พิมพ์ Job No. ระบบบินไปที่ช่องใน 3D บอก Rack · ชั้น · จำนวน ไม่ต้องเดินหา' },
  { id:'hold', q:'งานที่ติด HOLD ทำอะไรในระบบไม่ได้บ้าง?', c:['Scrap ไม่ได้อย่างเดียว', 'หยิบออกไม่ได้อย่างเดียว', 'Scrap / หยิบออก / ลบ ไม่ได้ทั้งหมด', 'ทำได้ทุกอย่างแต่ขึ้นเตือน'], a:2, why:'งาน Hold ถูกบล็อกทั้ง Scrap หยิบออก และลบ ต้องปลด Hold ก่อน (มีผู้อนุมัติ)' },
  { id:'holdset', q:'การติด Hold ให้งาน ต้องใส่ข้อมูลอะไร?', c:['ไม่ต้องใส่อะไร', 'ชื่อผู้ติด Hold + เหตุผล', 'เลข WI', 'รหัสผ่านหัวหน้า'], a:1, why:'ต้องมีชื่อและเหตุผลเสมอ ทุกครั้งถูกเก็บใน Audit Log' },
  { id:'release', q:'การปลด Hold ต้องมีอะไร?', c:['ใครก็ปลดได้ทันที', 'ชื่อผู้อนุมัติ + เหตุผล', 'รอให้ครบ 14 วัน', 'Export ไฟล์ก่อน'], a:1, why:'ปลด Hold ต้องใส่ชื่อผู้อนุมัติและเหตุผล บันทึกไว้ตรวจย้อนหลังได้' },
  { id:'pick', q:'Pick List ใช้ทำอะไร?', c:['พิมพ์ป้าย', 'หยิบงานออกหลายงาน เรียงตามเส้นทางเดินสั้นที่สุด ติ๊กทีละจุด', 'นับสต็อก', 'เปลี่ยนโซน'], a:1, why:'ใส่ Job ที่ต้องหยิบ ระบบไฮไลต์ทุกจุดและเรียงทางเดิน หยิบแล้วติ๊ก ครบแล้วกด นำออกที่ติ๊ก' },
  { id:'offline', q:'ป้ายมุมบนขึ้นว่า "ออฟไลน์ · เก็บในเครื่องนี้" ควรทำอย่างไร?', c:['หยุดใช้งานทันที', 'ทำงานต่อได้ ข้อมูลจะส่งขึ้น server เองเมื่อกลับมา และแจ้งผู้ดูแล', 'ลบข้อมูลในเครื่อง', 'ปิดเครื่อง'], a:1, why:'ระหว่างออฟไลน์ เครื่องเก็บรายการไว้ และส่งขึ้นเองเมื่อ server กลับมา ถ้าเป็นนานให้แจ้งผู้ดูแลระบบ' },
  { id:'paper', q:'ถ้าระบบใช้ไม่ได้นาน หรือคอมพิวเตอร์ดับ ให้ทำอย่างไร?', c:['รอจนระบบกลับมาค่อยวางงาน', 'ใช้ผังกระดาษที่พิมพ์ไว้ทุกกะ จดเข้า–ออก แล้วคีย์ย้อนหลัง', 'วางงานที่ไหนก็ได้', 'โทรหา IT แล้วรอ'], a:1, why:'ผังกระดาษพิมพ์ไว้ทุกกะเพื่อกรณีนี้ จดการเข้า–ออกไว้ แล้วคีย์เข้าระบบเมื่อกลับมา' },
  { id:'age', q:'งานที่อยู่ใน Store นานเท่าไหร่ ระบบจะเตือนให้แจ้งเจ้าของงาน?', c:['3 วัน', '7 วัน', '14 วันขึ้นไป', '30 วัน'], a:2, why:'งานค้าง 14 วันขึ้นไปขึ้นในรายการแจ้งเจ้าของงาน (Owner) เพื่อคืนหรือตัดสินใจ' },
  { id:'undo', q:'บันทึกผิดไปเมื่อสักครู่ แก้อย่างไรเร็วที่สุด?', c:['ลบทั้งแถวแล้วพิมพ์ใหม่', 'กด "↶ ย้อน" (Undo)', 'Import ไฟล์ใหม่ทั้งหมด', 'แจ้ง IT'], a:1, why:'ปุ่ม ↶ ย้อน ย้อนการบันทึกล่าสุดได้ทันที (และ ↷ ทำซ้ำ)' },
];
let train = readJSON('resTrainV1', { attempts: [] });
let trainQuiz = null;   /* the quiz on screen: [{ ...question, order:[choice idx] }] */
function saveTrain(){ try { localStorage.setItem('resTrainV1', JSON.stringify(train)); } catch {} }
const trainKey = a => (String(a.empId || '').trim().toUpperCase()) || ('N:' + String(a.name || '').trim().toLowerCase().replace(/\s+/g, ' '));
const fmtDT = t => { const d = new Date(t); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
/* one row per person: best attempt (passed first, then highest score), number of attempts, latest crew */
function trainPeople(){
  const by = {};
  (train.attempts || []).forEach(a => { (by[trainKey(a)] ||= []).push(a); });
  return Object.values(by).map(list => {
    list.sort((x, y) => x.at - y.at);
    const best = [...list].sort((x, y) => (y.passed - x.passed) || (y.score / y.total - x.score / x.total) || (y.at - x.at))[0];
    const last = list[list.length - 1];
    return { name: last.name, empId: last.empId || '', crew: last.crew, best, last, tries: list.length, passedAt: list.find(a => a.passed)?.at || null };
  }).sort((a, b) => (a.crew || '').localeCompare(b.crew || '') || a.name.localeCompare(b.name, 'th'));
}
function renderTrain(){
  const people = trainPeople(), crewF = $('trCrewFilter').value;
  const crews = ['A', 'B', 'C'];
  $('trKpis').innerHTML = crews.map(c => {
    const ps = people.filter(p => p.crew === c), ok = ps.filter(p => p.best.passed).length;
    return `<div class="tr-kpi"><span>กะ ${c}</span><b>${ok}</b><small>ผ่านแล้ว จาก ${ps.length} คนที่อบรม</small></div>`;
  }).join('') + `<div class="tr-kpi all"><span>รวม 3 กะ</span><b>${people.filter(p => p.best.passed).length}</b><small>ผ่านแล้ว จาก ${people.length} คน</small></div>`;
  const rows = people.filter(p => !crewF || p.crew === crewF);
  $('trTable').innerHTML = `<thead><tr><th>ชื่อ</th><th>รหัสพนักงาน</th><th>กะ</th><th>ผล</th><th>คะแนนดีสุด</th><th>ภาคปฏิบัติ</th><th>วันที่ผ่าน</th><th>ผู้สอน</th><th>สอบ (ครั้ง)</th></tr></thead><tbody>${
    rows.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.empId || '-')}</td><td>${esc(p.crew || '-')}</td>
      <td><span class="badge ${p.best.passed ? 'normal' : 'over'}">${p.best.passed ? 'ผ่าน' : 'ยังไม่ผ่าน'}</span></td>
      <td class="num">${p.best.score}/${p.best.total}</td><td class="num">${p.best.practical.filter(Boolean).length}/${TRAIN_PRACTICAL.length}</td>
      <td>${p.passedAt ? fmtDT(p.passedAt) : '-'}</td><td>${esc(p.best.trainer || '-')}</td><td class="num">${p.tries}</td></tr>`).join('')
    || `<tr><td colspan="9" class="hint-small" style="text-align:center;padding:18px">ยังไม่มีผลการอบรม${crewF ? ` ในกะ ${crewF}` : ''}</td></tr>`}</tbody>`;
}
function trainStart(){
  const name = $('trName').value.trim(), crew = $('trCrew').value, trainer = $('trTrainer').value.trim();
  if (!name || !crew || !trainer){ showToast('กรอกข้อมูลให้ครบ', 'ต้องมีชื่อผู้อบรม กะ และชื่อผู้สอน', 'warn'); return; }
  const pool = [...TRAIN_QUIZ].sort(() => Math.random() - 0.5).slice(0, TRAIN_QN);
  trainQuiz = pool.map(q => ({ ...q, order: q.c.map((_, i) => i).sort(() => Math.random() - 0.5) }));
  $('trQuiz').innerHTML = trainQuiz.map((q, n) => `<fieldset class="tr-q" data-q="${n}"><legend><b>${n + 1}.</b> ${esc(q.q)}</legend>${
    q.order.map(i => `<label class="tr-opt"><input type="radio" name="trq${n}" value="${i}"><span>${esc(q.c[i])}</span></label>`).join('')}</fieldset>`).join('')
    + `<div class="tr-actions"><button class="btn primary" type="button" id="trSubmit">ส่งคำตอบ</button><span class="hint-small">ผ่านเมื่อได้ ${Math.ceil(TRAIN_QN * TRAIN_PASS)}/${TRAIN_QN} ขึ้นไป และทำภาคปฏิบัติครบ</span></div>`;
  $('trResult').hidden = true; $('trQuiz').hidden = false;
  $('trSubmit').addEventListener('click', trainSubmit);
  $('trQuiz').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function trainSubmit(){
  const picks = trainQuiz.map((q, n) => { const r = document.querySelector(`input[name="trq${n}"]:checked`); return r ? Number(r.value) : null; });
  const missing = picks.findIndex(v => v === null);
  if (missing >= 0){ showToast('ยังตอบไม่ครบ', `ข้อ ${missing + 1} ยังไม่ได้เลือกคำตอบ`, 'warn'); document.querySelector(`.tr-q[data-q="${missing}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const wrong = trainQuiz.filter((q, n) => picks[n] !== q.a);
  const practical = [...document.querySelectorAll('#trPractical input')].map(i => i.checked);
  const score = trainQuiz.length - wrong.length, total = trainQuiz.length;
  const passed = score / total >= TRAIN_PASS && practical.every(Boolean);
  const att = { id: newId(), at: Date.now(), name: $('trName').value.trim(), empId: $('trEmp').value.trim(), crew: $('trCrew').value, trainer: $('trTrainer').value.trim(),
    score, total, passed, practical, wrong: wrong.map(q => q.id) };
  train.attempts = [...(train.attempts || []), att];
  saveTrain();
  $('trQuiz').hidden = true; $('trResult').hidden = false;
  $('trResult').innerHTML = `<div class="tr-score ${passed ? 'ok' : 'no'}"><b>${score}/${total}</b><span>${passed ? '✓ ผ่านการอบรม' : '✗ ยังไม่ผ่าน'}</span>
      <small>${!practical.every(Boolean) ? 'ภาคปฏิบัติยังไม่ครบ · ' : ''}${score / total < TRAIN_PASS ? `ต้องได้ ${Math.ceil(total * TRAIN_PASS)} ข้อขึ้นไป · ` : ''}บันทึกผลแล้ว ${fmtDT(att.at)}</small></div>
    ${wrong.length ? `<h4>ข้อที่ตอบผิด · ทบทวนก่อนสอบใหม่</h4>${wrong.map(q => `<div class="tr-why"><b>${esc(q.q)}</b><span>คำตอบที่ถูก: ${esc(q.c[q.a])}</span><small>${esc(q.why)}</small></div>`).join('')}` : ''}
    <div class="tr-actions"><button class="btn soft" type="button" id="trAgain">${passed ? 'คนถัดไป' : 'สอบใหม่'}</button></div>`;
  $('trAgain').addEventListener('click', () => { if (passed) { ['trName', 'trEmp'].forEach(id => { $(id).value = ''; }); document.querySelectorAll('#trPractical input').forEach(i => { i.checked = false; }); $('trResult').hidden = true; $('trName').focus(); } else trainStart(); });
  showToast(passed ? 'ผ่านการอบรม' : 'บันทึกผลแล้ว', `${att.name} · ${score}/${total}`, passed ? 'success' : 'warn');
  renderTrain();
}
function trainExport(){
  const cols = ['ชื่อ', 'รหัสพนักงาน', 'กะ', 'ผล', 'คะแนน', 'ภาคปฏิบัติ', 'ผู้สอน', 'วันเวลา'];
  const rows = [...(train.attempts || [])].sort((a, b) => a.at - b.at).map(a => ({ 'ชื่อ': a.name, 'รหัสพนักงาน': a.empId, 'กะ': a.crew, 'ผล': a.passed ? 'ผ่าน' : 'ไม่ผ่าน',
    'คะแนน': `${a.score}/${a.total}`, 'ภาคปฏิบัติ': `${a.practical.filter(Boolean).length}/${TRAIN_PRACTICAL.length}`, 'ผู้สอน': a.trainer, 'วันเวลา': fmtDT(a.at) }));
  downloadFile(`Resonance_Training_${stamp()}.csv`, toCSV(cols, rows));
}
/* printable training record with signature columns (for the training file / audit) */
function trainPrint(){
  const crewF = $('trCrewFilter').value, people = trainPeople().filter(p => !crewF || p.crew === crewF);
  const w = window.open('', '_blank');
  if (!w){ showToast('เปิดหน้าพิมพ์ไม่ได้', 'อนุญาต Pop-up ให้หน้านี้ก่อน', 'error'); return; }
  w.document.write(`<!doctype html><meta charset="utf-8"><title>บันทึกการอบรม Resonance Store</title><style>
    body{font-family:Tahoma,sans-serif;margin:24px;color:#111} h1{font-size:20px;margin:0} p{margin:4px 0 14px;color:#444;font-size:13px}
    table{width:100%;border-collapse:collapse;font-size:12.5px} th,td{border:1px solid #999;padding:7px 6px;text-align:left} th{background:#eee} td.s{width:110px}
    @media print{button{display:none}}</style>
    <h1>บันทึกการอบรมการใช้งาน Resonance Store${crewF ? ` · กะ ${crewF}` : ' · ทั้ง 3 กะ'}</h1>
    <p>HSA Resonance Lab · เกณฑ์ผ่าน: แบบทดสอบ ${Math.ceil(TRAIN_QN * TRAIN_PASS)}/${TRAIN_QN} ขึ้นไป และภาคปฏิบัติครบ ${TRAIN_PRACTICAL.length} ข้อ · พิมพ์เมื่อ ${fmtDT(Date.now())}</p>
    <table><tr><th>#</th><th>ชื่อ - สกุล</th><th>รหัส</th><th>กะ</th><th>วันที่อบรม</th><th>คะแนน</th><th>ผล</th><th>ผู้สอน</th><th>ลายเซ็นผู้อบรม</th><th>ลายเซ็นผู้สอน</th></tr>
    ${people.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.empId)}</td><td>${esc(p.crew)}</td><td>${fmtDT(p.best.at)}</td><td>${p.best.score}/${p.best.total}</td><td>${p.best.passed ? 'ผ่าน' : 'ไม่ผ่าน'}</td><td>${esc(p.best.trainer)}</td><td class="s"></td><td class="s"></td></tr>`).join('')}
    </table><p style="margin-top:28px">ผู้ตรวจสอบ ............................................ วันที่ ....................</p>
    <button onclick="print()">พิมพ์</button>`);
  w.document.close();
}
$('trPractical').innerHTML = TRAIN_PRACTICAL.map((t, i) => `<label class="tr-check"><input type="checkbox" data-p="${i}"><span>${esc(t)}</span></label>`).join('');
$('trStart').addEventListener('click', trainStart);
$('trCrewFilter').addEventListener('change', renderTrain);
$('trExport').addEventListener('click', trainExport);
$('trPrint').addEventListener('click', trainPrint);
window.addEventListener('storage', e => {
  /* sync.js signals remote changes with a storage event; reload the training record whenever it may have changed */
  if (e.key && !/^(resTrainV1|resStoreV7)$/.test(e.key)) return;
  train = readJSON('resTrainV1', { attempts: [] });
  if (currentTab === 'train') renderTrain();
});

/* ===================== TABS ===================== */
function setTab(t){
  const TABS = ['overview','3d','insights','jobs','entry','train'];
  if (!TABS.includes(t)) t = 'overview';
  if (kiosk.on && t !== '3d') exitKiosk();
  if (three.ready && three.walking() && t !== '3d' && t !== 'overview') three.walkStop();
  currentTab = t;
  try { localStorage.setItem('resTabV1', t); } catch {}
  document.querySelectorAll('#tabs [data-tab]').forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  TABS.forEach(v => { $(`view-${v}`).hidden = v !== t; });
  const [title, sub] = PAGE_TITLES[t];
  $('pageTitle').textContent = title; $('pageSub').textContent = sub;
  /* the single 3D stage is shared: Overview shows it inline, the 3D tab shows it large */
  const put = (id, slot) => { const p = $(id), s = $(slot); if (p.parentElement !== s) s.appendChild(p); };
  if (t === 'overview') put('stagePanel', 'overview3dSlot');
  if (t === '3d') put('stagePanel', 'view-3d');
  if (t === '3d' || t === 'overview'){ if (three.ready) start3D(); else init3D(); } else stop3D();
  refreshTables();
  window.scrollTo({ top:0 });
}
const PAGE_TITLES = {
  overview: ['ภาพรวม', 'KPI · รับงานเข้า · 3D · ผังชั้นวาง'],
  '3d': ['3D Store', 'ค้นหา · Heatmap · Pick List · Time Machine · โหมดทีวี'],
  insights: ['Insights', 'ส่งกะ · พยากรณ์ · Kaizen · Cycle Count · Audit Log'],
  jobs: ['Jobs', 'งานที่อยู่ใน Store และการ Dispose'],
  entry: ['Data Entry', 'แก้ไขข้อมูล Store โดยตรง'],
  train: ['อบรม', 'ภาคปฏิบัติ + แบบทดสอบ · บันทึกว่าใครผ่านแล้ว ทั้ง 3 กะ'],
};
function refreshTables(){
  if (currentTab === 'jobs') renderJobsTable();
  if (currentTab === 'entry') renderEntryTable();
  if (currentTab === 'train') renderTrain();
  renderInsights();
}

/* ===================== RENDER ===================== */
function renderDashboard(){
  const rows = filteredData();
  renderActiveFilterText();
  renderKPIs(rows);
  renderRackMap(rows);
  renderTopItems(rows);
  renderAlerts(rows);
  renderHoldList();
  renderJobSummary(rows);
  renderTeamAlert();
  const n = storeJobs(store).length;
  $('tabJobs').textContent = n || '';
  if (three.ready){
    if (tm.active) three.update(rowsAt(tm.T));
    else three.update(rows);
    if (three.match && $('flyBox').value.trim()) flySearchRefresh();
  }
  if ($('posDialog').open) renderPosDialog();
  renderKiosk();
  refreshFlyList();
  if (pick.open) renderPick();
  checkAlerts();
}
/* data changed while a search is shown: keep the highlight, refresh the hit list without flying again */
function flySearchRefresh(){ const keep = three.flyTo; three.flyTo = () => {}; try { flySearch($('flyBox').value); } finally { three.flyTo = keep; } }
function renderAll(){
  renderDashboard();
  refreshTables();
  updateAddForm();
  syncLights();
}

/* ===================== GUIDE LIGHT ON SCREEN (pick-to-light idea, shown only on the 3D / 2D map: the real shelves have no lamps) =====================
   Put-away: the chosen position is highlighted GREEN with "+qty" when work is received, and goes off when the tray is
   placed (operator presses "✓ วางแล้ว" or scans the shelf QR).
   Pick: every stop of the Pick List is highlighted AMBER with its stop number and qty; ticking the items clears it.
   A stop whose remaining work is all on HOLD shows RED "ห้ามหยิบ". Shown in 3D and on the 2D rack map only; no lamp is fitted on the shelves (needs a contamination review first). */
const plight = { put: {} };            /* key -> [{ id, job, qty }] waiting to be placed */
function lightPut(key, row){ (plight.put[key] ||= []).push({ id: row._id, job: row.JOB_NO, qty: num(row.QUANITY) }); syncLights(); }
function confirmPut(key, id, how){
  const l = plight.put[key]; if (!l) return false;
  plight.put[key] = id ? l.filter(x => x.id !== id) : [];
  if (!plight.put[key].length) delete plight.put[key];
  syncLights();
  if (how !== 'auto') showToast('✓ วางแล้ว · ไฮไลต์ดับ', `${keyTxt(key)}${how === 'scan' ? ' · ยืนยันด้วยการสแกนป้ายชั้น' : ''}`);
  return true;
}
function lightMap(){
  const m = {}, ids = new Set(store.map(r => r._id));
  Object.entries(plight.put).forEach(([k, l]) => {
    const live = l.filter(x => ids.has(x.id)); if (!live.length){ delete plight.put[k]; return; }
    m[k] = { kind:'put', text:`วาง +${live.reduce((a, x) => a + x.qty, 0)}`, jobs: live.map(x => x.job).join(', ') };
  });
  try {
    if (pick.open && pick.stops) pick.stops.forEach(s => {
      const left = s.rows.filter(r => !pick.done.has(r._id) && ids.has(r._id)); if (!left.length) return;
      const ok = left.filter(r => !isHeld(r.JOB_NO));
      m[s.k] = ok.length ? { kind:'pick', text:`${s.i + 1} · หยิบ ${sumQty(ok)}`, jobs: ok.map(r => r.JOB_NO).join(', ') }
                         : { kind:'hold', text:`${s.i + 1} · ห้ามหยิบ HOLD`, jobs: left.map(r => r.JOB_NO).join(', ') };
    });
  } catch {}
  return m;
}
function syncLights(){
  let m; try { m = lightMap(); } catch { return; }
  if (three.ready && three.setLights) three.setLights(m);
  document.querySelectorAll('#rackMap .cell[data-pos]').forEach(c => {
    const l = m[c.dataset.pos];
    ['put', 'pick', 'hold'].forEach(kd => c.classList.toggle('lit-' + kd, !!l && l.kind === kd));
    c.dataset.light = l ? `▶ ${l.text}` : '';
  });
  const el = $('plightPanel'); if (!el) return;
  const list = Object.entries(m);
  el.hidden = !list.length;
  el.innerHTML = list.length ? `<div class="pl-h">▶ ไฟนำทางบนจอ · ${list.length} จุด</div>` + list.map(([k, l]) => `<div class="pl-row ${l.kind}">
      <i></i><span><b>${keyTxt(k)}</b><small>${esc(l.text)} · ${esc(l.jobs)}</small></span>
      ${l.kind === 'put' ? `<button type="button" class="mini-btn" data-plok="${k}">✓ วางแล้ว</button>` : `<small class="pl-hint">${l.kind === 'hold' ? 'ห้ามหยิบ' : 'ติ๊กใน Pick List'}</small>`}</div>`).join('') : '';
}

/* ===================== EVENTS ===================== */
$('storeFileInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) importStore(f); e.target.value = ''; });
$('jobFileInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) importJobs(f); e.target.value = ''; });
$('addRowBtn').addEventListener('click', () => addRow());
$('entryAddBtn').addEventListener('click', () => addRow());
$('quickAddBtn').addEventListener('click', () => {
  if (currentTab !== 'overview') setTab('overview');
  setTimeout(() => { $('addPanel').scrollIntoView({ behavior:'smooth', block:'start' }); $('fJob').focus({ preventScroll:true }); }, 60);
});
/* ⋯ menu: close after choosing, or when clicking elsewhere */
$('moreMenu').addEventListener('click', e => { if (e.target.closest('.more-item') && !e.target.closest('label')) $('moreMenu').open = false; });
document.addEventListener('click', e => { if (!e.target.closest('#moreMenu')) $('moreMenu').open = false; });
['storeFileInput', 'jobFileInput'].forEach(id => $(id).addEventListener('change', () => { $('moreMenu').open = false; }));
$('saveBtn').addEventListener('click', () => saveAll());
$('exportBtn').addEventListener('click', exportStore);
$('resetBtn').addEventListener('click', resetData);
$('searchBox').addEventListener('input', renderDashboard);
$('clearFiltersBtn').addEventListener('click', () => {
  Object.keys(filterState).forEach(k => filterState[k].clear());
  $('searchBox').value = '';
  buildFilterBar(); renderDashboard();
});
$('jobSearchBox').addEventListener('input', renderJobsTable);
$('exportJobsBtn').addEventListener('click', exportJobs);
$('notifyTeamBtn').addEventListener('click', notifyTeam);
$('copyAlertBtn').addEventListener('click', async () => {
  const info = teamAlertInfo(); if (!info) return;
  showToast((await copyText(info.message)) ? 'คัดลอกแล้ว' : 'คัดลอกไม่ได้', info.message, 'info');
});
$('tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
$('themeBtn').addEventListener('click', () => {
  const t = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('resThemeV1', t); } catch {}
  applyTheme(t);
});
$('editorName').addEventListener('change', () => { try { localStorage.setItem('resEditorV1', editor()); } catch {} });

/* rack map cells -> position dialog */
$('rackMap').addEventListener('click', e => { const c = e.target.closest('[data-pos]'); if (c) openPos(...c.dataset.pos.split('|')); });
$('rackMap').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.pos){ e.preventDefault(); openPos(...e.target.dataset.pos.split('|')); } });
$('posClose').addEventListener('click', () => $('posDialog').close());
$('posDialog').addEventListener('click', e => {
  if (e.target === $('posDialog')) { $('posDialog').close(); return; }
  const mv = e.target.closest('[data-dmove]'); if (mv){ moveToOut(mv.dataset.dmove); return; }
  if (e.target.closest('[data-dadd]')){ const p = dlgPos; $('posDialog').close(); prefillAdd(p); }
});
$('posDialog').addEventListener('close', () => { dlgPos = null; });

/* hold: buttons in the jobs table, position dialog and hold panel; "หา" flies the 3D camera to the job */
document.addEventListener('click', e => {
  const h = e.target.closest('[data-hold]'); if (h){ openHold(h.dataset.hold); return; }
  const f = e.target.closest('[data-holdfly]'); if (f){ flyToJob(f.dataset.holdfly); return; }
  /* wrong zone: move the job's rows to the best allowed position (after the trays were moved for real) */
  const pl = e.target.closest('[data-plok]'); if (pl){ confirmPut(pl.dataset.plok, null, 'button'); return; }
  const zm = e.target.closest('[data-zmove]');
  if (zm){
    const k = zm.dataset.zmove, to = findZoneFor(k);
    if (!to){ showToast('ไม่มีช่องที่ถูกโซนว่างพอ', `${k}: ไม่มีโซนที่รับ Product/Type นี้และมีที่ว่างพอ · แก้ผังที่ ⋯ → ตั้งค่าโซน`, 'error'); return; }
    if (confirm(`ย้าย ${k} ไป ${keyTxt(to)} (${zoneText(to)})?\nย้ายถาดจริงไปที่ช่องนั้นด้วย`)) moveJobTo(k, to, isHeld(k) ? 'เข้าโซน HOLD' : 'ย้ายเข้าโซนที่ถูกต้อง');
  }
});
$('holdForm').addEventListener('submit', submitHold);
$('paperBtn').addEventListener('click', printPaperMap);

/* jobs table: dispose decision saves immediately; Scrap only after the job label is scanned and the job is not on hold */
$('currentJobTable').addEventListener('change', e => {
  const sel = e.target.closest('[data-dispose]');
  if (sel){
    const k = sel.dataset.dispose;
    if (sel.value === 'Scrap'){
      sel.value = disposeOf(k).status;
      if (holdData[k]){ holdBlock(k, 'Scrap'); return; }
      scrapPending = k; openScan('scrap');
      return;
    }
    setDispose(k, sel.value);
    return;
  }
  const det = e.target.closest('[data-dispose-detail]');
  if (det){
    const k = det.dataset.disposeDetail;
    disposeData[k] = { ...(disposeData[k] || { status:'Pending' }), detail: det.value.trim() };
    saveLocal();
  }
});

/* data entry: edit in place, Save Changes to persist */
$('entryTable').addEventListener('change', e => {
  const inp = e.target.closest('[data-col]'); if (!inp) return;
  const tr = inp.closest('tr[data-id]'); const r = store.find(x => x._id === tr.dataset.id); if (!r) return;
  const c = inp.dataset.col;
  r[c] = c === 'QUANITY' ? Math.max(0, num(inp.value)) : inp.value.trim();
  if (c === 'QUANITY') inp.value = r[c];
  if (['RACK','SIDE','FLOOR','CELL'].includes(c)){
    r.STORE_LOCATION = autoLoc(r);
    tr.querySelector('[data-col="STORE_LOCATION"]').value = r.STORE_LOCATION;
    const act = tr.querySelector('.row-actions');
    act.innerHTML = `${String(r.CELL).toUpperCase() === 'IN' ? `<button type="button" class="mini-btn move" data-move="${r._id}">ย้าย → OUT</button>` : ''}<button type="button" class="mini-btn del" data-del="${r._id}" aria-label="ลบแถว">ลบ</button>`;
  }
  if (editor()){ r.Last_Editor = editor(); tr.querySelector('[data-col="Last_Editor"]').value = r.Last_Editor; }
  inp.closest('td').classList.add('changed');
  if (c === 'QUANITY'){
    const q = sumQty(positionRows(store, r.RACK, r.SIDE, r.FLOOR, String(r.CELL).toUpperCase()));
    if (q > LIMIT) showToast('เกินกำหนด', `${r.RACK}-${r.SIDE} L${r.FLOOR} ${r.CELL} จะมี ${q}/${LIMIT} units`, 'warn');
  }
  setDirty(true);
  if (['RACK','SIDE','CELL','ITEM','PRODUCT','TYPE'].includes(c)) buildFilterBar();
  renderDashboard();
  if (currentTab === 'overview') renderJobsTable();
  updateAddForm();
});
$('entryTable').addEventListener('click', e => {
  const mv = e.target.closest('[data-move]'); if (mv){ moveToOut(mv.dataset.move); return; }
  const del = e.target.closest('[data-del]'); if (del) deleteRow(del.dataset.del);
});

/* 3D: search & fly, colour modes, kiosk, time machine */
$('flyForm').addEventListener('submit', e => { e.preventDefault(); flySearch($('flyBox').value); });
$('flyBox').addEventListener('input', () => { if (!$('flyBox').value.trim()) clearFly(); });
$('flyBox').addEventListener('keydown', e => { if (e.key === 'Escape') clearFly(); });
$('flyClear').addEventListener('click', clearFly);
$('flyResults').addEventListener('click', e => {
  const b = e.target.closest('[data-fly]'); if (!b) return;
  flyIdx = Number(b.dataset.fly);
  $('flyResults').querySelectorAll('[data-fly]').forEach(x => x.classList.toggle('on', x === b));
  three.flyTo(flyHits[flyIdx].k);
});
$('modeSeg').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
$('kioskBtn').addEventListener('click', enterKiosk);
$('kioskExit').addEventListener('click', exitKiosk);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && kiosk.on) exitKiosk(); setTimeout(() => three.ready && three.resize(), 60); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && kiosk.on) exitKiosk(); });
$('tmRange').addEventListener('input', e => { tmStop(); tmSet(Number(e.target.value)); });
$('tmPlay').addEventListener('click', tmPlay);
$('tmLive').addEventListener('click', tmLive);
$('viewHomeBtn').addEventListener('click', () => three.ready && three.go('home'));

/* insights */
$('hoSeg').addEventListener('click', e => { const b = e.target.closest('[data-ho]'); if (!b) return; hoOffset = Number(b.dataset.ho); document.querySelectorAll('#hoSeg [data-ho]').forEach(x => x.setAttribute('aria-checked', String(x === b))); renderHandover(); });
$('statSeg').addEventListener('click', e => { const b = e.target.closest('[data-stat]'); if (!b) return; statBy = b.dataset.stat; document.querySelectorAll('#statSeg [data-stat]').forEach(x => x.setAttribute('aria-checked', String(x === b))); renderStats(); });
$('hoCopy').addEventListener('click', async () => { const ok = await copyText(handoverText(handoverData())); showToast(ok ? 'คัดลอกรายงานส่งกะแล้ว' : 'คัดลอกไม่ได้', ok ? 'วาง (Ctrl+V) ในแชท Teams ได้เลย' : 'ลองอีกครั้ง', ok ? 'success' : 'error'); });
$('hoTeams').addEventListener('click', async () => {
  const ok = await copyText(handoverText(handoverData()));
  const link = HSA_TEAM_EMAILS.find(x => /^https?:/i.test(x));
  if (link) window.open(link, '_blank', 'noopener');
  showToast(link ? 'เปิดแชททีมแล้ว' : 'คัดลอกแล้ว', ok ? 'คัดลอกรายงานไว้แล้ว วาง (Ctrl+V) ได้เลย' : 'คัดลอกข้อความไม่ได้', ok ? 'success' : 'warn');
});
$('hoPng').addEventListener('click', handoverPNG);
$('logSearch').addEventListener('input', renderLog);
$('logExport').addEventListener('click', exportLog);
$('forecastBody').addEventListener('click', e => {
  const b = e.target.closest('[data-flykey]'); if (!b) return;
  if (currentTab !== 'overview' && currentTab !== '3d') setTab('3d');
  $('stagePanel').scrollIntoView({ behavior:'smooth', block:'center' });
  setTimeout(() => three.ready && three.flyTo(b.dataset.flykey), 300);
});

/* QR labels + scanning */
$('qrBtn').addEventListener('click', openQR);
$('qrSeg').addEventListener('click', e => { const b = e.target.closest('[data-qr]'); if (b){ qrKind = b.dataset.qr; renderQR(); } });
$('qrPrint').addEventListener('click', printQR);
document.addEventListener('click', e => { const b = e.target.closest('[data-scan]'); if (b) openScan(b.dataset.scan); });
$('scanInput').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); handleScan($('scanInput').value); } });
$('scanDialog').addEventListener('close', stopScan);
document.querySelectorAll('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
['qrDialog', 'scanDialog', 'holdDialog', 'zoneDialog'].forEach(id => $(id).addEventListener('click', e => { if (e.target === $(id)) $(id).close(); }));
/* zone setup */
$('zoneBtn').addEventListener('click', () => { $('moreMenu').open = false; openZones(); });
$('zoneBody').addEventListener('change', e => {
  if (e.target.dataset.zf !== 'hold') return;
  const tr = e.target.closest('tr'); tr.classList.toggle('hold', e.target.checked);
  tr.querySelectorAll('[data-zf="prod"],[data-zf="type"]').forEach(i => { i.disabled = e.target.checked; });
});
$('zoneSave').addEventListener('click', () => {
  zones = readZoneDialog(); saveZones();
  const bad = zoneViolations().length;
  showToast('บันทึกผังโซนแล้ว', bad ? `มีงานผิดโซน ${bad} รายการ · ดูในแผง 🔒 แล้วย้ายให้ถูก` : 'ทุกงานอยู่ถูกโซน · พิมพ์ป้ายโซนใหม่ไปติดชั้น', bad ? 'warn' : '');
  renderZoneDialog(zones); renderAll(); updateAddForm();
});
$('zoneReset').addEventListener('click', () => { if (confirm('คืนค่าผังโซนแนะนำ? (ยังไม่บันทึกจนกด "บันทึกผังโซน")')) renderZoneDialog(JSON.parse(JSON.stringify(DEFAULT_ZONES))); });
$('zonePrint').addEventListener('click', async () => { try { await loadLib('qrcode.js', 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', () => !!window.qrcode); } catch {} printZoneSigns(); });

/* undo / redo */
$('undoBtn').addEventListener('click', doUndo);
$('redoBtn').addEventListener('click', doRedo);
const typingIn = el => el && el.closest && el.closest('input,textarea,select,[contenteditable="true"]');
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'k'){ e.preventDefault(); if ($('cmdk').open) $('cmdk').close(); else openCmdk(); return; }
  if (!mod || typingIn(e.target)) return;
  if (k === 'z' && !e.shiftKey){ e.preventDefault(); doUndo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)){ e.preventDefault(); doRedo(); }
});

/* pick list */
$('pickBtn').addEventListener('click', openPick);
$('pickClose').addEventListener('click', closePick);
$('pickInput').addEventListener('input', () => { pick.done.clear(); renderPick(); });
$('pickFrom').addEventListener('change', renderPick);
$('pickSeg').addEventListener('click', e => { const b = e.target.closest('[data-pk]'); if (!b) return; pick.mode = b.dataset.pk; document.querySelectorAll('#pickSeg [data-pk]').forEach(x => x.setAttribute('aria-checked', String(x === b))); $('pickInput').value = ''; fillPickList(); renderPick(); });
$('pickSort').addEventListener('click', e => { const b = e.target.closest('[data-ps]'); if (!b) return; pick.sort = b.dataset.ps; document.querySelectorAll('#pickSort [data-ps]').forEach(x => x.setAttribute('aria-checked', String(x === b))); renderPick(); });
$('pickItems').addEventListener('change', e => { const c = e.target.closest('[data-pkid]'); if (!c) return; if (c.checked) pick.done.add(c.dataset.pkid); else pick.done.delete(c.dataset.pkid); renderPick(); });
$('pickItems').addEventListener('click', e => {
  const b = e.target.closest('[data-pkfly]'); if (b && three.ready){ three.flyTo(b.dataset.pkfly); return; }
  const h = e.target.closest('[data-pkhold]'); if (h){ e.preventDefault(); holdBlock(h.dataset.pkhold, 'หยิบออก'); }
});
$('pickDone').addEventListener('click', pickCheckout);

/* command palette */
$('cmdkBtn').addEventListener('click', openCmdk);
$('cmdkInput').addEventListener('input', () => { cmdk.sel = 0; renderCmdk(); });
$('cmdkInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown'){ e.preventDefault(); cmdk.sel = Math.min(cmdk.items.length - 1, cmdk.sel + 1); renderCmdk(); }
  else if (e.key === 'ArrowUp'){ e.preventDefault(); cmdk.sel = Math.max(0, cmdk.sel - 1); renderCmdk(); }
  else if (e.key === 'Enter'){ e.preventDefault(); runCmdk(cmdk.sel); }
});
$('cmdkList').addEventListener('click', e => { const b = e.target.closest('[data-ci]'); if (b) runCmdk(Number(b.dataset.ci)); });
$('cmdk').addEventListener('click', e => { if (e.target === $('cmdk')) $('cmdk').close(); });

/* notifications, voice, walk, ambience */
$('notifyBtn').addEventListener('click', toggleNotify);
setInterval(checkAlerts, 10 * 60 * 1000);
if (SR) $('voiceBtn').hidden = false;
$('voiceBtn').addEventListener('click', voiceListen);
$('walkBtn').addEventListener('click', () => { if (!three.ready) return; if (three.walking()) three.walkStop(); else three.walkStart(); });
$('walkExit').addEventListener('click', () => three.ready && three.walkStop());
$('ambBtn').addEventListener('click', () => { if (!three.ready) return; three.setAmbience(!three.ambience); $('ambBtn').setAttribute('aria-pressed', String(three.ambience)); });
$('flyBox').addEventListener('focus', kzFindStart);

/* insights: kaizen, cycle count, owner mails, weekly report */
$('weeklyBtn').addEventListener('click', weeklyReport);
$('kzExport').addEventListener('click', exportKaizen);
$('kzBody').addEventListener('click', e => {
  const t = e.target.closest('[data-kt]'); if (t && !kzRun.stopwatch){ kzRun.task = t.dataset.kt; renderKaizen(); return; }
  if (e.target.closest('#kzSw')){ kzStopwatch(); return; }
  if (e.target.closest('#kzAddMan')){
    const s = Number($('kzManual').value); if (!(s > 0)){ showToast('ใส่เวลาเป็นวินาที', '', 'warn'); return; }
    kz.base.push({ t: Date.now(), ms: Math.round(s * 1000), task: kzRun.task || 'find', note: $('kzNote').value.trim() }); kzSave();
    showToast('เพิ่มค่า Before แล้ว', `${(kzRun.task || 'find') === 'find' ? 'หางาน' : 'รับงานเข้า'} ${secTxt(s)}`); renderKaizen(); return;
  }
  if (e.target.closest('#kzDelLast')){ if (kz.base.length && confirm('ลบค่า Before ล่าสุด?')){ kz.base.pop(); kzSave(); renderKaizen(); } }
});
$('kzBody').addEventListener('change', e => { const i = e.target.closest('[data-kset]'); if (!i) return; kz.set[i.dataset.kset] = i.value; kzSave(); renderKaizen(); });
$('ccBody').addEventListener('click', e => {
  const s = e.target.closest('[data-ccsave]'); if (s){ ccSave(s.dataset.ccsave); return; }
  const o = e.target.closest('[data-ccopen]'); if (o){ const [rk, sd, f, c] = o.dataset.ccopen.split('|'); openPos(rk, sd, f, c); return; }
  const ha = e.target.closest('[data-hacheck]'); if (ha) holdAuditSave(ha.dataset.hacheck, ha.dataset.ok === '1');
});
$('ccBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.cck) ccSave(e.target.dataset.cck); });
$('ownerTable').addEventListener('click', e => { const b = e.target.closest('[data-draft]'); if (b) draftMail(b.dataset.draft); });
$('ownerTable').addEventListener('change', e => { const i = e.target.closest('[data-mail]'); if (!i) return; ownerMail[i.dataset.mail] = i.value.trim(); try { localStorage.setItem('resOwnerEmailV1', JSON.stringify(ownerMail)); } catch {} });

/* guide + tour */
$('guideBtn').addEventListener('click', openGuide);
$('guidePrint').addEventListener('click', printGuide);
$('tourBtn').addEventListener('click', startTour);
window.addEventListener('resize', () => { if (tour.el && !tour.el.hidden) showTour(); });

/* another tab saved, or sync.js brought in data saved on another PC: pick it up (unless this tab has unsaved edits) */
window.addEventListener('storage', e => {
  if (!e.key || !/^(resStoreV7|jobDetailV7|disposeDataV7|resLogV1|resHoldV1|resHoldLogV1|resHoldAuditV1|resKaizenV1|resCycleV1|resOwnerEmailV1|resZoneV1)$/.test(e.key)) return;
  histLog = readJSON('resLogV1', []); histSnap = readJSON('resLogSnapV1', histSnap); histStart = Number(localStorage.getItem('resLogStartV1')) || histStart;
  jobs = readJSON('jobDetailV7', {}); disposeData = readJSON('disposeDataV7', {});
  holdData = readJSON('resHoldV1', {}); holdLog = readJSON('resHoldLogV1', []);
  zones = readJSON('resZoneV1', null) || zones;
  Object.assign(kz, readJSON('resKaizenV1', {}));
  Object.assign(ownerMail, readJSON('resOwnerEmailV1', {}));
  if (!dirty) store = (readJSON('resStoreV7', []) || []).map(normRow);
  lastUpdated = localStorage.getItem('lastUpdatedV7') || lastUpdated; $('lastUpdated').textContent = fmtStamp(lastUpdated);
  buildFilterBar(); buildJobFilterBar(); renderAll();
});

/* 3D controls */
$('viewAisleBtn').addEventListener('click', () => three.ready && three.go('aisle'));
$('viewTopBtn').addEventListener('click', () => three.ready && three.go('top'));
$('viewRacksBtn').addEventListener('click', () => three.ready && three.go('racks'));
$('spinBtn').addEventListener('click', () => {
  if (!three.ready) return;
  three.controls.autoRotate = !three.controls.autoRotate;
  $('spinBtn').setAttribute('aria-pressed', String(three.controls.autoRotate));
});

window.addEventListener('beforeunload', e => { if (dirty){ e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){ e.preventDefault(); saveAll(); } });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (three.ready) three.applyTheme(); });

/* ===================== INIT ===================== */
(function init(){
  try { const t = localStorage.getItem('resThemeV1'); if (t) applyTheme(t); } catch {}
  try { $('editorName').value = localStorage.getItem('resEditorV1') || ''; } catch {}
  $('lastUpdated').textContent = fmtStamp(lastUpdated);
  /* start the history on first run; record anything changed outside this page since the last visit
     (e.g. by the original dashboard), keeping row ids stable so history stays linked */
  if (histSnap){ adoptIds(store, histSnap); logCtx = { src:'external', ed:'' }; }
  saveLocal();
  renderLegend();
  $('notifyBtn').setAttribute('aria-pressed', String(notif.on));
  try { $('ambBtn').setAttribute('aria-pressed', String(localStorage.getItem('resAmbV1') !== '0')); } catch {}
  /* first visit on this PC: short guided tour */
  try { if (!localStorage.getItem('resTourV1')) setTimeout(() => { if (!kiosk.on) startTour(); }, 1500); } catch {}
  renderShift();
  setInterval(renderShift, 60 * 1000);
  setInterval(() => { if (currentTab === 'jobs') renderJobsTable(); }, 60 * 60 * 1000);
  buildFilterBar();
  buildJobFilterBar();
  initAddForm();
  renderDashboard();
  updateAddForm();
  setTab(currentTab);
})();
