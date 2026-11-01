# Operations

Deployment (server, https, reverse proxy, API) is in `DEPLOY.md`. A simple Windows install (one lab PC, Task Scheduler) is scripted in `app/deploy/` and described in Thai in `วิธีติดตั้ง_server_เอง.md`. This page covers keeping it running.

**Status at a glance:** `app/deploy/3-status.bat` shows whether the server is running, the last backup time and the backup folders. Server log: `app/data/server.log`.

## Backups

- **Automatic:** every hour that had changes, at every shift change (06:00 and 18:00), on first write, on shutdown, and before every restore.
- **Where:** `data/backups/` on the server, plus `backupDir` from `server-config.json`.
  - **`backupDir` must be a team location** (team SharePoint / OneDrive library or a network share). A personal OneDrive disappears when its owner leaves the company.
- **Retention:** kept `keepDays` (default 30) days; the newest 10 are always kept.
- **Manual backup:** status chip in the top bar → Backup & Restore → **🛡 Backup ตอนนี้**. Or `POST api/backup`.

## Restore

In the app: status chip → Backup & Restore → pick a backup → Restore. The server backs up the current data first, so a restore can itself be undone. All PCs pick up the restored data on their next poll (~5 s).

From a file, for example a backup copied from SharePoint: use **⬆ กู้คืนจากไฟล์** in the same dialog.

## When something goes wrong

| Symptom | What to check |
|---|---|
| Chip says **offline** on every PC | Is `node server.js` running? Check its console log. Is the port open? PCs keep working and send their queued changes when it is back. |
| Chip says **local** | The page was opened as a file, not from the server URL. Use the server address. |
| One PC shows old data or an old version | Ctrl+F5. If it persists, bump `CACHE` in `sw.js` and redeploy. |
| Server lost / disk failure | Install Node 18+, copy `app/`, and put the newest backup in place as `data/resonance-data.json` (same format), or restore it through the app. |
| Server down for a long time | The lab uses the printed paper map (printed every shift: PAPER FALLBACK). Re-enter the paper moves once the server is back. |
| "Save failed: storage full" toast | Browser `localStorage` is near its ~5–10 MB limit. The history log is the biggest key; it is already capped at ~3 MB / 180 days. |
| A change from one PC "disappeared" | Look for a `…-conflict.json` backup: it holds the copy that lost a save race. |

## Who to call

_Fill in at hand-over:_ primary owner, backup owner, lab key user, server admin.
