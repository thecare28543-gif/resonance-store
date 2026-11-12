# Resonance Store

Web app for the HSA Resonance lab store (Seagate Korat): where every tested job sits on the two racks, what is on hold, and what has been in the store too long.

- **Users:** HSA Resonance lab operators, all 3 shifts, on the lab PCs (Microsoft Edge).
- **Original author:** Sirinya Mungjuntuek (HSA Resonance), 2026. Kaizen project "RESONANCE STORE 4.0".
- **Owner after hand-over:** _fill in: Dev team / person and backup person_

> **Start here (Thai):** `คู่มือระบบ_Resonance_Store_สำหรับ_Dev.pdf` — the whole system in one book (what it does, architecture, screens, files, business rules, data, deploy, operations, security, how to change / test / release, known issues, every other document).

## What is in this folder

| Path | What it is |
|---|---|
| `app/` | The whole web app. Plain HTML + JavaScript + CSS, **no build step**. Edit a file, reload the page. The server needs one npm package (`pg`): run `npm install` in `app/` once. |
| `app/login.html` · `app/users.html` | Log-in window (user name = GID, password = GID) and the admin page for user accounts (add, import from Excel/CSV, roles admin / user / viewer, unlock, log-in history). |
| `app/db/` | PostgreSQL: `schema.sql` (all tables + views), `01_create_user_and_db.sql`, and the Thai setup guide `วิธีตั้งค่าฐานข้อมูล.md`. |
| `app/lib/` | Third-party libraries, kept locally so the lab PCs need no internet (three.js r128, OrbitControls, SheetJS xlsx, qrcode, jsQR). |
| `app/server.js` | Node.js 18+ server: log-in and roles, serves the app only to logged-in users, keeps one shared copy of the data for every PC in **PostgreSQL**, takes automatic backups (table `rs_backups`). Settings in `server-config.json` (copy from `server-config.example.json`; never commit the real database password). |
| `app/deploy/` | Windows scripts: `1-check` (is this PC ready), `2-install-autostart` (Task Scheduler + firewall), `3-status` (running? last backup?), `uninstall-autostart`. |
| `วิธีติดตั้ง_server_เอง.md` | Step-by-step install guide in Thai for the lab, plus a ready-to-send request to IT. |
| `docs/` | Developer documentation (start with `ARCHITECTURE.md`). |
| `HANDOVER_CHECKLIST.md` | What must be done so the app does not depend on one person. |
| `CHANGELOG.md` | Record every change here. |

## Run it in 1 minute

```
cd app
node server.js
```

Open `http://localhost:8080`. Open it in a second browser too: a change in one shows in the other within ~5 s.

You can also open `app/RESONANCE_STORE.html` directly from disk. It then works on that PC only (data in the browser's `localStorage`, no sharing, no backups). This is how the app ran before the server existed.

To try it with data: **Data Entry → Import** a store `.xlsx` (the lab's "RESONANCE_STORE_<date>_Team …xlsx" file) and the job report `Report.csv`. See `docs/DATA.md`.

## Documentation

| Read this | When |
|---|---|
| `docs/ARCHITECTURE.md` | First. How the pieces fit, where data lives, how sync works. |
| `docs/CODE_MAP.md` | Finding code: every section of `app.js` with its line number. |
| `docs/CHANGE_GUIDE.md` | Common changes (capacity, layout, zones, shifts, columns) and the release steps. |
| `docs/DATA.md` | Import file formats, stored data, backup file format. |
| `docs/DEPLOY.md` | Putting it on a server (https, reverse proxy, API contract). |
| `docs/OPERATIONS.md` | Backup / restore, server down, troubleshooting. |

## Putting it under version control

Git was not installed on the author's PC, so this folder is not a Git repository yet. On a PC with Git:

```
git init
git add .
git commit -m "Resonance Store: initial import from the lab"
git remote add origin <company repo URL>
git push -u origin main
```

`.gitignore` already keeps live data, backups and the lab's Excel/CSV files out of the repository.

## Extra tools (2026-11-12)
- `app/deploy/move-kit/` - move the whole system (app + database + users) to a new PC with one double-click. See its README.
- `tools/single-file/` - build one self-contained HTML that runs without a server (offline demo / single PC). See its README.
