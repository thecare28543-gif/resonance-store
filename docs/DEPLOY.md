# Resonance Store: deploy notes for the Dev team

## What changed
Until now, the web app was static: every browser kept its own data in `localStorage`, so each PC had a separate copy and there was no backup.

This version adds one shared data store with automatic backups:

| File | Role |
|---|---|
| `RESONANCE_STORE.html`, `app.js`, `styles.css`, `lib/` | The web app. It still reads and writes `localStorage` as before. |
| `sync.js` | Loaded before `app.js`. It pulls the shared data from `/api/data`, pushes every change, polls every 5 s, and queues changes while the server is down. |
| `sw.js` | Service worker. The page still opens while the server is down. Browsers allow this only on **https** or localhost. |
| `server.js` | Reference server: Node.js 18+, no npm packages. It serves the files and the API and writes the backups. |
| `server-config.json` | Port, data folder, backup folder, retention days. |

If no server answers, or the page is opened as a file, the app falls back to `localStorage` only, exactly as before.

## Option A: use server.js as is (simplest)
1. Copy the whole folder to the server and run `node server.js`. Keep it running as a service, for example with NSSM on Windows, pm2, or systemd.
2. Edit `server-config.json`:
   ```json
   { "port": 8080, "dataDir": "data", "backupDir": "\\\\fileserver\\share\\ResonanceBackup", "keepDays": 30 }
   ```
   - `backupDir` is a second copy of every backup, on a OneDrive/SharePoint-synced folder or a network share. In JSON, write each `\` as `\\`.
   - The environment variables `PORT` and `RS_DATA_DIR` override the config file.
3. Put it behind the company reverse proxy (IIS ARR / nginx) with **https**, so the offline cache in `sw.js` can work.

## Option B: implement the same API on your own stack
The client only needs these endpoints, relative to the page URL, so `api/...` sits next to `RESONANCE_STORE.html`:

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `api/data?since=N` | | `{ version, keys: { name: string\|null } }`: only keys changed after version N (all keys when N = 0) |
| PUT | `api/data` | `{ base, set: { name: string } }` | 200 `{ version, keys }`, where `keys` = changes from other PCs after `base`.<br>409 `{ version, conflicts: [names], keys }` if another client changed one of these keys after `base`. |
| POST | `api/conflict` | `{ base, set, client }` | Saves the losing client's copy as a backup file. |
| GET | `api/health` | | `{ ok, version, lastBackupAt, backupDirs, keepDays, backups }` |
| GET | `api/backups` | | `[ { name, size, at } ]` |
| GET | `api/backups/<name>` | | Downloads that backup. |
| POST | `api/backup` | | Takes a manual backup now. |
| POST | `api/restore` | `{ name }` or `{ keys }` | Backs up the current data first, then replaces it. Keys missing from the restored set become `null`. |

**Data model:** a global `version` counter. Each key stores `{ value, ver }`, where `ver` is the global version at which the key was last written. Values are opaque strings (the app's JSON).

## Backups (what server.js does)
- **Hourly:** a backup every hour in which data changed.
- **Shift change:** a backup at every shift change, 06:00 and 18:00.
- **Other events:** a backup on first write, on shutdown (Ctrl+C), and before every restore.
- **Location and retention:** files are written to `data/backups` and to `backupDir`. They are kept `keepDays` days, and the newest 10 are always kept.
- **Safe writes:** the data file is written atomically (temp file, then rename).

## Security notes
- There is no login. It is meant for the intranet only.
- Add SSO or IP restrictions at the reverse proxy if needed.
- Static serving refuses `server.js`, `server-config.json`, the data folder, and any path above the app folder.
- Request bodies are limited to 60 MB.

## Quick test on one PC
```
node server.js
```
Then open `http://localhost:8080` in two browsers, or from another PC at `http://<pc-ip>:8080`. A change in one browser appears in the other within about 5 s. The chip at the top shows sync status. Click it to open Backup & Restore.
