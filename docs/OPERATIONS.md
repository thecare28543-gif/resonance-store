# Operations

Deployment (PostgreSQL, server, https, reverse proxy, API) is in `DEPLOY.md`; the Thai pgAdmin guide is `app/db/วิธีตั้งค่าฐานข้อมูล.md`. A Windows install (Task Scheduler) is scripted in `app/deploy/`. This page covers keeping it running.

**Status at a glance:** `app/deploy/3-status.bat` shows whether the server runs and whether the first admin exists. Server log: `app/data/server.log`. Data, backups and log-ins: pgAdmin (`rs_backups`, `login_log`, `v_users`) or the web as an admin.

## User accounts
- Admins open **บัญชีผู้ใช้** (user menu top right → จัดการผู้ใช้งาน, or `/users.html`).
- New staff: add one, or import Excel / CSV (GID, Name / User Name, Role, Crew, Department). They log in with GID / GID right away.
- Someone leaves: **ปิดบัญชี** (deactivate), never delete — the history of who changed what stays readable.
- "เข้าระบบไม่ได้ชั่วคราว": the account is locked after 5 wrong tries; an admin clicks **🔓 ปลดล็อก** (or wait 15 min).
- Keep at least two admins (the system refuses to remove the last one).
- First admin lost / no admin left: stop the server, in pgAdmin `UPDATE app_users SET role='admin', active=true WHERE gid='<gid>';`, start again.

## Backups
- **Automatic:** every hour that had changes, at every shift change (06:00 and 18:00), first save, before every restore, save-race conflicts, shutdown.
- **Where:** table `rs_backups` in PostgreSQL, plus `backupDir` from `server-config.json` if set.
  - **`backupDir` must be a team location** (team SharePoint / OneDrive library or a network share). A personal OneDrive disappears when its owner leaves.
- **Retention:** `keepDays` (default 30) days; the newest 10 are always kept.
- **Whole database:** schedule a daily `pg_dump -U rs_app -d resonance_store -F c -f resonance_store_YYYYMMDD.backup` to a team location.
- **Manual backup:** status chip in the top bar → Backup & Restore → **🛡 Backup ตอนนี้**.

## Restore (admins only)
In the app: status chip → Backup & Restore → pick a backup → **กู้คืน**. The server backs up the current data first, so a restore can itself be undone. All PCs pick up the restored data within ~5 s.
From a file (a backup copied from SharePoint, or an old `resonance-data.json`): **⬆ กู้คืนจากไฟล์** in the same dialog.
Whole database lost: `pg_restore` the newest dump (or pgAdmin → Restore), then start the server.

## When something goes wrong

| Symptom | What to check |
|---|---|
| Server does not start: "No database settings" / "Cannot use the database" | `server-config.json` → `database`; is the PostgreSQL service running; is the password right; did `npm install` run. |
| Chip says **offline** on every PC | Is the server running (`3-status.bat`)? Is the port open? PCs keep working and send their queued changes when it is back. |
| Everyone is sent back to the log-in page | Normal after 12 h, after a role change or deactivation. Otherwise check the server log. |
| Chip says **local** | The page was opened as a file, not from the server URL. Use the server address. |
| Toast "มี N เครื่องยังใช้ไฟล์เว็บเวอร์ชันเก่า" | A PC runs old files: Ctrl+F5 there; if it persists, bump `CACHE` in `sw.js` and redeploy. |
| Server down for a long time | The lab uses the printed paper map (printed every shift: PAPER FALLBACK). Re-enter the paper moves once the server is back. |
| "Save failed: storage full" toast | Browser `localStorage` is near its ~5–10 MB limit. The history log is the biggest key; it is capped at ~3 MB / 180 days. |
| A change from one PC "disappeared" | Look for a `…-conflict` backup: it holds the copy that lost a save race (normally merged automatically). |

## Who to call

_Fill in at hand-over:_ primary owner, backup owner, lab key user, server / database admin.
