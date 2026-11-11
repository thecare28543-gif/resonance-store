# Code map

## Files

| File | Lines | Role |
|---|---|---|
| `RESONANCE_STORE.html` | ~560 | All markup: top bar, sidebar tabs, panels, dialogs. Elements are found by `id` from `app.js`. |
| `styles.css` | ~980 | Light theme by default, dark theme under `[data-theme="dark"]`. Colours are CSS variables at the top. |
| `app.js` | ~4,100 | The whole UI and logic, one file in plain ES2020+ with no modules and no framework. |
| `sync.js` | ~350 | Server sync layer (see `ARCHITECTURE.md`). Loaded before `app.js`. |
| `sw.js` | ~20 | Offline cache. **Bump `CACHE` when you release**, or browsers keep old files. |
| `login.html` · `users.html` | ~290 · ~330 | Log-in window (with the decorative 3D racks) and the admin page for user accounts. Self-contained: page script at the bottom of each file. |
| `server.js` | ~520 | Log-in, roles, API, static files, backups. One dependency: `pg` (PostgreSQL). |
| `server-config.json` | | `port`, `dataDir`, `backupDir`, `keepDays`, `sessionHours`, `secureCookie`, `trustProxy`, `database`. Copy from `server-config.example.json`. |
| `db/schema.sql` | ~270 | Every PostgreSQL table + view, and `rs_refresh()` that rebuilds the readable tables. |

## `app.js` sections

Every section starts with a banner comment `/* ===================== NAME ===================== */`. Search for the name. Line numbers are as of the hand-over and will drift.

| Line | Section |
|---|---|
| 9 | CONFIG |
| 60 | STATE |
| 77 | HELPERS |
| 114 | HOLD (a held job must not be scrapped, picked out or deleted) |
| 136 | ZONES (each position belongs to one Product + Type; held jobs live in the HOLD zone) |
| 255 | HISTORY LOG (Time Machine · audit · forecast · tester stats) |
| 337 | DATE HELPERS (for "Days in Store") |
| 391 | TOAST NOTIFICATION |
| 401 | CSV PARSER (robust, handles quoted multi-line fields) |
| 446 | AGGREGATION |
| 504 | FILTER UI (Tick Box / Checkbox multi-select) |
| 613 | JOB TABLE FILTER |
| 685 | KPIs |
| 706 | RACK MAP |
| 770 | SIDE PANELS |
| 840 | TEAM ALERT |
| 875 | JOBS TABLE |
| 940 | DATA ENTRY TABLE |
| 1018 | IMPORT / EXPORT |
| 1128 | ADD WORK (receive into store) |
| 1324 | POSITION DIALOG |
| 1365 | HOLD DIALOG (hold needs a name + reason, release needs an approver + reason) |
| 1416 | PAPER FALLBACK (system down: the printed sheet still tells where everything is) |
| 1438 | SHIFT |
| 1458 | THEME |
| 1467 | 3D STORE |
| 2308 | 3D: SEARCH & FLY · COLOUR MODES · LEGEND |
| 2361 | TIME MACHINE |
| 2400 | INSIGHTS: FORECAST |
| 2475 | INSIGHTS: TESTER STATS |
| 2508 | INSIGHTS: SHIFT HANDOVER |
| 2585 | INSIGHTS: AUDIT LOG |
| 2623 | TV / KIOSK MODE |
| 2704 | QR LABELS |
| 2739 | ZONE SETUP (dialog + printable zone signs) |
| 2786 | SCAN (camera QR or USB barcode gun) |
| 2859 | UNDO / REDO UI |
| 2889 | PICK LIST (pick work out along the shortest walk) |
| 2996 | CTRL+K COMMAND PALETTE |
| 3048 | DESKTOP NOTIFICATIONS + SOUND |
| 3091 | VOICE COMMANDS (Thai, push to talk) |
| 3130 | OWNER E-MAILS FOR OVERDUE WORK |
| 3166 | WEEKLY REPORT (print / save as PDF) |
| 3218 | KAIZEN: timing, before / after, ROI |
| 3383 | CYCLE COUNT (blind count of a few positions every shift) |
| 3441 | POKA-YOKE: scan the shelf QR before saving |
| 3445 | GUIDE (one-page standard work) + FIRST-RUN TOUR |
| 3515 | TRAINING (who has been trained, hands-on check + quiz, shared on the server) |
| 3643 | TABS |
| 3678 | RENDER |
| 3711 | GUIDE LIGHT ON SCREEN (pick-to-light idea, shown only on the 3D / 2D map: the real shelves have no lamps) |
| 3758 | EVENTS |
| 4088 | INIT |

## How a change flows

1. A user acts, for example adding work. The handler in **EVENTS** changes the `store` array.
2. `saveLocal()` writes `store`, `jobs` and `disposeData` to `localStorage`, records an undo snapshot, and appends to the history log.
3. `renderAll()` redraws the KPIs, tables, 2D map and 3D (`three.update(rows)`).
4. `sync.js` sees the `localStorage` write and pushes it to the server. Other PCs pull it within ~5 s and run `renderAll()` too.

## Planned clean-up (not done yet)

Split `app.js` into files per section (3D, import/export, hold, insights, …). The section banners above are the natural split points. Do this with the testing checklist in `CHANGE_GUIDE.md`, because there are no automated tests.
