# Changelog

Newest first. One line per release: date · who · what · why.

## 2026-11-11 · Sirinya Mungjuntuek · release 2026.11.11: PostgreSQL + log-in + user accounts
- **PostgreSQL:** all shared data moves from the JSON file to PostgreSQL (`app/db/schema.sql`). `rs_kv` is the master copy (same sync protocol, 3-way merge unchanged); readable tables `store_rows`, `jobs`, `holds`, `hold_log`, `dispose_decisions`, `zones`, `training_attempts` are rebuilt on every save for reports / pgAdmin; views `v_position_load`, `v_jobs_in_store`, `v_users`. Backups go to table `rs_backups` (+ optional file copy). An old `data/resonance-data.json` is imported automatically on first start.
- **Log-in:** user name = GID, password = the same GID (lab decision), stored only as an scrypt hash. Session cookie 12 h (HttpOnly, SameSite=Strict, Secure on https). 5 wrong tries lock the account 15 min. Writes need a custom header (CSRF guard). The log-in page shows nothing about the system and its errors are generic. First admin is created with a one-time setup code from the server log.
- **Roles:** admin (everything + users + restore), user (store work), viewer (read only; the web refuses its edits). Last_Editor comes from the logged-in name.
- **users.html:** user accounts page (add, import Excel/CSV with GID / Name / Role / Crew / Department, inline edit, deactivate, unlock, rights table, log-in history), same look as the app.
- **login.html:** single log-in window over a decorative 3D store (three.js, no real data).
- Also in 2026.11.10–11: save-race 3-way merge, Hold rows locked in Data Entry, Reset/Import keep held jobs, 80-piece cap in Data Entry, Undo/Redo only this PC's rows, version chip + old-version warning (`X-RS-Ver`), tray placement picture, Tester 01/02/03 labels, editable Jobs table.
- Deploy: `npm install` in `app/`, run `db/01_create_user_and_db.sql` + `db/schema.sql` in pgAdmin (see `db/วิธีตั้งค่าฐานข้อมูล.md`), fill `server-config.json`, then `deploy/2-install-autostart.bat`.
- Tests: API 43/43, 2-PC end-to-end with log-in 24/24, UI 14/14.

## 2026-11-01 · Sirinya Mungjuntuek · training tab + hidden server
- New **อบรม** tab: hands-on checklist (5 skills, ticked by the trainer) + quiz (10 of 14 questions, pass 8/10), record per person and per crew, CSV export, printable sign-off sheet. Stored in `resTrainV1` (shared, backed up).
- Training manual PDF shown inside the อบรม tab (`app/training-manual.pdf`; open full screen or download). `server.js` now serves `.pdf` as `application/pdf`.
- `sw.js` cache bumped to v3 (manual cached for offline).
- `deploy/install-autostart`: the server now runs with no window under `run-server.vbs`, which restarts it within ~10 s if it stops (before, closing the console window stopped the server).

## 2026-11-01 · Sirinya Mungjuntuek · hand-over package
- First hand-over to the Dev team: app files, developer documentation, hand-over checklist.
- State of the app:
  - In daily use in the HSA Resonance lab: 3D store, smart slot, pick list, Hold block, roving audit, Kaizen dashboard.
  - Server sync and backups (`server.js`, `sync.js`) have been tested and are waiting for the Dev team to deploy them on a company server with https.
  - QR scanning is implemented but not in use; it is waiting for a clean-room approved scanner.
