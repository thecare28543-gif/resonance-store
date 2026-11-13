# Changelog

Newest first. One line per release: date · who · what · why.

## 2026-11-13 · Sirinya Mungjuntuek · release 2026.11.13: training manual as a web page
- **manual.html:** the training manual (was only a PDF) is now a web page with the same content: contents list, 8 sections, A4 print layout (9 pages, same as the PDF), phone width. The อบรม page shows it inline, sized to its full height (no second scroll bar); contents links scroll the app page. "เปิดเต็มจอ / พิมพ์" opens it alone; the PDF stays as "ดาวน์โหลด PDF". Behind the log-in like every other page.
- The 8 screenshots live in `app/manual/`. They and `training-manual.pdf` are now in the repository (the lab lead confirmed they are not confidential). If a picture is missing, its figure shows a note instead.
- **server.js:** `X-Frame-Options` DENY → SAMEORIGIN, so the app can show its own pages in a frame (the old PDF frame was blank on the server for the same reason). Other sites still cannot frame it.
- **sw.js:** cache v5 with the manual; files are cached one by one, so a missing file (the PDF or pictures on a fresh install) no longer stops the offline copy.
- VER 2026.11.13. Tests: auth_api 43/43, e2e 24/24, ui_login 14/14, manual page 12/12.

## 2026-11-12 · Sirinya Mungjuntuek · lab logo, start-server.bat, move kit, single-file build (app.js / sync.js unchanged, VER stays 2026.11.11)
- **Lab logo:** the 3-bar mark is replaced by the lab logo, embedded as a data-URI in `app/styles.css` (`.logo.lab`). The sidebar logo (`#homeLogo`) goes back to the main page (ภาพรวม tab, scroll to top); users.html links it to `/`; login.html shows it without a link.
- **start-server.bat:** reads the port from `server-config.json` (default 8081); starts `deployun-server.vbs` only if nothing is listening, waits up to 20 s, then opens `/login.html`. CRLF line endings.
- **Move kit** (`app/deploy/move-kit/`): `INSTALL.bat` + `install_new_pc.ps1` install the whole system on a new PC from a copy of the app folder and a `pg_dump` of the database (new random rs_app password, auto-start, firewall, never overwrites).
- **Single-file build** (`tools/single-file/`): one HTML that runs without a server, with a browser-side copy of the log-in (GID / GID, roles, lock-out) and user admin. Not real security; the server version stays the real system.
- Tests: auth_api 43/43, e2e 24/24, ui_login 14/14; single-file login 19/19.

## 2026-11-11 · Sirinya Mungjuntuek · release 2026.11.11: PostgreSQL + log-in + user accounts
- **PostgreSQL:** all shared data moves from the JSON file to PostgreSQL (`app/db/schema.sql`). `rs_kv` is the master copy (same sync protocol, 3-way merge unchanged); readable tables `store_rows`, `jobs`, `holds`, `hold_log`, `dispose_decisions`, `zones`, `training_attempts` are rebuilt on every save for reports / pgAdmin; views `v_position_load`, `v_jobs_in_store`, `v_users`. Backups go to table `rs_backups` (+ optional file copy). An old `data/resonance-data.json` is imported automatically on first start.
- **Log-in:** user name = GID, password = the same GID (lab decision), stored only as an scrypt hash. Session cookie 12 h (HttpOnly, SameSite=Strict, Secure on https). 5 wrong tries lock the account 15 min. Writes need a custom header (CSRF guard). The log-in page shows nothing about the system and its errors are generic. First admin is created with a one-time setup code from the server log.
- **Roles:** admin (everything + users + restore), user (store work), viewer (read only; the web refuses its edits). Last_Editor comes from the logged-in name.
- **users.html:** user accounts page (add, import Excel/CSV with GID / Name / Role / Crew / Department, inline edit, deactivate, unlock, rights table, log-in history), same look as the app.
- **login.html:** single log-in window over a decorative 3D store (three.js, no real data).
- Also in 2026.11.10–11: save-race 3-way merge, Hold rows locked in Data Entry, Reset/Import keep held jobs, 80-piece cap in Data Entry, Undo/Redo only this PC's rows, version chip + old-version warning (`X-RS-Ver`), tray placement picture, Tester 01/02/03 labels, editable Jobs table.
- Deploy: `npm install` in `app/`, run `db/01_create_user_and_db.sql` + `db/schema.sql` in pgAdmin (see `db/วิธีตั้งค่าฐานข้อมูล.md`), fill `server-config.json`, then `deploy/2-install-autostart.bat`.
- Tests: API 43/43, 2-PC end-to-end with log-in 24/24, UI 14/14.
- Hand-over docs (Thai): `คู่มือระบบ_Resonance_Store_สำหรับ_Dev.pdf` (master book), database manual (detailed + summary PDF), `docs/กฎของงาน_Business_Rules.md`, `docs/ปัญหาที่รู้_และงานค้าง.md`; `docs/CHANGE_GUIDE.md` updated for log-in / PostgreSQL; automated tests now shipped in `tests/` with `run-tests.ps1` (throw-away PostgreSQL, made-up data only).
- Fix: view `v_position_load` now says WARNING from 60 pieces, the same as `WARN_AT` in the app (was 64).

## 2026-11-10 · Sirinya Mungjuntuek · release 2026.11.10 + server live
- **Server is live:** the Dev team has deployed `server.js` on a company server with https. Every lab PC now opens the app from the server URL; data is shared and backed up there.
- Safer saving when two PCs save at once: `sync.js` merges the changes (3-way merge) instead of one PC overwriting the other.
- Hold jobs are locked in Data Entry; Reset and Import keep held jobs; Data Entry refuses more than 80 pieces per position.
- Undo / Redo only steps back this PC's own changes and never touches a held job.
- Version `VER` (in `sync.js`) shows on the sync chip and is sent as header `X-RS-Ver`; the server reports which versions ran in the last 2 minutes and the app warns when a PC still runs old files. **Bump `VER` on every release of `app.js` / `sync.js`.**
- Add form shows a picture of where the trays go (stack 1–4 from the left, tray 1 at the bottom). Testers are shown as "Tester 01/02/03". Jobs table can be edited in place (Owner, Product, Description, Test Status, Tester); held jobs stay locked.
- Fresh install starts with no zones; the recommended zones load only from the reset button.
- Regression: 2-PC end-to-end test 23/23 pass.
- Known: importing a new Job Detail file overwrites manual edits made in the Jobs table.

## 2026-11-01 · Sirinya Mungjuntuek · training tab + hidden server
- New **อบรม** tab: hands-on checklist (5 skills, ticked by the trainer) + quiz (10 of 14 questions, pass 8/10), record per person and per crew, CSV export, printable sign-off sheet. Stored in `resTrainV1` (shared, backed up).
- Training manual PDF shown inside the อบรม tab (`app/training-manual.pdf`; open full screen or download). `server.js` now serves `.pdf` as `application/pdf`.
- `sw.js` cache bumped to v3 (manual cached for offline).
- `deploy/install-autostart`: the server now runs with no window under `run-server.vbs`, which restarts it within ~10 s if it stops (before, closing the console window stopped the server).

## 2026-11-01 · Sirinya Mungjuntuek · hand-over package
- First hand-over to the Dev team: app files, developer documentation, hand-over checklist.
- State of the app:
  - In daily use in the HSA Resonance lab: 3D store, smart slot, pick list, Hold block, roving audit, Kaizen dashboard.
  - Server sync and backups (`server.js`, `sync.js`) have been tested and are waiting for the Dev team to deploy them on a company server with https. (Done — see 2026-11-10.)
  - QR scanning is implemented but not in use; it is waiting for a clean-room approved scanner.
