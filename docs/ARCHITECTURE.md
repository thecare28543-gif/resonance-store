# Architecture

## The pieces

```
 Lab PC (Edge)                                   Server (Node.js 18+)                 PostgreSQL
 ┌───────────────────────────────────────┐       ┌──────────────────────────────┐    ┌──────────────────────┐
 │ login.html  (GID / GID)               │       │ server.js                    │    │ resonance_store      │
 │ RESONANCE_STORE.html                  │       │  ├ log-in, roles, sessions   │    │  ├ app_users …       │
 │  ├ sync.js   (loads first)            │ HTTP  │  ├ serves the app files      │ pg │  ├ rs_kv (master)    │
 │  │   pulls shared data → localStorage │◄─────►│  │   (only after log-in)     │◄──►│  ├ store_rows, jobs, │
 │  │   pushes every change, polls 5 s   │       │  ├ /api/data (one shared     │    │  │   holds … (read)  │
 │  ├ app.js    (the whole UI)           │       │  │   copy, 3-way merge)      │    │  └ rs_backups        │
 │  └ sw.js     (offline cache)          │       │  └ backups: hourly + shift   │    └──────────────────────┘
 │ users.html  (admins: accounts)        │       │      (+ optional team folder)│
 └───────────────────────────────────────┘       └──────────────────────────────┘
```

- **`app.js`** is the application: tabs, KPIs, 2D rack map, 3D store (three.js), import/export, hold, pick list, reports, Kaizen dashboard. It only knows `localStorage`. It has no idea a server exists.
- **`sync.js`** sits between `app.js` and the server. It wraps `localStorage.setItem`: every write to a **shared key** is queued and sent with `PUT api/data`. Every 5 s it polls `GET api/data?since=<version>` and writes other PCs' changes into `localStorage`. It then fires a `storage` event, which `app.js` already handles by reloading its state.
- **`sw.js`** is a service worker that caches the app files, so the page still opens when the server is down. It only works on `https` or `localhost`.
- **`server.js`** keeps the shared data in PostgreSQL (`rs_kv` + a global version in `rs_meta`), handles log-in and roles, and takes the backups (table `rs_backups`). The full API contract is in `DEPLOY.md`; tables in `app/db/schema.sql`.

## Modes (shown in the status chip in the top bar)

| Mode | When | Behaviour |
|---|---|---|
| `local` | Page opened as a file (`file://`) | This PC only, like the original dashboard. |
| `online` | Server reachable | All PCs see the same data within ~5 s. |
| `offline` | Server stopped answering | Keeps working on this PC, queues changes (`rsSyncPending`), sends them when the server is back. |

**Conflicts:** two PCs change the same key from the same base version. The second `PUT` gets `409`; its copy is saved as a `…-conflict` backup, then `sync.js` merges both changes (3-way merge against the version it started from; store rows by `_id`) and sends again. Both PCs' changes are kept.

**Version check:** `VER` in `sync.js` is sent as `X-RS-Ver`; the server reports which versions ran in the last 2 minutes and the app warns when a PC still runs old files. **Bump `VER` on every release of `app.js` / `sync.js`.**

## Data lives in `localStorage` keys

Each key holds a JSON string. The keys listed in `SHARED` at the top of `sync.js` are synced across PCs. All other keys stay on each PC. Details are in `DATA.md`.

**If you add a new key that must be the same on every PC, add it to `SHARED` in `sync.js`.** Otherwise it silently stays per-PC.

## The physical store the code models

- **Racks and positions:** 2 racks (A, B), each with 2 sides (L, R) × 3 floors × 2 cells (IN, OUT), giving **24 positions**. Each position holds at most **80 pieces** (`LIMIT`).
- **Sides and access:** the two racks face each other across one aisle. A-R and B-L are reached from the aisle. A-L is reached from behind rack A, and B-R from beyond rack B. On every shelf, OUT is the half towards T1 and IN is the half towards the back of the room. The comments at `zoneXZ` and `walkPath` in the 3D section are the reference.
- **Testers:** 3 test benches, T1–T3. Operators carry trays from a bench to the racks. The 3D room geometry (`GEO`, in the 3D section) is in metres and also drives the walking-distance logic in "smart slot" and the pick list.
- **Zones:** each position can be bound to a Product and a Type. One position is the HOLD zone. Defaults are in `DEFAULT_ZONES`, and users can change them in the app (Zone Setup). Their changes are stored in `resZoneV1`.
- **Hold:** a held job cannot be scrapped, picked out or deleted. Hold needs a name and a reason; release needs an approver and a reason. Every hold, release and blocked attempt is logged (`resHoldLogV1`) and shown in the Audit Log.

## Things that look like features but are not in use yet

QR labels and scanning (`QR LABELS`, `SCAN`, `POKA-YOKE` sections) are implemented. They are **not used in the lab yet**: the lab is still choosing a scanner that meets clean-room rules. Keep the code; it is the planned next phase.

## Log-in and roles

Everyone logs in on `login.html` with **user = GID, password = GID** (lab decision). The logged-in name fills the editor field (`Last_Editor` and the logs) and cannot be typed over. Roles: `admin` (everything + `users.html` + restore), `user` (store work), `viewer` (read only: `sync.js` refuses to write shared keys and the server returns 403). Details and security notes in `DEPLOY.md`.

Opening `RESONANCE_STORE.html` directly as a file still works (mode `local`, this PC only, no log-in) — keep it for emergencies only.
