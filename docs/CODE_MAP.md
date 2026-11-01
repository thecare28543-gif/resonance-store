# Code map

## Files

| File | Lines | Role |
|---|---|---|
| `RESONANCE_STORE.html` | ~490 | All markup: top bar, sidebar tabs, panels, dialogs. Elements are found by `id` from `app.js`. |
| `styles.css` | ~880 | Light theme by default, dark theme under `[data-theme="dark"]`. Colours are CSS variables at the top. |
| `app.js` | ~3,760 | The whole UI and logic, one file in plain ES2020+ with no modules and no framework. |
| `sync.js` | ~210 | Server sync layer (see `ARCHITECTURE.md`). Loaded before `app.js`. |
| `sw.js` | ~20 | Offline cache. **Bump `CACHE` when you release**, or browsers keep old files. |
| `server.js` | ~200 | Data server and backups. No dependencies. |
| `server-config.json` | | `port`, `dataDir`, `backupDir`, `keepDays`. |

## `app.js` sections

Every section starts with a banner comment `/* ===================== NAME ===================== */`. Search for the name. Line numbers are as of the hand-over and will drift.

| Line | Section |
|---|---|
| 9 | CONFIG: capacity, layout, columns, team Teams link, shift pattern |
| 57 | STATE: loads `store`, `jobs`, `disposeData` from `localStorage` |
| 72 | HELPERS: `saveLocal()`, undo/redo snapshots, job-number normalising |
| 108 | HOLD: a held job must not be scrapped, picked out or deleted |
| 130 | ZONES: each position belongs to one Product + Type; held jobs live in the HOLD zone |
| 226 | HISTORY LOG (Time Machine · audit · forecast · tester stats) |
| 308 | DATE HELPERS (for "Days in Store") |
| 362 | TOAST NOTIFICATION |
| 372 | CSV PARSER (handles quoted multi-line fields) |
| 417 | AGGREGATION |
| 475 | FILTER UI |
| 584 | JOB TABLE FILTER |
| 656 | KPIs |
| 677 | RACK MAP (2D) |
| 741 | SIDE PANELS |
| 811 | TEAM ALERT |
| 846 | JOBS TABLE |
| 906 | DATA ENTRY TABLE |
| 981 | IMPORT / EXPORT |
| 1084 | ADD WORK (receive into store, smart slot suggestion) |
| 1280 | POSITION DIALOG |
| 1321 | HOLD DIALOG |
| 1372 | PAPER FALLBACK (printed map for when the system is down) |
| 1394 | SHIFT (crew A/B/C rotation) |
| 1414 | THEME |
| 1423 | 3D STORE (three.js scene, room geometry `GEO`, operators, camera presets, walk mode) |
| 2264 | 3D: SEARCH & FLY · COLOUR MODES · LEGEND |
| 2317 | TIME MACHINE |
| 2356 | INSIGHTS: FORECAST |
| 2431 | INSIGHTS: TESTER STATS |
| 2464 | INSIGHTS: SHIFT HANDOVER |
| 2541 | INSIGHTS: AUDIT LOG |
| 2579 | TV / KIOSK MODE |
| 2660 | QR LABELS *(next phase, not used in the lab yet)* |
| 2695 | ZONE SETUP (dialog + printable zone signs) |
| 2742 | SCAN: camera QR or USB barcode gun *(next phase)* |
| 2815 | UNDO / REDO UI |
| 2838 | PICK LIST (pick work out along the shortest walk) |
| 2945 | CTRL+K COMMAND PALETTE |
| 2997 | DESKTOP NOTIFICATIONS + SOUND |
| 3040 | VOICE COMMANDS (Thai, push to talk) |
| 3079 | OWNER E-MAILS FOR OVERDUE WORK |
| 3115 | WEEKLY REPORT (print / save as PDF) |
| 3167 | KAIZEN: timing, before / after, ROI |
| 3298 | CYCLE COUNT |
| 3356 | POKA-YOKE: scan the shelf QR before saving *(next phase)* |
| 3360 | GUIDE + FIRST-RUN TOUR |
| 3430 | TABS |
| 3463 | RENDER (`renderAll()`: redraws everything from `store`) |
| 3496 | GUIDE LIGHT ON SCREEN (pick-to-light shown on the 3D / 2D map only; the real shelves have no lamps) |
| 3543 | EVENTS (all `addEventListener` wiring) |
| 3829 | INIT |

## How a change flows

1. A user acts, for example adding work. The handler in **EVENTS** changes the `store` array.
2. `saveLocal()` writes `store`, `jobs` and `disposeData` to `localStorage`, records an undo snapshot, and appends to the history log.
3. `renderAll()` redraws the KPIs, tables, 2D map and 3D (`three.update(rows)`).
4. `sync.js` sees the `localStorage` write and pushes it to the server. Other PCs pull it within ~5 s and run `renderAll()` too.

## Planned clean-up (not done yet)

Split `app.js` into files per section (3D, import/export, hold, insights, …). The section banners above are the natural split points. Do this with the testing checklist in `CHANGE_GUIDE.md`, because there are no automated tests.
