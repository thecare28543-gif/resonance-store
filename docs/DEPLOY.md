# Resonance Store: deploy notes for the Dev team

Release 2026.11.11 and later: data in **PostgreSQL**, everyone **logs in**, admins manage user accounts in the web.
Thai step-by-step for pgAdmin: `app/db/วิธีตั้งค่าฐานข้อมูล.md`.

## The pieces

| File | Role |
|---|---|
| `RESONANCE_STORE.html`, `app.js`, `styles.css`, `lib/` | The web app. It still reads and writes `localStorage`; `sync.js` keeps that in step with the server. |
| `sync.js` | Loaded before `app.js`. Pulls the shared data from `/api/data`, pushes every change (3-way merge on save races), polls every 5 s, queues changes while the server is down. Shows the logged-in user, uses their name as editor, blocks writes for Viewers, sends the app version (`X-RS-Ver`). |
| `login.html` | The only page served before log-in (with `styles.css`, `lib/three.min.js`, `sw.js`). Shows nothing about the system. |
| `users.html` | Admin page: user accounts, import from Excel / CSV, roles, unlock, log-in history. |
| `sw.js` | Service worker: the page still opens while the server is down. Browsers allow this only on **https** or localhost. Never caches the log-in or users pages. |
| `server.js` | Node.js 18+ server, one npm package (`pg`). Log-in, roles, API, static files, backups. |
| `db/schema.sql` | Every table and view. The server also runs it at start (idempotent). |
| `server-config.json` | Port, database, backup folder, retention, session length. Copy from `server-config.example.json`. **Never commit the real database password.** |
| `deploy/` | Windows scripts: `1-check`, `2-install-autostart` (Task Scheduler at log-on, or `-AtStartup` as SYSTEM), `3-status`, `uninstall-autostart`. |

## Install (Windows server or lab PC)
1. Install Node.js 18+ and PostgreSQL 13+ (tested on 18) with pgAdmin 4.
2. pgAdmin → database `postgres` → Query Tool → run `db/01_create_user_and_db.sql` (change the password in it first). This creates role `rs_app` and database `resonance_store` owned by it.
3. pgAdmin → database `resonance_store` → Query Tool → first line `SET ROLE rs_app;`, then run `db/schema.sql`. (Or skip: the server creates the tables on its first start.)
4. Copy `server-config.example.json` to `server-config.json`, fill `database.password`. Or set `DATABASE_URL=postgres://rs_app:<pw>@host:5432/resonance_store` instead.
5. In the app folder: `npm install`, then `deploy\2-install-autostart.bat` (or run `node server.js` as a service with NSSM / pm2).
6. The server log prints `NO ADMIN YET … setup code: xxxx` (also in `data/setup-token.txt`). Open the site, enter the setup code + the admin's GID + name. That admin then logs in with **GID / GID**.
7. Put it behind the company reverse proxy (IIS ARR / nginx) with **https**. Keep `secureCookie: "auto"` and let the proxy send `X-Forwarded-Proto: https`.
8. Moving from the old JSON server: put the old `data/resonance-data.json` in the new `data/` folder before the first start; it is imported once. Or log in as admin → status chip → Backup & Restore → **⬆ กู้คืนจากไฟล์**.

`server-config.json`:
```json
{ "port": 8080, "dataDir": "data", "backupDir": "", "keepDays": 30, "sessionHours": 12, "secureCookie": "auto", "trustProxy": true,
  "database": { "host": "localhost", "port": 5432, "database": "resonance_store", "user": "rs_app", "password": "…" } }
```
`PORT`, `RS_DATA_DIR`, `DATABASE_URL` and `RS_SETUP_TOKEN` environment variables override the file.

## Log-in and roles
- **Log-in rule (lab decision, 2026-11-11):** user name = the person's GID, password = the same GID. Stored only as an scrypt hash. Anyone who knows a GID can log in as that person, so the WI tells everyone to log out before leaving a shared PC; the log-in history shows who logged in from where.
- **Session:** cookie `rs_sid`, HttpOnly, SameSite=Strict, Secure on https, 12 h (`sessionHours`).
- **Lockout:** 5 wrong passwords lock the account 15 min (admin can unlock); 20 failures from one IP in 15 min pause that IP. Log-in errors are generic on purpose.
- **Roles:** `admin` = everything + user accounts + restore; `user` = normal store work; `viewer` = read only (the server refuses its writes, the web puts the screen back). At least one active admin always remains; an admin cannot demote or close their own account.
- **CSRF guard:** every non-GET API call must carry `X-Requested-With` or `X-RS-Ver`.

## API (all JSON, relative to the page URL)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `api/auth/status` | anyone | `{ setupNeeded, user }` |
| POST | `api/auth/login` | anyone | `{ gid, password }` → sets the cookie |
| POST | `api/auth/setup` | anyone, only while no admin | `{ token, gid, name }` → first admin |
| GET / POST | `api/auth/me`, `api/auth/logout` | logged in | |
| GET | `api/data?since=N` | logged in | `{ version, keys, apps, user }`: keys changed after version N |
| PUT | `api/data` | admin, user | `{ base, set }` → 200 `{ version, keys }` or 409 `{ version, conflicts, keys }` |
| POST | `api/conflict` | admin, user | stores the losing copy of a save race as a backup |
| GET | `api/health`, `api/backups`, `api/backups/<name>` | logged in | |
| POST | `api/backup` | admin, user | manual backup |
| POST | `api/restore` | admin | `{ name }` or `{ keys }`; backs up first |
| GET / POST / PUT | `api/users`, `api/users/import`, `api/users/<gid>`, `api/users/<gid>/reset`, `api/login-log` | admin | accounts; `reset` = unlock + password back to GID |

## Data model (PostgreSQL)
- `rs_meta.version` is a global counter; `rs_kv(key, value, ver, updated_by)` is the master copy (values are the app's JSON strings).
- `PUT api/data` runs in one transaction with `SELECT … FOR UPDATE` on `rs_meta`, so two PCs can never both win.
- After each save `rs_refresh(key)` rebuilds the readable tables (`store_rows`, `jobs`, `holds`, `hold_log`, `dispose_decisions`, `zones`, `training_attempts`). They are for reports / Power BI / pgAdmin only — do not edit them.
- Accounts: `app_users`, `user_sessions`, `login_log`, `user_admin_log`. Views: `v_position_load`, `v_jobs_in_store`, `v_users`.

## Backups
- Table `rs_backups`: every hour with changes, every shift change (06:00 / 18:00), first save, manual, before restore, save-race conflicts, shutdown. Kept `keepDays` days, newest 10 always.
- `backupDir` (optional): the same backups as files on a team SharePoint / network share.
- Also schedule a daily `pg_dump -U rs_app -d resonance_store -F c` to a team location.

## Security notes
- Static serving refuses `server.js`, `server-config*`, `package*.json`, `data/`, `db/`, `deploy/`, `node_modules/`, folders starting with `_`, and `.xlsx .csv .pptx .mp4 .md .log .bat .ps1 .txt`.
- Response headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`.
- Request bodies are limited to 60 MB.

## Quick test on one PC
```
npm install
node server.js
```
Open `http://localhost:8080`, create the first admin with the setup code, add a user, log in as that user in a second browser. A change in one browser appears in the other within about 5 s.
