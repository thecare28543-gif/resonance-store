# Change guide

Read `docs/กฎของงาน_Business_Rules.md` for the part you change **before** changing it, and `docs/ปัญหาที่รู้_และงานค้าง.md` for what is already known.

## Common changes

| I want to… | Change this | Where |
|---|---|---|
| Change the 80-piece limit or the warning level | `LIMIT`, `WARN_AT`, `NEAR_FULL_RATIO` (and the 60 / 80 in view `v_position_load`) | `app.js` CONFIG, `db/schema.sql` |
| Add a rack side / floor / cell | `RACK_SIDES`, `FLOORS`, `CELLS` (CONFIG) **and** the 3D room `GEO` + `zoneXZ()` + `walkPath()` (3D STORE) **and** `RECOMMENDED_ZONES` | `app.js` |
| Change which product/type goes where | Usually nothing: users do it in the app (**Zone Setup**), saved to `resZoneV1`. `RECOMMENDED_ZONES` is only the "load the lab's suggested layout" button. | `app.js` ZONES |
| Add a tester bench | `TESTERS` (CONFIG), `TESTER_NAME`, and `GEO.BX` (bench x positions, 3D STORE) | `app.js` |
| Change the shift rotation | `SHIFT_PATTERN`, `SHIFT_BASE_DAY`, `SHIFT_BASE_IDX` (12-day cycle, anchor date) | `app.js` CONFIG |
| Change the team Teams link | `HSA_TEAM_EMAILS` (kept out of Git) | `app.js` CONFIG |
| Add / rename an import column | `STORE_COLS` / `EXTRA_COLS` / `JOB_COLS`. Keep old names readable so old files still import. | `app.js` CONFIG, IMPORT / EXPORT |
| Change disposal choices | `DISPOSE_OPTIONS` | `app.js` CONFIG |
| Add data that every PC must share | Add the `localStorage` key to `SHARED`; for a report table add a table + a branch in `rs_refresh()` | `sync.js`, `db/schema.sql` |
| Add a column to a report table | `ALTER TABLE … ADD COLUMN IF NOT EXISTS` + the field in `rs_refresh()`; re-run `schema.sql` (the server does it at start) | `db/schema.sql` |
| Roles / what a viewer may do | `can` in `api()` (server) and the viewer guard in `Storage.prototype.setItem` (client) | `server.js`, `sync.js` |
| Log-in rule (GID / GID), session length, lockout | `gidPw`, `checkPw` call in `POST /api/auth/login`, `sessionHours`, the `5` / `15 minutes` in the login route | `server.js`, `server-config.json` |
| What can be opened before log-in | `PUBLIC` set; never add data files | `server.js` |
| User accounts page | `users.html` (self-contained) + `usersApi()` | `users.html`, `server.js` |
| Add a new file to the app | Add it to `FILES` and bump `CACHE` | `sw.js` |
| Server port / database / backup folder / retention | `server-config.json` (or env `PORT`, `DATABASE_URL`, `RS_DATA_DIR`) | `app/` |
| Colours, fonts | CSS variables at the top of `styles.css` (light) and the dark block; login.html and users.html use the same file | `styles.css` |

## Release steps

1. Change the code in a branch.
2. **Bump `VER` in `sync.js`** (`YYYY.MM.DD`, add `.2` for a second release that day) whenever `app.js` or `sync.js` changes — PCs on old files get a warning.
3. In `sw.js`, bump `CACHE` (e.g. `resonance-store-v4` → `-v5`), or the lab PCs keep serving old files from cache.
4. Run the automated tests (`tests/README.md`): API, 2-PC end-to-end, UI — all must pass. Then the manual checklist below for the parts you touched.
5. If `db/schema.sql` changed: it must stay idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`). Try it twice on a copy of the database.
6. Add a line to `CHANGELOG.md`: date, who, what, why.
7. **Take a backup** (status chip → Backup & Restore → 🛡 Backup ตอนนี้, and `pg_dump`).
8. Deploy: copy `app/` to the server **except** `data/`, `server-config.json` and `node_modules/`. Run `npm install` if `package.json` changed. Restart the server if `server.js` or `db/schema.sql` changed.
9. Tell the lab. One reload (Ctrl+F5) on each PC picks up the new version; the version shows on the status chip.

## Manual test checklist

Automated tests cover most of this (`tests/`). Check by hand what you changed.

**Log-in and accounts**
- [ ] Opening the site shows only the log-in window (logo, User, Password, button) — no hints, no system details.
- [ ] Wrong password → "User หรือ Password ไม่ถูกต้อง". 5 wrong → "เข้าระบบไม่ได้ชั่วคราว…"; admin sees "ล็อก" and can unlock.
- [ ] GID / GID logs in; the editor field shows the logged-in name and cannot be typed over.
- [ ] Admin: บัญชีผู้ใช้ → add one, import the CSV template, change a role, deactivate (that user is logged out), log-in history shows entries.
- [ ] User cannot open `users.html`; Viewer: adding work is refused with a warning and nothing is saved.
- [ ] Log out → the app asks to log in again. After 12 h the session ends by itself.

**Store work**
- [ ] Page opens with no errors in the console (F12).
- [ ] Import the store `.xlsx` and `Report.csv`. KPIs, 2D map and 3D show the data.
- [ ] Add work: smart slot suggests a position in the right zone; the tray picture shows ★; saving to a wrong zone or over 80 pieces is refused.
- [ ] Search a Job No. → the 3D view flies to its position.
- [ ] Put a job on Hold (name + reason). Try Scrap / pick / delete / Data Entry edit → all refused and logged. Release needs an approver.
- [ ] Pick List: route shows, held jobs cannot be ticked, "remove from store" updates the data.
- [ ] Undo / redo the last change (only this PC's rows).
- [ ] Export → re-import the exported file → same data; held jobs not in the file are kept.
- [ ] Two browsers (two users): a change in one appears in the other within ~5 s; saving at the same moment keeps both.
- [ ] Stop the server: the chip shows offline, edits still work. Start it again → queued edits are sent.
- [ ] Backup & Restore (admin): backup now, restore it, data comes back. In pgAdmin `store_rows` / `jobs` match the web.
- [ ] Dark mode, phone width, kiosk mode still look right.
